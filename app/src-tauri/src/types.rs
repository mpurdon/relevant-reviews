use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum FetchStatus {
    Running,
    Done,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FetchProgress {
    pub step: u8,
    pub total_steps: u8,
    pub label: String,
    pub status: FetchStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pr_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_done: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_total: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Highlight {
    pub start_line: u64,
    pub end_line: u64,
    pub severity: String,
    pub comment: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileDiff {
    pub path: String,
    pub classification: String,
    pub reason: String,
    pub category: String,
    #[serde(default = "default_risk_level")]
    pub risk_level: String,
    pub diff_type: String,
    pub base_content: String,
    pub head_content: String,
    pub unified_diff: String,
    #[serde(default)]
    pub additions: u64,
    #[serde(default)]
    pub deletions: u64,
    #[serde(default)]
    pub highlights: Vec<Highlight>,
}

fn default_risk_level() -> String {
    "medium".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChangeGroup {
    pub label: String,
    pub description: String,
    pub file_paths: Vec<String>,
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
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub change_groups: Vec<ChangeGroup>,
    pub files: Vec<FileDiff>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Settings {
    pub model: String,
    #[serde(default)]
    pub github_token: String,
    #[serde(default)]
    pub aws_profile: String,
}

#[derive(Debug, Deserialize)]
pub struct FileClassification {
    pub path: String,
    pub classification: String,
    #[serde(default)]
    pub category: String,
    #[serde(default = "default_risk_level")]
    pub risk_level: String,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Deserialize)]
pub struct HighlightResult {
    pub path: String,
    pub start_line: u64,
    pub end_line: u64,
    #[serde(default = "default_info")]
    pub severity: String,
    #[serde(default)]
    pub comment: String,
}

fn default_info() -> String {
    "info".to_string()
}

#[derive(Debug, Deserialize)]
pub struct PrMetadata {
    pub title: String,
    pub html_url: String,
    pub number: u64,
    pub base: PrRef,
    pub head: PrRef,
}

#[derive(Debug, Deserialize)]
pub struct PrRef {
    #[serde(rename = "ref")]
    pub ref_name: String,
    pub sha: String,
}

#[derive(Debug, Deserialize)]
pub struct PrFile {
    pub filename: String,
    pub status: String,
    #[serde(default)]
    pub additions: u64,
    #[serde(default)]
    pub deletions: u64,
}
