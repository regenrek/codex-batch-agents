import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_SESSION = "codex-review";

export interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Escape a string for POSIX shell (single-quote style).
 */
export function shellEscapePosix(arg: string): string {
  if (arg.length === 0) return "''";
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

/**
 * Sanitize a string for use as a filename stem.
 */
export function sanitizeFileStem(input: string): string {
  const sanitized = input.replaceAll(/[^a-zA-Z0-9._-]/g, "_").replaceAll(/_+/g, "_");
  return sanitized.length > 0 ? sanitized : "prompt";
}

/**
 * Write a prompt to a temp file and return the path.
 */
export function writeTempPromptFile(namespace: string, key: string, content: string): string {
  const promptDir = join(tmpdir(), namespace);
  mkdirSync(promptDir, { recursive: true });
  const promptFile = join(promptDir, `${sanitizeFileStem(key)}.txt`);
  writeFileSync(promptFile, content);
  return promptFile;
}

/**
 * List directories in a path that match an optional filter.
 */
export function listDirectories(
  baseDir: string,
  options?: { filter?: (name: string) => boolean }
): string[] {
  try {
    return readdirSync(baseDir)
      .filter((name) => {
        const path = join(baseDir, name);
        if (!statSync(path).isDirectory()) return false;
        return options?.filter ? options.filter(name) : true;
      })
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * Check if a directory contains a package marker file.
 */
export function isPackageDir(
  dir: string,
  markers = ["package.json", "Cargo.toml", "pyproject.toml", "go.mod", "pom.xml", "build.gradle"]
): boolean {
  for (const marker of markers) {
    try {
      statSync(join(dir, marker));
      return true;
    } catch {
      // continue
    }
  }
  return false;
}

/**
 * Run a command and capture output.
 */
export function run(command: string, args: string[], cwd?: string): SpawnResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * Run a command and return whether it succeeded.
 */
export function runOk(command: string, args: string[], cwd?: string): boolean {
  const result = spawnSync(command, args, { cwd, stdio: "ignore" });
  return result.status === 0;
}

/**
 * Check if a tmux session exists.
 */
export function sessionExists(sessionName: string): boolean {
  return runOk("tmux", ["has-session", "-t", sessionName]);
}

/**
 * Get PIDs of panes in a tmux session.
 */
export function getSessionPanePids(sessionName: string): number[] {
  if (!sessionExists(sessionName)) return [];

  const result = run("tmux", ["list-panes", "-t", sessionName, "-a", "-F", "#{pane_pid}"]);
  if (result.status !== 0) return [];

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((pid) => Number.parseInt(pid, 10))
    .filter((pid) => Number.isFinite(pid));
}

function parseProcessTable(): Map<number, number> {
  const result = run("ps", ["-axo", "pid=,ppid=,command="]);
  if (result.status !== 0) return new Map();

  const pidToParent = new Map<number, number>();
  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;

    const pid = Number.parseInt(match[1] ?? "", 10);
    const ppid = Number.parseInt(match[2] ?? "", 10);
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;

    pidToParent.set(pid, ppid);
  }

  return pidToParent;
}

function listCodexPids(pidToParent: Map<number, number>): number[] {
  const result = run("ps", ["-axo", "pid=,command="]);
  if (result.status !== 0) return [];

  const codexPids: number[] = [];
  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s+(.*)$/);
    if (!match) continue;

    const pid = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isFinite(pid)) continue;

    const command = (match[2] ?? "").trim();
    const exe = command.split(/\s+/)[0] ?? "";

    if (!/(^|\/)codex$/.test(exe)) continue;
    if (!pidToParent.has(pid)) continue;

    codexPids.push(pid);
  }

  return codexPids;
}

/**
 * Find codex processes that are descendants of the given pane PIDs.
 */
export function getCodexProcessesForPanePids(panePids: number[]): number[] {
  if (panePids.length === 0) return [];

  const panePidSet = new Set(panePids);
  const pidToParent = parseProcessTable();
  const allCodexPids = listCodexPids(pidToParent);

  const matching: number[] = [];
  for (const codexPid of allCodexPids) {
    let currentPid = codexPid;
    for (let depth = 0; depth < 50 && currentPid > 1; depth++) {
      if (panePidSet.has(currentPid)) {
        matching.push(codexPid);
        break;
      }

      const parent = pidToParent.get(currentPid);
      if (!parent || parent === currentPid) break;
      currentPid = parent;
    }
  }

  return [...new Set(matching)];
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill codex processes gracefully (SIGTERM then SIGKILL).
 */
export function killCodexProcesses(pids: number[]): void {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // ignore
    }
  }

  spawnSync("sleep", ["0.5"], { stdio: "ignore" });

  for (const pid of pids) {
    if (!pidExists(pid)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ignore
    }
  }
}

/**
 * Kill a tmux session and its associated codex processes.
 */
export function killSession(sessionName: string): void {
  if (!sessionExists(sessionName)) return;

  const panePids = getSessionPanePids(sessionName);
  const codexPids = getCodexProcessesForPanePids(panePids);

  runOk("tmux", ["kill-session", "-t", sessionName]);

  if (codexPids.length > 0) {
    console.log(`Killing ${codexPids.length} codex process(es)...`);
    killCodexProcesses(codexPids);
  }
}

function sendCommandToWindow(sessionName: string, windowName: string, command: string): void {
  const target = `${sessionName}:${windowName}`;
  runOk("tmux", ["send-keys", "-t", target, "-l", command]);
  runOk("tmux", ["send-keys", "-t", target, "Enter"]);
}

function sendCommandToPaneId(paneId: string, command: string): void {
  runOk("tmux", ["send-keys", "-t", paneId, "-l", command]);
  runOk("tmux", ["send-keys", "-t", paneId, "Enter"]);
}

function setPaneTitle(paneId: string, title: string): void {
  runOk("tmux", ["select-pane", "-t", paneId, "-T", title]);
}

type PaneGeometry = {
  id: string;
  left: number;
  top: number;
};

function listPanesGeometry(target: string): PaneGeometry[] {
  const result = run("tmux", ["list-panes", "-t", target, "-F", "#{pane_id}|#{pane_left}|#{pane_top}"]);
  if (result.status !== 0) return [];

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, leftRaw, topRaw] = line.split("|");
      return {
        id: id ?? "",
        left: Number.parseInt(leftRaw ?? "", 10),
        top: Number.parseInt(topRaw ?? "", 10),
      } satisfies PaneGeometry;
    })
    .filter((pane) => pane.id && Number.isFinite(pane.left) && Number.isFinite(pane.top));
}

function splitPane50_50(paneTarget: string, cwd: string, direction: "h" | "v"): string {
  const args = [
    "split-window",
    direction === "h" ? "-h" : "-v",
    "-p",
    "50",
    "-t",
    paneTarget,
    "-c",
    cwd,
    "-P",
    "-F",
    "#{pane_id}",
    "-d",
  ];

  const res = run("tmux", args);
  if (res.status !== 0) {
    throw new Error(`Failed to split tmux pane '${paneTarget}': ${res.stderr || res.stdout}`);
  }

  const paneId = res.stdout.trim();
  if (!paneId) {
    throw new Error(`Failed to read new pane id after splitting '${paneTarget}'.`);
  }

  return paneId;
}

function configurePaneTitles(windowTarget: string): void {
  runOk("tmux", ["set-window-option", "-t", windowTarget, "pane-border-status", "top"]);
  runOk("tmux", ["set-window-option", "-t", windowTarget, "pane-border-format", "#{pane_index} #{pane_title}"]);
}

export interface CreateSessionWindow {
  name: string;
  cwd: string;
  command: string;
}

export interface CreateSessionPane {
  name: string;
  cwd: string;
  command: string;
}

/**
 * Create a tmux session with one window per item.
 */
export function createTmuxSession(sessionName: string, windows: CreateSessionWindow[]): void {
  if (windows.length === 0) {
    throw new Error("createTmuxSession requires at least one window.");
  }

  killSession(sessionName);

  const [first, ...rest] = windows;
  const create = run("tmux", ["new-session", "-d", "-s", sessionName, "-n", first.name, "-c", first.cwd]);
  if (create.status !== 0) {
    throw new Error(`Failed to create tmux session '${sessionName}': ${create.stderr || create.stdout}`);
  }

  sendCommandToWindow(sessionName, first.name, first.command);

  for (const win of rest) {
    const res = run("tmux", ["new-window", "-t", sessionName, "-n", win.name, "-c", win.cwd]);
    if (res.status !== 0) {
      throw new Error(`Failed to create tmux window '${win.name}': ${res.stderr || res.stdout}`);
    }
    sendCommandToWindow(sessionName, win.name, win.command);
  }

  runOk("tmux", ["select-window", "-t", `${sessionName}:${first.name}`]);
}

function createFixed5x4GridInWindow(windowTarget: string, cwd: string): string[] {
  const columns = 5;
  const rows = 4;

  // Create 5 columns by splitting horizontally.
  for (let i = 1; i < columns; i++) {
    splitPane50_50(windowTarget, cwd, "h");
  }

  // Normalize column sizes.
  runOk("tmux", ["select-layout", "-t", windowTarget, "even-horizontal"]);

  const columnRoots = listPanesGeometry(windowTarget)
    .sort((a, b) => a.left - b.left)
    .slice(0, columns)
    .map((p) => p.id);

  if (columnRoots.length !== columns) {
    throw new Error(`Expected ${columns} columns but found ${columnRoots.length}.`);
  }

  // Create 4 rows inside each column using 50/50 splits.
  for (const colPaneId of columnRoots) {
    const bottomHalf = splitPane50_50(colPaneId, cwd, "v");
    splitPane50_50(colPaneId, cwd, "v");
    splitPane50_50(bottomHalf, cwd, "v");
  }

  configurePaneTitles(windowTarget);

  const panes = listPanesGeometry(windowTarget);
  const paneIds = panes
    .sort((a, b) => (a.top - b.top) || (a.left - b.left))
    .map((p) => p.id);

  if (paneIds.length !== columns * rows) {
    throw new Error(`Expected ${columns * rows} panes but found ${paneIds.length}.`);
  }

  return paneIds;
}

/**
 * Create one or more tmux windows with a fixed 5x4 pane grid (20 panes per window).
 * If fewer items than panes, remaining panes are left empty.
 */
export function createTmuxGridWindows(
  sessionName: string,
  panes: CreateSessionPane[],
  panesPerWindow = 20
): void {
  if (panes.length === 0) {
    throw new Error("createTmuxGridWindows requires at least one pane.");
  }

  const gridSize = panesPerWindow;

  killSession(sessionName);

  const paneGroups: CreateSessionPane[][] = [];
  for (let i = 0; i < panes.length; i += gridSize) {
    paneGroups.push(panes.slice(i, i + gridSize));
  }

  for (let w = 0; w < paneGroups.length; w++) {
    const windowName = `grid-${w}`;
    const windowTarget = `${sessionName}:${windowName}`;
    const baseCwd = panes[0]?.cwd ?? PROJECT_ROOT;

    if (w === 0) {
      const create = run("tmux", ["new-session", "-d", "-s", sessionName, "-n", windowName, "-c", baseCwd]);
      if (create.status !== 0) {
        throw new Error(`Failed to create tmux session '${sessionName}': ${create.stderr || create.stdout}`);
      }
    } else {
      const create = run("tmux", ["new-window", "-t", sessionName, "-n", windowName, "-c", baseCwd]);
      if (create.status !== 0) {
        throw new Error(`Failed to create tmux window '${windowName}': ${create.stderr || create.stdout}`);
      }
    }

    const paneIds = createFixed5x4GridInWindow(windowTarget, baseCwd);
    const group = paneGroups[w] ?? [];

    for (let i = 0; i < paneIds.length; i++) {
      const paneId = paneIds[i]!;
      const item = group[i];
      if (!item) {
        setPaneTitle(paneId, "");
        continue;
      }

      setPaneTitle(paneId, item.name);

      const command =
        item.cwd && item.cwd !== baseCwd
          ? `cd ${shellEscapePosix(item.cwd)} && ${item.command}`
          : item.command;

      sendCommandToPaneId(paneId, command);
    }
  }

  runOk("tmux", ["select-window", "-t", `${sessionName}:grid-0`]);

  const firstPane = listPanesGeometry(`${sessionName}:grid-0`).sort((a, b) => (a.top - b.top) || (a.left - b.left))[0]?.id;
  if (firstPane) {
    runOk("tmux", ["select-pane", "-t", firstPane]);
  }
}
