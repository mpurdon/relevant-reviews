mod bedrock;
mod commands;
mod config;
mod fetch;
mod github;
mod pr_parser;
mod prompts;
pub mod types;

use commands::AppState;
use std::env;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = env::args().collect();
    let manifest_path = args.get(1).cloned();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            manifest_path: Mutex::new(manifest_path),
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_manifest,
            commands::get_initial_manifest_path,
            commands::fetch_pr,
            commands::fetch_review_requests,
            commands::get_settings,
            commands::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
