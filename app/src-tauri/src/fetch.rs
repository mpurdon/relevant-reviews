use crate::bedrock::{extract_json_array, region_from_arn, BedrockClient};
use crate::config::resolve_github_token;
use crate::github::GithubClient;
use crate::pr_parser::parse_pr_ref;
use crate::prompts::{build_classification_prompt, build_grouping_prompt, build_highlight_prompt, build_summary_prompt};
use crate::types::{
    ChangeGroup, FetchProgress, FetchStatus, FileClassification, FileDiff, Highlight, HighlightResult, ReviewManifest, Settings,
};
use futures::stream::{FuturesUnordered, StreamExt};
use std::collections::HashMap;
use tauri::Emitter;

fn emit_progress(
    app: &tauri::AppHandle,
    step: u8,
    label: &str,
    status: FetchStatus,
    pr_title: Option<&str>,
    files: Option<(u32, u32)>,
) {
    let _ = app.emit("fetch-progress", FetchProgress {
        step,
        total_steps: 6,
        label: label.to_string(),
        status,
        pr_title: pr_title.map(|s| s.to_string()),
        files_done: files.map(|(d, _)| d),
        files_total: files.map(|(_, t)| t),
    });
}

pub async fn fetch_pr_impl(pr_ref: &str, settings: &Settings, app: &tauri::AppHandle) -> Result<ReviewManifest, String> {
    if settings.model.is_empty() {
        return Err("No model ARN configured. Set it in Settings.".to_string());
    }

    let token = resolve_github_token(settings)?;
    let parsed = parse_pr_ref(pr_ref)?;

    let github = GithubClient::new(token);

    // Step 1: Fetch PR metadata
    emit_progress(app, 1, "Fetching PR metadata", FetchStatus::Running, None, None);
    let metadata = github
        .get_pr_metadata(&parsed.owner, &parsed.repo, parsed.number)
        .await?;
    let pr_title = metadata.title;
    emit_progress(app, 1, "Fetching PR metadata", FetchStatus::Done, Some(&pr_title), None);
    let pr_url = metadata.html_url;
    let pr_number = metadata.number;
    let base_ref = metadata.base.ref_name;
    let head_ref = metadata.head.ref_name;
    let base_sha = metadata.base.sha;
    let head_sha = metadata.head.sha;

    // Step 2: Fetch PR file list and diff in parallel
    emit_progress(app, 2, "Fetching files and diff", FetchStatus::Running, None, None);
    let (files_result, diff_result) = tokio::join!(
        github.get_pr_files(&parsed.owner, &parsed.repo, parsed.number),
        github.get_pr_diff(&parsed.owner, &parsed.repo, parsed.number),
    );

    let pr_files = files_result?;
    let full_diff = diff_result?;
    emit_progress(app, 2, "Fetching files and diff", FetchStatus::Done, None, None);

    if pr_files.is_empty() {
        return Err("No changed files found in this PR.".to_string());
    }

    let file_list: Vec<String> = pr_files.iter().map(|f| f.filename.clone()).collect();

    // Index additions/deletions by filename for later use
    let file_stats: HashMap<String, (u64, u64)> = pr_files
        .iter()
        .map(|f| (f.filename.clone(), (f.additions, f.deletions)))
        .collect();

    // Step 3: AI classification
    emit_progress(app, 3, "Classifying files with AI", FetchStatus::Running, None, None);
    let region = region_from_arn(&settings.model)?;
    let bedrock = BedrockClient::new(&region, &settings.aws_profile).await?;

    let classification_prompt =
        build_classification_prompt(&pr_title, &file_list, &full_diff);

    let classification_raw = bedrock
        .invoke_model(&settings.model, &classification_prompt)
        .await?;

    let classification_json = extract_json_array(&classification_raw)?;
    let classifications: Vec<FileClassification> = serde_json::from_value(classification_json)
        .map_err(|e| format!("Failed to parse classification: {}", e))?;
    emit_progress(app, 3, "Classifying files with AI", FetchStatus::Done, None, None);

    let relevant: Vec<&FileClassification> = classifications
        .iter()
        .filter(|c| c.classification == "RELEVANT")
        .collect();

    if relevant.is_empty() {
        return Ok(ReviewManifest {
            pr_title,
            pr_url,
            pr_number,
            base_ref,
            head_ref,
            base_sha,
            head_sha,
            summary: String::new(),
            change_groups: vec![],
            files: vec![],
        });
    }

    // Step 4: AI highlight analysis + summary + grouping (parallel)
    emit_progress(app, 4, "Analyzing highlights, summary, and grouping", FetchStatus::Running, None, Some((0, 3)));
    let per_file_diff_map = build_per_file_diff_map(&full_diff);
    let per_file_diffs = extract_per_file_diffs(&per_file_diff_map, &relevant);
    let highlight_prompt = build_highlight_prompt(&pr_title, &per_file_diffs);

    let summary_prompt = build_summary_prompt(&pr_title, &relevant);
    let grouping_prompt = build_grouping_prompt(&pr_title, &relevant);

    let mut ai_stream: FuturesUnordered<_> = [
        ("highlights", bedrock.invoke_model(&settings.model, &highlight_prompt)),
        ("summary", bedrock.invoke_model(&settings.model, &summary_prompt)),
        ("grouping", bedrock.invoke_model(&settings.model, &grouping_prompt)),
    ].into_iter().map(|(name, fut)| async move { (name, fut.await) }).collect();

    let mut highlights_raw = Err("not started".to_string());
    let mut summary_raw = Err("not started".to_string());
    let mut grouping_raw = Err("not started".to_string());
    let mut ai_done: u32 = 0;
    while let Some((name, result)) = ai_stream.next().await {
        ai_done += 1;
        emit_progress(app, 4, "Analyzing highlights, summary, and grouping", FetchStatus::Running, None, Some((ai_done, 3)));
        match name {
            "highlights" => highlights_raw = result,
            "summary" => summary_raw = result,
            "grouping" => grouping_raw = result,
            _ => {}
        }
    }
    emit_progress(app, 4, "Analyzing highlights, summary, and grouping", FetchStatus::Done, None, None);

    let highlights_raw = highlights_raw.unwrap_or_else(|_| "[]".to_string());

    let highlights_json = extract_json_array(&highlights_raw).unwrap_or_else(|_| {
        serde_json::Value::Array(vec![])
    });

    let highlight_results: Vec<HighlightResult> =
        serde_json::from_value(highlights_json).unwrap_or_default();

    let summary = summary_raw.unwrap_or_default();

    let change_groups: Vec<ChangeGroup> = grouping_raw
        .ok()
        .and_then(|raw| extract_json_array(&raw).ok())
        .and_then(|json| serde_json::from_value(json).ok())
        .unwrap_or_default();

    // Index highlights by file path
    let mut highlights_by_path: HashMap<String, Vec<Highlight>> = HashMap::new();
    for h in highlight_results {
        highlights_by_path
            .entry(h.path.clone())
            .or_default()
            .push(Highlight {
                start_line: h.start_line,
                end_line: h.end_line,
                severity: h.severity,
                comment: h.comment,
            });
    }

    // Step 5: Fetch file contents for all relevant files concurrently
    let files_total = relevant.len() as u32;
    emit_progress(app, 5, "Fetching file contents", FetchStatus::Running, None, Some((0, files_total)));
    let content_futures: Vec<_> = relevant
        .iter()
        .map(|f| {
            let path = f.path.clone();
            let owner = parsed.owner.clone();
            let repo = parsed.repo.clone();
            let base = base_sha.clone();
            let head = head_sha.clone();
            let gh = &github;
            async move {
                let (base_content, head_content) = tokio::join!(
                    gh.get_file_content(&owner, &repo, &path, &base),
                    gh.get_file_content(&owner, &repo, &path, &head),
                );
                (path, base_content, head_content)
            }
        })
        .collect();

    let mut stream: FuturesUnordered<_> = content_futures.into_iter().collect();
    let mut contents = Vec::with_capacity(files_total as usize);
    let mut files_done: u32 = 0;
    while let Some(result) = stream.next().await {
        files_done += 1;
        emit_progress(app, 5, "Fetching file contents", FetchStatus::Running, None, Some((files_done, files_total)));
        contents.push(result);
    }
    emit_progress(app, 5, "Fetching file contents", FetchStatus::Done, None, None);

    // Step 6: Build the manifest
    emit_progress(app, 6, "Building review manifest", FetchStatus::Running, None, None);
    let mut file_diffs = Vec::new();

    for (path, base_result, head_result) in &contents {
        let base_content = base_result.as_deref().unwrap_or("").to_string();
        let head_content = head_result.as_deref().unwrap_or("").to_string();

        let diff_type = if base_content.is_empty() && !head_content.is_empty() {
            "added"
        } else if !base_content.is_empty() && head_content.is_empty() {
            "removed"
        } else {
            "modified"
        };

        // Get the unified diff for this file, stripping the git header
        let unified_diff = per_file_diff_map
            .get(path)
            .map(|d| strip_diff_header(d))
            .unwrap_or_default();

        let classification = classifications
            .iter()
            .find(|c| c.path == *path)
            .unwrap();

        let (additions, deletions) = file_stats.get(path).copied().unwrap_or((0, 0));

        file_diffs.push(FileDiff {
            path: path.clone(),
            classification: classification.classification.clone(),
            reason: classification.reason.clone(),
            category: classification.category.clone(),
            risk_level: classification.risk_level.clone(),
            diff_type: diff_type.to_string(),
            base_content,
            head_content,
            unified_diff,
            additions,
            deletions,
            highlights: highlights_by_path.remove(path.as_str()).unwrap_or_default(),
        });
    }

    emit_progress(app, 6, "Building review manifest", FetchStatus::Done, None, None);

    Ok(ReviewManifest {
        pr_title,
        pr_url,
        pr_number,
        base_ref,
        head_ref,
        base_sha,
        head_sha,
        summary,
        change_groups,
        files: file_diffs,
    })
}

/// Extract per-file diffs for the relevant files from a pre-built diff map.
fn extract_per_file_diffs(
    diff_map: &HashMap<String, String>,
    relevant: &[&FileClassification],
) -> Vec<(String, String)> {
    let mut result = Vec::new();

    for f in relevant {
        if let Some(diff) = diff_map.get(&f.path) {
            result.push((f.path.clone(), diff.clone()));
        }
    }

    result
}

/// Parse the full unified diff into a map of file_path -> diff_text.
fn build_per_file_diff_map(full_diff: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let mut current_path: Option<String> = None;
    let mut current_lines: Vec<&str> = Vec::new();

    for line in full_diff.lines() {
        if line.starts_with("diff --git ") {
            // Save previous file
            if let Some(path) = current_path.take() {
                map.insert(path, current_lines.join("\n"));
            }
            current_lines.clear();

            // Extract path from "diff --git a/path b/path"
            if let Some(b_part) = line.split(" b/").last() {
                current_path = Some(b_part.to_string());
            }
        }
        current_lines.push(line);
    }

    // Save the last file
    if let Some(path) = current_path {
        map.insert(path, current_lines.join("\n"));
    }

    map
}

/// Strip the git diff header (everything before the first @@ line).
fn strip_diff_header(diff: &str) -> String {
    let mut lines = diff.lines();
    let mut result = Vec::new();
    let mut found_hunk = false;

    for line in &mut lines {
        if line.starts_with("@@") {
            found_hunk = true;
        }
        if found_hunk {
            result.push(line);
        }
    }

    result.join("\n")
}
