# MCP Server

The Model Context Protocol (MCP) server is how Claude Code queries the knowledge graph. This document covers what it is, how Claude Code launches it, what tools it exposes, and how it reads from the database.

---

## What MCP is

MCP (Model Context Protocol) is an open standard that lets Claude Code talk to external tools over a subprocess pipe. Claude Code launches an MCP server as a child process, speaks to it over stdin/stdout using JSON-RPC messages, and the server exposes "tools" that Claude can call — similar to function calling in the API.

CodeGraph Live's MCP server exposes graph query tools so Claude can ask structural questions about the codebase without reading files directly.

---

## How Claude Code launches it

When you run `codegraph-live install`, it writes to `~/.claude.json`:

```json
{
  "mcpServers": {
    "codegraph": {
      "type": "stdio",
      "command": "codegraph-live",
      "args": ["serve", "--mcp"]
    }
  }
}
```

Every time a Claude Code session starts, Claude Code reads this config and launches `codegraph-live serve --mcp` as a subprocess. It communicates over stdin/stdout — no network, no port, no daemon socket. The process lives only for the duration of the Claude Code session.

This is completely separate from the background daemon. The MCP server is a short-lived per-session process; the daemon is a long-lived system service.

---

## Tools exposed

| Tool name | Parameters | What it returns |
|---|---|---|
| `codegraph_explore` | `query: string` | Comprehensive source sections for all symbols relevant to the query — the heavy-weight exploration tool |
| `codegraph_context` | `task: string` | Lighter context for a task — same idea as explore but less exhaustive |
| `codegraph_search` | `query: string` | Symbol names matching the query (fast, lightweight lookup) |
| `codegraph_callers` | `symbolName: string` | All symbols that call the given symbol |
| `codegraph_callees` | `symbolName: string` | All symbols the given symbol calls |
| `codegraph_impact` | `symbolName: string` | Transitive impact radius — everything that would break if this symbol changed |
| `codegraph_node` | `symbolName: string` | Full details + source code for a single symbol |
| `codegraph_status` | _(none)_ | Index stats: file count, node count, DB size, last sync time |

All tools read from `.codegraph/codegraph.db` in the project root. The MCP server locates the DB by walking up from `process.cwd()` to find the nearest `.codegraph/` directory.

---

## Source code

```
src/mcp/
├── index.ts      MCPServer class — lifecycle (start/stop), tool dispatch
├── tools.ts      Tool definitions: name, description, parameter schema, handler
└── transport.ts  Stdio transport — reads JSON-RPC from stdin, writes to stdout
```

### Startup sequence

```
Claude Code starts session
    │
    ├── reads ~/.claude.json → finds codegraph MCP server entry
    │
    └── spawns: codegraph-live serve --mcp
                    │
                    ├── MCPServer.start()
                    ├── StdioTransport.connect()  (opens readline on stdin)
                    ├── registers all tools from tools.ts
                    └── waits for JSON-RPC tool calls from Claude Code

Claude Code sends tool call → {"method": "tools/call", "params": {"name": "codegraph_search", ...}}
                    │
                    ├── MCPServer dispatches to handler in tools.ts
                    ├── handler opens CodeGraph.openSync(projectRoot)
                    ├── runs the query (search, graph traversal, etc.)
                    ├── closes the CodeGraph instance
                    └── returns JSON result to Claude Code over stdout

Claude Code session ends
    └── stdin closes → MCP server process exits
```

### Reading the graph

Each tool call opens the SQLite database, runs the query, and closes it. There is no long-lived connection kept by the MCP server. This is safe because:
- SQLite supports multiple readers via WAL mode
- The daemon's writes are serialized by CodeGraph's internal `FileLock`
- Read operations are non-destructive and always see a consistent snapshot

---

## Permissions

When `codegraph-live install` runs, it writes tool permissions to `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__codegraph__codegraph_search",
      "mcp__codegraph__codegraph_context",
      "mcp__codegraph__codegraph_callers",
      "mcp__codegraph__codegraph_callees",
      "mcp__codegraph__codegraph_impact",
      "mcp__codegraph__codegraph_node",
      "mcp__codegraph__codegraph_status"
    ]
  }
}
```

Without these, Claude Code would prompt the user to approve each tool call individually. The installer pre-approves all of them so graph queries happen silently.

Note: `codegraph_explore` is intentionally not in the allow list — it's a heavy tool that returns large amounts of source code, so it's left to require explicit approval as a natural reminder to use it thoughtfully.

---

## When there is no `.codegraph/` directory

If the MCP server is started in a project that hasn't been initialized, tool calls will return an error like:

```
CodeGraph not initialized in /path/to/project. Run `codegraph-live init` first.
```

This is graceful — it won't crash Claude Code, just surface the error message as a tool result. The CLAUDE.md instructions (written by `install`) tell Claude to inform the user and suggest running `codegraph-live init`.
