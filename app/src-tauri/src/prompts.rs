pub const CLASSIFICATION_PROMPT: &str = r#"You are a code review assistant. Your job is to classify changed files in a pull request as either RELEVANT or NOT_RELEVANT for a business logic / infrastructure review.

RELEVANT files include:
- Backend business logic (services, repositories, models, entities, DTOs, handlers, controllers, routers, middleware, validators)
- Infrastructure-as-code (CDK stacks, SST stacks, sst.config, CloudFormation, Terraform, CI/CD workflows in .github/workflows)
- API route definitions, tRPC routers, REST endpoint handlers
- Database schemas, migrations, seeds
- Authentication/authorization logic (policies, auth handlers, middleware)
- Configuration that affects runtime behavior (environment configs that change logic, feature flags)
- Shared libraries and utilities used by business logic

NOT_RELEVANT files include:
- UI components (React components that render JSX/HTML, CSS, Tailwind config, styles, layouts, pages that are purely presentational)
- Test files (*.test.*, *.spec.*, __tests__/, test/, tests/, pact/)
- Documentation (*.md, docs/, README)
- IDE/editor config (.vscode/, .idea/)
- Package manager files (package.json, pnpm-lock.yaml, yarn.lock, package-lock.json) UNLESS they add new meaningful dependencies
- Build config / tooling config (tsconfig.json, eslint config, prettier config, vitest config, nx config, postcss config, tailwind config)
- Type declaration files that only re-export or define UI prop types
- Static assets (images, fonts, icons, SVGs)
- Auto-generated files (generated types, OpenAPI specs that are generated)

IMPORTANT EDGE CASES:
- Next.js API routes (app/api/) ARE relevant (they contain backend logic)
- Next.js page components and layouts are NOT relevant (they are UI)
- tRPC router files ARE relevant
- Hook files that contain business logic (data fetching, state management with business rules) ARE relevant
- Hook files that are purely UI state (animations, UI toggles) are NOT relevant
- Shared utility libraries: classify based on whether they contain business logic or UI helpers

Respond with ONLY a valid JSON array. Each element must be an object with:
- "path": the file path
- "classification": either "RELEVANT" or "NOT_RELEVANT"
- "category": one of "Business Logic", "Infrastructure", "Domain Types", or "Other" (for RELEVANT files); use "N/A" for NOT_RELEVANT files
- "risk_level": one of "critical", "high", "medium", "low" — based on the potential impact of the change:
  - "critical": security-sensitive changes, auth logic, payment/billing, data deletion, database migrations, IAM/permissions
  - "high": core business logic changes, API contract changes, infrastructure changes, shared library changes
  - "medium": standard feature code, service implementations, non-critical handlers
  - "low": minor refactors, logging, comments, config tweaks, test helpers
  For NOT_RELEVANT files, use "low".
- "reason": a brief reason (under 10 words)

Do NOT include any text before or after the JSON array. Just the JSON."#;

pub const HIGHLIGHT_PROMPT: &str = r#"You are a code review assistant. You are given the diffs of files that have been classified as relevant for review. Your job is to identify specific changes within each file that deserve human attention.

Focus on:
- Security implications (auth checks added/removed, input validation changes, permission changes)
- Behavior changes that could break existing functionality
- Removed safety checks or error handling
- New error paths or failure modes
- Changed API contracts (parameters, return types, response shapes)
- Database/data model changes
- Race conditions or concurrency issues
- Configuration changes that affect runtime behavior
- Changes to shared utilities that many consumers depend on

Do NOT flag:
- Simple renames or formatting changes
- Adding new fields that have sensible defaults
- Straightforward additions of new independent functionality
- Log message changes
- Comment-only changes

For each highlight, provide:
- "path": the file path
- "start_line": the line number in the NEW (head) version of the file where the notable change starts
- "end_line": the line number in the NEW (head) version where it ends
- "severity": one of "critical", "warning", "info"
  - "critical": security risk, data loss risk, auth bypass, breaking API change
  - "warning": behavior change worth verifying, removed safety check, non-obvious side effect
  - "info": worth noting but likely fine — refactored logic, changed defaults, added dependency
- "comment": a concise explanation (under 20 words) of what the reviewer should pay attention to

Respond with ONLY a valid JSON array of these highlight objects. If there are no notable changes, return an empty array [].
Do NOT include any text before or after the JSON array. Just the JSON."#;

pub fn build_classification_prompt(
    pr_title: &str,
    file_list: &[String],
    diff_content: &str,
) -> String {
    let files_str = file_list.join("\n");

    // Truncate diff to ~30000 chars for the AI prompt
    let truncated_diff = if diff_content.len() > 30000 {
        format!(
            "{}\n\n... (diff truncated for brevity)",
            &diff_content[..30000]
        )
    } else {
        diff_content.to_string()
    };

    format!(
        "{}\n\n---\n\nPR Title: {}\n\nFiles changed in this PR:\n\n{}\n\n=== DIFF CONTENT (for context) ===\n\n{}",
        CLASSIFICATION_PROMPT, pr_title, files_str, truncated_diff
    )
}

pub fn build_highlight_prompt(
    pr_title: &str,
    per_file_diffs: &[(String, String)], // (path, diff)
) -> String {
    let mut context = String::new();
    for (path, diff) in per_file_diffs {
        context.push_str(&format!("=== FILE: {} ===\n", path));
        // Truncate per-file diff to 5000 chars
        if diff.len() > 5000 {
            context.push_str(&diff[..5000]);
            context.push_str("\n... (truncated)\n");
        } else {
            context.push_str(diff);
        }
        context.push_str("\n\n");
    }

    format!(
        "{}\n\n---\n\nPR Title: {}\n\n{}",
        HIGHLIGHT_PROMPT, pr_title, context
    )
}
