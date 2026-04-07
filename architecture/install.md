# Install vs Init — Two-Phase Setup

CodeGraph Live has two distinct setup commands with different scopes. Understanding this distinction is important for both using the tool and maintaining the installer code.

---

## The two phases

### Phase 1: `codegraph-live install` — global, once per machine

**What it writes:**

| File | Location | Purpose |
|---|---|---|
| `CLAUDE.md` | `~/.claude/CLAUDE.md` | Instructions to Claude on how to use CodeGraph tools. Applied in every session on this machine. |
| MCP config | `~/.claude.json` | Registers the MCP server so Claude Code knows to start `codegraph-live serve --mcp` in every session. |
| Permissions | `~/.claude/settings.json` | Auto-approves all `mcp__codegraph__*` tools so Claude doesn't prompt for permission each time. |
| Hooks | `~/.claude/settings.json` | `PostToolUse` and `Stop` hooks for auto-sync (see [hooks.md](./hooks.md)). |

**When to run:** Once, right after global installation. Re-running safely updates all configs (idempotent). Also runs if you invoke `codegraph-live` with no arguments.

**What it does NOT do:** Create `.codegraph/` or index any project. It only sets up the machine-level Claude Code integration.

---

### Phase 2: `codegraph-live init [path]` — local, once per project

**What it writes:**

| File | Location | Purpose |
|---|---|---|
| MCP config | `./.claude.json` | Project-local MCP registration (redundant if global exists, but good for portability). |
| Permissions | `./.claude/settings.json` | Project-local permission allow-list for CodeGraph tools. |
| Hooks | `./.claude/settings.json` | Project-local auto-sync hooks. |
| Graph DB | `./.codegraph/codegraph.db` | The actual knowledge graph — all symbols and relationships extracted from source. |

**When to run:** Once per project. Re-running is safe (skips indexing if already initialized; updates config files). The daemon picks up newly initialized projects within 30 seconds automatically.

**What it does NOT do:** Touch `~/.claude/` or write CLAUDE.md. The global installer owns that.

---

## Why CLAUDE.md goes to `~/.claude/` (not the project)

Claude Code merges CLAUDE.md files in a hierarchy:
1. `~/.claude/CLAUDE.md` — always loaded, every session
2. `<project>/.claude/CLAUDE.md` — loaded when Claude Code opens that project
3. `<project>/CLAUDE.md` — also loaded per project

The CodeGraph instructions need to apply in every project, not just ones where you ran `init`. Specifically, the "if `.codegraph/` doesn't exist, ask the user" instruction needs to fire in *any* project, not only pre-initialized ones.

If we wrote the instructions to `./.claude/CLAUDE.md` during `init`, they'd only be present after you'd already initialized the project — a circular dependency where you'd need to know about CodeGraph to get instructions about CodeGraph.

---

## File ownership summary

```
~/.claude/
├── CLAUDE.md            ← owned by `install` (written once globally)
├── .claude.json         ← owned by `install` (MCP server registration)
└── settings.json        ← owned by `install` (permissions + hooks)

<project>/
├── .claude.json         ← owned by `init` (local MCP registration)
├── .claude/
│   └── settings.json    ← owned by `init` (local permissions + hooks)
└── .codegraph/
    └── codegraph.db     ← owned by `init` / maintained by daemon + hooks
```

---

## Installer source code

The installer lives in `src/installer/`:

| File | Purpose |
|---|---|
| `index.ts` | `runGlobalInstaller()` and `runProjectInit()` — the two entry points |
| `config-writer.ts` | All file I/O: `writeMcpConfig()`, `writePermissions()`, `writeHooks()`, `writeClaudeMd()` |
| `claude-md-template.ts` | The CLAUDE.md content that gets injected, with start/end markers for idempotent updates |
| `clack.d.ts` | Type shim for `@clack/prompts` (ESM-only package — uses a dynamic import workaround due to tsc CJS compilation) |

### Idempotency

All write functions are safe to call multiple times:
- `writeClaudeMd()` looks for `<!-- CODEGRAPH_START -->` / `<!-- CODEGRAPH_END -->` markers and replaces the section if it exists, or appends if not
- `writeMcpConfig()` and `writePermissions()` merge into existing JSON, never overwrite unrelated keys
- `writeHooks()` removes any old CodeGraph entries before adding new ones (prevents duplicates)

### `InstallLocation` type

The `'global' | 'local'` union type controls where files land:
- `'global'` → `~/.claude/` and `~/.claude.json`
- `'local'` → `./.claude/` and `./.claude.json` (relative to `process.cwd()`)

`runGlobalInstaller()` always passes `'global'`.
`runProjectInit()` always passes `'local'`.
