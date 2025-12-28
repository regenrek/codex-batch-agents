# Codex Batch Code Review

> ⚠️ **Heads up** — This is experimental code, shared for ideas and inspiration. Expect rough edges.

A toolkit for running parallel code reviews across a monorepo using [Codex CLI](https://github.com/openai/codex) and tmux.

This demonstrates a workflow for reviewing multiple packages, services, or directories simultaneously—each in its own tmux pane—so you can monitor AI-powered code reviews at scale.

## Features

- **Parallel execution**: Review 10, 20, or 100+ targets simultaneously
- **Tmux grid layout**: 5×4 pane grids (20 reviews per window) for visual monitoring
- **Batching**: Split large monorepos into manageable batches
- **Auto-discovery**: Detect packages by common markers (package.json, Cargo.toml, etc.)
- **Custom prompts**: Bring your own review rubric
- **Clean process management**: Properly kills codex processes when sessions end

## Prerequisites

- **[Bun](https://bun.sh/)** (or adapt to Node.js with tsx)
- **[tmux](https://github.com/tmux/tmux)** - terminal multiplexer
- **[Codex CLI](https://github.com/openai/codex)** - OpenAI's coding agent

```bash
# Install prerequisites (macOS)
brew install tmux
npm install -g @openai/codex

# Verify
tmux -V
codex --version
```

## Quick Start

### 1. Review specific targets

```bash
# Review two directories
bun codex-batch-review.ts --target src/api,src/web

# Review with a specific model
bun codex-batch-review.ts --target packages/core,packages/utils --model o3
```

### 2. Auto-discover and review packages

```bash
# List all packages in a directory
bun codex-batch-review-packages.ts --packages-dir packages --list

# Review all discovered packages
bun codex-batch-review-packages.ts --packages-dir packages --all

# Use grid layout for visual monitoring
bun codex-batch-review-packages.ts --packages-dir crates --all --grid
```

### 3. Batch large monorepos

```bash
# Review packages in batches of 10
bun codex-batch-review-packages.ts --all --batch 1 --batch-size 10
bun codex-batch-review-packages.ts --all --batch 2 --batch-size 10
bun codex-batch-review-packages.ts --all --batch 3 --batch-size 10
```

## Scripts

| Script | Purpose |
|--------|---------|
| `codex-batch-review.ts` | Generic target-based reviewer (any paths) |
| `codex-batch-review-packages.ts` | Package-aware reviewer (auto-detects packages) |
| `codex-runner-pane.ts` | Helper that runs inside each tmux pane |
| `tmux-lib.ts` | Shared tmux/process utilities |

## Tmux Navigation

Once reviews are running:

```bash
# Attach to the session
tmux attach -t codex-review

# Navigation
Ctrl+B n          # Next window
Ctrl+B p          # Previous window
Ctrl+B <arrow>    # Move between panes (grid mode)
Ctrl+B z          # Zoom/unzoom current pane
Ctrl+B d          # Detach (reviews continue in background)
```

## Kill a Session

```bash
# Kill session and all associated codex processes
bun codex-batch-review.ts --kill
bun codex-batch-review-packages.ts --kill --session my-session
```

## Custom Prompts

Create a prompt template file with `{{scope}}` as a placeholder:

```markdown
## Review Scope
{{scope}}

## Your Company's Review Checklist
- [ ] Follows internal style guide
- [ ] Has appropriate test coverage
- [ ] No secrets in code
...
```

Then use it:

```bash
bun codex-batch-review.ts --target src/api --prompt-template-file my-prompt.md
```

## Package Detection

`codex-batch-review-packages.ts` detects packages by looking for these files:

- `package.json` (Node.js/JavaScript)
- `Cargo.toml` (Rust)
- `pyproject.toml` (Python)
- `go.mod` (Go)
- `pom.xml` (Java/Maven)
- `build.gradle` (Java/Gradle)

## Options Reference

### Common Options

| Option | Description |
|--------|-------------|
| `-m, --model <name>` | Model to use (e.g., `o3`, `claude-sonnet-4-20250514`) |
| `-s, --sandbox <mode>` | `read-only`, `workspace-write`, `danger-full-access` |
| `-a, --approval <policy>` | `untrusted`, `on-failure`, `on-request`, `never` |
| `--session <name>` | Custom tmux session name |
| `-g, --grid` | Use 5×4 pane grid layout |
| `--panes-per-window <N>` | Panes per grid window (default: 20) |
| `-b, --batch <N>` | Run batch N (1-indexed) |
| `--batch-size <N>` | Items per batch (default: 10) |
| `-l, --list` | List available targets |
| `-k, --kill` | Kill the tmux session |
| `--attach` | Auto-attach after starting |
| `--dry-run` | Print commands without executing |

### codex-batch-review.ts

| Option | Description |
|--------|-------------|
| `-t, --target <paths>` | Comma-separated target paths |
| `-d, --discover-dir <dir>` | Auto-discover targets in directory |
| `--discover-depth <N>` | Discovery depth (default: 1) |
| `--filter-regex <regex>` | Filter discovered directories |
| `--include-root-files` | Include root-level files as target |

### codex-batch-review-packages.ts

| Option | Description |
|--------|-------------|
| `-p, --package <names>` | Comma-separated package names |
| `-d, --packages-dir <dir>` | Packages directory (default: `packages`) |
| `--filter-regex <regex>` | Filter packages by regex |
| `--all` | Run all discovered packages |

## Example Workflows

### Rust Monorepo (Cargo workspace)

```bash
# List all crates
bun codex-batch-review-packages.ts --packages-dir crates --list

# Review all crates in grid mode
bun codex-batch-review-packages.ts --packages-dir crates --all --grid

# Review specific crates
bun codex-batch-review-packages.ts --packages-dir crates --package core,utils,api
```

### Node.js Monorepo (packages/)

```bash
# Review all packages
bun codex-batch-review-packages.ts --all --grid

# Filter by scope
bun codex-batch-review-packages.ts --all --filter-regex "^@myorg/"
```

### Generic Directory Review

```bash
# Review all top-level directories in src/
bun codex-batch-review.ts --discover-dir src --list
bun codex-batch-review.ts --discover-dir src --grid

# Review specific paths
bun codex-batch-review.ts --target backend/api,backend/workers,frontend/app
```

## How It Works

1. **Discovery**: Scans directories or uses explicit targets
2. **Prompt generation**: Creates a review prompt for each target (saved to temp files)
3. **Tmux session**: Creates a tmux session with windows/panes for each target
4. **Codex execution**: Each pane runs `codex exec` with the prompt via stdin
5. **Monitoring**: You can attach to watch all reviews in parallel
6. **Cleanup**: `--kill` terminates the session and any running codex processes

## Adapting for Your Project

1. Copy this folder to your project
2. Adjust `PROJECT_ROOT` in `tmux-lib.ts` if needed
3. Customize the default prompt in `codex-batch-review.ts` or use `--prompt-template-file`
4. Add to your justfile/Makefile for easy access

## Limitations

- **Unix-only**: Uses `ps` and tmux (works on macOS/Linux, Windows via WSL)
- **Requires Bun**: Uses Bun runtime (can be adapted for Node.js with tsx)
- **Terminal needed**: Designed for interactive terminal use

## License

MIT
