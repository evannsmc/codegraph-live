# CodeGraph Live — Architecture Overview

This document explains how the moving parts of CodeGraph Live fit together. Start here, then read the component-specific docs for deeper detail.

---

## What the system is

CodeGraph Live is a code intelligence layer that sits between your codebase and Claude Code. It maintains a **semantic knowledge graph** — a SQLite database of symbols (functions, classes, methods, types) and their relationships (calls, imports, extends, implements) extracted from source code via tree-sitter AST parsing.

Claude Code queries this graph through an **MCP server** to answer structural questions ("what calls this function?", "what does this class extend?", "what breaks if I change this?") without reading files manually.

The key difference from the upstream codegraph is the **background daemon**: a persistent process that watches all your projects simultaneously via OS-level inotify (Linux) and syncs the graph on every file save — even when Claude Code is closed.

---

## System diagram

```
╔══════════════════════════════════════════════════════════════════════╗
║                          YOUR MACHINE                                ║
║                                                                      ║
║  ┌─────────────────────────────────────────────────────────────────┐ ║
║  │                       CLAUDE CODE SESSION                       │ ║
║  │                                                                 │ ║
║  │  ┌──────────────────┐    ┌───────────────────────────────────┐  │ ║
║  │  │   Claude (LLM)   │◄──►│   MCP Server (codegraph-live      │  │ ║
║  │  │                  │    │   serve --mcp)                    │  │ ║
║  │  │  reads graph     │    │   • codegraph_explore             │  │ ║
║  │  │  via MCP tools   │    │   • codegraph_search              │  │ ║
║  │  └──────────────────┘    │   • codegraph_callers/callees     │  │ ║
║  │           │              │   • codegraph_impact              │  │ ║
║  │           │              │   • codegraph_node                │  │ ║
║  │    PostToolUse hook      └───────────────┬───────────────────┘  │ ║
║  │    (Edit/Write events)                   │ reads                │ ║
║  │           │                              ▼                      │ ║
║  │           │                    .codegraph/codegraph.db          │ ║
║  │           ▼                         (SQLite)                    │ ║
║  │   codegraph-live mark-dirty ◄────────────┘                      │ ║
║  │           │                                                     │ ║
║  │    Stop hook                                                    │ ║
║  │           │                                                     │ ║
║  │           ▼                                                     │ ║
║  │   codegraph-live sync-if-dirty                                  │ ║
║  └─────────────────────────────────────────────────────────────────┘ ║
║                                                                      ║
║  ┌─────────────────────────────────────────────────────────────────┐ ║
║  │              CODEGRAPH-LIVE DAEMON (systemd user service)       │ ║
║  │                                                                 │ ║
║  │  Discovery loop (every 30s)                                     │ ║
║  │    scans $HOME for .codegraph/codegraph.db                      │ ║
║  │           │                                                     │ ║
║  │           ▼                                                     │ ║
║  │  Per-project @parcel/watcher subscriptions (inotify)            │ ║
║  │    file change → 1000ms debounce → CodeGraph.sync()             │ ║
║  │                                                                 │ ║
║  │  Watches: all initialized projects simultaneously               │ ║
║  │  Even when: Claude Code is closed, you're in VS Code, vim, etc. │ ║
║  └─────────────────────────────────────────────────────────────────┘ ║
║                                                                      ║
║  Your projects:                                                       ║
║    ~/project-a/  .codegraph/codegraph.db  ◄── daemon watches this   ║
║    ~/project-b/  .codegraph/codegraph.db  ◄── daemon watches this   ║
║    ~/project-c/  (no .codegraph/)             not watched            ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## Components

| Component | File(s) | Role |
|---|---|---|
| **Global installer** | `src/installer/index.ts` → `runGlobalInstaller()` | One-time machine setup: writes `~/.claude/CLAUDE.md`, global MCP config, permissions |
| **Project initializer** | `src/installer/index.ts` → `runProjectInit()` | Per-project: creates `.codegraph/`, writes local MCP config + hooks, indexes |
| **MCP server** | `src/mcp/` | Claude Code talks to it over stdio; exposes graph query tools |
| **Daemon** | `src/daemon/` | Background process — watches all projects via inotify, syncs on file change |
| **Claude Code hooks** | Written by installer to `settings.json` | `PostToolUse` → mark-dirty, `Stop` → sync-if-dirty |
| **CLAUDE.md template** | `src/installer/claude-md-template.ts` | Instructions written to `~/.claude/CLAUDE.md` telling Claude how to use the tools |
| **CLI** | `src/bin/codegraph.ts` | All user-facing commands (`install`, `init`, `reindex`, `daemon status`, etc.) |

---

## Setup flow (what happens when you install)

```
1. npm install -g codegraph-live
         │
         ▼
2. codegraph-live install          ← run once per machine
         │
         ├── writes ~/.claude/CLAUDE.md        (tool usage instructions)
         ├── writes ~/.claude.json             (MCP server registration)
         ├── writes ~/.claude/settings.json    (permissions + hooks)
         └── offers to init current directory

3. codegraph-live init             ← run per project
         │
         ├── creates .codegraph/codegraph.db   (graph database)
         ├── writes ./.claude.json             (local MCP config)
         ├── writes ./.claude/settings.json    (local hooks)
         └── indexes all source files

4. codegraph-live daemon install-service   ← run once per machine
         │
         └── writes + enables systemd user service
             → daemon starts at login, watches all projects
```

---

## Data flow (steady state)

```
You edit a file (anywhere — VS Code, vim, Claude Code)
    │
    ├── If Claude Code edited it:
    │       PostToolUse hook fires
    │       → codegraph-live mark-dirty
    │       (marks a dirty flag file: .codegraph/.dirty)
    │       Then when Claude Code stops responding:
    │       Stop hook fires
    │       → codegraph-live sync-if-dirty
    │       (checks dirty flag, syncs if set, clears flag)
    │
    └── If you edited it outside Claude Code:
            @parcel/watcher detects the inotify event
            → 1000ms debounce (batches rapid saves)
            → CodeGraph.sync() incremental update
            (only re-indexes changed files)

In both cases, .codegraph/codegraph.db is updated.
The MCP server reads from this DB on every tool call — always fresh.
```

---

## Key design decisions

**Why a daemon instead of only hooks?**
Claude Code hooks only fire during Claude Code sessions. If you spend 3 hours in VS Code, open Claude Code, and immediately ask "what calls this function?" — the graph would be 3 hours stale. The daemon eliminates this gap.

**Why `@parcel/watcher` instead of `chokidar`?**
`@parcel/watcher` uses native OS APIs (inotify on Linux, FSEvents on macOS, ReadDirectoryChangesW on Windows). Near-zero CPU when idle — it's a blocking kernel wait, not a polling loop. `chokidar` also wraps native APIs but `@parcel/watcher` is lighter and more battle-tested at scale.

**Why is the MCP server a separate process started by Claude Code?**
The MCP stdio transport model requires a fresh process per Claude Code session. Claude Code launches `codegraph-live serve --mcp` automatically when a session starts (via the `~/.claude.json` registration), talks to it over stdin/stdout, and the process exits when the session ends. The daemon is completely separate and unaffected.

**Why two separate commands (`install` vs `init`)?**
`install` writes to `~/.claude/` — this affects *every* Claude Code session on your machine. `init` writes to `./.claude/` and `.codegraph/` — this affects only *this project's* sessions. Conflating them would either overwrite global config every time you init a project, or require global config to be redone per-project.

---

## Further reading

- [install.md](./install.md) — Detailed breakdown of what `install` and `init` write and why
- [mcp.md](./mcp.md) — How the MCP server works and what tools it exposes
- [daemon.md](./daemon.md) — Daemon internals: discovery, inotify, debounce, PID management
- [hooks.md](./hooks.md) — Claude Code hooks: mark-dirty / sync-if-dirty pipeline
