# Excel Diff as a Git/SVN Diff Tool

Excel Diff can be launched directly from version-control tools with two file paths:

```powershell
ExcelDiff.exe diff -s "old.xlsx" -d "new.xlsx" --title "Localization_Heat.xlsx"
```

Supported forms:

```powershell
ExcelDiff.exe diff -s "old.xlsx" -d "new.xlsx"
ExcelDiff.exe diff --src-path "old.xlsx" --dst-path "new.xlsx"
ExcelDiff.exe diff "old.xlsx" "new.xlsx"
ExcelDiff.exe "old.xlsx" "new.xlsx"
```

Supported file extensions: `.xlsx`, `.xlsm`, `.xlsb`, `.xls`, `.csv`, `.tsv`.

When Excel Diff is already running, a second launch opens a new diff tab in the existing window. The second process copies VCS temporary files into an Excel Diff temp folder before notifying the existing window, so Git/SVN can clean up their own temp files safely.

## One-Step Configuration

Run PowerShell from the repository root or pass the installed executable path:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\configure-vcs-diff.ps1 -ExePath "C:\Program Files\Excel Diff\ExcelDiff.exe"
```

The script:

- creates wrapper scripts under `%APPDATA%\ExcelDiff\tools`
- configures Git difftool `ExcelDiff`
- configures `git exceldiff`
- configures SVN CLI `diff-cmd`
- configures TortoiseSVN DiffTools for Excel/CSV extensions and common Excel MIME types
- suppresses the extra TortoiseMerge window for `svn:mime-type` property-only diffs
- writes a backup to `%APPDATA%\ExcelDiff\vcs-config-backup.json`
- writes the previous SVN config file to `%APPDATA%\ExcelDiff\svn-config.bak`
- writes SVN/Git wrapper logs to `%APPDATA%\ExcelDiff\logs\vcs-diff.log`

Restore the previous configuration:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\restore-vcs-diff.ps1
```

Optional flags:

```powershell
# Configure only Git.
powershell -ExecutionPolicy Bypass -File .\scripts\configure-vcs-diff.ps1 -SkipSvn

# Configure only SVN CLI.
powershell -ExecutionPolicy Bypass -File .\scripts\configure-vcs-diff.ps1 -SkipGit

# Do not configure TortoiseSVN.
powershell -ExecutionPolicy Bypass -File .\scripts\configure-vcs-diff.ps1 -SkipTortoiseSvn

# Use local Git config instead of global Git config.
powershell -ExecutionPolicy Bypass -File .\scripts\configure-vcs-diff.ps1 -GitScope local
```

## Git Manual Configuration

Equivalent `.gitconfig`:

```ini
[diff]
    tool = ExcelDiff

[difftool "ExcelDiff"]
    cmd = "\"C:/Program Files/Excel Diff/ExcelDiff.exe\" diff -s \"$LOCAL\" -d \"$REMOTE\" --title \"$MERGED\""
    trustExitCode = false

[alias]
    exceldiff = difftool -g -y -t ExcelDiff
```

Usage:

```powershell
git exceldiff path/to/file.xlsx
git difftool -g -y -t ExcelDiff HEAD~1 HEAD -- path/to/file.xlsx
```

To make Git treat Excel files as binary and prefer difftool viewing, add to `.gitattributes`:

```gitattributes
*.xls  binary
*.xlsx binary
*.xlsm binary
*.xlsb binary
```

## SVN CLI

Subversion CLI passes several arguments to external diff commands. The generated wrapper uses argument 6 and 7 as the old/new temp files, and falls back to argument 1 and 2 for direct testing.

The script updates `%APPDATA%\Subversion\config`:

```ini
[helpers]
diff-cmd = C:\Users\<you>\AppData\Roaming\ExcelDiff\tools\excel-diff-svn.cmd
```

Usage:

```powershell
svn diff path/to/file.xlsx
svn diff -r 123:124 path/to/file.xlsx
```

## TortoiseSVN

The configuration script writes per-extension and per-MIME-type values under `HKCU\Software\TortoiseSVN\DiffTools`. The Windows Explorer menu still shows TortoiseSVN's normal `Diff` / `Diff with previous version` entries; those entries launch Excel Diff for configured Excel/CSV file extensions and common Excel MIME types.

TortoiseSVN only shows the direct `Diff` menu item for files with local working-copy changes. Clean files normally show options such as `Diff with previous version`, `Show log`, or `Diff later`; that menu difference is controlled by TortoiseSVN file status.

Configured command:

```text
"C:\Program Files\Excel Diff\ExcelDiff.exe" diff -s "%base" -d "%mine" --title "%bname"
```

Manual configuration path: TortoiseSVN -> Settings -> External Programs -> Diff Viewer -> Advanced. Add the same command for `.xlsx`, `.xlsm`, `.xlsb`, and `.xls`.

Some repositories store Excel files with `svn:mime-type=application/octet-stream`. For those files, add the same command for `application/octet-stream` as well. The script does this automatically.

When comparing from the log window, TortoiseSVN may also try to show versioned property changes such as `svn:mime-type`. The script maps `svn:mime-type` to a no-op wrapper so the content comparison opens in Excel Diff without an extra TortoiseMerge property window.

If your TortoiseSVN dialog uses a different variable set, configure it with the two file path variables it provides for base/working or old/new files. Excel Diff accepts both named and positional arguments, so this also works:

```text
C:\Program Files\Excel Diff\ExcelDiff.exe diff %base %mine
```
