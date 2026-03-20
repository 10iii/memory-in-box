# Comparison: memory-in-box vs Alternatives

A detailed comparison of memory solutions for AI coding agents.

## Quick Comparison Table

| Feature | Claude Session Memory | OpenClaw MEMORY.md | Cursor Memory | memory-in-box |
|---------|----------------------|-------------------|---------------|---------------|
| **Persistence** | Session-scoped | File-based | Session + File | File-based |
| **Architecture** | Single-layer | Single-layer | Two-layer | Three-layer |
| **Storage format** | Proprietary JSON | Markdown | Mixed | NDJSON + JSON |
| **Human-readable** | Partial | Yes | Partial | Yes |
| **Git-friendly** | No | Yes | No | Yes |
| **Auto-summarization** | Yes (black-box) | Semi-auto | Yes | No (explicit) |
| **Multi-agent** | No | No | No | Yes |
| **Cross-framework** | Claude only | OpenClaw only | Cursor only | Any |
| **Dependencies** | Claude | OpenClaw | Cursor | Node.js (or any runtime) |
| **Knowledge distillation** | No | No | No | Yes |
| **Audit trail** | No | Limited | No | Full |

---

## Claude Session Memory

### How It Works

Claude Code automatically maintains conversation summaries across sessions. When you start a new session, Claude loads relevant context from previous conversations.

### Pros

- **Zero setup**: Works out of the box
- **Automatic**: No explicit logging required
- **Smart summarization**: Uses Claude's understanding to extract key points

### Cons

- **Black box**: Can't see or control what's remembered
- **No structure**: Flat summaries without hierarchy
- **Claude-locked**: Only works with Claude Code
- **No git history**: Memory changes don't appear in version control
- **Single agent**: No support for multi-agent setups

### When to Use

- Solo projects with Claude Code
- When simplicity matters more than control
- Short-term projects where memory loss isn't critical

---

## OpenClaw MEMORY.md

### How It Works

OpenClaw uses a `MEMORY.md` file in the project root. The agent reads this file at session start and (semi-)automatically updates it during work.

### Pros

- **Transparent**: Just a Markdown file you can read/edit
- **Git-friendly**: Changes tracked in version control
- **Human-editable**: Manual corrections easy

### Cons

- **Single-layer**: No separation of logs vs. knowledge vs. wisdom
- **No structured query**: Can't search by tag, date, or agent
- **Markdown limitations**: Complex data doesn't fit well
- **Merge conflicts**: Multiple agents editing causes conflicts
- **OpenClaw-only**: Not portable to other frameworks

### When to Use

- OpenClaw projects with single-agent workflows
- When Markdown simplicity is preferred
- Projects where structured queries aren't needed

---

## Cursor Memory (`.cursorules` + Memory)

### How It Works

Cursor combines session memory with rule files (`.cursorrules`). Rules define persistent instructions; memory handles conversation context.

### Pros

- **Rules + Memory separation**: Persistent rules vs. evolving context
- **Codebase awareness**: Good integration with project structure
- **Auto-indexing**: Understands your codebase

### Cons

- **Cursor-locked**: Only works in Cursor IDE
- **Opaque memory**: Can't inspect or modify directly
- **No audit trail**: Can't see what changed when
- **No multi-agent**: Single-agent assumption

### When to Use

- Cursor users who want built-in convenience
- Projects where Cursor is the only editing tool
- When you don't need cross-session history

---

## memory-in-box

### How It Works

Three-layer architecture with explicit logging:

1. **Info layer**: Append-only NDJSON logs (everything that happened)
2. **Knowledge layer**: Mutable JSON state (current context per agent)
3. **Wisdom layer**: AGENTS.md section (rare, human-curated principles)

Agents explicitly call `mib log` after each round. Periodic maintenance extracts knowledge from logs.

### Pros

- **Full transparency**: Plain text files, `cat`/`grep`/`jq` friendly
- **Three-layer hierarchy**: Different concerns, different storage
- **Multi-agent native**: Each agent has separate namespace
- **Git-friendly**: Line-based diffs, meaningful history
- **Framework agnostic**: Works with any AI coding tool
- **Full audit trail**: Every event timestamped and preserved
- **Knowledge distillation**: Explicit workflow for extracting insights

### Cons

- **Explicit effort**: Must call `mib log` (not automatic)
- **Setup required**: Need to inject protocol into agent rules
- **More files**: Directory structure more complex than single file
- **Manual maintenance**: Periodic knowledge extraction required

### When to Use

- Multi-agent projects
- When transparency and control matter
- Cross-framework setups (Claude + OpenCode, etc.)
- Long-running projects needing audit trail
- Teams wanting git-tracked agent memory

---

## Migration Paths

### From Claude Session Memory → memory-in-box

1. Start using memory-in-box alongside Claude's built-in memory
2. Gradually rely more on explicit `mib log` calls
3. Claude's memory becomes redundant; continue with just memory-in-box

### From MEMORY.md → memory-in-box

1. Run `mib init` to create directory structure
2. Copy key information from MEMORY.md to knowledge entries:
   ```bash
   mib upsert-knowledge --agent my-agent --category "migrated" \
     --title "From MEMORY.md" --content "$(cat MEMORY.md)"
   ```
3. Update agent rules to use memory-in-box protocol
4. Archive or delete MEMORY.md

### From Cursor Memory → memory-in-box

1. Export any visible memory/rules to files
2. Initialize memory-in-box in project
3. Add memory protocol to `.cursorrules`
4. Use memory-in-box alongside Cursor's built-in (they don't conflict)

---

## Decision Flowchart

```
Need memory for AI agents?
│
├─ Single agent, single tool?
│  ├─ Claude Code only → Use Claude Session Memory
│  ├─ Cursor only → Use Cursor's built-in
│  └─ OpenClaw only → Use MEMORY.md
│
├─ Multi-agent or cross-framework?
│  └─ memory-in-box ✓
│
├─ Need git history of memory changes?
│  └─ memory-in-box ✓
│
├─ Need to search by tag/date/agent?
│  └─ memory-in-box ✓
│
├─ Want zero-setup convenience?
│  └─ Use built-in (Claude/Cursor/OpenClaw)
│
└─ Want full transparency and control?
   └─ memory-in-box ✓
```

---

## Summary

| If you value... | Choose... |
|-----------------|-----------|
| Zero setup | Built-in (Claude/Cursor/OpenClaw) |
| Simplicity | MEMORY.md |
| Full control | memory-in-box |
| Multi-agent | memory-in-box |
| Cross-framework | memory-in-box |
| Git tracking | memory-in-box or MEMORY.md |
| Audit trail | memory-in-box |

memory-in-box trades convenience for transparency. If you're willing to explicitly log events, you get a robust, portable, inspectable memory system that works across any AI coding tool.
