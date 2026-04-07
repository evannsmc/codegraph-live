<div align="center">

# CodeGraph Live

### Always-on semantic code intelligence for Claude Code

**Fork of [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) — all the original features plus a persistent filesystem watcher daemon that keeps your graph fresh 24/7, even when Claude Code is closed.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Linux](https://img.shields.io/badge/Linux-inotify-blue.svg)](#)

</div>

---

## What this fork adds

The upstream codegraph syncs your code graph in two ways:
1. After Claude Code edits a file (via a `PostToolUse` hook)
2. When you manually run `codegraph sync`

This means edits you make yourself — in VS Code, vim, or anywhere outside Claude — pile up undetected until you open Claude Code again.

**codegraph-live adds a systemd user service that runs a background daemon.** The daemon uses [`@parcel/watcher`](https://github.com/parcel-bundler/watcher) (native inotify on Linux) to watch all your codegraph-initialized projects simultaneously. Every file save is detected within 1 second, debounced, and synced — regardless of whether Claude Code is open.

```
8am  - Boot → daemon starts automatically, watching all your projects
9am  - You edit files in VS Code (Claude Code closed)
         → daemon catches every save in real time
11am - You open Claude Code
         → graph is already up to date, zero sync needed
```

---

## Differences from upstream

| Feature | upstream codegraph | codegraph-live |
|---|---|---|
| Sync on Claude edits | Yes (PostToolUse hook) | Yes |
| Sync on your own edits | No (manual `sync` only) | **Yes — always automatic** |
| Graph fresh when Claude is closed | No | **Yes** |
| Filesystem watcher | No | **@parcel/watcher (inotify)** |
| Systemd user service | No | **Yes — starts at login** |
| Auto-discover new projects | No | **Yes — scans $HOME every 30s** |
| CLI binary | `codegraph` | `codegraph-live` |
| All original features | — | Fully preserved |

---

## Installation

### 1. Clone and install globally

```bash
git clone git@github.com:evannsmc/codegraph-live.git
cd codegraph-live
npm install
npm run build
npm install -g .
```

### 2. Register the systemd service

```bash
codegraph-live daemon install-service
```

This writes `~/.config/systemd/user/codegraph-live.service` and enables it immediately. The daemon will start automatically at every login from now on.

### 3. Run the global installer

```bash
codegraph-live install
```

This is a one-time setup that writes to your **global** `~/.claude/` directory:
- `~/.claude/CLAUDE.md` — CodeGraph usage instructions (applied in every project)
- `~/.claude.json` — MCP server registration
- `~/.claude/settings.json` — tool permissions and auto-sync hooks

You only need to run this once per machine. It will also offer to initialize the current directory as a project.

### 4. Initialize each project

Inside each project you want to track:

```bash
cd ~/your-project
codegraph-live init
```

This writes **project-local** config (`.claude.json`, `.claude/settings.json`) and indexes the codebase. The daemon picks up the new project within 30 seconds — no restart needed.

---

## Daemon management

```bash
codegraph-live daemon status           # Show PID + list of watched projects
codegraph-live daemon start            # Start daemon manually (if not using systemd)
codegraph-live daemon stop             # Stop the daemon
codegraph-live daemon restart          # Restart

codegraph-live daemon install-service  # Register + enable systemd user service
codegraph-live daemon uninstall-service # Remove the service
```

**Logs:** `~/.local/share/codegraph-live/daemon.log`
**PID file:** `~/.local/share/codegraph-live/daemon.pid`
**Service file:** `~/.config/systemd/user/codegraph-live.service`

---

## How the daemon works

1. **On startup** — scans `$HOME` recursively for directories containing `.codegraph/codegraph.db` (the marker that a project has been initialized)
2. **Per project** — opens a [`@parcel/watcher`](https://github.com/parcel-bundler/watcher) subscription on the project root. Uses Linux inotify under the hood: near-zero CPU when idle
3. **On file change** — debounces 1000ms (batches rapid saves from formatters), then calls `CodeGraph.open(root).sync()` — the same incremental sync the upstream CLI uses
4. **Auto-unwatch** — if `.codegraph/` is deleted (project uninstalled), the daemon removes it from the watch set silently
5. **Auto-discover** — every 30 seconds, rescans `$HOME` for newly initialized projects. New projects are picked up without restarting the daemon

The daemon coexists safely with the MCP server and any CLI `sync` calls via codegraph's existing `Mutex` + `FileLock` mechanism — concurrent syncs are serialized, not duplicated.

**Ignored paths:** `node_modules`, `.git`, `dist`, `build`, `__pycache__`, `target`, `.cargo`, `*.pyc`, `*.o`, `*.so`

---

## Full CLI reference

All upstream commands are available under the `codegraph-live` binary.

### Setup

```bash
codegraph-live install              # One-time global setup: writes ~/.claude/CLAUDE.md + MCP config
                                    # Run once per machine; also offered on bare `codegraph-live` invocation
codegraph-live init [path]          # Per-project: indexes code + writes local .claude.json/hooks
codegraph-live uninit [path]        # Remove CodeGraph from a project (deletes .codegraph/)
```

### Indexing & sync

```bash
codegraph-live reindex [path]       # Fully rebuild the graph from scratch (all files)
codegraph-live sync [path]          # Incremental sync — re-index only files that changed
codegraph-live status [path]        # Show index stats (file count, nodes, DB size, last sync)
```

> With the daemon running, you rarely need either manually — the daemon syncs on every file save automatically.

### Querying

```bash
codegraph-live query <search>       # Search for symbols by name (functions, classes, types)
codegraph-live files [path]         # Show project file structure as known to the graph
codegraph-live explain <task>       # Build rich context for a task — finds relevant symbols,
                                    #   call graphs, and code semantically (outputs markdown)
codegraph-live test-changes [files...]  # Find test files that cover the given source files
                                        #   (reverse graph traversal — useful in CI/pre-commit)
```

**`test-changes` example:**
```bash
# After editing a planning module, find which tests cover it:
git diff --name-only HEAD~1 | xargs codegraph-live test-changes
```

### MCP server & internal commands

```bash
codegraph-live serve --mcp          # [Internal] Claude Code starts this automatically — you never run it directly
codegraph-live mark-dirty [path]    # [Internal] Called by Claude Code's PostToolUse hook
codegraph-live sync-if-dirty [path] # [Internal] Called by Claude Code's Stop hook
```

MCP tools available inside Claude Code sessions:

| Tool | Purpose |
|---|---|
| `codegraph_explore` | Deep exploration — comprehensive context for a topic in one call |
| `codegraph_context` | Quick context for a task |
| `codegraph_search` | Find symbols by name (functions, classes, types) |
| `codegraph_callers` | Find what calls a function |
| `codegraph_callees` | Find what a function calls |
| `codegraph_impact` | Find what's affected by changing a symbol |
| `codegraph_node` | Get details + source for a specific symbol |

### Daemon (new in this fork)

```bash
codegraph-live daemon start             # Start daemon manually (detached background process)
codegraph-live daemon stop              # Stop the running daemon
codegraph-live daemon restart           # Restart the daemon
codegraph-live daemon status            # Show PID, running state, and list of watched projects

codegraph-live daemon install-service   # Write + enable ~/.config/systemd/user/codegraph-live.service
codegraph-live daemon uninstall-service # Disable and remove the systemd service
```


---

## Supported languages

TypeScript, JavaScript, TSX, JSX, Python, Go, Rust, Java, C, C++, C#, PHP, Ruby, Swift, Kotlin, Dart, Liquid, Pascal (19 total)

---

## Staying up to date with upstream

```bash
git remote add upstream https://github.com/colbymchenry/codegraph.git
git fetch upstream
git merge upstream/main
npm run build
npm install -g .
codegraph-live daemon restart
```

---

## Credits

- **[colbymchenry/codegraph](https://github.com/colbymchenry/codegraph)** — the upstream project this fork is based on. All core graph indexing, MCP tools, semantic search, and Claude Code integration come from there.
- **[sdsrss/code-graph-mcp](https://github.com/sdsrss/code-graph-mcp)** — inspiration for the always-on daemon architecture. That project's persistent filesystem watcher (implemented in Rust) demonstrated that keeping the graph live between sessions is both practical and valuable. The daemon in this fork applies the same idea to the codegraph TypeScript ecosystem.

---

## License

MIT — same as upstream. Fork by [evannsmc](https://github.com/evannsmc).
