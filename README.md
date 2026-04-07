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

### 3. Initialize a project

Inside any project you want to track:

```bash
cd ~/your-project
codegraph-live install
```

The interactive installer configures Claude Code's MCP server, hooks, and CLAUDE.md instructions. The daemon picks up the new project within 30 seconds — no restart needed.

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

## All original codegraph features

Everything from upstream is preserved. See the [upstream README](https://github.com/colbymchenry/codegraph) for full documentation on:

- Semantic search + call graph traversal via MCP tools
- `codegraph_explore`, `codegraph_context`, `codegraph_search`, `codegraph_callers`, `codegraph_impact`
- `codegraph-live affected` — git-diff-aware test selection for CI
- 19 supported languages (TypeScript, Python, Go, Rust, Java, C/C++, C#, Swift, Kotlin, and more)
- Local embeddings via `@xenova/transformers` (no API key needed)
- Interactive installer with Claude Code MCP + hook configuration

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

## License

MIT — same as upstream. Fork by [evannsmc](https://github.com/evannsmc).
