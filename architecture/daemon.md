# Background Daemon

The daemon is the core addition this fork makes over upstream. It is a persistent background process that keeps all your codegraph-initialized projects synchronized with the filesystem — continuously, even when Claude Code is closed.

---

## Why a daemon?

The upstream codegraph syncs in two ways:
1. When Claude Code edits a file — a `PostToolUse` hook fires and marks the graph dirty
2. When you manually run `codegraph sync`

This means if you spend time in VS Code, run a formatter, switch branches, or do a `git pull` — none of those changes reach the graph until you open Claude Code again and it eventually syncs.

The daemon closes this gap: it watches the filesystem directly. Any save from any editor is caught immediately.

---

## Architecture

```
codegraph-live daemon start
    │
    ├── writePid()   → ~/.local/share/codegraph-live/daemon.pid
    ├── DaemonLogger → ~/.local/share/codegraph-live/daemon.log
    │
    ├── Initial scan: scanForProjects($HOME)
    │     Walks $HOME recursively (depth ≤ 8)
    │     Finds directories containing .codegraph/codegraph.db
    │     → watchProject(root) for each found
    │
    ├── Per-project: @parcel/watcher.subscribe(root, callback, {ignore: [...]})
    │     OS-level inotify subscription (Linux)
    │     Callback fires on any file event (create, modify, delete, rename)
    │
    ├── On file event:
    │     Skip .codegraph/ events (avoids feedback loop from DB writes)
    │     Skip if .codegraph/codegraph.db was deleted → unwatchProject()
    │     Otherwise: scheduleSync(root)
    │
    ├── scheduleSync: 1000ms debounce
    │     Clears any pending timer for this root
    │     Sets new timer → syncProject(root) after 1000ms of quiet
    │
    ├── syncProject: CodeGraph.open(root).sync()
    │     Incremental sync — only re-indexes files that changed
    │     Opens DB, diffs against stored hashes, updates graph
    │     Closes DB when done
    │
    └── setInterval(discoverAndWatch, 30_000)
          Re-scans $HOME every 30s for newly initialized projects
          Hot-adds any new .codegraph/codegraph.db without restart
```

---

## Source code

```
src/daemon/
├── index.ts       Main daemon loop: watchProject, unwatchProject, scheduleSync, syncProject, discoverAndWatch
├── discovery.ts   scanForProjects() — recursive $HOME walk to find .codegraph/codegraph.db
├── pid.ts         writePid() / clearPid() — manages ~/.local/share/codegraph-live/daemon.pid
└── logger.ts      DaemonLogger — timestamped log lines to ~/.local/share/codegraph-live/daemon.log
```

---

## The debounce

The 1000ms debounce is critical for correctness. Without it:
- Running `prettier` on 200 files would trigger 200 sync operations in rapid succession
- Each sync would try to open the SQLite database while the previous was still running
- You'd get lock contention, wasted CPU, and partial syncs

With the debounce, rapid saves within a 1-second window collapse into a single sync that runs after the burst settles. The debounce timer resets on every new event for the same project.

---

## Ignored paths

The watcher ignores these patterns (passed to `@parcel/watcher`'s native ignore list):

```
**/node_modules/**
**/.git/**
**/dist/**
**/build/**
**/__pycache__/**
**/target/**
**/.cargo/**
**/*.pyc
**/*.o
**/*.so
```

These are ignored at the OS level — inotify never registers watches for them in the first place. This keeps the inotify watch descriptor count low (a limited kernel resource) and avoids spurious syncs from build artifacts.

Additionally, all events from inside `.codegraph/` itself are filtered out in the callback handler. This prevents a feedback loop: syncing writes to `codegraph.db`, which would re-trigger sync, which would write again, infinitely.

---

## Concurrency safety

The daemon runs `CodeGraph.sync()` — the same code path the CLI and MCP server use. CodeGraph has a built-in `FileLock` (a lock file at `.codegraph/codegraph.lock`) that serializes concurrent access. If the MCP server is mid-query when the daemon tries to sync, the sync waits for the lock.

In practice, conflicts are rare and brief — queries take milliseconds.

---

## Systemd integration

`codegraph-live daemon install-service` writes a systemd user service file:

```
~/.config/systemd/user/codegraph-live.service
```

Contents:
```ini
[Unit]
Description=CodeGraph Live filesystem watcher daemon
After=default.target

[Service]
Type=simple
ExecStart=/path/to/codegraph-live daemon start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

The service is enabled with `systemctl --user enable --now codegraph-live`. After that:
- The daemon starts automatically at every login
- If it crashes, systemd restarts it after 5 seconds
- Logs from stdout/stderr are captured by journald (in addition to the daemon's own log file)

To check status via systemd: `systemctl --user status codegraph-live`

---

## PID file

The daemon writes its PID to `~/.local/share/codegraph-live/daemon.pid` on startup and removes it on clean shutdown (SIGTERM, SIGINT). The CLI uses this file to implement:

- `daemon status` — reads PID, checks if process exists (`kill -0`), lists watched projects
- `daemon stop` — reads PID, sends SIGTERM
- `daemon restart` — stop + start

If the PID file exists but the process is gone (daemon crashed), the CLI detects this ("stale PID") and reports the daemon as not running.

---

## Log file

All daemon activity is written to `~/.local/share/codegraph-live/daemon.log`. Format:

```
2026-04-07T19:32:02.634Z [INFO] daemon starting (PID 975735)
2026-04-07T19:32:02.635Z [INFO] scanning /home/user for codegraph projects...
2026-04-07T19:32:05.221Z [INFO] watching 0 project(s) — daemon ready
2026-04-07T20:04:07.731Z [INFO] watching /home/user/my-project
2026-04-07T20:05:12.103Z [INFO] synced /home/user/my-project: +0 ~3 -0 (47ms)
```

The log is append-only and not rotated — monitor its size if leaving it running for months.

---

## Manual operation (without systemd)

```bash
codegraph-live daemon start    # Start in background (detached)
codegraph-live daemon status   # Check running state + watched projects
codegraph-live daemon stop     # Stop gracefully (SIGTERM)
codegraph-live daemon restart  # Stop + start
```

The `start` command forks a detached child process, writes the PID, and exits. The daemon continues running after the terminal closes.
