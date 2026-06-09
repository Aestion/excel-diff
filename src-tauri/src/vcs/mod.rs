use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsCommitSummary {
    pub id: String,
    pub author: Option<String>,
    pub date: Option<String>,
    pub message: String,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsFileInfo {
    pub kind: String,
    pub path: String,
    pub root: Option<String>,
    pub branch: Option<String>,
    pub url: Option<String>,
    pub revision: Option<String>,
    pub status: Option<String>,
    pub last_commit: Option<VcsCommitSummary>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum VcsKind {
    Git,
    Svn,
}

fn existing_base_path(path: &Path) -> PathBuf {
    if path.is_file() {
        path.parent().unwrap_or(path).to_path_buf()
    } else {
        path.to_path_buf()
    }
}

fn command_text(mut command: Command) -> Result<String, String> {
    let output = command
        .output()
        .map_err(|e| format!("执行版本控制命令失败: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "版本控制命令执行失败".to_string()
        } else {
            stderr
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn git_command(root: &Path) -> Command {
    let mut command = Command::new("git");
    command.arg("-C").arg(root);
    command
}

fn git_root(path: &Path) -> Option<PathBuf> {
    nearest_marker(path, ".git")
}

fn svn_root(path: &Path) -> Option<PathBuf> {
    nearest_marker(path, ".svn")
}

fn repo_relative_path(root: &Path, path: &Path) -> PathBuf {
    path.strip_prefix(root).unwrap_or(path).to_path_buf()
}

fn nearest_marker(path: &Path, marker: &str) -> Option<PathBuf> {
    let mut current = existing_base_path(path);
    loop {
        if current.join(marker).exists() {
            return Some(current);
        }
        if !current.pop() {
            return None;
        }
    }
}

fn detect_vcs_kind(path: &Path) -> Option<VcsKind> {
    let git_root = git_root(path);
    let svn_root = svn_root(path);

    match (git_root, svn_root) {
        (Some(git), Some(svn)) => {
            if svn.components().count() >= git.components().count() {
                Some(VcsKind::Svn)
            } else {
                Some(VcsKind::Git)
            }
        }
        (Some(_), None) => Some(VcsKind::Git),
        (None, Some(_)) => Some(VcsKind::Svn),
        (None, None) => None,
    }
}

fn parse_git_commit_line(line: &str) -> Option<VcsCommitSummary> {
    let parts: Vec<&str> = line.splitn(4, '\x1f').collect();
    if parts.len() < 4 {
        return None;
    }
    Some(VcsCommitSummary {
        id: parts[0].to_string(),
        author: Some(parts[1].to_string()).filter(|s| !s.is_empty()),
        date: Some(parts[2].to_string()).filter(|s| !s.is_empty()),
        message: parts[3].to_string(),
    })
}

fn git_log(root: &Path, path: &Path, limit: usize) -> Result<Vec<VcsCommitSummary>, String> {
    let rel = repo_relative_path(root, path);
    let mut command = git_command(root);
    command
        .args([
            "log",
            "--date=iso-strict",
            &format!("-n{}", limit),
            "--pretty=format:%H%x1f%an%x1f%ad%x1f%s",
            "--",
        ])
        .arg(rel);
    let text = command_text(command)?;
    Ok(text.lines().filter_map(parse_git_commit_line).collect())
}

fn git_info(path: &Path) -> Result<VcsFileInfo, String> {
    let root = git_root(path).ok_or_else(|| "未检测到 Git 工作副本".to_string())?;
    let rel = repo_relative_path(&root, path);

    let branch = {
        let mut command = git_command(&root);
        command.args(["branch", "--show-current"]);
        command_text(command).ok().filter(|s| !s.is_empty())
    };

    let status = {
        let mut command = git_command(&root);
        command.args(["status", "--porcelain", "--"]).arg(&rel);
        command_text(command).ok().map(|s| {
            if s.is_empty() {
                "clean".to_string()
            } else {
                s.lines().next().unwrap_or("modified").trim().to_string()
            }
        })
    };

    let last_commit = git_log(&root, path, 1).ok().and_then(|mut logs| logs.pop());

    Ok(VcsFileInfo {
        kind: "git".to_string(),
        path: path.to_string_lossy().to_string(),
        root: Some(root.to_string_lossy().to_string()),
        branch,
        url: None,
        revision: None,
        status,
        last_commit,
    })
}

fn parse_svn_info_value(text: &str, key: &str) -> Option<String> {
    text.lines()
        .find_map(|line| line.strip_prefix(key))
        .map(str::trim)
        .map(str::to_string)
        .filter(|s| !s.is_empty())
}

fn svn_info(path: &Path) -> Result<VcsFileInfo, String> {
    let root = svn_root(path);
    let mut command = Command::new("svn");
    command.arg("info").arg(path);
    let info_text = command_text(command)?;

    let status = {
        let mut command = Command::new("svn");
        command.arg("status").arg(path);
        command_text(command).ok().map(|s| {
            if s.is_empty() {
                "clean".to_string()
            } else {
                s.lines().next().unwrap_or("modified").trim().to_string()
            }
        })
    };

    let last_commit = svn_log(path, 1).ok().and_then(|mut logs| logs.pop());

    Ok(VcsFileInfo {
        kind: "svn".to_string(),
        path: path.to_string_lossy().to_string(),
        root: root.map(|p| p.to_string_lossy().to_string()),
        branch: None,
        url: parse_svn_info_value(&info_text, "URL:"),
        revision: parse_svn_info_value(&info_text, "Revision:"),
        status,
        last_commit,
    })
}

fn parse_svn_log(text: &str) -> Vec<VcsCommitSummary> {
    let mut commits = Vec::new();
    let mut current: Option<VcsCommitSummary> = None;
    let mut message_lines: Vec<String> = Vec::new();

    for line in text.lines() {
        if line.starts_with("------------------------------------------------------------------------") {
            if let Some(mut commit) = current.take() {
                let message = message_lines.join(" ").trim().to_string();
                if !message.is_empty() {
                    commit.message = message;
                }
                commits.push(commit);
                message_lines.clear();
            }
            continue;
        }

        if line.starts_with('r') && line.contains('|') {
            let parts: Vec<&str> = line.split('|').map(str::trim).collect();
            if parts.len() >= 3 {
                current = Some(VcsCommitSummary {
                    id: parts[0].to_string(),
                    author: Some(parts[1].to_string()).filter(|s| !s.is_empty()),
                    date: Some(parts[2].to_string()).filter(|s| !s.is_empty()),
                    message: String::new(),
                });
                message_lines.clear();
            }
            continue;
        }

        let trimmed = line.trim();
        let is_count_line = trimmed.ends_with(" line") || trimmed.ends_with(" lines");
        if current.is_some() && !trimmed.is_empty() && !is_count_line {
            message_lines.push(line.trim().to_string());
        }
    }

    if let Some(mut commit) = current {
        let message = message_lines.join(" ").trim().to_string();
        if !message.is_empty() {
            commit.message = message;
        }
        commits.push(commit);
    }

    commits
}

fn svn_log(path: &Path, limit: usize) -> Result<Vec<VcsCommitSummary>, String> {
    let mut command = Command::new("svn");
    command.arg("log").arg("-l").arg(limit.to_string()).arg(path);
    Ok(parse_svn_log(&command_text(command)?))
}

fn path_candidates(program: &str, install_dirs: &[&str]) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(path_env) = env::var_os("PATH") {
        for dir in env::split_paths(&path_env) {
            candidates.push(dir.join(program));
        }
    }

    for env_name in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
        if let Some(base) = env::var_os(env_name) {
            let base = PathBuf::from(base);
            for dir in install_dirs {
                candidates.push(base.join(dir).join(program));
            }
        }
    }

    candidates
}

fn find_executable(program: &str, install_dirs: &[&str]) -> Option<PathBuf> {
    path_candidates(program, install_dirs)
        .into_iter()
        .find(|candidate| candidate.is_file())
}

fn open_tortoise_git_log(path: &Path) -> Result<(), String> {
    let exe = find_executable("TortoiseGitProc.exe", &["TortoiseGit\\bin"])
        .ok_or_else(|| "未检测到 TortoiseGitProc.exe".to_string())?;
    Command::new(exe)
        .arg("/command:log")
        .arg(format!("/path:{}", path.display()))
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开 TortoiseGit 日志失败: {}", e))
}

fn open_tortoise_svn_log(path: &Path) -> Result<(), String> {
    let exe = find_executable("TortoiseProc.exe", &["TortoiseSVN\\bin"])
        .ok_or_else(|| "未检测到 TortoiseSVN TortoiseProc.exe".to_string())?;
    Command::new(exe)
        .arg("/command:log")
        .arg(format!("/path:{}", path.display()))
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开 TortoiseSVN 日志失败: {}", e))
}

pub fn open_vcs_log(path: &str) -> Result<(), String> {
    let target = Path::new(path);
    if !target.exists() {
        return Err(format!("路径不存在: {}", path));
    }

    match detect_vcs_kind(target) {
        Some(VcsKind::Git) => open_tortoise_git_log(target),
        Some(VcsKind::Svn) => open_tortoise_svn_log(target),
        None => Err(format!("未检测到 Git/SVN 工作副本: {}", path)),
    }
}

pub fn get_vcs_file_info(path: &str) -> Result<VcsFileInfo, String> {
    let target = Path::new(path);
    if !target.exists() {
        return Err(format!("路径不存在: {}", path));
    }

    match detect_vcs_kind(target) {
        Some(VcsKind::Git) => git_info(target),
        Some(VcsKind::Svn) => svn_info(target),
        None => Ok(VcsFileInfo {
            kind: "none".to_string(),
            path: path.to_string(),
            root: None,
            branch: None,
            url: None,
            revision: None,
            status: None,
            last_commit: None,
        }),
    }
}

pub fn get_vcs_file_log(path: &str, limit: usize) -> Result<Vec<VcsCommitSummary>, String> {
    let target = Path::new(path);
    if !target.exists() {
        return Err(format!("路径不存在: {}", path));
    }
    let limit = limit.clamp(1, 100);

    match detect_vcs_kind(target) {
        Some(VcsKind::Git) => {
            let root = git_root(target).ok_or_else(|| "未检测到 Git 工作副本".to_string())?;
            git_log(&root, target, limit)
        }
        Some(VcsKind::Svn) => svn_log(target, limit),
        None => Err(format!("未检测到 Git/SVN 工作副本: {}", path)),
    }
}

fn unique_temp_file(path: &Path, revision: &str) -> PathBuf {
    let safe_revision: String = revision
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("xlsx");
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("excel");
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    env::temp_dir()
        .join("excel-diff-vcs")
        .join(format!("{}-{}-{}.{}", stem, safe_revision, millis, ext))
}

pub fn cleanup_old_temp_exports(max_age_hours: u64) -> Result<(), String> {
    let dir = env::temp_dir().join("excel-diff-vcs");
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(());
    };
    let max_age = std::time::Duration::from_secs(max_age_hours.saturating_mul(3600));
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        if now.duration_since(modified).map(|age| age > max_age).unwrap_or(false) {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

pub fn export_vcs_file_revision(path: &str, revision: &str) -> Result<String, String> {
    let target = Path::new(path);
    if !target.exists() {
        return Err(format!("路径不存在: {}", path));
    }
    if revision.trim().is_empty() {
        return Err("revision/commit 不能为空".to_string());
    }

    let output_path = unique_temp_file(target, revision);
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建临时目录失败: {}", e))?;
    }

    let bytes = match detect_vcs_kind(target) {
        Some(VcsKind::Git) => {
            let root = git_root(target).ok_or_else(|| "未检测到 Git 工作副本".to_string())?;
            let rel = repo_relative_path(&root, target);
            let spec = format!("{}:{}", revision, rel.to_string_lossy().replace('\\', "/"));
            let mut command = git_command(&root);
            command.args(["show", &spec]);
            let output = command
                .output()
                .map_err(|e| format!("导出 Git 历史版本失败: {}", e))?;
            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
            }
            output.stdout
        }
        Some(VcsKind::Svn) => {
            let mut command = Command::new("svn");
            command.arg("cat").arg("-r").arg(revision).arg(target);
            let output = command
                .output()
                .map_err(|e| format!("导出 SVN 历史版本失败: {}", e))?;
            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
            }
            output.stdout
        }
        None => return Err(format!("未检测到 Git/SVN 工作副本: {}", path)),
    };

    fs::write(&output_path, bytes).map_err(|e| format!("写入临时历史文件失败: {}", e))?;
    Ok(output_path.to_string_lossy().to_string())
}

pub fn open_in_file_explorer(path: &str) -> Result<(), String> {
    let target = Path::new(path);
    if !target.exists() {
        return Err(format!("路径不存在: {}", path));
    }

    if cfg!(windows) {
        let mut command = Command::new("explorer");
        if target.is_file() {
            command.arg(format!("/select,{}", target.display()));
        } else {
            command.arg(target);
        }
        return command
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("打开资源管理器失败: {}", e));
    }

    #[cfg(target_os = "macos")]
    {
        return Command::new("open")
            .arg(target)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("打开 Finder 失败: {}", e));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("打开文件管理器失败: {}", e));
    }

    #[allow(unreachable_code)]
    Err("当前平台不支持打开文件管理器".to_string())
}
