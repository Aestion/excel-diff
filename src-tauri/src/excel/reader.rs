use calamine::{Reader, open_workbook, Xlsx, Data, CellErrorType};
use crate::models::{ParsedWorkbook, SheetData, CellData, ColumnInfo};

/// Read Excel file using calamine (pure Rust, no Python needed)
pub fn read_workbook(file_path: &str) -> Result<ParsedWorkbook, String> {
    let mut workbook: Xlsx<_> = open_workbook(file_path)
        .map_err(|e| format!("打开 Excel 文件失败: {}", e))?;

    let sheet_names = workbook.sheet_names()
        .to_owned();

    let mut sheets = Vec::new();

    for name in &sheet_names {
        // Read cell values
        let range = workbook.worksheet_range(name)
            .map_err(|e| format!("读取 Sheet '{}' 失败: {}", name, e))?;

        // Read formulas (if any)
        let formula_range = workbook.worksheet_formula(name).ok();

        let rows = range.rows().enumerate().map(|(row_idx, row)| {
            row.iter().enumerate().map(|(col_idx, cell)| {
                // Check if there's a formula at this position
                let formula = formula_range.as_ref()
                    .and_then(|fr| fr.get_value((row_idx as u32, col_idx as u32)))
                    .filter(|f| !f.is_empty())
                    .map(|f| f.clone());

                cell_to_cell_data(cell, formula)
            }).collect::<Vec<_>>()
        }).collect::<Vec<_>>();

        // Build columns from the second row. In these config sheets, row 1 is an optional note row
        // and row 2 contains the required field names.
        let header_row = rows.get(1).or_else(|| rows.get(0));
        let columns = if let Some(header_row) = header_row {
            header_row.iter().enumerate().map(|(i, cell)| {
                let name = match &cell.value {
                    serde_json::Value::String(s) => s.clone(),
                    serde_json::Value::Number(n) => format!("{}", n),
                    serde_json::Value::Null => format!("Column {}", i + 1),
                    _ => format!("Column {}", i + 1),
                };
                ColumnInfo {
                    index: i,
                    name,
                    data_type: "mixed".to_string(),
                }
            }).collect()
        } else {
            Vec::new()
        };

        sheets.push(SheetData {
            name: name.clone(),
            columns,
            rows,
        });
    }

    Ok(ParsedWorkbook {
        file_path: file_path.to_string(),
        sheets,
        sheet_names,
    })
}

fn cell_to_cell_data(cell: &Data, formula: Option<String>) -> CellData {
    let value = match cell {
        Data::Empty => serde_json::Value::Null,
        Data::Bool(b) => serde_json::Value::Bool(*b),
        Data::Int(i) => serde_json::Value::Number((*i).into()),
        Data::Float(f) => {
            if *f == (*f as i64) as f64 {
                serde_json::Value::Number((*f as i64).into())
            } else {
                serde_json::Value::Number(
                    serde_json::Number::from_f64(*f).unwrap_or_else(|| 0.into())
                )
            }
        }
        Data::String(s) => serde_json::Value::String(s.clone()),
        Data::Error(e) => {
            let err_str = match e {
                CellErrorType::Null => "#NULL!",
                CellErrorType::Div0 => "#DIV/0!",
                CellErrorType::Value => "#VALUE!",
                CellErrorType::Ref => "#REF!",
                CellErrorType::Name => "#NAME?",
                CellErrorType::Num => "#NUM!",
                CellErrorType::NA => "#N/A",
                _ => "#ERROR!",
            };
            serde_json::Value::String(err_str.to_string())
        }
        Data::DateTime(dt) => {
            serde_json::Value::String(format!("{}", dt))
        }
        Data::DateTimeIso(s) => {
            serde_json::Value::String(s.clone())
        }
        Data::DurationIso(s) => {
            serde_json::Value::String(s.clone())
        }
    };

    match formula {
        Some(f) => CellData::with_formula(value, f),
        None => CellData::new(value),
    }
}
