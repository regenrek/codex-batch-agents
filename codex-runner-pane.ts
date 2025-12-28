#!/usr/bin/env bun

/**
 * Helper script that runs inside a tmux pane.
 * Reads a prompt from a file and pipes it to `codex exec` via stdin.
 *
 * This avoids shell quoting/length issues with long prompts.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
type ApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never'

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'prompt-file': { type: 'string' },
      model: { type: 'string', short: 'm' },
      sandbox: { type: 'string', short: 's' },
      approval: { type: 'string', short: 'a' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: false
  })

  if (values.help) {
    console.log(`
codex-runner-pane - Internal helper for tmux panes

USAGE:
  bun codex-runner-pane.ts --prompt-file <file> [OPTIONS]

OPTIONS:
      --prompt-file <file> Prompt file to pass to codex via stdin
  -m, --model <model>      Model to use (e.g., o3, claude-sonnet-4-20250514)
  -s, --sandbox <mode>     Sandbox mode: read-only, workspace-write, danger-full-access
  -a, --approval <policy>  Approval policy: untrusted, on-failure, on-request, never
  -h, --help               Show this help
`)
    process.exit(0)
  }

  const promptFile = values['prompt-file']
  if (!promptFile) {
    console.error('Error: --prompt-file is required.')
    process.exit(2)
  }

  const prompt = readFileSync(promptFile, 'utf8')

  const args: string[] = ['exec', '-C', process.cwd()]

  if (values.model) {
    args.push('-m', values.model)
  }

  if (values.sandbox) {
    args.push('-s', values.sandbox as SandboxMode)
  }

  if (values.approval) {
    args.push('-a', values.approval as ApprovalPolicy)
  }

  // Read prompt from stdin to avoid shell quoting/length issues.
  args.push('-')

  const result = spawnSync('codex', args, {
    stdio: ['pipe', 'inherit', 'inherit'],
    input: prompt,
    encoding: 'utf8'
  })

  process.exit(result.status ?? 1)
}

main()
