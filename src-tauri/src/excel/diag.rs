use crate::excel::reader;
use crate::models::CellData;
use std::collections::{HashMap, HashSet};

pub fn diagnose(old_path: &str, new_path: &str, key_col: usize) {
    let old_wb = reader::read_workbook(old_path).unwrap();
    let new_wb = reader::read_workbook(new_path).unwrap();
    let old_rows = &old_wb.sheets[0].rows;
    let new_rows = &new_wb.sheets[0].rows;

    println!("OLD: {} data rows, NEW: {} data rows, key_col={}", old_rows.len()-1, new_rows.len()-1, key_col);

    // Build key -> list of indices
    let mut old_by_key: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, row) in old_rows.iter().enumerate().skip(1) {
        old_by_key.entry(fc(&row[key_col])).or_default().push(i);
    }
    let mut new_by_key: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, row) in new_rows.iter().enumerate().skip(1) {
        new_by_key.entry(fc(&row[key_col])).or_default().push(i);
    }

    // Show duplicate keys
    for (key, list) in &new_by_key {
        if list.len() > 1 { println!("  ⚠ NEW has duplicate key '{}' at rows {:?}", key, list); }
    }
    for (key, list) in &old_by_key {
        if list.len() > 1 { println!("  ⚠ OLD has duplicate key '{}' at rows {:?}", key, list); }
    }

    // Match in old order
    let mut consumed_old: HashSet<usize> = HashSet::new();
    let mut consumed_new: HashSet<usize> = HashSet::new();

    println!("\nDIFF (old order):");
    for i in 1..old_rows.len() {
        if consumed_old.contains(&i) { continue; }
        let key = fc(&old_rows[i][key_col]);
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
                let same = old_rows[i] == new_rows[ni];
                let status = if same {
                    "SAME".to_string()
                } else {
                    let diffs: Vec<_> = (0..old_rows[i].len().max(new_rows[ni].len()))
                        .filter(|&c| old_rows[i].get(c) != new_rows[ni].get(c))
                        .collect();
                    format!("DIFF cols {:?}", diffs)
                };
                println!("  OLD[{}] <-> NEW[{}] key={} {}", i, ni, key, status);
            }
            None => println!("  OLD[{}] key={} → DELETED", i, key),
        }
    }
    for i in 1..new_rows.len() {
        if consumed_new.contains(&i) { continue; }
        let key = fc(&new_rows[i][key_col]);
        consumed_new.insert(i);
        println!("  NEW[{}] key={} → ADDED", i, key);
    }
}

fn fc(v: &CellData) -> String {
    match &v.value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => {
            let f = n.as_f64().unwrap();
            if f == (f as i64) as f64 { format!("{}", f as i64) } else { format!("{}", f) }
        }
        serde_json::Value::Null => "∅".into(),
        _ => format!("{:?}", v.value),
    }
}
