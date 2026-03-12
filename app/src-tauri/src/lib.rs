use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::{command, State};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Highlight {
    pub start_line: u64,
    pub end_line: u64,
    pub severity: String, // "critical", "warning", "info"
    pub comment: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileDiff {
    pub path: String,
    pub classification: String,
    pub reason: String,
    pub category: String,
    #[serde(default = "default_risk_level")]
    pub risk_level: String, // "critical", "high", "medium", "low"
    pub diff_type: String,  // "modified", "added", "removed"
    pub base_content: String,
    pub head_content: String,
    pub unified_diff: String,
    #[serde(default)]
    pub highlights: Vec<Highlight>,
}

fn default_risk_level() -> String {
    "medium".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReviewManifest {
    pub pr_title: String,
    pub pr_url: String,
    pub pr_number: u64,
    pub base_ref: String,
    pub head_ref: String,
    pub base_sha: String,
    pub head_sha: String,
    pub files: Vec<FileDiff>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Settings {
    pub model: String,
}

struct AppState {
    manifest_path: Mutex<Option<String>>,
}

fn config_path() -> PathBuf {
    let home = env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home)
        .join(".config")
        .join("relevant-reviews")
        .join("config")
}

#[command]
fn get_settings() -> Settings {
    let path = config_path();
    let model = if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|content| {
                content
                    .lines()
                    .find(|l| l.starts_with("model="))
                    .map(|l| l.trim_start_matches("model=").to_string())
            })
            .unwrap_or_default()
    } else {
        String::new()
    };
    Settings { model }
}

#[command]
fn save_settings(settings: Settings) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    fs::write(&path, format!("model={}\n", settings.model))
        .map_err(|e| format!("Failed to save settings: {}", e))?;
    Ok(())
}

#[command]
fn load_manifest(path: String) -> Result<ReviewManifest, String> {
    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read manifest: {}", e))?;
    let manifest: ReviewManifest =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse manifest: {}", e))?;
    Ok(manifest)
}

#[command]
fn get_initial_manifest_path(state: State<AppState>) -> Option<String> {
    state.manifest_path.lock().unwrap().clone()
}

#[command]
fn fetch_pr(pr_ref: String) -> Result<String, String> {
    // Find the rr script relative to the executable or in PATH
    let rr_path = find_rr_script()?;

    let mut cmd = Command::new(&rr_path);
    cmd.arg(&pr_ref)
        .arg("--manifest-only")
        .env("PATH", get_shell_path());

    // Pass model ARN from settings if configured
    let settings = get_settings();
    if !settings.model.is_empty() {
        cmd.env("RR_MODEL", &settings.model);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run rr: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("rr failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // The last line of rr output when using --manifest-only is the manifest path
    let manifest_path = stdout
        .lines()
        .rev()
        .find(|line| line.ends_with(".json"))
        .ok_or_else(|| "Could not find manifest path in rr output".to_string())?
        .trim()
        .to_string();

    // Verify the manifest file exists
    if !std::path::Path::new(&manifest_path).exists() {
        return Err(format!("Manifest file not found: {}", manifest_path));
    }

    Ok(manifest_path)
}

fn get_shell_path() -> String {
    // macOS GUI apps don't inherit the user's shell PATH. Resolve it by
    // asking a login shell for its PATH, which sources .zprofile/.zshrc etc.
    if let Ok(output) = Command::new("/bin/zsh")
        .args(["-lc", "echo $PATH"])
        .output()
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return path;
            }
        }
    }
    // Fallback: current env PATH plus common Homebrew locations
    let current = env::var("PATH").unwrap_or_default();
    format!("/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:{}", current)
}

fn find_rr_script() -> Result<String, String> {
    // Try next to the executable first
    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            // Walk up to find the rr script (it's at the repo root)
            let mut dir = exe_dir.to_path_buf();
            for _ in 0..10 {
                let candidate = dir.join("rr");
                if candidate.exists() {
                    return Ok(candidate.to_string_lossy().to_string());
                }
                if !dir.pop() {
                    break;
                }
            }
        }
    }

    // Fall back to PATH (use resolved shell PATH so we can find rr in Homebrew etc.)
    let which = Command::new("which")
        .arg("rr")
        .env("PATH", get_shell_path())
        .output()
        .map_err(|e| format!("Failed to find rr: {}", e))?;

    if which.status.success() {
        return Ok(String::from_utf8_lossy(&which.stdout).trim().to_string());
    }

    Err("Could not find the 'rr' script. Make sure it is in your PATH or next to the app.".to_string())
}

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
            load_manifest,
            get_initial_manifest_path,
            fetch_pr,
            get_settings,
            save_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
