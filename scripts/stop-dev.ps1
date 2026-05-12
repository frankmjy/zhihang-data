$ErrorActionPreference = 'Stop'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$RunDir = Join-Path $Root '.run'
$EnvPath = Join-Path $Root '.env'

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

function Add-ProcessTree {
  param(
    [int]$RootProcessId,
    [System.Collections.Generic.HashSet[int]]$TargetIds,
    [array]$AllProcesses
  )

  if ($RootProcessId -le 0) {
    return
  }

  [void]$TargetIds.Add($RootProcessId)

  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($process in $AllProcesses) {
      if ($TargetIds.Contains([int]$process.ParentProcessId) -and -not $TargetIds.Contains([int]$process.ProcessId)) {
        [void]$TargetIds.Add([int]$process.ProcessId)
        $changed = $true
      }
    }
  }
}

function Stop-ProcessTree {
  param([int[]]$RootProcessIds)

  $allProcesses = @(Get-CimInstance Win32_Process)
  $targetIds = [System.Collections.Generic.HashSet[int]]::new()

  foreach ($rootProcessId in $RootProcessIds) {
    Add-ProcessTree -RootProcessId $rootProcessId -TargetIds $targetIds -AllProcesses $allProcesses
  }

  foreach ($processId in ($targetIds | Sort-Object -Descending)) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
}

$rootProcessIds = @()
if (Test-Path -LiteralPath $RunDir) {
  Get-ChildItem -LiteralPath $RunDir -Filter '*.pid' -ErrorAction SilentlyContinue | ForEach-Object {
    $content = Get-Content -LiteralPath $_.FullName -ErrorAction SilentlyContinue
    if ($content) {
      $rootProcessIds += [int]$content
    }
  }
}

$allProcesses = @(Get-CimInstance Win32_Process)
$escapedRoot = [regex]::Escape($Root.Path)
$fallbackProcesses = $allProcesses | Where-Object {
  $_.CommandLine -and
  ($_.CommandLine -match $escapedRoot) -and
  ($_.CommandLine -match 'run-with-env\.js development|nest start --watch|rspack serve|local-api-supervisor\.js|client-supervisor\.js|risk-local-api\.js|remote-debugging-port|npm run dev:(server|client|local-api)')
}

$rootProcessIds += @($fallbackProcesses | ForEach-Object { [int]$_.ProcessId })
$rootProcessIds = @($rootProcessIds | Sort-Object -Unique)

if ($rootProcessIds.Count -eq 0) {
  Write-Host 'No local dev service processes found.'
} else {
  Write-Host "Stopping local dev service processes: $($rootProcessIds -join ', ')"
  Stop-ProcessTree -RootProcessIds $rootProcessIds
}

if (Test-Path -LiteralPath $RunDir) {
  Get-ChildItem -LiteralPath $RunDir -Filter '*.pid' -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 2

$serverPort = [int](Get-DotEnvValue -Key 'SERVER_PORT' -Default '3000')
$clientPort = [int](Get-DotEnvValue -Key 'CLIENT_DEV_PORT' -Default '8080')
$listeners = Get-NetTCPConnection -LocalPort $serverPort,$clientPort -State Listen -ErrorAction SilentlyContinue

if ($listeners) {
  Write-Warning 'Some configured ports are still listening:'
  $listeners | Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table
  exit 1
}

if (Test-Path -LiteralPath $RunDir) {
  Remove-Item -LiteralPath $RunDir -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null

Write-Host 'Runtime cache cleared.'
Write-Host 'Local dev services stopped.'
