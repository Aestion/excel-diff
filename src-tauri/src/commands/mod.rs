use crate::excel;
use crate::models::{FileEntry, ParsedWorkbook, SheetData};
use crate::vcs;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::command;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHash {
    pub path: String,
    pub hash: String,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalDiffRequest {
    pub source_path: String,
    pub destination_path: String,
    pub title: Option<String>,
    pub fallback_cmd: Option<String>,
}

fn normalize_external_diff_path(path: &str, cwd: Option<&str>) -> String {
    let value = path.trim_matches('"');
    let candidate = Path::new(value);
    if candidate.is_absolute() {
        value.to_string()
    } else if let Some(cwd) = cwd {
        Path::new(cwd).join(candidate).to_string_lossy().to_string()
    } else {
        value.to_string()
    }
}

pub fn parse_external_diff_args(args: &[String], cwd: Option<&str>) -> Option<ExternalDiffRequest> {
    let mut start = 1;
    if args.get(1).map(|arg| arg.eq_ignore_ascii_case("diff")).unwrap_or(false) {
        start = 2;
    }

    let mut source_path: Option<String> = None;
    let mut destination_path: Option<String> = None;
    let mut title: Option<String> = None;
    let mut fallback_cmd: Option<String> = None;
    let mut positional: Vec<String> = Vec::new();
    let mut i = start;

    while i < args.len() {
        let arg = &args[i];
        match arg.as_str() {
            "-s" | "--src" | "--src-path" | "--source" | "--source-path" | "--local" => {
                if let Some(value) = args.get(i + 1) {
                    source_path = Some(value.clone());
                    i += 2;
                    continue;
                }
            }
            "-d" | "--dst" | "--dst-path" | "--dest" | "--destination" | "--destination-path" | "--remote" => {
                if let Some(value) = args.get(i + 1) {
                    destination_path = Some(value.clone());
                    i += 2;
                    continue;
                }
            }
            "-t" | "--title" | "--name" => {
                if let Some(value) = args.get(i + 1) {
                    title = Some(value.clone());
                    i += 2;
                    continue;
                }
            }
            "-c" | "--external-cmd" | "--fallback" | "--fallback-cmd" => {
                if let Some(value) = args.get(i + 1) {
                    fallback_cmd = Some(value.clone());
                    i += 2;
                    continue;
                }
            }
            "-i" | "-w" | "-v" | "-k" | "--immediately-execute-external-cmd" | "--wait-external-cmd" | "--validate-extension" | "--keep-file-history" => {
                i += 1;
                continue;
            }
            "--" => {
                positional.extend(args.iter().skip(i + 1).cloned());
                break;
            }
            _ if arg.starts_with('-') => {
                i += 1;
                continue;
            }
            _ => positional.push(arg.clone()),
        }
        i += 1;
    }

    if source_path.is_none() && positional.len() >= 2 {
        source_path = positional.get(0).cloned();
        destination_path = positional.get(1).cloned();
    } else if destination_path.is_none() && !positional.is_empty() {
        destination_path = positional.get(0).cloned();
    }

    let source_path = source_path?;
    let destination_path = destination_path?;
    Some(ExternalDiffRequest {
        source_path: normalize_external_diff_path(&source_path, cwd),
        destination_path: normalize_external_diff_path(&destination_path, cwd),
        title,
        fallback_cmd,
    })
}

fn copy_external_diff_file(path: &str, dir: &Path, name: &str) -> Result<String, String> {
    let source = Path::new(path);
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{}", value))
        .unwrap_or_default();
    let target = dir.join(format!("{}{}", name, extension));
    fs::copy(source, &target)
        .map_err(|e| format!("Failed to copy external diff file '{}': {}", path, e))?;
    Ok(target.to_string_lossy().to_string())
}

pub fn materialize_external_diff_request(
    request: &ExternalDiffRequest,
) -> Result<ExternalDiffRequest, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let dir = std::env::temp_dir()
        .join("excel-diff")
        .join("external-diff")
        .join(timestamp.to_string());
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create external diff temp dir '{}': {}", dir.display(), e))?;

    Ok(ExternalDiffRequest {
        source_path: copy_external_diff_file(&request.source_path, &dir, "source")?,
        destination_path: copy_external_diff_file(&request.destination_path, &dir, "destination")?,
        title: request.title.clone(),
        fallback_cmd: request.fallback_cmd.clone(),
    })
}

#[command]
pub fn get_startup_external_diff_request() -> Option<ExternalDiffRequest> {
    let args: Vec<String> = std::env::args().collect();
    let cwd = std::env::current_dir()
        .ok()
        .map(|path| path.to_string_lossy().to_string());
    parse_external_diff_args(&args, cwd.as_deref())
}

fn collect_excel_files(
    dir: &Path,
    base: &Path,
    entries: &mut Vec<FileEntry>,
) -> Result<(), String> {
    let extensions = ["xlsx", "xlsm", "xlsb", "xls"];

    let dir_entries =
        fs::read_dir(dir).map_err(|e| format!("读取目录 '{}' 失败: {}", dir.display(), e))?;

    for entry in dir_entries {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let metadata = entry
            .metadata()
            .map_err(|e| format!("读取元数据失败: {}", e))?;

        let path = entry.path();

        if metadata.is_dir() {
            // Recurse into subdirectories
            collect_excel_files(&path, base, entries)?;
        } else if metadata.is_file() {
            let file_name = entry.file_name().to_string_lossy().to_string();
            let ext = file_name.rsplit('.').next().unwrap_or("").to_lowercase();

            if file_name.starts_with("~$") {
                continue;
            }

            if extensions.contains(&ext.as_str()) {
                let relative = path
                    .strip_prefix(base)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .to_string();

                let modified_at = metadata.modified().ok().and_then(|t| {
                    t.duration_since(UNIX_EPOCH)
                        .ok()
                        .map(|d| d.as_secs() as i64 * 1000 + d.subsec_millis() as i64)
                });

                entries.push(FileEntry {
                    name: file_name,
                    path: path.to_string_lossy().to_string(),
                    relative_path: relative,
                    size_bytes: metadata.len(),
                    modified_at,
                });
            }
        }
    }

    Ok(())
}

#[command]
pub fn list_excel_files(dir_path: String) -> Result<Vec<FileEntry>, String> {
    let path = Path::new(&dir_path);
    if !path.is_dir() {
        return Err(format!("路径 '{}' 不是一个有效的目录", dir_path));
    }

    let mut entries = Vec::new();
    collect_excel_files(path, path, &mut entries)?;

    entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(entries)
}

fn fnv1a_file_hash(file_path: &str) -> Result<String, String> {
    const FNV_OFFSET: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;

    let mut file =
        fs::File::open(file_path).map_err(|e| format!("打开文件 '{}' 失败: {}", file_path, e))?;
    let mut hash = FNV_OFFSET;
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let len = file
            .read(&mut buffer)
            .map_err(|e| format!("读取文件 '{}' 失败: {}", file_path, e))?;
        if len == 0 {
            break;
        }
        for byte in &buffer[..len] {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(FNV_PRIME);
        }
    }

    Ok(format!("{:016x}", hash))
}

#[command]
pub fn hash_files(file_paths: Vec<String>) -> Result<Vec<FileHash>, String> {
    file_paths
        .into_iter()
        .map(|path| {
            let hash = fnv1a_file_hash(&path)?;
            Ok(FileHash { path, hash })
        })
        .collect()
}

#[command]
pub async fn copy_excel_file(source_path: String, target_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = Path::new(&source_path);
        let target = Path::new(&target_path);
        if !source.is_file() {
            return Err(format!("源文件不存在: {}", source_path));
        }
        if let Some(parent) = target.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).map_err(|e| format!("创建目标目录失败: {}", e))?;
            }
        }
        fs::copy(source, target)
            .map(|_| ())
            .map_err(|e| format!("复制文件失败: {}", e))
    })
    .await
    .map_err(|e| format!("复制任务失败: {}", e))?
}

#[command]
pub fn read_excel(file_path: String) -> Result<ParsedWorkbook, String> {
    excel::reader::read_workbook(&file_path)
}

#[command]
pub async fn write_excel(file_path: String, sheets: Vec<SheetData>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Ensure parent directory exists
        if let Some(parent) = Path::new(&file_path).parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
            }
        }
        excel::writer::write_workbook(&file_path, &sheets)
    })
    .await
    .map_err(|e| format!("写入任务失败: {}", e))?
}

#[command]
pub async fn write_excel_changes(file_path: String, changes_json: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Pass changes JSON directly to Python script
        excel::writer::write_changes(&file_path, &changes_json)
    })
    .await
    .map_err(|e| format!("写入任务失败: {}", e))?
}

#[command]
pub fn detect_key_columns(file_path: String, sheet_name: String) -> Result<Vec<usize>, String> {
    let workbook = excel::reader::read_workbook(&file_path)?;

    let sheet = workbook
        .sheets
        .iter()
        .find(|s| s.name == sheet_name)
        .ok_or_else(|| format!("未找到 Sheet '{}'", sheet_name))?;

    if sheet.rows.len() < 3 {
        return Ok(vec![]);
    }

    let col_count = sheet.columns.len();
    let mut unique_scores: Vec<(usize, f64)> = Vec::new();

    for col_idx in 0..col_count {
        // Skip columns with empty/None/fallback headers
        let header = sheet
            .columns
            .get(col_idx)
            .map(|c| c.name.trim().to_string())
            .unwrap_or_default();
        if header.is_empty() || header == "None" || header.starts_with("Column ") {
            continue;
        }

        let mut values: Vec<String> = Vec::new();
        let mut total = 0usize;
        for row in sheet.rows.iter().skip(2) {
            total += 1;
            if col_idx < row.len() {
                let val = match &row[col_idx].value {
                    serde_json::Value::String(s) => s.clone(),
                    serde_json::Value::Number(n) => format!("{}", n),
                    serde_json::Value::Bool(b) => format!("{}", b),
                    _ => continue,
                };
                if !val.is_empty() {
                    values.push(val);
                }
            }
        }

        // Skip if fill rate < 80%
        if values.len() * 5 < total * 4 {
            continue;
        }

        if values.is_empty() {
            continue;
        }

        let total = values.len();
        let unique: std::collections::HashSet<_> = values.iter().collect();
        let uniqueness = unique.len() as f64 / total as f64;

        unique_scores.push((col_idx, uniqueness));
    }

    unique_scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

    let result: Vec<usize> = unique_scores
        .iter()
        .filter(|(_, score)| *score > 0.95)
        .map(|(idx, _)| *idx)
        .collect();

    if result.is_empty() {
        Ok(unique_scores.iter().take(3).map(|(idx, _)| *idx).collect())
    } else {
        Ok(result)
    }
}

#[command]
pub fn get_excel_engine_status() -> Result<String, String> {
    Ok(match crate::excel::engine::current_engine() {
        crate::excel::engine::ExcelEngine::Xlwings => "xlwings",
        crate::excel::engine::ExcelEngine::Openpyxl => "openpyxl",
    }
    .to_string())
}

#[command]
pub fn open_vcs_log(path: String) -> Result<(), String> {
    vcs::open_vcs_log(&path)
}

#[command]
pub fn open_in_file_explorer(path: String) -> Result<(), String> {
    vcs::open_in_file_explorer(&path)
}

#[command]
pub async fn get_vcs_file_info(path: String) -> Result<vcs::VcsFileInfo, String> {
    tauri::async_runtime::spawn_blocking(move || vcs::get_vcs_file_info(&path))
        .await
        .map_err(|e| format!("获取版本信息任务失败: {}", e))?
}

#[command]
pub fn get_vcs_file_log(
    path: String,
    limit: Option<usize>,
) -> Result<Vec<vcs::VcsCommitSummary>, String> {
    vcs::get_vcs_file_log(&path, limit.unwrap_or(20))
}

#[command]
pub fn export_vcs_file_revision(path: String, revision: String) -> Result<String, String> {
    vcs::export_vcs_file_revision(&path, &revision)
}

#[command]
pub fn cleanup_old_vcs_temp_exports(max_age_hours: Option<u64>) -> Result<(), String> {
    vcs::cleanup_old_temp_exports(max_age_hours.unwrap_or(24))
}

#[cfg(test)]
mod tests {
    use super::parse_external_diff_args;

    #[test]
    fn parses_excelmerge_style_diff_args() {
        let args = vec![
            "ExcelDiff.exe".to_string(),
            "diff".to_string(),
            "-s".to_string(),
            "old.xlsx".to_string(),
            "-d".to_string(),
            "new.xlsx".to_string(),
            "-c".to_string(),
            "WinMerge".to_string(),
            "-i".to_string(),
            "-w".to_string(),
            "-v".to_string(),
            "-k".to_string(),
        ];

        let request = parse_external_diff_args(&args, Some("C:\\repo")).unwrap();
        assert!(request.source_path.ends_with("old.xlsx"));
        assert!(request.destination_path.ends_with("new.xlsx"));
        assert_eq!(request.fallback_cmd.as_deref(), Some("WinMerge"));
    }

    #[test]
    fn parses_positional_diff_args() {
        let args = vec![
            "ExcelDiff.exe".to_string(),
            "diff".to_string(),
            "C:\\tmp\\old.xlsx".to_string(),
            "C:\\tmp\\new.xlsx".to_string(),
        ];

        let request = parse_external_diff_args(&args, None).unwrap();
        assert_eq!(request.source_path, "C:\\tmp\\old.xlsx");
        assert_eq!(request.destination_path, "C:\\tmp\\new.xlsx");
    }

    #[test]
    fn parses_direct_two_path_args() {
        let args = vec![
            "ExcelDiff.exe".to_string(),
            "old.xlsx".to_string(),
            "new.xlsx".to_string(),
        ];

        let request = parse_external_diff_args(&args, Some("C:\\repo")).unwrap();
        assert!(request.source_path.ends_with("old.xlsx"));
        assert!(request.destination_path.ends_with("new.xlsx"));
    }
}
