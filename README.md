# Relevant Reviews

A tool that fetches GitHub PRs, uses AI to classify which files contain relevant changes (business logic, infrastructure, API routes, etc.), and opens only those files for review in a native desktop app.

## How it works

1. **Fetch** -- pulls PR metadata, file list, and diff via the GitHub REST API
2. **Classify** -- sends the file list and diff to Claude (via AWS Bedrock), which labels each file as RELEVANT or NOT_RELEVANT based on what it contains
3. **Highlight** -- a second AI pass identifies specific lines in relevant files that deserve human attention (security changes, behavior changes, removed safety checks, etc.)
4. **Review** -- displays the relevant diffs in a split or unified viewer with syntax highlighting and AI-annotated risk indicators

## Desktop app

The primary interface is a Tauri 2 desktop app with a React frontend and Rust backend. All GitHub and AI calls happen natively in Rust -- no CLI dependencies required.

### Features

- **PR opener** -- paste a PR URL or short ref (`owner/repo#123`) directly in the app
- **AI classification** -- files are automatically categorized and scored by risk level (critical / high / medium / low)
- **AI highlights** -- specific lines are annotated with severity (critical / warning / info) and explanatory comments
- **Split and unified diff views** -- toggle between side-by-side and unified diff display
- **File sidebar** -- files grouped by category with risk indicators; track which files you've reviewed
- **Drag-and-drop** -- drop a manifest JSON file onto the app to load a review
- **Settings** -- configure model ARN, GitHub token, and AWS profile from within the app

### Prerequisites

- [Rust](https://rustup.rs/)
- [Bun](https://bun.sh/) (used as the frontend package manager / build tool)
- Tauri v2 prerequisites: see [Tauri Getting Started](https://v2.tauri.app/start/prerequisites/)
- AWS credentials configured (env vars, `~/.aws/credentials`, or SSO)

### Setup

```bash
cd app
bun install
```

### Development

```bash
cd app
bun run tauri dev
```

### Build

```bash
cd app
bun run tauri build
```

The built app will be at `app/src-tauri/target/release/bundle/macos/Relevant Reviews.app`.

### Configuration

Settings are stored in `~/.config/relevant-reviews/config` and can be edited from the app's Settings modal.

| Setting | Description |
|---|---|
| `model` | AWS Bedrock model ARN (e.g., `arn:aws:bedrock:us-east-2:123456789:application-inference-profile/...`) |
| `github_token` | GitHub personal access token (optional if `GH_TOKEN` or `GITHUB_TOKEN` env var is set) |
| `aws_profile` | AWS profile name (optional, uses default credential chain if empty) |

GitHub token resolution order: config file > `GH_TOKEN` env > `GITHUB_TOKEN` env.

AWS region is extracted automatically from the model ARN.

## CLI (`rr`)

A standalone Bash script that performs the same fetch/classify/highlight workflow using the `gh` CLI and `claude` CLI. It can output results as a manifest JSON, print classification summaries, or open diffs in VSCode.

### Prerequisites

- [GitHub CLI (`gh`)](https://cli.github.com/) -- authenticated with access to your repos
- [Claude CLI (`claude`)](https://docs.anthropic.com/en/docs/claude-cli) -- for AI classification
- `jq`, `python3`

### Setup

```bash
# Make the script executable
chmod +x rr

# (Optional) Symlink into a directory on your PATH
ln -s "$(pwd)/rr" /usr/local/bin/rr

# Set the model ARN (env var or config file)
export RR_MODEL="arn:aws:bedrock:us-east-2:123456789:application-inference-profile/your-profile-id"
# -- or --
mkdir -p ~/.config/relevant-reviews
echo "model=arn:aws:bedrock:us-east-2:123456789:application-inference-profile/your-profile-id" > ~/.config/relevant-reviews/config
```

### Usage

```
rr <pr-url-or-ref> [options]
```

| Argument / Option | Description |
|---|---|
| `<pr-url-or-ref>` | GitHub PR URL, `owner/repo#number`, or just a number (if inside a repo) |
| `--list-only` | Only print the classification results, don't open any viewer |
| `--manifest-only` | Build the manifest JSON and print its path |
| `--vscode` | Open diffs in VSCode instead of the desktop app |
| `--help` | Show help |

### Examples

```bash
# Full PR URL
rr https://github.com/myorg/myrepo/pull/123

# Short form
rr myorg/myrepo#123

# Just a number (when inside a git repo with a GitHub remote)
rr 123

# List classification only
rr 123 --list-only

# Open in VSCode
rr 123 --vscode
```

## How files are classified

**RELEVANT** (shown for review):
- Backend business logic (services, handlers, controllers, routers)
- Infrastructure-as-code (CDK, SST, Terraform, CI/CD workflows)
- API routes, tRPC routers, REST endpoints
- Database schemas, migrations
- Auth/authz logic
- Shared libraries used by business logic

**NOT RELEVANT** (skipped):
- UI components (React JSX, CSS, layouts)
- Tests
- Documentation
- IDE/editor config
- Package manager lock files
- Build/tooling config
- Static assets

## Project structure

```
rr                              # Standalone CLI script (bash)
app/                            # Tauri desktop app
  package.json                  # Frontend dependencies (React 19, diff2html, Tauri API)
  src/                          # React frontend
    App.tsx                     # Main app component, routing between empty/review states
    main.tsx                    # Entry point
    types.ts                    # TypeScript types (ReviewManifest, FileDiff, Highlight)
    styles.css                  # GitHub-dark themed styles
    components/
      DiffViewer.tsx            # Split/unified diff viewer with syntax highlighting
      FileSidebar.tsx           # File list grouped by category and risk level
      Header.tsx                # PR title, progress bar, view toggle
      PrOpener.tsx              # Open a PR directly from the app
      SettingsModal.tsx         # Configure model ARN, GitHub token, AWS profile
  src-tauri/                    # Rust backend
    Cargo.toml                  # Rust dependencies (reqwest, aws-sdk-bedrockruntime, tauri)
    src/
      main.rs                   # Entry point
      lib.rs                    # Module hub, Tauri builder
      commands.rs               # Tauri command handlers
      fetch.rs                  # Orchestrator: GitHub -> AI classify -> AI highlight -> manifest
      github.rs                 # GitHub REST API client (reqwest)
      bedrock.rs                # AWS Bedrock Converse API client
      pr_parser.rs              # Parse PR URLs and short refs
      prompts.rs                # AI prompt templates
      config.rs                 # Settings load/save, token resolution
      types.rs                  # Shared Rust data types
    tauri.conf.json             # Tauri app config
```

## License

MIT
