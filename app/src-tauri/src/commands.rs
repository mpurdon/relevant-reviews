use crate::config::{load_settings, resolve_github_token, save_settings_to_disk};
use crate::fetch::fetch_pr_impl;
use crate::github::GithubClient;
use crate::types::{ReviewManifest, ReviewRequestItem, Settings};
use std::fs;
use std::sync::Mutex;
use tauri::{command, State};

pub struct AppState {
    pub manifest_path: Mutex<Option<String>>,
}

#[command]
pub fn get_settings() -> Settings {
    load_settings()
}

#[command]
pub fn save_settings(settings: Settings) -> Result<(), String> {
    save_settings_to_disk(&settings)
}

#[command]
pub fn load_manifest(path: String) -> Result<ReviewManifest, String> {
    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read manifest: {}", e))?;
    let manifest: ReviewManifest =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse manifest: {}", e))?;
    Ok(manifest)
}

#[command]
pub fn get_initial_manifest_path(state: State<AppState>) -> Option<String> {
    state.manifest_path.lock().unwrap().clone()
}

#[command]
pub async fn fetch_pr(app: tauri::AppHandle, pr_ref: String) -> Result<ReviewManifest, String> {
    let settings = load_settings();
    fetch_pr_impl(&pr_ref, &settings, &app).await
}

#[command]
pub async fn fetch_review_requests(
    cutoff_date: String,
    fetch_recent: bool,
) -> Result<Vec<ReviewRequestItem>, String> {
    let settings = load_settings();
    let token = resolve_github_token(&settings)?;
    let github = GithubClient::new(token);
    let username = github.get_authenticated_user().await?;
    github
        .get_review_requests(&username, &cutoff_date, fetch_recent)
        .await
}
