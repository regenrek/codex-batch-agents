# Multi-Agent Development System (AGENTBOT)

A framework for parallel AI-assisted development with domain-specialized agents.

---

## Overview

This system enables parallel development across multiple AI agents, each specialized in a specific domain. Agents work independently on their assigned tasks while respecting dependency chains.

### Key Benefits

- **Parallel execution** - Multiple agents work simultaneously
- **Domain expertise** - Each agent specializes in one area
- **Clear boundaries** - No file conflicts between agents
- **Dependency management** - Tasks execute in correct order
- **Verifiable progress** - Scripts confirm completion

---

## Quick Start

### 1. Define Your Domains

Identify 3-5 logical domains in your project:

```markdown
| Agent | Domain | Owns |
|-------|--------|------|
| AGENTBOT-1 | Backend API | `server/`, `api/` |
| AGENTBOT-2 | Database | `db/`, `migrations/` |
| AGENTBOT-3 | Frontend | `src/`, `components/` |
| AGENTBOT-4 | Auth | `auth/`, `middleware/` |
| AGENTBOT-5 | DevOps | `docker/`, `ci/` |
```

### 2. Create Task Document

```markdown
# Task: [TASK_ID]

## Phase 1

### AGENTBOT-1 Tasks
| ID | Task | Deps | Status |
|----|------|------|--------|
| 1.1 | Create API routes | None | ⬜ |
| 1.2 | Add validation | 1.1 | ⬜ |

### AGENTBOT-2 Tasks
| ID | Task | Deps | Status |
|----|------|------|--------|
| 2.1 | Create schema | None | ⬜ |
| 2.2 | Add migrations | 2.1 | ⬜ |
```

### 3. Generate Agent Prompts

Each agent gets a focused prompt with:
- Their domain scope
- Files they own
- Current task
- Dependencies to check
- Verification command

### 4. Run Agents in Parallel

- Open separate AI sessions
- Provide each agent its prompt
- Agents work independently
- Monitor shared task document

---

## Project Setup

### Directory Structure

```
your-project/
├── docs/
│   ├── agents/
│   │   ├── AGENTS-SYSTEM.md      # Agent definitions
│   │   ├── interface-changes.md  # Cross-domain changes
│   │   └── prompts/
│   │       ├── AGENTBOT-1.md
│   │       ├── AGENTBOT-2.md
│   │       └── ...
│   └── tasks/
│       └── [TASK_ID]-implementation.md
└── ...
```

### AGENTS-SYSTEM.md Template

```markdown
# AGENTBOT System Configuration

## Project: [PROJECT_NAME]
## Created: [DATE]

---

## Agents

| Agent | Domain | Responsibilities |
|-------|--------|------------------|
| AGENTBOT-1 | [DOMAIN] | [RESPONSIBILITIES] |
| AGENTBOT-2 | [DOMAIN] | [RESPONSIBILITIES] |
| AGENTBOT-3 | [DOMAIN] | [RESPONSIBILITIES] |

---

## Domain Definitions

### AGENTBOT-1: [DOMAIN]
**Scope:** [Files/folders this agent owns]
**Technologies:** [Languages/frameworks]
**Can Modify:** [Allowed paths]
**Cannot Modify:** [Forbidden paths]

---

## Dependency Rules

1. Agent can only start when dependencies are DONE
2. Agent must not modify files outside its domain
3. Agent must update task status upon completion
4. Agent must document API changes affecting others
```

---

## Task Document Template

```markdown
# [TASK_ID]: [Task Title]

Status: **in_progress**
Created: [DATE]

---

## Parallel Execution Map

```
AGENT-1: [Task 1.1] ────► [Task 1.2] ────►
AGENT-2: [Task 2.1] ────► (blocked by 1.2)
AGENT-3: (blocked) ─────► [Task 3.1] ────►
AGENT-4: [Task 4.1] ────► [Task 4.2] ────►
```

---

## Phase 1: [Phase Name]

### AGENTBOT-1 Tasks

| ID | Task | Dependencies | Status |
|----|------|--------------|--------|
| 1.1 | [Description] | None | ⬜ pending |
| 1.2 | [Description] | 1.1 | ⬜ pending |

### AGENTBOT-2 Tasks

| ID | Task | Dependencies | Status |
|----|------|--------------|--------|
| 2.1 | [Description] | None | ⬜ pending |
| 2.2 | [Description] | 1.1, 2.1 | ⬜ pending |

---

## Acceptance Criteria

- [ ] All tests pass
- [ ] Documentation updated
- [ ] No lint errors

---

## Verification Script

```bash
#!/bin/bash
ERRORS=0

# Verification checks
if [[ -f "expected/file.ts" ]]; then
  echo "✅ File exists"
else
  echo "❌ File missing"
  ERRORS=$((ERRORS + 1))
fi

echo "=== Summary ==="
if [ "$ERRORS" -eq 0 ]; then
  echo "✅ All checks passed"
else
  echo "❌ $ERRORS check(s) failed"
fi
```
```

---

## Agent Prompt Template

```markdown
# AGENTBOT-[N] Prompt: [Domain Name]

## Role

You are AGENTBOT-[N], a specialized AI developer focused on **[DOMAIN]**.

## Your Domain

**Files you own:**
- `path/to/files/*`
- `path/to/other/*`

**Technologies:**
- [Technology 1]
- [Technology 2]

## Current Task

**Task ID:** [TASK_ID]
**Description:** [What to build]
**Dependencies:** [Tasks that must complete first]

## Context Files

Read these before starting:
1. `docs/architecture/[doc].md` - Architecture
2. `path/to/interface.ts` - Interfaces to implement
3. `docs/tasks/[task].md` - Full task details

## Instructions

1. Read all context files first
2. Implement [specific deliverables]
3. Write tests
4. Update task status when complete
5. Document API changes if any

## Constraints

- Do NOT modify files outside your domain
- Do NOT change interfaces without documenting
- Do NOT skip tests

## Deliverables

- [ ] [Deliverable 1]
- [ ] [Deliverable 2]
- [ ] Tests passing

## Verification

```bash
[command to verify work]
```

## When Complete

1. Mark task as ✅ in task document
2. Document any interface changes
3. Proceed to next task if deps are met
```

---

## Domain Examples

### Full-Stack Web App

| Agent | Domain | Owns |
|-------|--------|------|
| AGENTBOT-1 | Backend API | `server/`, `api/` |
| AGENTBOT-2 | Database | `db/`, `migrations/` |
| AGENTBOT-3 | Frontend | `src/`, `components/` |
| AGENTBOT-4 | Auth | `auth/`, `middleware/` |
| AGENTBOT-5 | DevOps | `docker/`, `ci/` |

### Rust/Tauri Desktop App

| Agent | Domain | Owns |
|-------|--------|------|
| AGENTBOT-1 | IPC/Protocol | `crates/ipc/`, `crates/api/` |
| AGENTBOT-2 | Storage | `crates/store/`, `migrations/` |
| AGENTBOT-3 | Frontend/UI | `apps/desktop/src/` |
| AGENTBOT-4 | Core Logic | `crates/backend/`, `crates/core/` |
| AGENTBOT-5 | CLI/TUI | `crates/cli/`, `crates/tui/` |

### Microservices

| Agent | Domain | Owns |
|-------|--------|------|
| AGENTBOT-1 | User Service | `services/user/` |
| AGENTBOT-2 | Order Service | `services/order/` |
| AGENTBOT-3 | Payment Service | `services/payment/` |
| AGENTBOT-4 | Gateway | `gateway/` |
| AGENTBOT-5 | Shared Libs | `libs/`, `packages/` |

### Mobile App

| Agent | Domain | Owns |
|-------|--------|------|
| AGENTBOT-1 | iOS Native | `ios/` |
| AGENTBOT-2 | Android Native | `android/` |
| AGENTBOT-3 | Shared Logic | `shared/`, `core/` |
| AGENTBOT-4 | UI Components | `components/` |
| AGENTBOT-5 | Backend/API | `api/`, `server/` |

---

## Coordination Rules

### Parallelization

```
✅ CAN run in parallel:
- Tasks with no shared dependencies
- Tasks in different domains
- Read-only operations

❌ CANNOT run in parallel:
- Tasks where one depends on another's output
- Tasks modifying the same files
- Interface-defining tasks before implementation
```

### Dependency Resolution

```
Task A (no deps)      → Start immediately
Task B (depends: A)   → Wait for A
Task C (depends: A)   → Parallel with B after A
Task D (depends: B,C) → Wait for both B and C
```

### Status Legend

| Status | Meaning |
|--------|---------|
| ⬜ pending | Not started |
| 🔄 in_progress | Agent working |
| ✅ completed | Done and verified |
| ❌ blocked | Cannot proceed |
| ⏸️ paused | Temporarily stopped |

---

## Complete Example

### Agent Prompt: Storage Layer

```markdown
# AGENTBOT-2 Prompt: Storage Layer

## Role
You are AGENTBOT-2, specialized in database and storage.

## Your Domain
**Files you own:**
- `crates/store-sqlite/`
- `crates/db-migrations/`
- `crates/ports/src/*_store.rs`

**Technologies:** Rust, SQLite, sqlx, tokio

## Current Task
**Task ID:** 400.2.1
**Description:** Implement RunStore trait for SQLite
**Dependencies:** 400.1.1 (port traits) ✅ COMPLETE

## Context Files
1. `docs/architecture/daemon-architecture.md`
2. `crates/ports/src/run_store.rs` - Trait to implement
3. `docs/tasks/400-implementation.md`

## Instructions
1. Create `crates/store-sqlite/src/run_store_impl.rs`
2. Implement all methods from `RunStore` trait
3. Use `max_connections(1)` for write serialization
4. Add tests using temp file DB
5. Update task status when complete

## Constraints
- Do NOT modify `crates/ports/`
- Do NOT add types without documenting
- Use `StoreError` for errors

## Deliverables
- [ ] `RunStore` implementation
- [ ] All trait methods
- [ ] Tests passing
- [ ] Task marked complete

## Verification
```bash
cargo test -p spezi-store-sqlite
grep "impl RunStore" crates/store-sqlite/src/*.rs
```
```

---

## Best Practices

### 1. Keep Domains Separate
Each agent should have clear file ownership. Overlap causes conflicts.

### 2. Define Interfaces First
Have one agent define interfaces before others implement them.

### 3. Use Verification Scripts
Automated checks prevent incomplete work.

### 4. Document Cross-Domain Changes
When an agent changes something that affects others, document it immediately.

### 5. Start with Architecture
Create architecture docs before starting agents. They're the source of truth.

### 6. Small, Focused Tasks
Break large tasks into smaller ones. Easier to parallelize.

### 7. Regular Status Updates
Agents should update task status frequently.

---

## Troubleshooting

### "Agent modified wrong files"
- Review domain definitions
- Make constraints more explicit in prompts

### "Dependencies not respected"
- Add explicit dependency checks in agent prompts
- Use verification scripts

### "Conflicting implementations"
- Define interfaces in shared location first
- One agent owns interfaces, others implement

### "Agent stuck on blocked task"
- Check if blocking task is actually complete
- Verify status updates are happening

---