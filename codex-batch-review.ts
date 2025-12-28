#!/usr/bin/env bun

/**
 * Run codex CLI against multiple targets in parallel using tmux windows/panes.
 *
 * This is a generic code review runner that works with any monorepo structure.
 * Each target gets its own tmux pane so you can monitor all sessions.
 *
 * Usage:
 *   bun codex-batch-review.ts --target src/api,src/web
 *   bun codex-batch-review.ts --discover-dir src --list
 *   bun codex-batch-review.ts --discover-dir packages --grid
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import {
  createTmuxSession,
  createTmuxGridWindows,
  getCodexProcessesForPanePids,
  getSessionPanePids,
  killSession,
  PROJECT_ROOT,
  runOk,
  shellEscapePosix,
  writeTempPromptFile
} from './tmux-lib.ts'

const DEFAULT_SESSION = 'codex-review'

/**
 * Default review prompt - customize this or use --prompt-template-file
 */
const DEFAULT_PROMPT = `
## Scope
Review: {{scope}}

---

## PRIORITY LEVELS

### 🔴 CRITICAL (Must fix immediately)
- Security vulnerabilities (injection, auth bypass, secrets exposure)
- Data corruption or loss risks
- Crashes, panics, or undefined behavior
- Race conditions causing incorrect state

### 🟠 MEDIUM (Should fix)
- Performance issues on hot paths
- Missing input validation at public API boundaries
- Resource leaks (memory, file handles, connections)
- Incorrect error handling that swallows important failures
- Dead code paths that are still reachable

### 🟡 LOW (Fix if worthwhile)
- Code style inconsistencies
- Minor refactoring opportunities
- Non-critical documentation gaps

---

## WHAT TO CHECK

### Security
- [ ] Secrets hardcoded or logged
- [ ] SQL/NoSQL/OS command injection
- [ ] Path traversal, SSRF, XXE
- [ ] Missing AuthN/AuthZ checks
- [ ] Input validation at public APIs
- [ ] Dependency vulnerabilities

### Correctness
- [ ] Panics/crashes on user input
- [ ] Race conditions in shared state
- [ ] Integer overflow in calculations
- [ ] Off-by-one errors
- [ ] Missing null/empty handling

### Performance
- [ ] Blocking I/O in async context
- [ ] N+1 queries or missing indexes
- [ ] Hot-path allocations
- [ ] Missing timeouts on network calls

### Code Quality
- [ ] Dead code (delete it)
- [ ] Duplicated logic (consolidate)
- [ ] Deep nesting >3 levels
- [ ] Long methods >50 lines

---

## INSTRUCTIONS

1. **Fix, don't just report.** Make the code changes.
2. **Delete dead code** in the same change.
3. **Consolidate duplicates** immediately.
4. Focus on CRITICAL and MEDIUM issues first.
5. Use your judgment for LOW issues.

After review, provide:
1. Summary of changes made
2. Traffic light status: 🟢 all good / 🟡 some issues remain / 🔴 critical issues remain
3. Recommended next steps
`.trim()

interface DiscoverOptions {
  baseDir: string
  depth?: number
  filterRegex?: RegExp
  includeRootFiles?: boolean
}

function discoverTargets(options: DiscoverOptions): string[] {
  const { baseDir, depth = 1, filterRegex, includeRootFiles = false } = options
  const targets: string[] = []
  const absoluteBase = join(PROJECT_ROOT, baseDir)

  function scan(dir: string, currentDepth: number, prefix: string) {
    if (currentDepth > depth) return

    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (entry.name.startsWith('.')) continue

        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name

        if (filterRegex && !filterRegex.test(entry.name)) continue

        targets.push(`${baseDir}/${relativePath}`)

        if (currentDepth < depth) {
          scan(join(dir, entry.name), currentDepth + 1, relativePath)
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }

  scan(absoluteBase, 1, '')

  if (includeRootFiles) {
    targets.push(`${baseDir} (root files)`)
  }

  return targets.sort((a, b) => a.localeCompare(b))
}

function buildPrompt(target: string, customPrompt?: string): string {
  const template = customPrompt ?? DEFAULT_PROMPT
  return template.replace(/\{\{scope\}\}/g, target)
}

interface RunOptions {
  target: string
  model?: string
  sandbox?: string
  approval?: string
  customPrompt?: string
}

function buildCodexCommand(options: RunOptions): string {
  const prompt = buildPrompt(options.target, options.customPrompt)
  const promptFile = writeTempPromptFile('codex-batch-review', options.target, prompt)

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
      target: { type: 'string', short: 't' },
      'discover-dir': { type: 'string', short: 'd' },
      'discover-depth': { type: 'string' },
      'filter-regex': { type: 'string' },
      'include-root-files': { type: 'boolean' },
      'prompt-template-file': { type: 'string' },
      model: { type: 'string', short: 'm' },
      sandbox: { type: 'string', short: 's' },
      approval: { type: 'string', short: 'a' },
      session: { type: 'string' },
      grid: { type: 'boolean', short: 'g' },
      'panes-per-window': { type: 'string' },
      batch: { type: 'string', short: 'b' },
      'batch-size': { type: 'string' },
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

  if (values.help) {
    console.log(`
codex-batch-review - Run codex CLI in parallel tmux windows for code review

USAGE:
  bun codex-batch-review.ts [OPTIONS]

OPTIONS:
  -t, --target <paths>        Comma-separated target paths (e.g., src/api,src/web)
  -d, --discover-dir <dir>    Auto-discover targets in directory
      --discover-depth <N>    Depth for discovery (default: 1)
      --filter-regex <regex>  Filter discovered directories by regex
      --include-root-files    Include root-level files as a target
      --prompt-template-file  Custom prompt template file (use {{scope}} placeholder)
  -m, --model <model>         Model to use (e.g., o3, claude-sonnet-4-20250514)
  -s, --sandbox <mode>        Sandbox mode: read-only, workspace-write, danger-full-access
  -a, --approval <policy>     Approval policy: untrusted, on-failure, on-request, never
      --session <name>        Custom tmux session name (default: ${DEFAULT_SESSION})
  -g, --grid                  Use grid layout (multiple panes per window)
      --panes-per-window <N>  Panes per window in grid mode (default: 20)
  -b, --batch <N>             Run batch N (1-indexed)
      --batch-size <N>        Targets per batch (default: 10)
  -l, --list                  List discovered/available targets
  -k, --kill                  Kill the tmux session
      --attach                Auto-attach to tmux session after starting
      --dry-run               Print commands without executing
  -h, --help                  Show this help

EXAMPLES:
  # List targets in a directory
  bun codex-batch-review.ts --discover-dir packages --list

  # Review specific targets
  bun codex-batch-review.ts --target src/api,src/web,src/shared

  # Auto-discover and review all packages
  bun codex-batch-review.ts --discover-dir packages --grid

  # Review with batching (useful for large monorepos)
  bun codex-batch-review.ts --discover-dir packages --batch 1 --batch-size 10

  # Use custom model and approval policy
  bun codex-batch-review.ts --target src --model o3 --approval on-failure

TMUX NAVIGATION:
  Attach:       tmux attach -t <session>
  Windows:      Ctrl+B then n/p (next/prev)
  Panes:        Ctrl+B then arrow keys
  Zoom pane:    Ctrl+B then z
  Kill session: bun codex-batch-review.ts --kill
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

  // Determine targets
  let targets: string[] = []
  const discoverDir = values['discover-dir']
  const targetArg = values.target ?? positionals[0]

  if (discoverDir) {
    const filterRegex = values['filter-regex'] ? new RegExp(values['filter-regex']) : undefined
    const depth = values['discover-depth'] ? parseInt(values['discover-depth'], 10) : 1
    targets = discoverTargets({
      baseDir: discoverDir,
      depth,
      filterRegex,
      includeRootFiles: values['include-root-files']
    })
  } else if (targetArg) {
    targets = targetArg
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  }

  if (values.list) {
    const batchSize = values['batch-size'] ? parseInt(values['batch-size'], 10) : 10

    if (targets.length === 0) {
      console.log('No targets found. Use --discover-dir or --target to specify targets.')
      process.exit(0)
    }

    const totalBatches = Math.ceil(targets.length / batchSize)
    console.log(`\nAvailable targets (${targets.length} total, ${totalBatches} batches of ${batchSize}):\n`)

    for (let b = 0; b < totalBatches; b++) {
      const start = b * batchSize
      const end = Math.min(start + batchSize, targets.length)
      const batchTargets = targets.slice(start, end)
      console.log(`--- Batch ${b + 1} (${start + 1}-${end}) ---`)
      batchTargets.forEach((t, i) => console.log(`  ${start + i + 1}. ${t}`))
      console.log()
    }

    console.log(`Run a batch: bun codex-batch-review.ts --discover-dir ${discoverDir ?? '<dir>'} --batch <N>`)
    process.exit(0)
  }

  if (targets.length === 0) {
    console.error('Error: No targets specified. Use --target or --discover-dir.')
    console.error('       Use --list to see available targets.')
    process.exit(2)
  }

  // Apply batch slicing
  const batchSize = values['batch-size'] ? parseInt(values['batch-size'], 10) : 10
  const batchNum = values.batch ? parseInt(values.batch, 10) : null

  if (batchNum !== null) {
    const totalBatches = Math.ceil(targets.length / batchSize)
    if (batchNum < 1 || batchNum > totalBatches) {
      console.error(`Error: Batch ${batchNum} out of range. Valid: 1-${totalBatches}`)
      process.exit(2)
    }
    const start = (batchNum - 1) * batchSize
    const end = Math.min(start + batchSize, targets.length)
    targets = targets.slice(start, end)
    console.log(`Batch ${batchNum}/${totalBatches}: targets ${start + 1}-${end} (${targets.length} targets)\n`)
  }

  // Load custom prompt if specified
  let customPrompt: string | undefined
  if (values['prompt-template-file']) {
    const { readFileSync } = await import('node:fs')
    customPrompt = readFileSync(values['prompt-template-file'], 'utf8')
  }

  if (values['dry-run']) {
    console.log('=== DRY RUN ===\n')
    console.log(`Session: ${sessionName}`)
    console.log(`Targets: ${targets.join(', ')}\n`)
    for (const target of targets) {
      const cmd = buildCodexCommand({
        target,
        model: values.model,
        sandbox: values.sandbox,
        approval: values.approval,
        customPrompt
      })
      console.log(`[${target}] ${cmd}\n`)
    }
    process.exit(0)
  }

  if (!runOk('tmux', ['-V'])) {
    console.error('Error: tmux not found. Install tmux and try again.')
    process.exit(1)
  }

  const paneConfigs = targets.map((target) => ({
    name: target.replace(/\//g, '-').replace(/\s+/g, '-'),
    cwd: PROJECT_ROOT,
    command: buildCodexCommand({
      target,
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
    const windowCount = Math.max(1, Math.ceil(targets.length / panesPerWindow))
    const totalPanes = windowCount * panesPerWindow
    const emptyPanes = totalPanes - targets.length
    console.log(`\n✓ Created tmux session: ${sessionName} (grid mode)`)
    console.log(
      `  Windows: ${windowCount}, Panes: ${totalPanes} (${panesPerWindow} per window), Targets: ${targets.length}, Empty: ${emptyPanes}\n`
    )
  } else {
    createTmuxSession(sessionName, paneConfigs)
    console.log(`\n✓ Created tmux session: ${sessionName}`)
    console.log(`  Windows: ${targets.length} (one per target)\n`)
  }

  targets.forEach((t, i) => console.log(`  ${i}: ${t}`))
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
