mod commands;
mod excel;
mod models;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::list_excel_files,
            commands::hash_files,
            commands::copy_excel_file,
            commands::read_excel,
            commands::write_excel,
            commands::write_excel_changes,
            commands::detect_key_columns,
            commands::get_excel_engine_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
