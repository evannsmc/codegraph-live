# Claude Code Hooks — mark-dirty / sync-if-dirty

Claude Code has a hook system that lets you run shell commands in response to events during a session. CodeGraph Live uses two hooks to keep the graph in sync with Claude's own edits — independently of the background daemon.

---

## Why hooks, if there's a daemon?

The daemon catches edits made *outside* Claude Code (VS Code, terminal, etc.). But the daemon has a 1-second debounce — it doesn't sync mid-conversation.

The hooks serve a different purpose: they ensure the graph is fully up to date *before Claude responds*, which is when accurate graph data matters most. Specifically, when Claude edits code and then you ask a follow-up question in the same session, the graph should reflect those edits.

The hooks also provide a safety net if the daemon isn't running.

---

## The two hooks

### `PostToolUse` → `codegraph-live mark-dirty`

Fires after every `Edit` or `Write` tool call Claude makes. Runs asynchronously (non-blocking — Claude continues thinking while this runs in the background).

What it does:
```
codegraph-live mark-dirty
    │
    └── creates .codegraph/.dirty  (or updates its mtime)
        This is a sentinel file — just a flag, no content.
```

The mark-dirty command is fast (milliseconds) because it only touches a flag file, not the database.

**Matcher pattern:** `Edit|Write` — fires on both the `Edit` and `Write` tools. Does not fire on `Read`, `Bash`, or other tools.

### `Stop` → `codegraph-live sync-if-dirty`

Fires when Claude finishes generating its response (the "stop" event — Claude has stopped producing output). Runs synchronously — Claude Code waits for this to complete before the conversation turn ends.

What it does:
```
codegraph-live sync-if-dirty
    │
    ├── checks for .codegraph/.dirty
    │
    ├── if dirty:
    │     CodeGraph.open(projectRoot).sync()   ← incremental sync
    │     delete .codegraph/.dirty
    │     exit 0
    │
    └── if not dirty:
          exit 0 immediately (no-op)
```

The sync runs synchronously so that by the time Claude Code returns control to the user (ready for the next message), the graph reflects all edits Claude made during that turn.

---

## Hook configuration

Written to `settings.json` by the installer:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "codegraph-live mark-dirty",
            "async": true
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "codegraph-live sync-if-dirty"
          }
        ]
      }
    ]
  }
}
```

The `async: true` on `mark-dirty` means Claude Code fires it and immediately continues without waiting for it to finish. The `Stop` hook has no `async` field, so it defaults to synchronous.

---

## Full turn lifecycle

```
User asks: "Refactor this function"
    │
    └── Claude generates Edit tool calls
            │
            ├── Edit tool fires → file written
            │       │
            │       └── PostToolUse hook fires (async):
            │               codegraph-live mark-dirty
            │               → creates .codegraph/.dirty
            │
            ├── (more edits, more mark-dirty calls)
            │
            └── Claude finishes response
                    │
                    └── Stop hook fires (sync):
                            codegraph-live sync-if-dirty
                            → sees .dirty exists
                            → CodeGraph.sync() — re-indexes changed files
                            → deletes .dirty
                            → exits 0
                            │
User's next message → graph is up to date ✓
```

---

## Interaction with the daemon

The daemon and hooks both write to `codegraph.db` and are protected by CodeGraph's `FileLock`. They never interfere:

- If the daemon is mid-sync when `sync-if-dirty` runs, `sync-if-dirty` waits for the lock
- If `sync-if-dirty` is running and the daemon tries to sync, the daemon waits
- Both read the same `.dirty` flag — but the daemon ignores it entirely (it has its own event-based trigger); only `sync-if-dirty` reads and clears it

In practice, the daemon will often have already synced the changes before `sync-if-dirty` runs (the daemon's 1-second debounce typically fires during the time Claude is generating the response). In that case, `sync-if-dirty` does a nearly instantaneous diff sync that finds nothing new.

---

## Where hooks are written

The installer writes hooks to `settings.json` in either the global or local location:

| Location | Path | Written by |
|---|---|---|
| Global | `~/.claude/settings.json` | `codegraph-live install` |
| Local | `./.claude/settings.json` | `codegraph-live init` |

Both are written, so the hooks apply whether you open Claude Code globally or from a project directory. Claude Code merges hook configs from all applicable `settings.json` files, deduplicating by content.

The installer's `writeHooks()` function (`src/installer/config-writer.ts`) is idempotent: it removes any existing CodeGraph hook entries before writing new ones, so re-running `install` or `init` won't create duplicate hooks.
