use crate::types::{PrFile, PrMetadata};
use base64::Engine;
use reqwest::header::{ACCEPT, AUTHORIZATION, USER_AGENT};
use reqwest::Client;
use serde::Deserialize;

pub struct GithubClient {
    client: Client,
    token: String,
}

#[derive(Deserialize)]
struct ContentsResponse {
    content: Option<String>,
    encoding: Option<String>,
}

impl GithubClient {
    pub fn new(token: String) -> Self {
        Self {
            client: Client::new(),
            token,
        }
    }

    pub async fn get_pr_metadata(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<PrMetadata, String> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}",
            owner, repo, pr_number
        );

        let resp = self
            .client
            .get(&url)
            .header(AUTHORIZATION, format!("Bearer {}", self.token))
            .header(USER_AGENT, "relevant-reviews")
            .header(ACCEPT, "application/vnd.github.v3+json")
            .send()
            .await
            .map_err(|e| format!("GitHub API request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("GitHub API error ({}): {}", status, body));
        }

        resp.json::<PrMetadata>()
            .await
            .map_err(|e| format!("Failed to parse PR metadata: {}", e))
    }

    pub async fn get_pr_files(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<Vec<PrFile>, String> {
        let mut all_files = Vec::new();
        let mut page = 1u32;

        loop {
            let url = format!(
                "https://api.github.com/repos/{}/{}/pulls/{}/files?per_page=100&page={}",
                owner, repo, pr_number, page
            );

            let resp = self
                .client
                .get(&url)
                .header(AUTHORIZATION, format!("Bearer {}", self.token))
                .header(USER_AGENT, "relevant-reviews")
                .header(ACCEPT, "application/vnd.github.v3+json")
                .send()
                .await
                .map_err(|e| format!("GitHub API request failed: {}", e))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                return Err(format!("GitHub API error ({}): {}", status, body));
            }

            let files: Vec<PrFile> = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse PR files: {}", e))?;

            if files.is_empty() {
                break;
            }

            all_files.extend(files);
            page += 1;

            // Safety: don't paginate forever
            if page > 30 {
                break;
            }
        }

        Ok(all_files)
    }

    pub async fn get_pr_diff(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<String, String> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/pulls/{}",
            owner, repo, pr_number
        );

        let resp = self
            .client
            .get(&url)
            .header(AUTHORIZATION, format!("Bearer {}", self.token))
            .header(USER_AGENT, "relevant-reviews")
            .header(ACCEPT, "application/vnd.github.v3.diff")
            .send()
            .await
            .map_err(|e| format!("GitHub API request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("GitHub API error ({}): {}", status, body));
        }

        resp.text()
            .await
            .map_err(|e| format!("Failed to read PR diff: {}", e))
    }

    pub async fn get_file_content(
        &self,
        owner: &str,
        repo: &str,
        path: &str,
        ref_sha: &str,
    ) -> Result<String, String> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/contents/{}?ref={}",
            owner, repo, path, ref_sha
        );

        let resp = self
            .client
            .get(&url)
            .header(AUTHORIZATION, format!("Bearer {}", self.token))
            .header(USER_AGENT, "relevant-reviews")
            .header(ACCEPT, "application/vnd.github.v3+json")
            .send()
            .await
            .map_err(|e| format!("GitHub API request failed: {}", e))?;

        if resp.status().as_u16() == 404 {
            // File doesn't exist at this ref (added or deleted)
            return Ok(String::new());
        }

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("GitHub API error ({}): {}", status, body));
        }

        let contents: ContentsResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse file contents: {}", e))?;

        match contents.content {
            Some(encoded) if contents.encoding.as_deref() == Some("base64") => {
                let cleaned: String = encoded.chars().filter(|c| !c.is_whitespace()).collect();
                let decoded = base64::engine::general_purpose::STANDARD
                    .decode(&cleaned)
                    .map_err(|e| format!("Failed to decode base64 content: {}", e))?;
                String::from_utf8(decoded)
                    .map_err(|e| format!("File content is not valid UTF-8: {}", e))
            }
            Some(content) => Ok(content),
            None => Ok(String::new()),
        }
    }
}
