/**
 * CLAUDE.md template for CodeGraph instructions
 *
 * This template is injected into ~/.claude/CLAUDE.md (global) or ./.claude/CLAUDE.md (local)
 * Keep this in sync with the README.md "Recommended: Add Global Instructions" section
 */

// Markers to identify CodeGraph section for updates
export const CODEGRAPH_SECTION_START = '<!-- CODEGRAPH_START -->';
export const CODEGRAPH_SECTION_END = '<!-- CODEGRAPH_END -->';

export const CLAUDE_MD_TEMPLATE = `${CODEGRAPH_SECTION_START}
## CodeGraph Live

CodeGraph Live builds a semantic knowledge graph of codebases and keeps it continuously up to date via a background daemon. Use it for fast, structural code exploration — callers, callees, impact analysis, and deep context — without reading files manually.

### If \`.codegraph/\` exists in the project

The graph is always fresh (the codegraph-live daemon syncs on every file save). Use MCP tools directly in the main session:

| Tool | Use For |
|------|---------|
| \`codegraph_explore\` | **Deep exploration** — comprehensive context for a topic in one call (returns full source sections) |
| \`codegraph_context\` | Quick context for a task (lighter than explore) |
| \`codegraph_search\` | Find symbols by name (functions, classes, types) |
| \`codegraph_callers\` | Find everything that calls a function |
| \`codegraph_callees\` | Find everything a function calls |
| \`codegraph_impact\` | Find what breaks if you change a symbol |
| \`codegraph_node\` | Get details + source for a single symbol |

**Important:** \`codegraph_explore\` returns large source sections. If you only need a targeted answer, prefer \`codegraph_search\` + \`codegraph_node\` instead, or spawn an Explore subagent to keep the main context clean.

**Do not re-read files** that \`codegraph_explore\` or \`codegraph_context\` already returned source for — those sections are complete and authoritative.

### If \`.codegraph/\` does NOT exist

At the start of a session, tell the user:

"This project doesn't have CodeGraph Live initialized. To set it up: run \`codegraph-live install\` once per machine (global setup), then \`codegraph-live init\` inside this project."
${CODEGRAPH_SECTION_END}`;
