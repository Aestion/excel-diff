// CLI binary for testing and automation

#[allow(dead_code)]
#[path = "excel/mod.rs"]
mod excel;
#[allow(dead_code)]
#[path = "models/mod.rs"]
mod models;

use std::env;
use std::process;

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        print_usage();
        process::exit(1);
    }

    let result = match args[1].as_str() {
        "list" => cmd_list(&args[2..]),
        "read" => cmd_read(&args[2..]),
        "diff" => cmd_diff(&args[2..]),
        "write" => cmd_write(&args[2..]),
        "detect-keys" => cmd_detect_keys(&args[2..]),
        "merge-rows" => cmd_merge_rows(&args[2..]),
        "edit-cell" => cmd_edit_cell(&args[2..]),
        _ => { print_usage(); process::exit(1); }
    };

    if let Err(e) = result {
        eprintln!("ERROR: {}", e);
        process::exit(1);
    }
}

fn print_usage() {
    eprintln!("Usage: excel-diff-cli <command> [options]");
    eprintln!();
    eprintln!("Commands:");
    eprintln!("  list <dir>                              List Excel files");
    eprintln!("  read <file> [--sheet <name>]            Read Excel as JSON");
    eprintln!("  diff <old> <new> --key <col>            Compare two files");
    eprintln!("  write <file> --json <data_file>         Write JSON to Excel");
    eprintln!("  detect-keys <file> --sheet <name>       Detect key columns");
    eprintln!("  merge-rows <old> <new> --key <col> --keys <k1,k2,...>");
    eprintln!("                                          Copy rows from old to new");
    eprintln!("  edit-cell <file> --key <col> --row <key_val> --col <col_idx> --val <value>");
    eprintln!("                                          Edit a single cell");
}

fn cmd_list(args: &[String]) -> Result<(), String> {
    if args.is_empty() { return Err("list requires <dir>".into()); }
    let dir = &args[0];

    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Cannot read dir: {}", e))?;

    let extensions = ["xlsx", "xlsm", "xlsb", "xls"];
    let mut files = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // Recurse
            collect_files(&path, dir, &mut files)?;
        } else if let Some(ext) = path.extension() {
            let ext_str = ext.to_string_lossy().to_lowercase();
            if extensions.contains(&ext_str.as_str()) {
                let rel = path.strip_prefix(dir).unwrap_or(&path);
                files.push(serde_json::json!({
                    "name": entry.file_name().to_string_lossy(),
                    "path": path.to_string_lossy(),
                    "relativePath": rel.to_string_lossy(),
                    "sizeBytes": entry.metadata().map(|m| m.len()).unwrap_or(0),
                }));
            }
        }
    }

    println!("{}", serde_json::to_string_pretty(&files).unwrap());
    Ok(())
}

fn collect_files(dir: &std::path::Path, base: &str, files: &mut Vec<serde_json::Value>) -> Result<(), String> {
    let extensions = ["xlsx", "xlsm", "xlsb", "xls"];
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, base, files)?;
        } else if let Some(ext) = path.extension() {
            if extensions.contains(&ext.to_string_lossy().to_lowercase().as_str()) {
                let rel = path.strip_prefix(base).unwrap_or(&path);
                files.push(serde_json::json!({
                    "name": entry.file_name().to_string_lossy(),
                    "path": path.to_string_lossy(),
                    "relativePath": rel.to_string_lossy(),
                    "sizeBytes": entry.metadata().map(|m| m.len()).unwrap_or(0),
                }));
            }
        }
    }
    Ok(())
}

fn cmd_read(args: &[String]) -> Result<(), String> {
    if args.is_empty() { return Err("read requires <file>".into()); }
    let file = &args[0];

    let wb = excel::reader::read_workbook(file)?;

    if args.len() > 2 && args[1] == "--sheet" {
        // Read specific sheet
        let sheet_name = &args[2];
        let sheet = wb.sheets.iter().find(|s| s.name == *sheet_name)
            .ok_or_else(|| format!("Sheet '{}' not found", sheet_name))?;
        println!("{}", serde_json::to_string_pretty(sheet).unwrap());
    } else {
        println!("{}", serde_json::to_string_pretty(&wb).unwrap());
    }
    Ok(())
}

fn cmd_diff(args: &[String]) -> Result<(), String> {
    if args.len() < 4 || args[2] != "--key" {
        return Err(format!("diff requires <old> <new> --key <col_index>, got {:?}", args));
    }
    let old_file = &args[0];
    let new_file = &args[1];
    let key_col: usize = args[3].parse().map_err(|_| "Invalid key column index")?;

    let old_wb = excel::reader::read_workbook(old_file)?;
    let new_wb = excel::reader::read_workbook(new_file)?;

    let old_sheet = &old_wb.sheets[0];
    let new_sheet = &new_wb.sheets[0];

    // Build key maps
    use std::collections::{HashMap, HashSet};
    let mut old_by_key: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, row) in old_sheet.rows.iter().enumerate().skip(1) {
        old_by_key.entry(cell_str(&row[key_col])).or_default().push(i);
    }
    let mut new_by_key: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, row) in new_sheet.rows.iter().enumerate().skip(1) {
        new_by_key.entry(cell_str(&row[key_col])).or_default().push(i);
    }

    let mut consumed_old: HashSet<usize> = HashSet::new();
    let mut consumed_new: HashSet<usize> = HashSet::new();

    let mut results = Vec::new();

    for i in 1..old_sheet.rows.len() {
        if consumed_old.contains(&i) { continue; }
        let key = cell_str(&old_sheet.rows[i][key_col]);
        let mut matched: Option<usize> = None;
        if let Some(list) = new_by_key.get(&key) {
            for &ni in list {
                if !consumed_new.contains(&ni) { matched = Some(ni); break; }
            }
        }
        consumed_old.insert(i);
        match matched {
            Some(ni) => {
                consumed_new.insert(ni);
                let max_cols = old_sheet.rows[i].len().max(new_sheet.rows[ni].len());
                let mut diffs = Vec::new();
                for c in 0..max_cols {
                    let ov = old_sheet.rows[i].get(c).map(|cd| &cd.value).unwrap_or(&serde_json::Value::Null);
                    let nv = new_sheet.rows[ni].get(c).map(|cd| &cd.value).unwrap_or(&serde_json::Value::Null);
                    let ov_formula = old_sheet.rows[i].get(c).and_then(|cd| cd.formula.as_ref());
                    let nv_formula = new_sheet.rows[ni].get(c).and_then(|cd| cd.formula.as_ref());
                    // Skip if both are completely empty (value and formula)
                    let both_empty_val = ov.is_null() && nv.is_null();
                    let both_empty_formula = ov_formula.is_none() && nv_formula.is_none();
                    if !(both_empty_val && both_empty_formula) && (ov != nv || ov_formula != nv_formula) {
                        diffs.push(c);
                    }
                }
                let status = if diffs.is_empty() { "unchanged" } else { "modified" };
                results.push(serde_json::json!({
                    "key": key, "oldIndex": i, "newIndex": ni,
                    "status": status, "diffCols": diffs,
                }));
            }
            None => {
                results.push(serde_json::json!({
                    "key": key, "oldIndex": i, "status": "deleted",
                }));
            }
        }
    }

    for i in 1..new_sheet.rows.len() {
        if consumed_new.contains(&i) { continue; }
        let key = cell_str(&new_sheet.rows[i][key_col]);
        results.push(serde_json::json!({
            "key": key, "newIndex": i, "status": "added",
        }));
    }

    let stats = serde_json::json!({
        "unchanged": results.iter().filter(|r| r["status"] == "unchanged").count(),
        "modified": results.iter().filter(|r| r["status"] == "modified").count(),
        "deleted": results.iter().filter(|r| r["status"] == "deleted").count(),
        "added": results.iter().filter(|r| r["status"] == "added").count(),
    });

    let output = serde_json::json!({ "stats": stats, "rows": results });
    println!("{}", serde_json::to_string_pretty(&output).unwrap());
    Ok(())
}

fn cmd_write(args: &[String]) -> Result<(), String> {
    if args.len() < 3 || args[1] != "--json" {
        return Err("write requires <file> --json <data_file>".into());
    }
    let file = &args[0];
    let json_file = &args[2];

    let json_str = std::fs::read_to_string(json_file)
        .map_err(|e| format!("Cannot read JSON: {}", e))?;
    let data: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Invalid JSON: {}", e))?;

    let sheets: Vec<models::SheetData> = serde_json::from_value(data["sheets"].clone())
        .map_err(|e| format!("Invalid sheets data: {}", e))?;

    excel::writer::write_workbook(file, &sheets)?;
    println!("OK");
    Ok(())
}

fn cmd_detect_keys(args: &[String]) -> Result<(), String> {
    if args.len() < 3 || args[1] != "--sheet" {
        return Err("detect-keys requires <file> --sheet <name>".into());
    }
    let file = &args[0];
    let sheet_name = &args[2];

    let wb = excel::reader::read_workbook(file)?;
    let sheet = wb.sheets.iter().find(|s| s.name == *sheet_name)
        .ok_or_else(|| format!("Sheet '{}' not found", sheet_name))?;

    if sheet.rows.len() < 2 {
        println!("[]");
        return Ok(());
    }

    let mut scores: Vec<(usize, f64)> = Vec::new();
    for ci in 0..sheet.columns.len() {
        // Skip columns with empty/None/fallback headers
        let header = sheet.columns.get(ci).map(|c| c.name.trim().to_string()).unwrap_or_default();
        if header.is_empty() || header == "None" || header.starts_with("Column ") {
            continue;
        }

        let mut vals: Vec<String> = Vec::new();
        let mut total_rows = 0usize;
        for row in sheet.rows.iter().skip(1) {
            total_rows += 1;
            if ci < row.len() {
                let v = cell_str(&row[ci]);
                if !v.is_empty() { vals.push(v); }
            }
        }
        // Skip if fill rate < 80%
        if vals.len() * 5 < total_rows * 4 { continue; }
        if vals.is_empty() { continue; }
        let total = vals.len();
        let unique: std::collections::HashSet<_> = vals.iter().collect();
        scores.push((ci, unique.len() as f64 / total as f64));
    }

    scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    let result: Vec<usize> = scores.iter()
        .filter(|(_, s)| *s > 0.95)
        .map(|(i, _)| *i)
        .collect();

    let result = if result.is_empty() {
        scores.iter().take(3).map(|(i, _)| *i).collect::<Vec<_>>()
    } else { result };

    println!("{}", serde_json::to_string(&result).unwrap());
    Ok(())
}

use models::CellData;

fn cell_str(v: &CellData) -> String {
    match &v.value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => {
            let f = n.as_f64().unwrap();
            if f == (f as i64) as f64 { format!("{}", f as i64) } else { format!("{}", f) }
        }
        serde_json::Value::Null => String::new(),
        _ => format!("{}", v.value),
    }
}

fn parse_args_map(args: &[String]) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    let mut i = 0;
    while i < args.len() {
        if args[i].starts_with("--") && i + 1 < args.len() {
            map.insert(args[i][2..].to_string(), args[i + 1].clone());
            i += 2;
        } else {
            i += 1;
        }
    }
    map
}

/// merge-rows: copy specified rows from old to new
/// Usage: merge-rows <old> <new> --key <col> --keys <k1,k2,...>
fn cmd_merge_rows(args: &[String]) -> Result<(), String> {
    if args.len() < 2 { return Err("merge-rows requires <old> <new>".into()); }
    let old_file = &args[0];
    let new_file = &args[1];
    let flags = parse_args_map(&args[2..]);

    let key_col: usize = flags.get("key").ok_or("--key required")?
        .parse().map_err(|_| "Invalid key col")?;
    let keys_str = flags.get("keys").ok_or("--keys required (comma-separated)")?;
    let merge_keys: Vec<&str> = keys_str.split(',').collect();

    let old_wb = excel::reader::read_workbook(old_file)?;
    let mut new_wb = excel::reader::read_workbook(new_file)?;

    let old_sheet = &old_wb.sheets[0];

    // Build old key map
    use std::collections::HashMap;
    let mut old_map: HashMap<String, usize> = HashMap::new();
    for (i, row) in old_sheet.rows.iter().enumerate().skip(1) {
        old_map.insert(cell_str(&row[key_col]), i);
    }

    // For each merge key, copy old row to new
    let new_sheet = &mut new_wb.sheets[0];
    let mut merged_count = 0;

    for &mk in &merge_keys {
        let old_idx = match old_map.get(mk) {
            Some(&idx) => idx,
            None => continue,
        };
        let old_row = &old_sheet.rows[old_idx];

        // Find matching row in new
        for ni in 1..new_sheet.rows.len() {
            if ni >= new_sheet.rows.len() { break; }
            if cell_str(&new_sheet.rows[ni][key_col]) == mk {
                // Copy old values to new row (up to old column count)
                let copy_len = old_row.len();
                while new_sheet.rows[ni].len() < copy_len {
                    new_sheet.rows[ni].push(CellData::new(serde_json::Value::Null));
                }
                for c in 0..copy_len {
                    new_sheet.rows[ni][c] = old_row[c].clone();
                }
                merged_count += 1;
                break;
            }
        }
    }

    // Write back
    let json_path = format!("{}.tmp_merge.json", new_file);
    let data = serde_json::json!({"sheets": new_wb.sheets.iter().map(|s| serde_json::json!({"name": s.name, "rows": s.rows})).collect::<Vec<_>>()});
    std::fs::write(&json_path, serde_json::to_string(&data).unwrap()).map_err(|e| e.to_string())?;

    let script = find_write_script()?;
    let (python, python_args) = find_python3()?;
    let output = std::process::Command::new(&python).args(&python_args).arg(&script).arg(new_file).arg(&json_path)
        .output().map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&json_path);

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    println!("OK: merged {} rows", merged_count);
    Ok(())
}

/// edit-cell: change a single cell value
/// Usage: edit-cell <file> --key <col> --row <key_val> --col <col_idx> --val <value>
fn cmd_edit_cell(args: &[String]) -> Result<(), String> {
    if args.is_empty() { return Err("edit-cell requires <file>".into()); }
    let file = &args[0];
    let flags = parse_args_map(&args[1..]);

    let key_col: usize = flags.get("key").ok_or("--key required")?
        .parse().map_err(|_| "Invalid key col")?;
    let row_key = flags.get("row").ok_or("--row required")?;
    let col_idx: usize = flags.get("col").ok_or("--col required")?
        .parse().map_err(|_| "Invalid col")?;
    let val = flags.get("val").ok_or("--val required")?;

    let mut wb = excel::reader::read_workbook(file)?;
    let sheet = &mut wb.sheets[0];

    // Find the row by key
    for i in 1..sheet.rows.len() {
        if cell_str(&sheet.rows[i][key_col]) == *row_key {
            while sheet.rows[i].len() <= col_idx {
                sheet.rows[i].push(CellData::new(serde_json::Value::Null));
            }
            // Try to parse as number, otherwise string
            if val.starts_with('=') {
                // Formula: keep existing value, set formula
                sheet.rows[i][col_idx].formula = Some(val.to_string());
            } else if let Ok(n) = val.parse::<f64>() {
                // Number value, clear formula
                sheet.rows[i][col_idx].value = serde_json::json!(n);
                sheet.rows[i][col_idx].formula = None;
            } else {
                // String value, clear formula
                sheet.rows[i][col_idx].value = serde_json::json!(val);
                sheet.rows[i][col_idx].formula = None;
            }

            // Write back
            let json_path = format!("{}.tmp_edit.json", file);
            let data = serde_json::json!({"sheets": wb.sheets.iter().map(|s| serde_json::json!({"name": s.name, "rows": s.rows})).collect::<Vec<_>>()});
            std::fs::write(&json_path, serde_json::to_string(&data).unwrap()).map_err(|e| e.to_string())?;

            let script = find_write_script()?;
            let (python, python_args) = find_python3()?;
            let output = std::process::Command::new(&python).args(&python_args).arg(&script).arg(file).arg(&json_path)
                .output().map_err(|e| e.to_string())?;
            let _ = std::fs::remove_file(&json_path);

            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).to_string());
            }

            println!("OK: set row={} col={} to {:?}", row_key, col_idx, val);
            return Ok(());
        }
    }

    Err(format!("Row with key '{}' not found", row_key))
}

fn find_write_script() -> Result<String, String> {
    let candidates = [
        "write_excel.py",
        "src-tauri/write_excel.py",
        "../src-tauri/write_excel.py",
        "./src-tauri/write_excel.py",
    ];
    for c in &candidates {
        if std::path::Path::new(c).exists() { return Ok(c.to_string()); }
    }
    let src_path = concat!(env!("CARGO_MANIFEST_DIR"), "/write_excel.py");
    if std::path::Path::new(src_path).exists() { return Ok(src_path.to_string()); }
    Err("write_excel.py not found".into())
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
    let output = std::process::Command::new(program)
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

    Err(format!("Python 3 not found. Tried: {}", tried.join("; ")))
}
