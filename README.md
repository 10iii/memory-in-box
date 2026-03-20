# memory-in-box

A three-layer memory system for AI agents. Inspired by human cognition: raw experiences (info layer) are distilled into structured knowledge, which crystallizes into reusable wisdom. Zero external dependencies—just files your agent (and you) can read.

| Layer | Analogy | Storage | Purpose |
|-------|---------|---------|---------|
| **Info** | Episodic memory | NDJSON logs | Complete audit trail |
| **Knowledge** | Semantic memory | JSON state | Current context, active todos |
| **Wisdom** | Crystallized insights | AGENTS.md | Core principles (human-curated) |

## Installation & Setup

### Step 1: Install the Skill

Copy this skill folder to your agent's skills directory:

```bash
# Claude Code
cp -r memory-in-box ~/.claude/skills/

# OpenCode / OpenClaw
cp -r memory-in-box .opencode/skills/

# Global user skills
cp -r memory-in-box ~/.agents/skills/
```

### Step 2: Initialize Memory Directory

From your project root, run:

```bash
node .opencode/skills/memory-in-box/bin/mib.mjs init
```

This creates the `memory-in-box/` directory with proper structure:

```
memory-in-box/
├── context-logs/       # Info layer: append-only event logs
├── knowledge/          # Knowledge layer: current state
├── experiences/        # Extracted lessons
└── indexes/            # Query acceleration (auto-rebuilt)
```

### Step 3: Inject Memory Protocol (Critical!)

Your agent needs to know to use memory-in-box every session. Add this section to the appropriate knowledge file for your framework:

<details>
<summary><b>Claude Code</b> → Add to <code>CLAUDE.md</code></summary>

```markdown
## Memory Protocol (memory-in-box)

**Cold Start**: On every new session, run first:
`node .claude/skills/memory-in-box/bin/mib.mjs cold-start-load --agent my-agent`

**Every Round**: End each conversation turn with:
`node .claude/skills/memory-in-box/bin/mib.mjs log --summary "what happened" --agent my-agent`

**Maintenance**: When `round_id % 21 === 0`, run `maintenance-scan` and extract knowledge from pending logs.
```

</details>

<details>
<summary><b>OpenCode / OpenClaw</b> → Add to <code>AGENTS.md</code></summary>

```markdown
## Memory Protocol (memory-in-box)

**Cold Start**: On every new session, run first:
`node .opencode/skills/memory-in-box/bin/mib.mjs cold-start-load --agent my-agent`

**Every Round**: End each conversation turn with:
`node .opencode/skills/memory-in-box/bin/mib.mjs log --summary "what happened" --agent my-agent`

**Maintenance**: When `round_id % 21 === 0`, run `maintenance-scan` and extract knowledge from pending logs.
```

</details>

<details>
<summary><b>Cursor / Windsurf / Other</b> → Add to <code>.cursor/rules.md</code> or project README</summary>

```markdown
## Memory Protocol (memory-in-box)

**Cold Start**: On every new session, run first:
`node path/to/memory-in-box/bin/mib.mjs cold-start-load --agent my-agent`

**Every Round**: End each conversation turn with:
`node path/to/memory-in-box/bin/mib.mjs log --summary "what happened" --agent my-agent`

**Maintenance**: When `round_id % 21 === 0`, run `maintenance-scan` and extract knowledge from pending logs.
```

</details>

> **Why inject rules?** AI agents load project knowledge files at session start. Without this injection, the agent "forgets" to log and loses continuity across sessions.

## Commands Reference

All commands follow the pattern: `node path/to/bin/mib.mjs <command> [options]`

| Command | Description |
|---------|-------------|
| `init` | Initialize memory directory |
| `log --summary TEXT --agent NAME` | Append a log entry |
| `search-logs --text TEXT --agent NAME` | Search logs |
| `cold-start-load --agent NAME` | One-call recovery for cold start |
| `upsert-knowledge --agent NAME --category CAT --title TEXT --content TEXT` | Create/update knowledge |
| `list-knowledge --agent NAME` | List knowledge entries |
| `add-experience --category CAT --lesson TEXT` | Record a learned lesson |
| `list-experiences` | Retrieve lessons |
| `maintenance-scan --agent NAME` | Find logs pending extraction |
| `health` | Check system health |
| `--version` | Show version |
| `--help` | Show all commands |

## Why memory-in-box?

| Feature | Claude Session Memory | OpenClaw MEMORY.md | memory-in-box |
|---------|----------------------|-------------------|---------------|
| Auto-saves summaries | ✅ Black-box | ⚠️ Semi-auto | ❌ Explicit |
| Three-layer architecture | ✅ | ❌ | ✅ |
| Human-readable files | ⚠️ JSON | ✅ Markdown | ✅ NDJSON+JSON |
| Git-friendly | ❌ | ✅ | ✅ |
| Knowledge distillation | ❌ | ❌ | ✅ Manual |
| Cross-framework | ❌ Claude only | ❌ OpenClaw only | ✅ Any |
| Zero dependencies | ✅ | ✅ | ✅ |

## License

MIT
