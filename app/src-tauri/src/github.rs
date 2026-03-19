use crate::types::{PrFile, PrMetadata, ReviewRequestItem};
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

#[derive(Deserialize)]
struct GithubUser {
    login: String,
}

#[derive(Deserialize)]
struct SearchResponse {
    items: Vec<SearchItem>,
}

#[derive(Deserialize)]
struct SearchItem {
    number: u64,
    title: String,
    html_url: String,
    user: GithubUser,
    created_at: String,
    updated_at: String,
    draft: Option<bool>,
    pull_request: Option<SearchPullRequest>,
}

#[derive(Deserialize)]
struct SearchPullRequest {
    merged_at: Option<String>,
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

    pub async fn get_authenticated_user(&self) -> Result<String, String> {
        let resp = self
            .client
            .get("https://api.github.com/user")
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

        let user: GithubUser = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse user: {}", e))?;
        Ok(user.login)
    }

    async fn search_prs(
        &self,
        query: &str,
    ) -> Result<Vec<SearchItem>, String> {
        let url = format!(
            "https://api.github.com/search/issues?q={}&sort=created&order=asc&per_page=100",
            urlencoding::encode(query)
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

        let search: SearchResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse search results: {}", e))?;

        Ok(search.items)
    }

    pub async fn get_review_requests(
        &self,
        username: &str,
        cutoff_date: &str,
        fetch_recent: bool,
    ) -> Result<Vec<ReviewRequestItem>, String> {
        let date_filter = if fetch_recent {
            format!("created:>={}", cutoff_date)
        } else {
            format!("created:<{}", cutoff_date)
        };

        // Search for PRs where user is a requested reviewer, has reviewed, or has commented
        // This covers: pending requests, submitted reviews, and pending reviews with comments
        let requested_query = format!(
            "is:pr is:open review-requested:{} -is:draft {}",
            username, date_filter
        );
        let reviewed_query = format!(
            "is:pr is:open reviewed-by:{} -author:{} -is:draft {}",
            username, username, date_filter
        );
        let commented_query = format!(
            "is:pr is:open commenter:{} -author:{} -is:draft {}",
            username, username, date_filter
        );

        // Run all three searches concurrently
        let (requested_result, reviewed_result, commented_result) = tokio::join!(
            self.search_prs(&requested_query),
            self.search_prs(&reviewed_query),
            self.search_prs(&commented_query),
        );

        let requested_items = requested_result?;
        let reviewed_items = reviewed_result.unwrap_or_default();
        let commented_items = commented_result.unwrap_or_default();

        // Merge and deduplicate by URL
        let mut seen = std::collections::HashSet::new();
        let mut items: Vec<ReviewRequestItem> = Vec::new();

        for item in requested_items.into_iter().chain(reviewed_items.into_iter()).chain(commented_items.into_iter()) {
            if !seen.insert(item.html_url.clone()) {
                continue;
            }
            if let Some(ref pr) = item.pull_request {
                if pr.merged_at.is_some() {
                    continue;
                }
            }

            let (owner, repo) = parse_owner_repo(&item.html_url)?;

            items.push(ReviewRequestItem {
                owner,
                repo,
                number: item.number,
                title: item.title,
                html_url: item.html_url,
                author: item.user.login,
                created_at: item.created_at,
                updated_at: item.updated_at,
                draft: item.draft.unwrap_or(false),
                direct_request: false,
                my_review_status: "pending".to_string(),
                unresolved_thread_count: 0,
            });
        }

        // Enrich all PRs in a single GraphQL call
        if !items.is_empty() {
            let _ = self.enrich_review_requests(&mut items, username).await;
        }

        // Sort: direct requests first, then by created_at ascending (oldest first)
        items.sort_by(|a, b| {
            b.direct_request
                .cmp(&a.direct_request)
                .then_with(|| a.created_at.cmp(&b.created_at))
        });

        Ok(items)
    }

    async fn enrich_review_requests(
        &self,
        items: &mut [ReviewRequestItem],
        username: &str,
    ) -> Result<(), String> {
        // Build a batched GraphQL query with one alias per PR
        let pr_fragment = r#"
            reviewRequests(first: 20) {
                nodes {
                    requestedReviewer {
                        ... on User { login }
                    }
                }
            }
            reviews(last: 100) {
                nodes {
                    author { login }
                    state
                }
            }
            reviewThreads(first: 100) {
                nodes { isResolved }
            }
        "#;

        let mut query_parts = Vec::new();
        for (i, item) in items.iter().enumerate() {
            query_parts.push(format!(
                "pr{}: repository(owner: \"{}\", name: \"{}\") {{ pullRequest(number: {}) {{ {} }} }}",
                i, item.owner, item.repo, item.number, pr_fragment
            ));
        }

        let query = format!("{{ {} }}", query_parts.join("\n"));
        let body = serde_json::json!({ "query": query });

        let resp = self
            .client
            .post("https://api.github.com/graphql")
            .header(AUTHORIZATION, format!("Bearer {}", self.token))
            .header(USER_AGENT, "relevant-reviews")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("GraphQL request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("GraphQL error ({}): {}", status, body));
        }

        let result: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse GraphQL response: {}", e))?;

        let data = match result.get("data") {
            Some(d) => d,
            None => return Err("No data in GraphQL response".to_string()),
        };

        for (i, item) in items.iter_mut().enumerate() {
            let key = format!("pr{}", i);
            let pr = match data.pointer(&format!("/{}/pullRequest", key)) {
                Some(pr) => pr,
                None => continue,
            };

            // Direct vs team: check if user is in requestedReviewer users
            if let Some(nodes) = pr.pointer("/reviewRequests/nodes").and_then(|v| v.as_array()) {
                item.direct_request = nodes.iter().any(|node| {
                    node.pointer("/requestedReviewer/login")
                        .and_then(|l| l.as_str())
                        .map(|l| l.eq_ignore_ascii_case(username))
                        .unwrap_or(false)
                });
            }

            // My review status: find latest decisive review by the user
            if let Some(reviews) = pr.pointer("/reviews/nodes").and_then(|v| v.as_array()) {
                let mut status = "pending".to_string();
                for review in reviews {
                    let author = review
                        .pointer("/author/login")
                        .and_then(|l| l.as_str())
                        .unwrap_or("");
                    if !author.eq_ignore_ascii_case(username) {
                        continue;
                    }
                    if let Some(state) = review.get("state").and_then(|s| s.as_str()) {
                        match state {
                            "APPROVED" | "CHANGES_REQUESTED" | "DISMISSED" => {
                                status = state.to_lowercase();
                            }
                            "COMMENTED" => {
                                if status == "pending" {
                                    status = "commented".to_string();
                                }
                            }
                            _ => {}
                        }
                    }
                }
                item.my_review_status = status;
            }

            // Unresolved thread count
            if let Some(threads) = pr.pointer("/reviewThreads/nodes").and_then(|v| v.as_array()) {
                item.unresolved_thread_count = threads
                    .iter()
                    .filter(|node| {
                        node.get("isResolved")
                            .and_then(|v| v.as_bool())
                            .map(|r| !r)
                            .unwrap_or(false)
                    })
                    .count() as u32;
            }
        }

        Ok(())
    }
}

fn parse_owner_repo(html_url: &str) -> Result<(String, String), String> {
    // https://github.com/owner/repo/pull/123
    let parts: Vec<&str> = html_url.split('/').collect();
    if parts.len() >= 5 {
        let owner = parts[parts.len() - 4].to_string();
        let repo = parts[parts.len() - 3].to_string();
        Ok((owner, repo))
    } else {
        Err(format!("Could not parse owner/repo from URL: {}", html_url))
    }
}
