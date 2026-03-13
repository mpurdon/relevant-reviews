<img width="1024" height="1024" alt="image" src="https://github.com/user-attachments/assets/bac674d0-5746-40f5-ae3a-d5b6c1318a3b" />
# Relevant Reviews

A CLI tool that fetches GitHub PRs, uses AI to classify which files contain relevant changes (business logic, infrastructure, API routes, etc.), and opens only those files for review -- either in a native desktop app or in VSCode.

## How it works

1. **Fetch** -- pulls the PR metadata and diff via the `gh` CLI
2. **Classify** -- sends the file list and diff to Claude, which labels each file as RELEVANT or NOT_RELEVANT based on what it contains (backend logic, infra-as-code, API routes, etc.)
3. **Highlight** -- a second AI pass identifies specific lines in relevant files that deserve human attention (security changes, behavior changes, removed safety checks, etc.)
4. **Review** -- opens the relevant diffs in the Relevant Reviews desktop app (or VSCode with `--vscode`)

## Prerequisites

- [GitHub CLI (`gh`)](https://cli.github.com/) -- authenticated with access to your repos
- [Claude CLI (`claude`)](https://docs.anthropic.com/en/docs/claude-cli) -- for AI classification
- A Claude model ARN (e.g., a Bedrock inference profile)

For the desktop app (optional):

- [Rust](https://rustup.rs/)
- [Bun](https://bun.sh/) (or npm/pnpm -- just update the Tauri `beforeBuildCommand`)
- Tauri v2 prerequisites: see [Tauri Getting Started](https://v2.tauri.app/start/prerequisites/)

## Setup

### 1. Configure the model

The `rr` script needs a Claude model ARN. Set it one of two ways:

```bash
# Option A: environment variable
export RR_MODEL="arn:aws:bedrock:us-east-2:123456789:application-inference-profile/your-profile-id"

# Option B: config file
mkdir -p ~/.config/relevant-reviews
echo "model=arn:aws:bedrock:us-east-2:123456789:application-inference-profile/your-profile-id" > ~/.config/relevant-reviews/config
```

### 2. Make the script executable

```bash
chmod +x rr
```

### 3. (Optional) Add to PATH

```bash
# Symlink into a directory on your PATH
ln -s "$(pwd)/rr" /usr/local/bin/rr
```

### 4. (Optional) Build the desktop app

```bash
cd app
bun install
cargo tauri build
```

The built app will be at `app/src-tauri/target/release/bundle/macos/Relevant Reviews.app`.

## Usage

```
rr <pr-url-or-ref> [options]
```

### Arguments

| Argument | Description |
|---|---|
| `<pr-url-or-ref>` | GitHub PR URL, `owner/repo#number`, or just a number (if inside a repo) |

### Options

| Option | Description |
|---|---|
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

# Open in VSCode instead of the desktop app
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
rr                          # Main CLI script (bash)
app/                        # Tauri desktop app
  src/                      # React frontend
    App.tsx                 # Main app component
    components/
      DiffViewer.tsx        # Split/unified diff viewer with syntax highlighting
      FileSidebar.tsx       # File list grouped by category and risk
      Header.tsx            # PR title, progress bar, view toggle
      PrOpener.tsx          # Open a PR directly from the app
      SettingsModal.tsx     # Configure model ARN
    types.ts                # TypeScript types for the manifest
    styles.css              # GitHub-dark themed styles
  src-tauri/                # Rust backend
    src/lib.rs              # Tauri commands (load manifest, fetch PR, settings)
    src/main.rs             # Entry point
    tauri.conf.json         # Tauri config
```

## License

MIT
