param(
  [string]$ExePath = "",
  [ValidateSet("global", "local")]
  [string]$GitScope = "global",
  [switch]$SkipGit,
  [switch]$SkipSvn,
  [switch]$SkipTortoiseSvn
)

$ErrorActionPreference = "Stop"

function Resolve-ExcelDiffExe {
  param([string]$PathFromUser)

  if ($PathFromUser -and (Test-Path -LiteralPath $PathFromUser)) {
    $resolved = Get-Item -LiteralPath $PathFromUser
    if ($resolved.PSIsContainer) {
      $nestedCandidates = @(
        (Join-Path $resolved.FullName "ExcelDiff.exe"),
        (Join-Path $resolved.FullName "Excel Diff.exe")
      )
      foreach ($candidate in $nestedCandidates) {
        if (Test-Path -LiteralPath $candidate) {
          return (Resolve-Path -LiteralPath $candidate).Path
        }
      }
      throw "ExePath points to a directory, but ExcelDiff.exe was not found inside: $PathFromUser"
    }
    return $resolved.FullName
  }

  $candidates = @(
    "$env:ProgramFiles\Excel Diff\ExcelDiff.exe",
    "${env:ProgramFiles(x86)}\Excel Diff\ExcelDiff.exe",
    "$PSScriptRoot\..\src-tauri\target\release\ExcelDiff.exe",
    "$PSScriptRoot\..\src-tauri\target\debug\ExcelDiff.exe"
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  throw "ExcelDiff.exe was not found. Pass -ExePath `"C:\Path\To\ExcelDiff.exe`"."
}

function Get-GitValue {
  param([string]$Name, [string]$Scope)
  $scopeArg = if ($Scope -eq "local") { "--local" } else { "--global" }
  $value = & git config $scopeArg --get $Name 2>$null
  if ($LASTEXITCODE -eq 0) { return $value }
  return $null
}

function Set-GitValue {
  param([string]$Name, [string]$Value, [string]$Scope)
  $scopeArg = if ($Scope -eq "local") { "--local" } else { "--global" }
  & git config $scopeArg $Name $Value
}

function Unset-GitValue {
  param([string]$Name, [string]$Scope)
  $scopeArg = if ($Scope -eq "local") { "--local" } else { "--global" }
  & git config $scopeArg --unset $Name 2>$null
}

function Read-SvnConfig {
  $path = Join-Path $env:APPDATA "Subversion\config"
  if (Test-Path -LiteralPath $path) {
    return Get-Content -LiteralPath $path -Raw
  }
  return ""
}

function Write-SvnDiffCmd {
  param([string]$WrapperPath)

  $configDir = Join-Path $env:APPDATA "Subversion"
  $configPath = Join-Path $configDir "config"
  New-Item -ItemType Directory -Force -Path $configDir | Out-Null
  if (!(Test-Path -LiteralPath $configPath)) {
    Set-Content -LiteralPath $configPath -Encoding UTF8 -Value "[helpers]`r`ndiff-cmd = $WrapperPath`r`n"
    return
  }

  $lines = Get-Content -LiteralPath $configPath
  $output = New-Object System.Collections.Generic.List[string]
  $inHelpers = $false
  $helpersSeen = $false
  $diffWritten = $false

  foreach ($line in $lines) {
    if ($line -match '^\s*\[helpers\]\s*$') {
      $helpersSeen = $true
      $inHelpers = $true
      $output.Add($line)
      continue
    }
    if ($line -match '^\s*\[.+\]\s*$') {
      if ($inHelpers -and !$diffWritten) {
        $output.Add("diff-cmd = $WrapperPath")
        $diffWritten = $true
      }
      $inHelpers = $false
      $output.Add($line)
      continue
    }
    if ($inHelpers -and $line -match '^\s*#?\s*diff-cmd\s*=') {
      if (!$diffWritten) {
        $output.Add("diff-cmd = $WrapperPath")
        $diffWritten = $true
      }
      continue
    }
    $output.Add($line)
  }

  if (!$helpersSeen) {
    $output.Add("")
    $output.Add("[helpers]")
    $output.Add("diff-cmd = $WrapperPath")
  } elseif ($inHelpers -and !$diffWritten) {
    $output.Add("diff-cmd = $WrapperPath")
  }

  Set-Content -LiteralPath $configPath -Encoding UTF8 -Value ($output -join "`r`n")
}

function Test-UsableBackup {
  param([string]$Path)
  if (!(Test-Path -LiteralPath $Path)) {
    return $false
  }
  try {
    $existing = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    return ($null -ne $existing.git -or $null -ne $existing.svn)
  } catch {
    return $false
  }
}

function Read-Backup {
  param([string]$Path)
  if (!(Test-Path -LiteralPath $Path)) {
    return $null
  }
  try {
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Convert-JsonObjectToHashtable {
  param($Object)
  $result = [ordered]@{}
  if ($null -eq $Object) {
    return $result
  }
  foreach ($property in $Object.PSObject.Properties) {
    $result[$property.Name] = $property.Value
  }
  return $result
}

function Get-TortoiseDiffToolValue {
  param([string]$Extension)
  $path = "HKCU:\Software\TortoiseSVN\DiffTools"
  $item = Get-ItemProperty -Path $path -ErrorAction SilentlyContinue
  if ($null -eq $item) {
    return $null
  }
  $prop = $item.PSObject.Properties[$Extension]
  if ($null -eq $prop) {
    return $null
  }
  return [string]$prop.Value
}

function Set-TortoiseDiffToolValue {
  param([string]$Extension, [string]$Value)
  $path = "HKCU:\Software\TortoiseSVN\DiffTools"
  if (!(Test-Path -Path $path)) {
    New-Item -Path $path -Force | Out-Null
  }
  New-ItemProperty -Path $path -Name $Extension -Value $Value -PropertyType String -Force | Out-Null
}

$exe = Resolve-ExcelDiffExe $ExePath
if ($SkipGit -and $SkipSvn -and $SkipTortoiseSvn) {
  Write-Host "Nothing to configure because -SkipGit, -SkipSvn, and -SkipTortoiseSvn were all set."
  Write-Host "Executable: $exe"
  exit 0
}

$toolDir = Join-Path $env:APPDATA "ExcelDiff\tools"
$backupDir = Join-Path $env:APPDATA "ExcelDiff"
$backupPath = Join-Path $backupDir "vcs-config-backup.json"
$svnBackupPath = Join-Path $backupDir "svn-config.bak"
New-Item -ItemType Directory -Force -Path $toolDir | Out-Null
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$gitWrapper = Join-Path $toolDir "excel-diff-git.cmd"
$svnWrapper = Join-Path $toolDir "excel-diff-svn.cmd"

Set-Content -LiteralPath $gitWrapper -Encoding ASCII -Value @"
@echo off
"$exe" diff -s "%~1" -d "%~2" --title "%~3"
"@

Set-Content -LiteralPath $svnWrapper -Encoding ASCII -Value @"
@echo off
set LEFT=%~6
set RIGHT=%~7
if "%RIGHT%"=="" (
  set LEFT=%~1
  set RIGHT=%~2
)
"$exe" diff -s "%LEFT%" -d "%RIGHT%" --title "%~3"
"@

$backup = [ordered]@{
  createdAt = (Get-Date).ToString("o")
  exePath = $exe
  gitScope = $GitScope
  git = $null
  svn = $null
  tortoiseSvn = $null
}

$existingBackup = Read-Backup $backupPath
if ($existingBackup) {
  if ($existingBackup.createdAt) { $backup.createdAt = [string]$existingBackup.createdAt }
  if ($existingBackup.exePath) { $backup.exePath = [string]$existingBackup.exePath }
  if ($existingBackup.gitScope) { $backup.gitScope = [string]$existingBackup.gitScope }
  if ($existingBackup.git) { $backup.git = $existingBackup.git }
  if ($existingBackup.svn) { $backup.svn = $existingBackup.svn }
  if ($existingBackup.tortoiseSvn) { $backup.tortoiseSvn = $existingBackup.tortoiseSvn }
}

if (!$SkipGit -and $null -eq $backup.git) {
  $backup.git = [ordered]@{
    diffTool = [string](Get-GitValue "diff.tool" $GitScope)
    difftoolCmd = [string](Get-GitValue "difftool.ExcelDiff.cmd" $GitScope)
    difftoolTrustExitCode = [string](Get-GitValue "difftool.ExcelDiff.trustExitCode" $GitScope)
    aliasExceldiff = [string](Get-GitValue "alias.exceldiff" $GitScope)
  }
}

$shouldWriteBackup = !(Test-UsableBackup $backupPath)

if (!$SkipSvn -and $null -eq $backup.svn) {
  $svnConfigPath = Join-Path $env:APPDATA "Subversion\config"
  $svnConfigExists = Test-Path -LiteralPath $svnConfigPath
  if ($svnConfigExists) {
    Copy-Item -LiteralPath $svnConfigPath -Destination $svnBackupPath -Force
  } elseif (Test-Path -LiteralPath $svnBackupPath) {
    Remove-Item -LiteralPath $svnBackupPath -Force
  }
  $backup.svn = [ordered]@{
    configPath = $svnConfigPath
    existed = $svnConfigExists
    backupPath = $svnBackupPath
  }
}

if (!$SkipTortoiseSvn -and $null -eq $backup.tortoiseSvn) {
  $extensions = @(".xls", ".xlsx", ".xlsm", ".xlsb", ".csv", ".tsv")
  $values = [ordered]@{}
  foreach ($extension in $extensions) {
    $values[$extension] = Get-TortoiseDiffToolValue $extension
  }
  $backup.tortoiseSvn = [ordered]@{
    diffTools = $values
  }
}

if (!$shouldWriteBackup) {
  Write-Host "Existing backup preserved: $backupPath"
}
$backup | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $backupPath -Encoding UTF8

if (!$SkipGit) {
  $gitCmd = "`"$gitWrapper`" `"`$LOCAL`" `"`$REMOTE`" `"`$MERGED`""
  Set-GitValue "diff.tool" "ExcelDiff" $GitScope
  Set-GitValue "difftool.ExcelDiff.cmd" $gitCmd $GitScope
  Set-GitValue "difftool.ExcelDiff.trustExitCode" "false" $GitScope
  Set-GitValue "alias.exceldiff" "difftool -g -y -t ExcelDiff" $GitScope
}

if (!$SkipSvn) {
  Write-SvnDiffCmd $svnWrapper
}

if (!$SkipTortoiseSvn) {
  $tortoiseCommand = "`"$exe`" diff -s %base -d %mine --title %bname"
  foreach ($extension in @(".xls", ".xlsx", ".xlsm", ".xlsb", ".csv", ".tsv")) {
    Set-TortoiseDiffToolValue $extension $tortoiseCommand
  }
}

Write-Host "Excel Diff VCS integration configured."
Write-Host "Executable: $exe"
Write-Host "Backup: $backupPath"
if (!$SkipGit) {
  Write-Host "Git alias: git exceldiff <path>"
}
if (!$SkipSvn) {
  Write-Host "SVN CLI diff-cmd configured via $svnWrapper"
}
if (!$SkipTortoiseSvn) {
  Write-Host "TortoiseSVN DiffTools configured for .xls/.xlsx/.xlsm/.xlsb/.csv/.tsv"
}
