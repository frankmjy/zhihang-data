param(
  [switch]$NoBrowser,
  [int]$ReadyTimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$LogDir = Join-Path $Root 'logs'
$RunDir = Join-Path $Root '.run'
$EnvPath = Join-Path $Root '.env'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null

function Get-DotEnvValue {
  param(
    [string]$Key,
    [string]$Default
  )

  if (-not (Test-Path -LiteralPath $EnvPath)) {
    return $Default
  }

  $line = Get-Content -LiteralPath $EnvPath |
    Where-Object { $_ -match "^\s*$([regex]::Escape($Key))\s*=" } |
    Select-Object -First 1

  if (-not $line) {
    return $Default
  }

  return (($line -split '=', 2)[1]).Trim()
}

function Get-Listener {
  param([int]$Port)
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
}

function Test-PortReady {
  param([int]$Port)

  $targets = @(
    @{
      Address = [System.Net.IPAddress]::Loopback
      Family = [System.Net.Sockets.AddressFamily]::InterNetwork
    },
    @{
      Address = [System.Net.IPAddress]::IPv6Loopback
      Family = [System.Net.Sockets.AddressFamily]::InterNetworkV6
    }
  )

  foreach ($target in $targets) {
    $client = [System.Net.Sockets.TcpClient]::new($target.Family)
    try {
      $asyncResult = $client.BeginConnect($target.Address, $Port, $null, $null)
      if (-not $asyncResult.AsyncWaitHandle.WaitOne(250, $false)) {
        continue
      }

      $client.EndConnect($asyncResult)
      return $true
    } catch {
      continue
    } finally {
      $client.Close()
    }
  }

  return $false
}

function Get-EffectiveEnvValue {
  param([string]$Key)

  $value = [Environment]::GetEnvironmentVariable($Key)
  if ($value) {
    return $value
  }

  return Get-DotEnvValue -Key $Key -Default ''
}

function Test-ProcessAlive {
  param([string]$PidFile)

  if (-not (Test-Path -LiteralPath $PidFile)) {
    return $false
  }

  $processId = Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue
  if (-not $processId) {
    return $false
  }

  return [bool](Get-Process -Id ([int]$processId) -ErrorAction SilentlyContinue)
}

function Start-AppProcess {
  param(
    [string]$Name,
    [string]$FilePath,
    [string[]]$Arguments
  )

  $pidFile = Join-Path $RunDir "$Name.pid"
  if (Test-ProcessAlive $pidFile) {
    $existingPid = Get-Content -LiteralPath $pidFile
    Write-Host "$Name already running. PID: $existingPid"
    return [int]$existingPid
  }

  $outLog = Join-Path $LogDir "$Name.out.log"
  $errLog = Join-Path $LogDir "$Name.err.log"

  "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Starting $Name" | Set-Content -LiteralPath $outLog
  "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Starting $Name" | Set-Content -LiteralPath $errLog

  $process = Start-Process `
    -FilePath $FilePath `
    -ArgumentList $Arguments `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -WindowStyle Hidden `
    -PassThru

  Set-Content -LiteralPath $pidFile -Value $process.Id
  Write-Host "$Name started. PID: $($process.Id)"
  return [int]$process.Id
}

function Get-LocalBin {
  param([string]$Name)

  $fileName = if ($IsWindows -or $env:OS -eq 'Windows_NT') { "$Name.cmd" } else { $Name }
  return Join-Path $Root "node_modules\.bin\$fileName"
}

function Start-PackageScript {
  param(
    [string]$Name,
    [string]$ScriptName
  )

  if ($NpmPath) {
    return Start-AppProcess -Name $Name -FilePath $NpmPath -Arguments @('run', $ScriptName)
  }

  if ($ScriptName -eq 'dev:local-api') {
    return Start-AppProcess -Name $Name -FilePath $NodePath -Arguments @('.\scripts\local-api-supervisor.js')
  }

  if ($ScriptName -eq 'dev:client:supervisor') {
    return Start-AppProcess -Name $Name -FilePath $NodePath -Arguments @('.\scripts\client-supervisor.js')
  }

  if ($ScriptName -eq 'dev:client') {
    $rspackPath = Get-LocalBin -Name 'rspack'
    if (-not (Test-Path -LiteralPath $rspackPath)) {
      Write-Host "错误: 未找到 $rspackPath，依赖不完整，请使用包含 node_modules 的完整包，或安装 npm 后执行 npm install。" -ForegroundColor Red
      exit 1
    }

    return Start-AppProcess -Name $Name -FilePath $rspackPath -Arguments @('serve', '--config', 'rspack.config.js', '--env', 'mode=development')
  }

  if ($ScriptName -eq 'dev:server') {
    $nestPath = Get-LocalBin -Name 'nest'
    if (-not (Test-Path -LiteralPath $nestPath)) {
      Write-Host "错误: 未找到 $nestPath，依赖不完整，请使用包含 node_modules 的完整包，或安装 npm 后执行 npm install。" -ForegroundColor Red
      exit 1
    }

    return Start-AppProcess -Name $Name -FilePath $nestPath -Arguments @('start', '--watch')
  }

  Write-Host "错误: 不支持的启动脚本 $ScriptName。" -ForegroundColor Red
  exit 1
}

function Get-BrowserExecutable {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }

  return $null
}

function Open-AppBrowser {
  param([string]$Url)

  $browserPath = Get-BrowserExecutable
  if (-not $browserPath) {
    Start-Process $Url
    return
  }

  $debugPort = [int](Get-DotEnvValue -Key 'RISK_BROWSER_DEBUG_PORT' -Default '9222')
  $intranetOrigin = Get-DotEnvValue -Key 'RISK_INTRANET_ORIGIN' -Default 'https://risk.example.internal'
  $changeIntranetOrigin = Get-DotEnvValue -Key 'CHANGE_INTRANET_ORIGIN' -Default 'https://change.example.internal'
  $drillIntranetOrigin = Get-DotEnvValue -Key 'DRILL_INTRANET_ORIGIN' -Default 'https://drill.example.internal'
  $eventIntranetOrigin = Get-DotEnvValue -Key 'EVENT_INTRANET_ORIGIN' -Default 'https://event.example.internal'
  $profileDir = Join-Path $RunDir 'browser-profile'
  New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

  $browserTargets = @($intranetOrigin, $changeIntranetOrigin, $drillIntranetOrigin, $eventIntranetOrigin, $Url) |
    Where-Object { $_ } |
    Select-Object -Unique

  $browserArgs = @(
    "--remote-debugging-port=$debugPort",
    "--user-data-dir=$profileDir",
    '--no-first-run',
    '--new-window'
  ) + $browserTargets

  $process = Start-Process -FilePath $browserPath -ArgumentList $browserArgs -PassThru
  Set-Content -LiteralPath (Join-Path $RunDir 'browser.pid') -Value $process.Id
  Write-Host "Browser opened with debug port $debugPort. PID: $($process.Id)"
  Write-Host "If intranet data fetching fails, complete login in the risk, change, drill, and event intranet tabs opened by this browser window."
}

function Add-DirectoryToPath {
  param([string]$Directory)

  if (-not $Directory) {
    return
  }

  $existingSegments = @($env:Path -split ';' | Where-Object { $_ })
  if ($existingSegments -notcontains $Directory) {
    $env:Path = "$Directory;$env:Path"
  }
}

function Refresh-ProcessPath {
  $segments = @()
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')

  if ($machinePath) {
    $segments += $machinePath -split ';'
  }

  if ($userPath) {
    $segments += $userPath -split ';'
  }

  $commonNodeDirs = @(
    (Join-Path $Root 'runtime\node'),
    (Join-Path $Root 'node_modules\.bin'),
    (Join-Path $env:ProgramFiles 'nodejs'),
    (Join-Path ${env:ProgramFiles(x86)} 'nodejs'),
    (Join-Path $env:LOCALAPPDATA 'Programs\nodejs')
  )

  $segments += $commonNodeDirs
  $env:Path = (($segments | Where-Object { $_ } | Select-Object -Unique) -join ';')
}

function Use-NodeExecutable {
  param([string]$Path)

  Add-DirectoryToPath -Directory (Split-Path -Parent $Path)
  return $Path
}

function Get-NpmExecutable {
  $npmCommand = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
  if ($npmCommand) {
    return $npmCommand.Source
  }

  $npmCommand = Get-Command 'npm' -ErrorAction SilentlyContinue
  if ($npmCommand) {
    return $npmCommand.Source
  }

  $candidates = @(
    (Join-Path $env:ProgramFiles 'nodejs\npm.cmd'),
    (Join-Path ${env:ProgramFiles(x86)} 'nodejs\npm.cmd'),
    (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\npm.cmd')
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }

  return $null
}

function Get-NodeExecutable {
  $bundledCandidates = @(
    (Join-Path $Root 'runtime\node\node.exe'),
    (Join-Path $Root 'node_modules\.bin\node.exe')
  )

  foreach ($candidate in $bundledCandidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return Use-NodeExecutable -Path $candidate
    }
  }

  $nodeCommand = Get-Command 'node.exe' -ErrorAction SilentlyContinue
  if ($nodeCommand) {
    return Use-NodeExecutable -Path $nodeCommand.Source
  }

  $nodeCommand = Get-Command 'node' -ErrorAction SilentlyContinue
  if ($nodeCommand) {
    return Use-NodeExecutable -Path $nodeCommand.Source
  }

  $candidates = @(
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return Use-NodeExecutable -Path $candidate
    }
  }

  return $null
}

function Get-NodeVersionInfo {
  param([string]$NodePath)

  try {
    $version = (& $NodePath -p "process.versions.node").Trim()
    $majorText = ($version -split '\.')[0]
    $major = 0
    if ([int]::TryParse($majorText, [ref]$major)) {
      return @{
        Full = $version
        Major = $major
      }
    }
  } catch {
    return $null
  }

  return $null
}

function Invoke-WingetNodeSetup {
  param([switch]$Upgrade)

  $winget = Get-Command 'winget.exe' -ErrorAction SilentlyContinue
  if (-not $winget) {
    return $false
  }

  if ($Upgrade) {
    Write-Host 'Node.js 版本低于 22，尝试使用 winget 升级 Node.js LTS...'
    & $winget.Source upgrade --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
  } else {
    Write-Host '未找到 Node.js，尝试使用 winget 安装 Node.js LTS...'
    & $winget.Source install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
  }

  Refresh-ProcessPath
  return [bool](Get-NodeExecutable)
}

function Get-MissingDependencyFiles {
  $requiredFiles = @(
    'node_modules\.bin\rspack.cmd',
    'node_modules\@rspack\core\package.json',
    'node_modules\react\package.json',
    'node_modules\react-dom\package.json',
    'node_modules\@nestjs\cli\package.json'
  )

  $missing = @()
  foreach ($relativePath in $requiredFiles) {
    $fullPath = Join-Path $Root $relativePath
    if (-not (Test-Path -LiteralPath $fullPath)) {
      $missing += $relativePath
    }
  }

  return $missing
}

function Ensure-Dependencies {
  $missing = @(Get-MissingDependencyFiles)
  if ($missing.Count -eq 0) {
    Write-Host '依赖检查通过。'
    return
  }

  Write-Host '检测到依赖缺失，将执行 npm install 自动下载：'
  $missing | ForEach-Object { Write-Host "  - $_" }

  if (-not $NpmPath) {
    Show-NpmInstallHelp
  }

  Push-Location $Root
  try {
    & $NpmPath install
  } finally {
    Pop-Location
  }

  $missingAfterInstall = @(Get-MissingDependencyFiles)
  if ($missingAfterInstall.Count -gt 0) {
    Write-Host ''
    Write-Host '错误: npm install 后依赖仍不完整。' -ForegroundColor Red
    $missingAfterInstall | ForEach-Object { Write-Host "  - $_" }
    exit 1
  }

  Write-Host '依赖安装完成。'
}

function Show-NodeInstallHelp {
  Write-Host ""
  Write-Host "错误: 当前电脑没有找到 Node.js，无法启动服务。" -ForegroundColor Red
  Write-Host ""
  Write-Host "请先安装 Node.js 22 或更高版本。"
  Write-Host "安装步骤："
  Write-Host "1. 打开 https://nodejs.org"
  Write-Host "2. 下载 Windows Installer / LTS 版本"
  Write-Host "3. 安装时保持 Add to PATH / 添加到 PATH 选项开启"
  Write-Host "4. 安装完成后关闭当前窗口，重新双击 start-dev.bat"
  Write-Host ""
  Write-Host "验证方式：打开新的 cmd 或 PowerShell，执行 node -v，应能看到版本号。"
  Write-Host ""

  try {
    Start-Process "https://nodejs.org"
  } catch {
    # Ignore browser launch failures; the printed URL is enough.
  }

  exit 1
}

function Show-NpmInstallHelp {
  Write-Host ""
  Write-Host "错误: 当前电脑没有找到 npm，且项目内没有 node_modules，无法自动安装依赖。" -ForegroundColor Red
  Write-Host ""
  Write-Host "处理方式二选一："
  Write-Host "1. 使用包含 node_modules 的完整离线依赖包。"
  Write-Host "2. 安装带 npm 的 Node.js，然后重新双击 start-dev.bat，让脚本自动 npm install。"
  Write-Host ""
  exit 1
}

$ServerPort = [int](Get-DotEnvValue -Key 'SERVER_PORT' -Default '3000')
$ClientPort = [int](Get-DotEnvValue -Key 'CLIENT_DEV_PORT' -Default '8080')
$PlatformDomain = Get-EffectiveEnvValue -Key 'FORCE_AUTHN_INNERAPI_DOMAIN'
$UsePlatformBackend = (Get-EffectiveEnvValue -Key 'USE_PLATFORM_BACKEND') -match '^(1|true|yes|on)$'
Refresh-ProcessPath
$NodePath = Get-NodeExecutable
if (-not $NodePath) {
  [void](Invoke-WingetNodeSetup)
  Refresh-ProcessPath
  $NodePath = Get-NodeExecutable

  if (-not $NodePath) {
    Show-NodeInstallHelp
  }
}

$NodeInfo = Get-NodeVersionInfo -NodePath $NodePath
if (-not $NodeInfo) {
  Write-Host "错误: Node.js 已找到但无法执行: $NodePath" -ForegroundColor Red
  exit 1
}

if ($NodeInfo.Major -lt 22) {
  [void](Invoke-WingetNodeSetup -Upgrade)
  Refresh-ProcessPath
  $NodePath = Get-NodeExecutable
  $NodeInfo = Get-NodeVersionInfo -NodePath $NodePath

  if (-not $NodeInfo -or $NodeInfo.Major -lt 22) {
    Show-NodeInstallHelp
  }
}
Write-Host "Node.js ready: $($NodeInfo.Full)"

$NpmPath = Get-NpmExecutable

if (-not $PlatformDomain) {
  Write-Host 'FORCE_AUTHN_INNERAPI_DOMAIN is empty. Using lightweight local API mode.'
} elseif (-not $UsePlatformBackend) {
  Write-Host 'FORCE_AUTHN_INNERAPI_DOMAIN is set, but USE_PLATFORM_BACKEND is not enabled. Using lightweight local API mode.'
}

Ensure-Dependencies

$serverListener = Get-Listener $ServerPort
$clientListener = Get-Listener $ClientPort

if ($serverListener -and $clientListener) {
  $url = "http://localhost:$ClientPort"
  Write-Host "Services already running: backend PID $($serverListener.OwningProcess), frontend PID $($clientListener.OwningProcess)."
  Write-Host "Frontend ready: $url"
  if (-not $NoBrowser) {
    Open-AppBrowser $url
  }
  exit 0
}

if ($serverListener -or $clientListener) {
  if ($serverListener) {
    Write-Warning "Port $ServerPort is already in use by PID $($serverListener.OwningProcess). Stop it first or change SERVER_PORT in .env."
  }

  if ($clientListener) {
    Write-Warning "Port $ClientPort is already in use by PID $($clientListener.OwningProcess). Stop it first or change CLIENT_DEV_PORT in .env."
  }

  exit 1
}

if ($PlatformDomain -and $UsePlatformBackend) {
  $serverPid = Start-PackageScript -Name 'server' -ScriptName 'dev:server'
} else {
  Write-Host 'Starting lightweight local API for browser-based intranet fetching.'
  $serverPid = Start-PackageScript -Name 'server' -ScriptName 'dev:local-api'
}
$clientPid = Start-PackageScript -Name 'client' -ScriptName 'dev:client:supervisor'

Write-Host ''
Write-Host 'Waiting for services to become ready...'

$serverReady = $false
$clientReady = $false
$deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
while ((Get-Date) -lt $deadline) {
  $serverReady = Test-PortReady $ServerPort
  $clientReady = Test-PortReady $ClientPort

  if ($serverReady -and $clientReady) {
    break
  }

  $serverAlive = [bool](Get-Process -Id $serverPid -ErrorAction SilentlyContinue)
  $clientAlive = [bool](Get-Process -Id $clientPid -ErrorAction SilentlyContinue)

  if (-not $serverReady -and -not $serverAlive -and $PlatformDomain -and $UsePlatformBackend) {
    Write-Warning 'Backend start process exited before the port became ready.'
  }

  if (-not $clientReady -and -not $clientAlive) {
    Write-Warning 'Frontend start process exited before the port became ready.'
    break
  }

  Start-Sleep -Milliseconds 500
}

Write-Host ''
if ($serverReady) {
  Write-Host "Backend ready:  http://localhost:$ServerPort"
} else {
  Write-Warning "Backend did not listen on port $ServerPort within $ReadyTimeoutSeconds seconds. Check logs\server.out.log and logs\server.err.log."
}

if ($clientReady) {
  $url = "http://localhost:$ClientPort"
  Write-Host "Frontend ready: $url"
  if (-not $NoBrowser) {
    Open-AppBrowser $url
  }
} else {
  Write-Warning "Frontend did not listen on port $ClientPort within $ReadyTimeoutSeconds seconds. Check logs\client.out.log and logs\client.err.log."
}

Write-Host ''
Write-Host 'Use stop-dev.bat or npm run local:stop to stop the services.'
