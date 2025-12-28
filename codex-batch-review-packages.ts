#!/usr/bin/env bun

/**
 * Run codex CLI against packages/crates in a monorepo using tmux.
 *
 * Auto-detects packages by looking for common package marker files:
 * - package.json (Node.js)
 * - Cargo.toml (Rust)
 * - pyproject.toml (Python)
 * - go.mod (Go)
 * - pom.xml (Java/Maven)
 * - build.gradle (Java/Gradle)
 *
 * Usage:
 *   bun codex-batch-review-packages.ts --packages-dir packages --list
 *   bun codex-batch-review-packages.ts --packages-dir crates --grid
 *   bun codex-batch-review-packages.ts --package my-pkg,other-pkg
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import {
  createTmuxSession,
  createTmuxGridWindows,
  getCodexProcessesForPanePids,
  getSessionPanePids,
  isPackageDir,
  killSession,
  listDirectories,
  PROJECT_ROOT,
  runOk,
  shellEscapePosix,
  writeTempPromptFile
} from './tmux-lib.ts'

const DEFAULT_SESSION = 'codex-packages'

const DEFAULT_PROMPT = `
## Scope
Package: {{scope}}

Stay within this package's scope. Reference other packages only if directly relevant.

---

## PRIORITY LEVELS & REQUIRED ACTION

### 🔴 CRITICAL (Must fix immediately)
- Security vulnerabilities (injection, auth bypass, secrets exposure)
- Data corruption or loss risks
- Crashes, panics, or undefined behavior
- Race conditions causing incorrect state
**ACTION: Fix all critical issues. Do not skip any.**

### 🟠 MEDIUM (Must fix)
- Performance issues on hot paths (blocking I/O, N+1, O(n²) where O(n) possible)
- Missing input validation at public API boundaries
- Resource leaks (memory, file handles, connections)
- Incorrect error handling that swallows important failures
- Dead code paths that are still reachable
- Missing tests for critical business logic
**ACTION: Fix all medium issues. Do not skip any.**

### 🟡 LOW (Fix if worthwhile)
- Code style inconsistencies
- Minor refactoring opportunities
- Non-critical documentation gaps
- Test coverage for edge cases
**ACTION: Use judgment. Fix if the fix is simple and improves quality.**

---

## WHAT TO CHECK

### Security (Critical/Medium)
- [ ] Secrets hardcoded or logged (CRITICAL)
- [ ] SQL/NoSQL/OS command injection (CRITICAL)
- [ ] Path traversal, SSRF, XXE (CRITICAL)
- [ ] Missing AuthN/AuthZ checks (CRITICAL)
- [ ] Input validation missing at public APIs (MEDIUM)
- [ ] Unsafe deserialization (MEDIUM)
- [ ] Dependency CVEs (MEDIUM)

### Correctness (Critical/Medium)
- [ ] Panics/unwrap on user-controlled input (CRITICAL)
- [ ] Race conditions in shared state (CRITICAL)
- [ ] Integer overflow in size calculations (CRITICAL)
- [ ] Off-by-one errors in loops/slices (MEDIUM)
- [ ] Missing null/empty handling (MEDIUM)
- [ ] Timezone/encoding edge cases (MEDIUM)

### Performance (Medium)
- [ ] Blocking I/O in async context
- [ ] N+1 queries or missing indexes
- [ ] Hot-path allocations (Vec in tight loops)
- [ ] Missing timeouts on network calls
- [ ] Unbounded buffers or queues

### Code Quality (Medium/Low)
- [ ] Dead code still in codebase (MEDIUM - delete it)
- [ ] Duplicated logic (MEDIUM - consolidate)
- [ ] Deep nesting >3 levels (LOW)
- [ ] Long methods >50 lines (LOW)
- [ ] Unused imports (LOW)

### Tests (Medium)
- [ ] Critical paths missing tests
- [ ] Error cases not tested
- [ ] Concurrency scenarios not tested

---

## STRICT IMPLEMENTATION RULES

1. **Fix, don't report.** Make the code changes, don't just list issues.
2. **Delete dead code** in the same commit. No "cleanup later".
3. **One source of truth.** Consolidate duplicated logic immediately.
4. **Production-ready.** Changes must scale to 1000+ users.
5. **No workarounds.** Full fixes only. No shims, wrappers, or TODO comments.
6. **Remove legacy code** when replacing it. Don't keep both versions.

---

## OUTPUT FORMAT

After reviewing, fix all CRITICAL and MEDIUM issues. Then provide:
1. Summary of changes made
2. Traffic light: 🟢 all good / 🟡 some issues remain / 🔴 critical issues remain
3. Recommended next steps
`.trim()

function listPackages(packagesDir: string, filterRegex?: RegExp): string[] {
  const absoluteDir = join(PROJECT_ROOT, packagesDir)
  return listDirectories(absoluteDir, {
    filter: (name) => {
      if (filterRegex && !filterRegex.test(name)) return false
      return isPackageDir(join(absoluteDir, name))
    }
  })
}

function buildPrompt(pkg: string, packagesDir: string, customPrompt?: string): string {
  const template = customPrompt ?? DEFAULT_PROMPT
  return template.replace(/\{\{scope\}\}/g, `${packagesDir}/${pkg}`)
}

interface RunOptions {
  pkg: string
  packagesDir: string
  model?: string
  sandbox?: string
  approval?: string
  customPrompt?: string
}

function buildCodexCommand(options: RunOptions): string {
  const prompt = buildPrompt(options.pkg, options.packagesDir, options.customPrompt)
  const promptFile = writeTempPromptFile('codex-batch-packages', options.pkg, prompt)

  const args = ['bun', join(PROJECT_ROOT, 'codex-code-review', 'codex-runner-pane.ts'), '--prompt-file', promptFile]

  if (options.model) args.push('-m', options.model)
  if (options.sandbox) args.push('-s', options.sandbox)
  if (options.approval) args.push('-a', options.approval)

  return args.map(shellEscapePosix).join(' ')
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      package: { type: 'string', short: 'p' },
      'packages-dir': { type: 'string', short: 'd' },
      'filter-regex': { type: 'string' },
      'prompt-template-file': { type: 'string' },
      model: { type: 'string', short: 'm' },
      sandbox: { type: 'string', short: 's' },
      approval: { type: 'string', short: 'a' },
      session: { type: 'string' },
      grid: { type: 'boolean', short: 'g' },
      'panes-per-window': { type: 'string' },
      batch: { type: 'string', short: 'b' },
      'batch-size': { type: 'string' },
      all: { type: 'boolean' },
      list: { type: 'boolean', short: 'l' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      kill: { type: 'boolean', short: 'k' },
      attach: { type: 'boolean' }
    },
    allowPositionals: true
  })

  const batchSuffix = values.batch && !values.session ? `-batch${values.batch}` : ''
  const sessionName = (values.session ?? DEFAULT_SESSION) + batchSuffix
  const packagesDir = values['packages-dir'] ?? 'packages'

  if (values.help) {
    console.log(`
codex-batch-review-packages - Run codex CLI for monorepo packages

USAGE:
  bun codex-batch-review-packages.ts [OPTIONS]

OPTIONS:
  -p, --package <names>       Package name(s), comma-separated
  -d, --packages-dir <dir>    Directory containing packages (default: packages)
      --filter-regex <regex>  Filter packages by regex (e.g., "^@org/")
      --all                   Run all packages
      --prompt-template-file  Custom prompt template (use {{scope}} placeholder)
  -m, --model <model>         Model to use (e.g., o3, claude-sonnet-4-20250514)
  -s, --sandbox <mode>        Sandbox: read-only, workspace-write, danger-full-access
  -a, --approval <policy>     Approval: untrusted, on-failure, on-request, never
      --session <name>        Custom tmux session name (default: ${DEFAULT_SESSION})
  -g, --grid                  Use grid layout (multiple panes per window)
      --panes-per-window <N>  Panes per window in grid mode (default: 20)
  -b, --batch <N>             Run batch N (1-indexed)
      --batch-size <N>        Packages per batch (default: 10)
  -l, --list                  List discovered packages
  -k, --kill                  Kill the tmux session
      --attach                Auto-attach after starting
      --dry-run               Print commands without executing
  -h, --help                  Show this help

PACKAGE DETECTION:
  Directories are detected as packages if they contain:
  - package.json (Node.js)
  - Cargo.toml (Rust)
  - pyproject.toml (Python)
  - go.mod (Go)
  - pom.xml / build.gradle (Java)

EXAMPLES:
  # List packages in 'packages' directory
  bun codex-batch-review-packages.ts --list

  # List packages in 'crates' directory (Rust monorepo)
  bun codex-batch-review-packages.ts --packages-dir crates --list

  # Review specific packages
  bun codex-batch-review-packages.ts --package core,utils,api

  # Review all packages with grid layout
  bun codex-batch-review-packages.ts --all --grid

  # Review packages in batches
  bun codex-batch-review-packages.ts --all --batch 1 --batch-size 10
  bun codex-batch-review-packages.ts --all --batch 2 --batch-size 10

TMUX NAVIGATION:
  Attach:       tmux attach -t <session>
  Windows:      Ctrl+B then n/p (next/prev)
  Panes:        Ctrl+B then arrow keys
  Zoom pane:    Ctrl+B then z
`)
    process.exit(0)
  }

  if (values.kill) {
    if (runOk('tmux', ['-V']) && runOk('tmux', ['has-session', '-t', sessionName])) {
      const panePids = getSessionPanePids(sessionName)
      const codexPids = getCodexProcessesForPanePids(panePids)

      killSession(sessionName)

      console.log(`✓ Killed tmux session: ${sessionName}`)
      if (codexPids.length > 0) {
        console.log(`✓ Killed ${codexPids.length} associated codex process(es)`)
      }
    } else {
      console.log(`No session named '${sessionName}' exists.`)
    }
    process.exit(0)
  }

  const filterRegex = values['filter-regex'] ? new RegExp(values['filter-regex']) : undefined
  const allPackages = listPackages(packagesDir, filterRegex)

  if (values.list) {
    const batchSize = values['batch-size'] ? parseInt(values['batch-size'], 10) : 10
    const totalBatches = Math.ceil(allPackages.length / batchSize)

    if (allPackages.length === 0) {
      console.log(`No packages found in '${packagesDir}'.`)
      console.log('Packages are detected by presence of: package.json, Cargo.toml, pyproject.toml, go.mod, pom.xml, build.gradle')
      process.exit(0)
    }

    console.log(`\nPackages in '${packagesDir}' (${allPackages.length} total, ${totalBatches} batches of ${batchSize}):\n`)

    for (let b = 0; b < totalBatches; b++) {
      const start = b * batchSize
      const end = Math.min(start + batchSize, allPackages.length)
      const batchPkgs = allPackages.slice(start, end)
      console.log(`--- Batch ${b + 1} (${start + 1}-${end}) ---`)
      batchPkgs.forEach((p, i) => console.log(`  ${start + i + 1}. ${p}`))
      console.log()
    }

    console.log(`Run a batch: bun codex-batch-review-packages.ts --packages-dir ${packagesDir} --all --batch <N>`)
    process.exit(0)
  }

  // Determine packages to review
  let packages: string[] = []
  const pkgArg = values.package ?? positionals[0]

  if (values.all) {
    packages = [...allPackages]
  } else if (pkgArg) {
    packages = pkgArg
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)

    // Validate packages exist
    const available = new Set(allPackages)
    for (const pkg of packages) {
      if (!available.has(pkg)) {
        console.error(`Error: Package '${pkg}' not found in '${packagesDir}'.`)
        console.error('Use --list to see available packages.')
        process.exit(2)
      }
    }
  }

  if (packages.length === 0) {
    console.error('Error: --package or --all is required.')
    console.error('Use --list to see available packages.')
    process.exit(2)
  }

  // Apply batch slicing
  const batchSize = values['batch-size'] ? parseInt(values['batch-size'], 10) : 10
  const batchNum = values.batch ? parseInt(values.batch, 10) : null

  if (batchNum !== null) {
    const totalBatches = Math.ceil(packages.length / batchSize)
    if (batchNum < 1 || batchNum > totalBatches) {
      console.error(`Error: Batch ${batchNum} out of range. Valid: 1-${totalBatches}`)
      process.exit(2)
    }
    const start = (batchNum - 1) * batchSize
    const end = Math.min(start + batchSize, packages.length)
    packages = packages.slice(start, end)
    console.log(`Batch ${batchNum}/${totalBatches}: packages ${start + 1}-${end} (${packages.length} packages)\n`)
  }

  // Load custom prompt if specified
  let customPrompt: string | undefined
  if (values['prompt-template-file']) {
    customPrompt = readFileSync(values['prompt-template-file'], 'utf8')
  }

  if (values['dry-run']) {
    console.log('=== DRY RUN ===\n')
    console.log(`Session: ${sessionName}`)
    console.log(`Packages dir: ${packagesDir}`)
    console.log(`Packages: ${packages.join(', ')}\n`)
    for (const pkg of packages) {
      const cmd = buildCodexCommand({
        pkg,
        packagesDir,
        model: values.model,
        sandbox: values.sandbox,
        approval: values.approval,
        customPrompt
      })
      console.log(`[${pkg}] ${cmd}\n`)
    }
    process.exit(0)
  }

  if (!runOk('tmux', ['-V'])) {
    console.error('Error: tmux not found. Install tmux and try again.')
    process.exit(1)
  }

  const paneConfigs = packages.map((pkg) => ({
    name: pkg,
    cwd: PROJECT_ROOT,
    command: buildCodexCommand({
      pkg,
      packagesDir,
      model: values.model,
      sandbox: values.sandbox,
      approval: values.approval,
      customPrompt
    })
  }))

  if (values.grid) {
    const panesPerWindow = values['panes-per-window']
      ? parseInt(values['panes-per-window'], 10)
      : 20
    createTmuxGridWindows(sessionName, paneConfigs, panesPerWindow)
    const windowCount = Math.max(1, Math.ceil(packages.length / panesPerWindow))
    const totalPanes = windowCount * panesPerWindow
    const emptyPanes = totalPanes - packages.length
    console.log(`\n✓ Created tmux session: ${sessionName} (grid mode)`)
    console.log(
      `  Windows: ${windowCount}, Panes: ${totalPanes} (${panesPerWindow} per window), Packages: ${packages.length}, Empty: ${emptyPanes}\n`
    )
  } else {
    createTmuxSession(sessionName, paneConfigs)
    console.log(`\n✓ Created tmux session: ${sessionName}`)
    console.log(`  Windows: ${packages.length} (one per package)\n`)
  }

  packages.forEach((p, i) => console.log(`  ${i}: ${p}`))
  console.log(`\nTo watch the sessions:`)
  console.log(`  tmux attach -t ${sessionName}`)
  console.log(`\nNavigation:`)
  console.log(`  Windows: Ctrl+B then n/p`)
  if (values.grid) {
    console.log(`  Panes:   Ctrl+B then arrow keys (zoom: Ctrl+B z)`)
  }

  if (values.attach) {
    console.log('\nAttaching to session...\n')
    spawnSync('tmux', ['attach', '-t', sessionName], { stdio: 'inherit' })
  }
}

await main()
