use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub relative_path: String,
    pub size_bytes: u64,
    #[serde(default)]
    pub modified_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub index: usize,
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellData {
    pub value: serde_json::Value,
    #[serde(default)]
    pub formula: Option<String>,
}

impl CellData {
    pub fn new(value: serde_json::Value) -> Self {
        Self { value, formula: None }
    }

    pub fn with_formula(value: serde_json::Value, formula: String) -> Self {
        Self { value, formula: Some(formula) }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetData {
    pub name: String,
    #[serde(default)]
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Vec<CellData>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedWorkbook {
    pub file_path: String,
    pub sheets: Vec<SheetData>,
    pub sheet_names: Vec<String>,
}
