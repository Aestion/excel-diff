param(
  [string]$BackupPath = ""
)

$ErrorActionPreference = "Stop"

if (!$BackupPath) {
  $BackupPath = Join-Path $env:APPDATA "ExcelDiff\vcs-config-backup.json"
}

if (!(Test-Path -LiteralPath $BackupPath)) {
  throw "Backup file was not found: $BackupPath"
}

function Set-Or-Unset-GitValue {
  param([string]$Name, [AllowNull()][string]$Value, [string]$Scope)
  $scopeArg = if ($Scope -eq "local") { "--local" } else { "--global" }
  if ($null -eq $Value -or $Value -eq "") {
    & git config $scopeArg --unset $Name 2>$null
  } else {
    & git config $scopeArg $Name $Value
  }
}

function Set-Or-Remove-TortoiseDiffToolValue {
  param([string]$Root, [string]$Extension, [AllowNull()][string]$Value)
  $path = "HKCU:\Software\$Root\DiffTools"
  if ($null -eq $Value -or $Value -eq "") {
    if (Test-Path -Path $path) {
      Remove-ItemProperty -Path $path -Name $Extension -ErrorAction SilentlyContinue
    }
  } else {
    if (!(Test-Path -Path $path)) {
      New-Item -Path $path -Force | Out-Null
    }
    New-ItemProperty -Path $path -Name $Extension -Value $Value -PropertyType String -Force | Out-Null
  }
}

$backup = Get-Content -LiteralPath $BackupPath -Raw | ConvertFrom-Json

if ($backup.git) {
  $scope = if ($backup.gitScope) { [string]$backup.gitScope } else { "global" }
  Set-Or-Unset-GitValue "diff.tool" $backup.git.diffTool $scope
  Set-Or-Unset-GitValue "difftool.ExcelDiff.cmd" $backup.git.difftoolCmd $scope
  Set-Or-Unset-GitValue "difftool.ExcelDiff.trustExitCode" $backup.git.difftoolTrustExitCode $scope
  Set-Or-Unset-GitValue "alias.exceldiff" $backup.git.aliasExceldiff $scope
  Write-Host "Git configuration restored."
}

if ($backup.svn) {
  $configPath = [string]$backup.svn.configPath
  $configDir = Split-Path -Parent $configPath
  New-Item -ItemType Directory -Force -Path $configDir | Out-Null

  if ($null -ne $backup.svn.content) {
    Set-Content -LiteralPath $configPath -Encoding UTF8 -Value ([string]$backup.svn.content)
    Write-Host "SVN CLI configuration restored: $configPath"
  } elseif ($backup.svn.existed -and $backup.svn.backupPath -and (Test-Path -LiteralPath ([string]$backup.svn.backupPath))) {
    Copy-Item -LiteralPath ([string]$backup.svn.backupPath) -Destination $configPath -Force
    Write-Host "SVN CLI configuration restored: $configPath"
  } elseif (!$backup.svn.existed) {
    if (Test-Path -LiteralPath $configPath) {
      Remove-Item -LiteralPath $configPath -Force
    }
    Write-Host "SVN CLI configuration removed because no previous config existed."
  } else {
    throw "SVN backup file was not found: $($backup.svn.backupPath)"
  }
}

if ($backup.tortoiseSvn -and $backup.tortoiseSvn.diffTools) {
  foreach ($property in $backup.tortoiseSvn.diffTools.PSObject.Properties) {
    Set-Or-Remove-TortoiseDiffToolValue "TortoiseSVN" $property.Name $property.Value
  }
  Write-Host "TortoiseSVN DiffTools restored."
}

if ($backup.tortoiseGit -and $backup.tortoiseGit.diffTools) {
  foreach ($property in $backup.tortoiseGit.diffTools.PSObject.Properties) {
    Set-Or-Remove-TortoiseDiffToolValue "TortoiseGit" $property.Name $property.Value
  }
  Write-Host "TortoiseGit DiffTools restored."
}

Write-Host "Excel Diff VCS integration restored from: $BackupPath"
