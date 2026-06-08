use crate::excel::engine::{current_engine, ExcelEngine};
use crate::models::SheetData;
use std::io::Write;
use std::process::Command;

fn find_write_script() -> Result<String, String> {
    if let Ok(exe_dir) = std::env::current_exe() {
        if let Some(dir) = exe_dir.parent() {
            let p = dir.join("write_excel.py");
            if p.exists() {
                return Ok(p.to_string_lossy().to_string());
            }
        }
    }

    let candidates = [
        "write_excel.py",
        "src-tauri/write_excel.py",
        "../src-tauri/write_excel.py",
        "./src-tauri/write_excel.py",
    ];
    for c in &candidates {
        if std::path::Path::new(c).exists() {
            return Ok(c.to_string());
        }
    }

    let src_path = concat!(env!("CARGO_MANIFEST_DIR"), "/write_excel.py");
    if std::path::Path::new(src_path).exists() {
        return Ok(src_path.to_string());
    }

    Err("找不到 write_excel.py 脚本".to_string())
}

fn find_write_script_xlwings() -> Result<String, String> {
    if let Ok(exe_dir) = std::env::current_exe() {
        if let Some(dir) = exe_dir.parent() {
            let p = dir.join("write_excel_xlwings.py");
            if p.exists() {
                return Ok(p.to_string_lossy().to_string());
            }
        }
    }

    let candidates = [
        "write_excel_xlwings.py",
        "src-tauri/write_excel_xlwings.py",
        "../src-tauri/write_excel_xlwings.py",
        "./src-tauri/write_excel_xlwings.py",
    ];
    for c in &candidates {
        if std::path::Path::new(c).exists() {
            return Ok(c.to_string());
        }
    }

    let src_path = concat!(env!("CARGO_MANIFEST_DIR"), "/write_excel_xlwings.py");
    if std::path::Path::new(src_path).exists() {
        return Ok(src_path.to_string());
    }

    Err("找不到 write_excel_xlwings.py 脚本".to_string())
}

fn python3_candidates() -> Vec<(&'static str, Vec<&'static str>)> {
    if cfg!(windows) {
        vec![
            ("py", vec!["-3"]),
            ("python3", vec![]),
            ("python", vec![]),
        ]
    } else {
        vec![("python3", vec![]), ("python", vec![])]
    }
}

fn command_version(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program)
        .args(args)
        .arg("--version")
        .output()
        .ok()?;

    let text = if output.stdout.is_empty() {
        String::from_utf8_lossy(&output.stderr).to_string()
    } else {
        String::from_utf8_lossy(&output.stdout).to_string()
    };
    Some(text.trim().to_string())
}

fn find_python3() -> Result<(String, Vec<String>), String> {
    let mut tried = Vec::new();
    for (program, args) in python3_candidates() {
        match command_version(program, &args) {
            Some(version) if version.starts_with("Python 3.") => {
                return Ok((
                    program.to_string(),
                    args.into_iter().map(String::from).collect(),
                ));
            }
            Some(version) => tried.push(format!("{} {} => {}", program, args.join(" "), version)),
            None => tried.push(format!("{} {} => not found", program, args.join(" "))),
        }
    }

    Err(format!("找不到可用的 Python 3。已尝试: {}", tried.join("; ")))
}

fn try_write(script_path: &str, file_path: &str, json_path: &str) -> Result<(), String> {
    let (python, python_args) = find_python3()?;
    let output = Command::new(&python)
        .args(&python_args)
        .arg(script_path)
        .arg(file_path)
        .arg(json_path)
        .output()
        .map_err(|e| format!("调用 Python 失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Python 写入失败: {}", stderr));
    }
    Ok(())
}

/// Write changes incrementally (preserves all original metadata)
pub fn write_changes(file_path: &str, changes_json: &str) -> Result<(), String> {
    let json_path = format!("{}.tmp_changes.json", file_path);
    std::fs::write(&json_path, changes_json)
        .map_err(|e| format!("写入临时文件失败: {}", e))?;

    let result = try_write_with_fallback(file_path, &json_path);
    let _ = std::fs::remove_file(&json_path);
    result
}

pub fn write_workbook(file_path: &str, sheets: &[SheetData]) -> Result<(), String> {
    let data = serde_json::json!({
        "sheets": sheets.iter().map(|s| serde_json::json!({
            "name": s.name,
            "rows": s.rows,
        })).collect::<Vec<_>>()
    });

    let json_path = format!("{}.tmp.json", file_path);
    {
        let mut f = std::fs::File::create(&json_path)
            .map_err(|e| format!("创建临时文件失败: {}", e))?;
        f.write_all(data.to_string().as_bytes())
            .map_err(|e| format!("写入临时文件失败: {}", e))?;
    }

    let result = try_write_with_fallback(file_path, &json_path);
    let _ = std::fs::remove_file(&json_path);
    result
}

fn try_write_with_fallback(file_path: &str, json_path: &str) -> Result<(), String> {
    if current_engine() == ExcelEngine::Xlwings {
        let script = find_write_script_xlwings()?;
        return try_write(&script, file_path, json_path);
    }

    let script = find_write_script()?;
    try_write(&script, file_path, json_path)
}
