use std::process::Command;
use std::sync::OnceLock;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ExcelEngine {
    Openpyxl,
    Xlwings,
}

fn detect() -> ExcelEngine {
    match std::env::var("EXCEL_DIFF_ENGINE")
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "openpyxl" => return ExcelEngine::Openpyxl,
        "xlwings" => return ExcelEngine::Xlwings,
        _ => {}
    }

    // Non-Windows: always use openpyxl
    if !cfg!(target_os = "windows") {
        return ExcelEngine::Openpyxl;
    }

    // Probe 1: can we import xlwings?
    let ok_xlwings = Command::new("python")
        .args(["-c", "import xlwings"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !ok_xlwings {
        return ExcelEngine::Openpyxl;
    }

    // Probe 2: is Excel COM registered in Windows registry?
    let ok_com = Command::new("python")
        .args([
            "-c",
            r"import winreg; winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, r'Excel.Application\CLSID')",
        ])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if ok_com {
        ExcelEngine::Xlwings
    } else {
        ExcelEngine::Openpyxl
    }
}

static ENGINE: OnceLock<ExcelEngine> = OnceLock::new();

pub fn current_engine() -> ExcelEngine {
    *ENGINE.get_or_init(detect)
}
