use calamine::{Reader, open_workbook, Xlsx};

fn main() {
    let mut workbook: Xlsx<_> = open_workbook("E:/ClaudeWork/test1/1.xlsx").unwrap();
    let range = workbook.worksheet_range("Sheet1").unwrap();

    println!("Range rows: {}", range.rows().len());

    // Check row 21 (index 21, after header)
    for row_idx in 20..=22 {
        if let Some(row) = range.rows().nth(row_idx) {
            println!("\nRow {}:", row_idx);
            for (col_idx, cell) in row.iter().enumerate() {
                println!("  Col {}: value={:?}", col_idx, cell);
            }
        }
    }

    // Try to read formulas
    match workbook.worksheet_formula("Sheet1") {
        Ok(formula_range) => {
            println!("\nFormula range rows: {}", formula_range.rows().len());
            for row_idx in 20..=22 {
                if let Some(row) = formula_range.rows().nth(row_idx) {
                    println!("\nFormula Row {}:", row_idx);
                    for (col_idx, formula) in row.iter().enumerate() {
                        if !formula.is_empty() {
                            println!("  Col {}: formula={:?}", col_idx, formula);
                        }
                    }
                }
            }
        }
        Err(e) => {
            println!("\nError reading formulas: {:?}", e);
        }
    }
}
