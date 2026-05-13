param(
  [switch]$NoStart,
  [switch]$SkipWinget
)

$ErrorActionPreference = 'Stop'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$NodeModulesDir = Join-Path $Root 'node_modules'
$EnvPath = Join-Path $Root '.env'

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
  param([string]$Message)
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Fail {
  param([string]$Message)
  Write-Host "[ERROR] $Message" -ForegroundColor Red
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

function Get-NodeExecutable {
  $bundledCandidates = @(
    (Join-Path $Root 'runtime\node\node.exe'),
    (Join-Path $Root 'node_modules\.bin\node.exe')
  )

  foreach ($candidate in $bundledCandidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }

  $nodeCommand = Get-Command 'node.exe' -ErrorAction SilentlyContinue
  if ($nodeCommand) {
    return $nodeCommand.Source
  }

  $nodeCommand = Get-Command 'node' -ErrorAction SilentlyContinue
  if ($nodeCommand) {
    return $nodeCommand.Source
  }

  $candidates = @(
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }

  return $null
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

  if ($SkipWinget) {
    return $false
  }

  $winget = Get-Command 'winget.exe' -ErrorAction SilentlyContinue
  if (-not $winget) {
    return $false
  }

  if ($Upgrade) {
    Write-Host "Trying to upgrade Node.js LTS with winget..."
    & $winget.Source upgrade --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
  } else {
    Write-Host "Trying to install Node.js LTS with winget..."
    & $winget.Source install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
  }

  Refresh-ProcessPath
  return [bool](Get-NodeExecutable)
}

function Show-ManualNodeHelp {
  Write-Fail 'Node.js is required before this app can run.'
  Write-Host ''
  Write-Host 'The bundled Node runtime was not found or cannot run.'
  Write-Host 'Please install Node.js 22 or newer, then run install-new-pc.bat again.'
  Write-Host 'Download page: https://nodejs.org'
  Write-Host 'Keep "Add to PATH" enabled during installation.'

  try {
    Start-Process 'https://nodejs.org'
  } catch {
    # The printed URL is enough if the browser cannot be opened.
  }
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
    Write-Ok 'Offline dependencies are present.'
    return
  }

  Write-Host 'Some dependency files are missing:'
  $missing | ForEach-Object { Write-Host "  - $_" }

  $npmPath = Get-NpmExecutable
  if (-not $npmPath) {
    Write-Fail 'npm is not available, so missing dependencies cannot be restored automatically.'
    Write-Host 'Use the full offline package that includes node_modules, or reinstall Node.js with npm enabled.'
    exit 1
  }

  Write-Host ''
  Write-Host 'Running npm install to download and restore dependencies...'
  Push-Location $Root
  try {
    & $npmPath install
  } finally {
    Pop-Location
  }

  $missingAfterInstall = @(Get-MissingDependencyFiles)
  if ($missingAfterInstall.Count -gt 0) {
    Write-Fail 'Dependencies are still incomplete after npm install.'
    $missingAfterInstall | ForEach-Object { Write-Host "  - $_" }
    exit 1
  }

  Write-Ok 'Dependencies restored.'
}

Write-Step 'Checking project location'
Write-Host "Project: $($Root.Path)"
if (-not (Test-Path -LiteralPath (Join-Path $Root 'package.json'))) {
  Write-Fail 'package.json was not found. Please run this script from the extracted risk project folder.'
  exit 1
}
Write-Ok 'Project files found.'

Write-Step 'Checking Node.js runtime'
Refresh-ProcessPath
$nodePath = Get-NodeExecutable

if (-not $nodePath) {
  $installed = Invoke-WingetNodeSetup
  Refresh-ProcessPath
  $nodePath = Get-NodeExecutable

  if (-not $installed -or -not $nodePath) {
    Show-ManualNodeHelp
    exit 1
  }
}

$nodeInfo = Get-NodeVersionInfo -NodePath $nodePath
if (-not $nodeInfo) {
  Write-Fail "Node.js was found but cannot be executed: $nodePath"
  exit 1
}

if ($nodeInfo.Major -lt 22) {
  Write-Host "Current Node.js version is $($nodeInfo.Full), but this project requires 22 or newer." -ForegroundColor Yellow
  [void](Invoke-WingetNodeSetup -Upgrade)
  Refresh-ProcessPath
  $nodePath = Get-NodeExecutable
  $nodeInfo = Get-NodeVersionInfo -NodePath $nodePath

  if (-not $nodeInfo -or $nodeInfo.Major -lt 22) {
    Show-ManualNodeHelp
    exit 1
  }
}

Write-Ok "Node.js $($nodeInfo.Full) is ready: $nodePath"

Write-Step 'Checking offline dependencies'
if (-not (Test-Path -LiteralPath $NodeModulesDir)) {
  Write-Host 'node_modules was not found. This package will download dependencies with npm install.'
}
Ensure-Dependencies

Write-Step 'Checking configuration'
if (-not (Test-Path -LiteralPath $EnvPath)) {
  Write-Host '.env was not found. Creating a local default .env file.'
  @(
    'SERVER_PORT=3000',
    'SERVER_HOST=localhost',
    'USE_PLATFORM_BACKEND=false',
    'SUDA_DATABASE_URL=',
    'CLIENT_DEV_PORT=8080',
    'RISK_BROWSER_DEBUG_PORT=9222',
    'RISK_INTRANET_ORIGIN=https://risk.example.internal',
    'RISK_API_PATH=/api/ab-bpm/biz/bizCustGrid/view/list_fxgl_xcydfxpcmxsjlb',
    'RISK_RECORD_LIST_API_PATH=/api/ab-bpm/biz/bizCustGrid/view/fxgl_xcydfxpcjlsjlb',
    'RISK_KEEPALIVE_ENABLED=true',
    'RISK_KEEPALIVE_INTERVAL_MS=300000',
    'RISK_KEEPALIVE_START_DELAY_MS=30000',
    'RISK_AUTO_SYNC_ENABLED=true',
    'RISK_AUTO_SYNC_SCHEDULES=08:33',
    'RISK_AUTO_SYNC_HOUR=8',
    'RISK_AUTO_SYNC_MINUTE=33',
    'CHANGE_INTRANET_ORIGIN=https://change.example.internal',
    'DRILL_INTRANET_ORIGIN=https://emergencydrill.meta42.indc.vnet.com',
    'DRILL_LIST_URL=https://emergencydrill.meta42.indc.vnet.com/api/emergencydrill/exercisePlan/queryExercisePlanList',
    'DRILL_EVALUATION_URL=https://emergencydrill.meta42.indc.vnet.com/api/event/eventOrder/selEventMsg',
    'DRILL_EVALUATION_DETAIL_URL=https://emergencydrill.meta42.indc.vnet.com/api/emergencydrill/exerciseEvaluation/selExerciseEvaluationTemplate',
    'EVENT_INTRANET_ORIGIN=https://event.example.internal',
    'INSPECT_INTRANET_ORIGIN=https://inspect2.meta42.indc.vnet.com',
    'EVENT_LIST_URL=https://event.example.internal/api/event/eventOrder/selEventMsg',
    'INSPECT_LIST_URL=https://inspect2.meta42.indc.vnet.com/api/inspect/inspection/job/list',
    'INSPECT_DATACENTER_CODE=0.5.2.2.1.1',
    'INSPECT_AUTO_SYNC_ENABLED=true',
    'INSPECT_AUTO_SYNC_SCHEDULES=07:00,11:00,17:00,23:30',
    'INSPECT_AUTO_SYNC_NOTIFY_ENABLED=true',
    'CHANGE_AUTO_SYNC_ENABLED=true',
    'CHANGE_AUTO_SYNC_SCHEDULES=08:35,13:05,16:05',
    'DRILL_AUTO_SYNC_ENABLED=true',
    'DRILL_AUTO_SYNC_SCHEDULES=08:33',
    'DRILL_AUTO_SYNC_PAGE_SIZE=100',
    'DRILL_AUTO_SYNC_LIST_CONCURRENCY=6',
    'DRILL_AUTO_SYNC_MAX_PAGES=1000',
    'DRILL_EVALUATION_PAGE_SIZE=100',
    'DRILL_EVALUATION_LIST_CONCURRENCY=6',
    'DRILL_EVALUATION_MAX_PAGES=1000',
    'EVENT_AUTO_SYNC_ENABLED=true',
    'EVENT_AUTO_SYNC_SCHEDULES=08:37,13:38,16:08',
    'EVENT_AUTO_SYNC_PAGE_SIZE=300',
    'EVENT_AUTO_SYNC_LIST_CONCURRENCY=6',
    'EVENT_AUTO_SYNC_MAX_PAGES=1000',
    'EVENT_AUTO_SYNC_PAGE_RETRY_ATTEMPTS=3',
    'EVENT_AUTO_SYNC_PAGE_RETRY_DELAY_MS=1200',
    'EVENT_INCOMPLETE_ORDER_STATUS=1,2,3,4,6',
    'EVENT_ALL_ORDER_STATUS=1,2,3,4,5,6',
    'EVENT_INCREMENTAL_SYNC_ORDER_STATUS=1,2,3,4,5,6',
    'EVENT_INCREMENTAL_SYNC_LOOKBACK_DAYS=30',
    'EVENT_INCREMENTAL_SYNC_START_DATE_FIELD=startDate',
    'EVENT_INCREMENTAL_SYNC_END_DATE_FIELD=endDate',
    'EVENT_INCREMENTAL_CREATED_START_DATE_FIELD=startDate',
    'EVENT_INCREMENTAL_CREATED_END_DATE_FIELD=endDate',
    'EVENT_INCREMENTAL_HAPPEN_START_DATE_FIELD=startHappendDate',
    'EVENT_INCREMENTAL_HAPPEN_END_DATE_FIELD=endHappendDate',
    'EVENT_MONTHLY_SYNC_ENABLED=true',
    'EVENT_MONTHLY_SYNC_SCHEDULES=07:50',
    'EVENT_MONTHLY_SYNC_ORDER_STATUS=1,2,3,4,5,6',
    'EVENT_MONTHLY_SYNC_START_DATE_FIELD=startDate',
    'EVENT_MONTHLY_SYNC_END_DATE_FIELD=endDate',
    'EVENT_COMPLETED_SYNC_ENABLED=true',
    'EVENT_COMPLETED_ORDER_STATUS=5',
    'EVENT_COMPLETED_START_DATE=2026-01-01 00:00:00',
    'EVENT_COMPLETED_END_DATE=',
    'EVENT_COMPLETED_START_DATE_FIELD=startDate',
    'EVENT_COMPLETED_END_DATE_FIELD=endDate',
    'EVENT_FULL_SYNC_ORDER_STATUS=1,2,3,4,5,6',
    'EVENT_FULL_SYNC_START_DATE=',
    'EVENT_FULL_SYNC_END_DATE=',
    'EVENT_FULL_SYNC_START_DATE_FIELD=startDate',
    'EVENT_FULL_SYNC_END_DATE_FIELD=endDate',
    'EVENT_SYNC_STATE_PATH=',
    'EVENT_SYNC_PREVIEW_LIMIT=300',
    'INSPECT_AUTO_SYNC_PAGE_SIZE=15',
    'INSPECT_AUTO_SYNC_LIST_CONCURRENCY=6',
    'INSPECT_AUTO_SYNC_MAX_PAGES=1000',
    'INSPECT_SYNC_PREVIEW_LIMIT=300',
    'FEISHU_APP_ID=',
    'FEISHU_APP_SECRET=',
    'FEISHU_BITABLE_APP_TOKEN=',
    'FEISHU_BITABLE_TABLE_ID=',
    'FEISHU_BITABLE_VIEW_ID=',
    'FEISHU_NOTIFY_CHAT_ID=',
    'FEISHU_NOTIFY_CHAT_NAME=',
    'EXTRA_ABNORMAL_NOTIFY_ENABLED=true',
    'EXTRA_ABNORMAL_NOTIFY_CHAT_ID=oc_38825452b566a9c8d5859d54eb31a64c',
    'CHANGE_FEISHU_APP_ID=',
    'CHANGE_FEISHU_APP_SECRET=',
    'CHANGE_FEISHU_BITABLE_APP_TOKEN=',
    'CHANGE_FEISHU_WORKORDER_TABLE_ID=',
    'CHANGE_FEISHU_BASIC_DATA_TABLE_ID=',
    'CHANGE_FEISHU_BASIC_DATA_VIEW_ID=',
    'EVENT_FEISHU_APP_ID=',
    'EVENT_FEISHU_APP_SECRET=',
    'EVENT_FEISHU_BITABLE_APP_TOKEN=',
    'EVENT_FEISHU_TABLE_ID=',
    'EVENT_FEISHU_VIEW_ID=',
    'EVENT_FEISHU_NOTIFY_CHAT_ID=',
    'EVENT_FEISHU_NOTIFY_CHAT_NAME=',
    'INSPECT_FEISHU_APP_ID=',
    'INSPECT_FEISHU_APP_SECRET=',
    'INSPECT_FEISHU_BITABLE_APP_TOKEN=IrIibPkUOa6udGsMhu2cbOqhnWg',
    'INSPECT_FEISHU_TABLE_ID=tblTXHrDH4Mv0971',
    'INSPECT_FEISHU_VIEW_ID=vewgfEzEZl',
    'INSPECT_FEISHU_NOTIFY_CHAT_ID=',
    'INSPECT_FEISHU_NOTIFY_CHAT_NAME=',
    'FORCE_AUTHN_INNERAPI_DOMAIN=',
    'FORCE_AUTHN_ACCESS_KEY=',
    'FORCE_AUTHN_ACCESS_SECRET=',
    'LOG_REQUEST_BODY=true',
    'LOG_RESPONSE_BODY=true'
  ) | Set-Content -LiteralPath $EnvPath -Encoding UTF8
}
Write-Ok '.env is ready.'

Write-Step 'Install check complete'
Write-Host 'Next steps:'
Write-Host '1. Connect to VPN.'
Write-Host '2. Double-click start-dev.bat.'
Write-Host '3. Log in on the intranet browser tab opened by the script.'
Write-Host '4. Use http://localhost:8080 and click the data fetch button.'
Write-Host '5. Double-click stop-dev.bat when done.'

if (-not $NoStart) {
  Write-Host ''
  $answer = Read-Host 'Start the app now? Type Y to start, or press Enter to exit'
  if ($answer -match '^(y|yes)$') {
    & (Join-Path $Root 'start-dev.bat')
  }
}
