use crate::excel::engine::{current_engine, ExcelEngine};
use crate::models::SheetData;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

struct PythonEnv {
    program: String,
    args: Vec<String>,
    version: String,
}

impl PythonEnv {
    fn display_command(&self) -> String {
        if self.args.is_empty() {
            self.program.clone()
        } else {
            format!("{} {}", self.program, self.args.join(" "))
        }
    }

    fn pip_install_command(&self, package: &str) -> String {
        let mut parts = vec![self.program.clone()];
        parts.extend(self.args.clone());
        parts.push("-m".to_string());
        parts.push("pip".to_string());
        parts.push("install".to_string());
        parts.push(package.to_string());
        parts.join(" ")
    }
}

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
        if Path::new(c).exists() {
            return Ok(c.to_string());
        }
    }

    let src_path = concat!(env!("CARGO_MANIFEST_DIR"), "/write_excel.py");
    if Path::new(src_path).exists() {
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
        if Path::new(c).exists() {
            return Ok(c.to_string());
        }
    }

    let src_path = concat!(env!("CARGO_MANIFEST_DIR"), "/write_excel_xlwings.py");
    if Path::new(src_path).exists() {
        return Ok(src_path.to_string());
    }

    Err("找不到 write_excel_xlwings.py 脚本".to_string())
}

fn push_python_candidate(candidates: &mut Vec<(String, Vec<String>)>, path: PathBuf) {
    if path.exists() {
        candidates.push((path.to_string_lossy().to_string(), vec![]));
    }
}

fn bundled_python_candidates() -> Vec<(String, Vec<String>)> {
    let mut candidates = Vec::new();

    if cfg!(windows) {
        let bundled_python = Path::new("python-windows").join("python.exe");

        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                push_python_candidate(&mut candidates, exe_dir.join(&bundled_python));
                push_python_candidate(
                    &mut candidates,
                    exe_dir.join("resources").join(&bundled_python),
                );
            }
        }

        push_python_candidate(&mut candidates, Path::new("resources").join(&bundled_python));
        push_python_candidate(
            &mut candidates,
            Path::new("src-tauri").join("resources").join(&bundled_python),
        );
        push_python_candidate(
            &mut candidates,
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join(&bundled_python),
        );
    }

    candidates
}

fn python3_candidates() -> Vec<(String, Vec<String>)> {
    let mut candidates = bundled_python_candidates();

    if cfg!(windows) {
        candidates.extend([
            ("py".to_string(), vec!["-3".to_string()]),
            ("python3".to_string(), vec![]),
            ("python".to_string(), vec![]),
        ]);
    } else {
        candidates.extend([
            ("python3".to_string(), vec![]),
            ("python".to_string(), vec![]),
        ]);
    }

    candidates
}

fn command_version(program: &str, args: &[String]) -> Option<String> {
    let mut cmd = Command::new(program);
    cmd.args(args).arg("--version");
    crate::utils::hide_console(&mut cmd);
    let output = cmd.output().ok()?;

    let text = if output.stdout.is_empty() {
        String::from_utf8_lossy(&output.stderr).to_string()
    } else {
        String::from_utf8_lossy(&output.stdout).to_string()
    };
    Some(text.trim().to_string())
}

fn parse_python_version(version: &str) -> Option<(u32, u32, u32)> {
    let version_text = version.split_whitespace().find(|part| {
        part.chars()
            .next()
            .map(|ch| ch.is_ascii_digit())
            .unwrap_or(false)
    })?;
    let mut parts = version_text.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts
        .next()
        .and_then(|part| part.parse().ok())
        .unwrap_or(0);
    Some((major, minor, patch))
}

fn is_supported_python(version: &str) -> bool {
    matches!(parse_python_version(version), Some((major, minor, _)) if major == 3 && minor >= 8)
}

fn find_python3_with_dependency(engine: ExcelEngine) -> Result<PythonEnv, String> {
    let package = dependency_name(engine);
    let mut tried = Vec::new();
    let mut first_supported = None;

    for (program, args) in python3_candidates() {
        let display = if args.is_empty() {
            program.clone()
        } else {
            format!("{} {}", program, args.join(" "))
        };

        match command_version(&program, &args) {
            Some(version) if is_supported_python(&version) => {
                let env = PythonEnv {
                    program,
                    args,
                    version,
                };

                if first_supported.is_none() {
                    first_supported = Some(PythonEnv {
                        program: env.program.clone(),
                        args: env.args.clone(),
                        version: env.version.clone(),
                    });
                }

                if python_has_dependency(&env, package) {
                    return Ok(env);
                }

                tried.push(format!(
                    "{} => {}（未安装 {}）",
                    display, env.version, package
                ));
            }
            Some(version) if version.starts_with("Python ") => tried.push(format!(
                "{} => {}（需要 Python 3.8 或更高版本）",
                display, version
            )),
            Some(version) => tried.push(format!("{} => {}", display, version)),
            None => tried.push(format!("{} => not found", display)),
        }
    }

    if let Some(env) = first_supported {
        return check_python_dependency(&env, engine).and(Ok(env));
    }

    Err(format!(
        "找不到安装了 {package} 的 Python 3.8 或更高版本。已尝试: {}",
        tried.join("; ")
    ))
}

fn engine_name(engine: ExcelEngine) -> &'static str {
    match engine {
        ExcelEngine::Openpyxl => "openpyxl",
        ExcelEngine::Xlwings => "xlwings",
    }
}

fn dependency_name(engine: ExcelEngine) -> &'static str {
    match engine {
        ExcelEngine::Openpyxl => "openpyxl",
        ExcelEngine::Xlwings => "xlwings",
    }
}

fn python_has_dependency(env: &PythonEnv, package: &str) -> bool {
    let import_stmt = format!("import {}", package);
    let mut cmd = Command::new(&env.program);
    cmd.args(&env.args).args(["-c", &import_stmt]);
    crate::utils::hide_console(&mut cmd);
    cmd.output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn check_python_dependency(env: &PythonEnv, engine: ExcelEngine) -> Result<(), String> {
    let package = dependency_name(engine);
    let import_stmt = format!("import {}", package);
    let mut cmd = Command::new(&env.program);
    cmd.args(&env.args).args(["-c", &import_stmt]);
    crate::utils::hide_console(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("检查 Python 依赖失败: {}", e))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let mut message = format!(
        "Excel 写入依赖缺失：当前 Python 环境未安装 {package}。\n\n已检测到 Python：\n{} => {}\n\n请在命令行执行：\n{}",
        env.display_command(),
        env.version,
        env.pip_install_command(package)
    );

    if engine == ExcelEngine::Xlwings {
        message.push_str("\n\n注意：xlwings 写入模式还需要本机安装 Microsoft Excel。");
    }

    if !stderr.is_empty() {
        message.push_str("\n\n检测详情：\n");
        message.push_str(&stderr);
    }

    Err(message)
}

fn try_write(
    script_path: &str,
    file_path: &str,
    json_path: &str,
    engine: ExcelEngine,
) -> Result<(), String> {
    let env = find_python3_with_dependency(engine)?;

    let mut cmd = Command::new(&env.program);
    cmd.args(&env.args)
        .arg(script_path)
        .arg(file_path)
        .arg(json_path);
    crate::utils::hide_console(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("调用 Python 失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Python 写入失败。\n\n引擎：{}\nPython：{} => {}\n脚本：{}\n\n错误详情：\n{}",
            engine_name(engine),
            env.display_command(),
            env.version,
            script_path,
            stderr.trim()
        ));
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
    let engine = current_engine();
    if engine == ExcelEngine::Xlwings {
        let script = find_write_script_xlwings()?;
        return try_write(&script, file_path, json_path, engine);
    }

    let script = find_write_script()?;
    try_write(&script, file_path, json_path, engine)
}
