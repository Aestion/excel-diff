// Full simulation of the app's diff pipeline
use crate::excel::reader;
use crate::models::CellData;
use std::collections::HashMap;

pub fn full_diff_simulation(old_path: &str, new_path: &str, key_col: usize) {
    let old_wb = reader::read_workbook(old_path).unwrap();
    let new_wb = reader::read_workbook(new_path).unwrap();

    let old_rows = &old_wb.sheets[0].rows;
    let new_rows = &new_wb.sheets[0].rows;

    // Build key maps (skip header at index 0)
    let mut old_map: HashMap<String, (usize, &Vec<CellData>)> = HashMap::new();
    for (i, row) in old_rows.iter().enumerate().skip(1) {
        let key = fmt_cell(&row[key_col]);
        old_map.insert(key, (i, row));
    }

    let mut new_map: HashMap<String, (usize, &Vec<CellData>)> = HashMap::new();
    for (i, row) in new_rows.iter().enumerate().skip(1) {
        let key = fmt_cell(&row[key_col]);
        new_map.insert(key, (i, row));
    }

    println!("╔══════════════════════════════════════════════════════════════════════════════╗");
    println!("║  DIFF RESULT (key column = {})                                               ║", key_col);
    println!("╠══════╦════════════════════════════════╦════════════════════════════════╣");
    println!("║ Pos  ║ LEFT (old)                     ║ RIGHT (new)                    ║");
    println!("╠══════╬════════════════════════════════╬════════════════════════════════╣");

    let mut consumed: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut pos = 0;

    // Process old rows in order
    for i in 1..old_rows.len() {
        let old_row = &old_rows[i];
        let key = fmt_cell(&old_row[key_col]);
        pos += 1;

        match new_map.get(&key) {
            Some((_, new_row)) => {
                consumed.insert(key.clone());
                let mut diffs = Vec::new();
                for c in 0..old_row.len().max(new_row.len()) {
                    let ov = old_row.get(c).map(|cd| &cd.value).unwrap_or(&serde_json::Value::Null);
                    let nv = new_row.get(c).map(|cd| &cd.value).unwrap_or(&serde_json::Value::Null);
                    let ov_formula = old_row.get(c).and_then(|cd| cd.formula.as_ref());
                    let nv_formula = new_row.get(c).and_then(|cd| cd.formula.as_ref());
                    if ov != nv || ov_formula != nv_formula { diffs.push(c); }
                }
                let status = if diffs.is_empty() { "  " } else { "≠≠" };
                println!("║ {:>3}  ║ {} {} ║ {} {} ║",
                    pos, status, fmt_row(old_row), status, fmt_row(new_row));
                if !diffs.is_empty() {
                    for c in &diffs {
                        let ov = old_row.get(*c).map(|cd| &cd.value).unwrap_or(&serde_json::Value::Null);
                        let nv = new_row.get(*c).map(|cd| &cd.value).unwrap_or(&serde_json::Value::Null);
                        let ovf = old_row.get(*c).and_then(|cd| cd.formula.as_ref());
                        let nvf = new_row.get(*c).and_then(|cd| cd.formula.as_ref());
                        let mut ov_str = format!("{:?}", ov);
                        let mut nv_str = format!("{:?}", nv);
                        if let Some(f) = ovf { ov_str = format!("{} [f:{}]", ov_str, f); }
                        if let Some(f) = nvf { nv_str = format!("{} [f:{}]", nv_str, f); }
                        println!("║      ║    col{}: {} ║    col{}: {} ║", c, ov_str, c, nv_str);
                    }
                }
            }
            None => {
                println!("║ {:>3}  ║ -- {} ║ (deleted)                    ║", pos, fmt_row(old_row));
            }
        }
    }

    // Append new-only rows
    for i in 1..new_rows.len() {
        let new_row = &new_rows[i];
        let key = fmt_cell(&new_row[key_col]);
        if !consumed.contains(&key) {
            pos += 1;
            println!("║ {:>3}  ║ (added)                      ║ ++ {} ║", pos, fmt_row(new_row));
        }
    }

    println!("╚══════╩════════════════════════════════╩════════════════════════════════╝");

    println!("\nLEFT file has {} data rows, RIGHT file has {} data rows",
        old_rows.len() - 1, new_rows.len() - 1);
}

fn fmt_cell(v: &CellData) -> String {
    let val_str = match &v.value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => {
            let f = n.as_f64().unwrap_or(0.0);
            if f == (f as i64) as f64 { format!("{}", f as i64) } else { format!("{}", f) }
        }
        serde_json::Value::Null => "∅".into(),
        _ => format!("{:?}", v.value),
    };
    if let Some(f) = &v.formula {
        format!("{} [={}]", val_str, f)
    } else {
        val_str
    }
}

fn fmt_row(row: &Vec<CellData>) -> String {
    let parts: Vec<String> = row.iter().map(fmt_cell).collect();
    let s = parts.join(", ");
    if s.len() > 28 { format!("{}...", &s[..25]) } else { format!("{:<28}", s) }
}
