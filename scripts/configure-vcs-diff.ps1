param(
  [string]$ExePath = "",
  [ValidateSet("global", "local")]
  [string]$GitScope = "global",
  [switch]$SkipGit,
  [switch]$SkipSvn,
  [switch]$SkipTortoiseSvn,
  [switch]$SkipTortoiseGit
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
  param([string]$Root, [string]$Extension)
  $path = "HKCU:\Software\$Root\DiffTools"
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
  param([string]$Root, [string]$Extension, [string]$Value)
  $path = "HKCU:\Software\$Root\DiffTools"
  if (!(Test-Path -Path $path)) {
    New-Item -Path $path -Force | Out-Null
  }
  New-ItemProperty -Path $path -Name $Extension -Value $Value -PropertyType String -Force | Out-Null
}

$exe = Resolve-ExcelDiffExe $ExePath
if ($SkipGit -and $SkipSvn -and $SkipTortoiseSvn -and $SkipTortoiseGit) {
  Write-Host "Nothing to configure because -SkipGit, -SkipSvn, -SkipTortoiseSvn, and -SkipTortoiseGit were all set."
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
$tortoiseWrapper = Join-Path $toolDir "excel-diff-tortoise.js"
$noopWrapper = Join-Path $toolDir "excel-diff-noop.js"

Set-Content -LiteralPath $gitWrapper -Encoding ASCII -Value @"
@echo off
setlocal
set "EXE=$exe"
set "LEFT=%~1"
set "RIGHT=%~2"
set "TITLE=%~3"
set "LOGDIR=%APPDATA%\ExcelDiff\logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>nul
if not exist "%LEFT%" (
  echo Missing left file: "%LEFT%" >> "%LOGDIR%\vcs-diff.log"
  exit /b 2
)
if not exist "%RIGHT%" (
  echo Missing right file: "%RIGHT%" >> "%LOGDIR%\vcs-diff.log"
  exit /b 2
)
set "COPYDIR=%TEMP%\ExcelDiff\vcs-diff\%RANDOM%-%RANDOM%-%RANDOM%"
mkdir "%COPYDIR%" >nul 2>nul
for %%I in ("%LEFT%") do set "LEFT_COPY=%COPYDIR%\left%%~xI"
for %%I in ("%RIGHT%") do set "RIGHT_COPY=%COPYDIR%\right%%~xI"
copy /Y "%LEFT%" "%LEFT_COPY%" >nul || exit /b 3
copy /Y "%RIGHT%" "%RIGHT_COPY%" >nul || exit /b 4
echo [%DATE% %TIME%] Git diff "%LEFT%" "%RIGHT%" ^> "%LEFT_COPY%" "%RIGHT_COPY%" >> "%LOGDIR%\vcs-diff.log"
start "" "%EXE%" diff -s "%LEFT_COPY%" -d "%RIGHT_COPY%" --title "%TITLE%"
"@

Set-Content -LiteralPath $noopWrapper -Encoding ASCII -Value @"
WScript.Quit(0);
"@

Set-Content -LiteralPath $svnWrapper -Encoding ASCII -Value @"
@echo off
setlocal
set "EXE=$exe"
set "LEFT=%~6"
set "RIGHT=%~7"
set "TITLE=%~3"
if "%RIGHT%"=="" (
  set "LEFT=%~1"
  set "RIGHT=%~2"
)
if "%TITLE%"=="" set "TITLE=%~n2"
set "LOGDIR=%APPDATA%\ExcelDiff\logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>nul
if not exist "%LEFT%" (
  echo Missing left file: "%LEFT%" args=%* >> "%LOGDIR%\vcs-diff.log"
  exit /b 2
)
if not exist "%RIGHT%" (
  echo Missing right file: "%RIGHT%" args=%* >> "%LOGDIR%\vcs-diff.log"
  exit /b 2
)
set "COPYDIR=%TEMP%\ExcelDiff\vcs-diff\%RANDOM%-%RANDOM%-%RANDOM%"
mkdir "%COPYDIR%" >nul 2>nul
for %%I in ("%LEFT%") do set "LEFT_COPY=%COPYDIR%\left%%~xI"
for %%I in ("%RIGHT%") do set "RIGHT_COPY=%COPYDIR%\right%%~xI"
copy /Y "%LEFT%" "%LEFT_COPY%" >nul || exit /b 3
copy /Y "%RIGHT%" "%RIGHT_COPY%" >nul || exit /b 4
echo [%DATE% %TIME%] SVN diff "%LEFT%" "%RIGHT%" ^> "%LEFT_COPY%" "%RIGHT_COPY%" >> "%LOGDIR%\vcs-diff.log"
start "" "%EXE%" diff -s "%LEFT_COPY%" -d "%RIGHT_COPY%" --title "%TITLE%"
"@

$jsExe = $exe.Replace("\", "\\").Replace('"', '\"')
Set-Content -LiteralPath $tortoiseWrapper -Encoding ASCII -Value @"
var fso = new ActiveXObject("Scripting.FileSystemObject");
var shell = new ActiveXObject("WScript.Shell");
var exe = "$jsExe";
var args = WScript.Arguments;
var left = args.length > 0 ? String(args.Item(0)) : "";
var right = args.length > 1 ? String(args.Item(1)) : "";
var title = args.length > 2 ? String(args.Item(2)) : "";
var appData = shell.ExpandEnvironmentStrings("%APPDATA%");
var temp = shell.ExpandEnvironmentStrings("%TEMP%");
var logDir = fso.BuildPath(appData, "ExcelDiff\\logs");
var rootDir = fso.BuildPath(temp, "ExcelDiff\\vcs-diff");

function ensureFolder(path) {
  if (!fso.FolderExists(path)) {
    ensureFolder(fso.GetParentFolderName(path));
    fso.CreateFolder(path);
  }
}

function quote(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

function extension(path) {
  var name = fso.GetFileName(path);
  var index = name.lastIndexOf(".");
  return index >= 0 ? name.substring(index) : "";
}

function log(message) {
  try {
    ensureFolder(logDir);
    var file = fso.OpenTextFile(fso.BuildPath(logDir, "vcs-diff.log"), 8, true);
    file.WriteLine(new Date().toISOString() + " " + message);
    file.Close();
  } catch (e) {}
}

try {
  ensureFolder(rootDir);
  if (!fso.FileExists(left)) {
    log("TortoiseSVN missing left: " + left + " args=" + WScript.Arguments.length);
    WScript.Quit(2);
  }
  if (!fso.FileExists(right)) {
    log("TortoiseSVN missing right: " + right + " args=" + WScript.Arguments.length);
    WScript.Quit(2);
  }

  var copyDir = fso.BuildPath(rootDir, String(new Date().getTime()) + "-" + Math.floor(Math.random() * 1000000000));
  fso.CreateFolder(copyDir);
  var leftCopy = fso.BuildPath(copyDir, "left" + extension(left));
  var rightCopy = fso.BuildPath(copyDir, "right" + extension(right));
  fso.CopyFile(left, leftCopy, true);
  fso.CopyFile(right, rightCopy, true);
  if (!title) {
    title = fso.GetFileName(right) || fso.GetFileName(left);
  }

  var command = quote(exe) + " diff -s " + quote(leftCopy) + " -d " + quote(rightCopy) + " --title " + quote(title);
  log("TortoiseSVN diff " + left + " " + right + " -> " + leftCopy + " " + rightCopy + " cmd=" + command);
  shell.Run(command, 1, false);
} catch (e) {
  log("TortoiseSVN wrapper error: " + e.message);
  WScript.Quit(5);
}
"@

$backup = [ordered]@{
  createdAt = (Get-Date).ToString("o")
  exePath = $exe
  gitScope = $GitScope
  git = $null
  svn = $null
  tortoiseSvn = $null
  tortoiseGit = $null
}

$existingBackup = Read-Backup $backupPath
if ($existingBackup) {
  if ($existingBackup.createdAt) { $backup.createdAt = [string]$existingBackup.createdAt }
  if ($existingBackup.exePath) { $backup.exePath = [string]$existingBackup.exePath }
  if ($existingBackup.gitScope) { $backup.gitScope = [string]$existingBackup.gitScope }
  if ($existingBackup.git) { $backup.git = $existingBackup.git }
  if ($existingBackup.svn) { $backup.svn = $existingBackup.svn }
  if ($existingBackup.tortoiseSvn) { $backup.tortoiseSvn = $existingBackup.tortoiseSvn }
  if ($existingBackup.tortoiseGit) { $backup.tortoiseGit = $existingBackup.tortoiseGit }
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
  $extensions = @(
    ".xls",
    ".xlsx",
    ".xlsm",
    ".xlsb",
    ".csv",
    ".tsv",
    "application/octet-stream",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel.sheet.macroEnabled.12",
    "text/csv",
    "text/tab-separated-values",
    "svn:mime-type"
  )
  $values = [ordered]@{}
  foreach ($extension in $extensions) {
    $values[$extension] = Get-TortoiseDiffToolValue "TortoiseSVN" $extension
  }
  $backup.tortoiseSvn = [ordered]@{
    diffTools = $values
  }
}

if (!$SkipTortoiseGit -and $null -eq $backup.tortoiseGit) {
  $extensions = @(
    ".xls",
    ".xlsx",
    ".xlsm",
    ".xlsb",
    ".csv",
    ".tsv",
    "application/octet-stream",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel.sheet.macroEnabled.12",
    "text/csv",
    "text/tab-separated-values"
  )
  $values = [ordered]@{}
  foreach ($extension in $extensions) {
    $values[$extension] = Get-TortoiseDiffToolValue "TortoiseGit" $extension
  }
  $backup.tortoiseGit = [ordered]@{
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
  Set-GitValue "alias.exceldiff" "difftool -y -t ExcelDiff" $GitScope
}

if (!$SkipSvn) {
  Write-SvnDiffCmd $svnWrapper
}

if (!$SkipTortoiseSvn) {
  $tortoiseCommand = "wscript.exe `"$tortoiseWrapper`" `"%base`" `"%mine`" `"%bname`""
  foreach ($extension in @(
    ".xls",
    ".xlsx",
    ".xlsm",
    ".xlsb",
    ".csv",
    ".tsv",
    "application/octet-stream",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel.sheet.macroEnabled.12",
    "text/csv",
    "text/tab-separated-values"
  )) {
    Set-TortoiseDiffToolValue "TortoiseSVN" $extension $tortoiseCommand
  }
  Set-TortoiseDiffToolValue "TortoiseSVN" "svn:mime-type" "wscript.exe `"$noopWrapper`""
}

if (!$SkipTortoiseGit) {
  $tortoiseCommand = "wscript.exe `"$tortoiseWrapper`" `"%base`" `"%mine`" `"%bname`""
  foreach ($extension in @(
    ".xls",
    ".xlsx",
    ".xlsm",
    ".xlsb",
    ".csv",
    ".tsv",
    "application/octet-stream",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel.sheet.macroEnabled.12",
    "text/csv",
    "text/tab-separated-values"
  )) {
    Set-TortoiseDiffToolValue "TortoiseGit" $extension $tortoiseCommand
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
  Write-Host "TortoiseSVN DiffTools configured for Excel/CSV extensions and MIME types"
}
if (!$SkipTortoiseGit) {
  Write-Host "TortoiseGit DiffTools configured for Excel/CSV extensions and MIME types"
}
