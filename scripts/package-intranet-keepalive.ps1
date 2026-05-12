param(
  [string]$OutputDir = ''
)

$ErrorActionPreference = 'Stop'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$OutputRoot = if ($OutputDir) {
  [System.IO.Path]::GetFullPath((Join-Path $Root $OutputDir))
} else {
  Join-Path $Root 'dist'
}
$RunDir = Join-Path $Root '.run'
$StageRoot = Join-Path $RunDir 'package-intranet-keepalive'
$StandaloneStage = Join-Path $StageRoot 'intranet-keepalive-standalone'
$SkillStage = Join-Path $StageRoot 'zhihang-intranet-keepalive'
$SkillSource = Join-Path $env:USERPROFILE '.codex\skills\zhihang-intranet-keepalive'

function Assert-ChildPath {
  param(
    [string]$Child,
    [string]$Parent
  )

  $childFull = [System.IO.Path]::GetFullPath($Child)
  $parentFull = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  if (-not $childFull.StartsWith($parentFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify path outside expected directory: $childFull"
  }
}

function Reset-Directory {
  param([string]$Path)

  Assert-ChildPath -Child $Path -Parent $RunDir
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Copy-RequiredFile {
  param(
    [string]$Source,
    [string]$Destination
  )

  if (-not (Test-Path -LiteralPath $Source)) {
    throw "Missing required file: $Source"
  }

  $parent = Split-Path -Parent $Destination
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
Reset-Directory -Path $StageRoot
New-Item -ItemType Directory -Force -Path $StandaloneStage | Out-Null

Copy-RequiredFile -Source (Join-Path $Root 'scripts\intranet-keepalive.js') -Destination (Join-Path $StandaloneStage 'intranet-keepalive.js')
Copy-RequiredFile -Source (Join-Path $Root 'start-intranet-keepalive.bat') -Destination (Join-Path $StandaloneStage 'start-intranet-keepalive.bat')
Copy-RequiredFile -Source (Join-Path $Root '.env.keepalive.example') -Destination (Join-Path $StandaloneStage '.env.keepalive.example')
Copy-RequiredFile -Source (Join-Path $Root 'INTRANET_KEEPALIVE_MIGRATION.md') -Destination (Join-Path $StandaloneStage 'INTRANET_KEEPALIVE_MIGRATION.md')

$StandaloneZip = Join-Path $OutputRoot 'intranet-keepalive-standalone.zip'
if (Test-Path -LiteralPath $StandaloneZip) {
  Remove-Item -LiteralPath $StandaloneZip -Force
}
Compress-Archive -Path (Join-Path $StandaloneStage '*') -DestinationPath $StandaloneZip -Force
Write-Host "Standalone package: $StandaloneZip"

if (Test-Path -LiteralPath $SkillSource) {
  Copy-Item -LiteralPath $SkillSource -Destination $StageRoot -Recurse -Force
  $SkillZip = Join-Path $OutputRoot 'zhihang-intranet-keepalive-skill.zip'
  if (Test-Path -LiteralPath $SkillZip) {
    Remove-Item -LiteralPath $SkillZip -Force
  }
  Compress-Archive -Path $SkillStage -DestinationPath $SkillZip -Force
  Write-Host "Skill package: $SkillZip"
} else {
  Write-Warning "Skill source not found, skipped skill zip: $SkillSource"
}
