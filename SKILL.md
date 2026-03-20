---
name: memory-in-box
description: >
  Three-layer memory system for AI agents. Triggers: "persist agent state",
  "remember across sessions", "memory-in-box", "mib", "cold-start-load",
  "extract knowledge from logs", "maintenance-scan", "three-layer memory".
---

# Skill: memory-in-box

## Purpose

Provide cross-session memory persistence for AI agents using a three-layer architecture (info → knowledge → wisdom). No external dependencies—just files.

## Trigger Conditions

Activate this skill when the agent encounters:
- "memory-in-box" or "mib" in project documentation
- "Cold Start" or "cold-start-load" protocols
- "persist agent state" or "remember across sessions"
- "extract knowledge from logs" or "maintenance-scan"
- "three-layer memory" architecture references
- `mib.mjs` command invocations

## CLI Reference

All commands: `node <skill-path>/bin/mib.mjs <command> [options]`

### Cold Start (Run First Every Session)

```bash
node <skill-path>/bin/mib.mjs cold-start-load --agent <agent-name>
```

Returns: `{ knowledge: [...], recent_unextracted_logs: [...], recent_experiences: [...] }`

### Log Entry (Run Every Round)

```bash
node <skill-path>/bin/mib.mjs log --agent <agent-name> --summary "what happened"
```

Optional: `--detail "technical details" --tags "tag1,tag2"`

Returns: `{ ok: true, round_id: N }`

### Maintenance Scan (When round_id % 21 === 0)

```bash
node <skill-path>/bin/mib.mjs maintenance-scan --agent <agent-name> --knowledge-bit-pending true
```

Returns logs pending knowledge extraction. Agent should:
1. Review pending logs
2. Extract important patterns into knowledge
3. Mark processed logs

### Knowledge Operations

```bash
# Upsert knowledge
node <skill-path>/bin/mib.mjs upsert-knowledge \
  --agent <agent-name> \
  --category "project_status" \
  --title "Current state" \
  --content "Description..."

# List knowledge
node <skill-path>/bin/mib.mjs list-knowledge --agent <agent-name>
```

### Experience Operations

```bash
# Add experience (lesson learned)
node <skill-path>/bin/mib.mjs add-experience \
  --category "trap" \
  --lesson "Always check X before Y"

# List experiences
node <skill-path>/bin/mib.mjs list-experiences
```

### Mark Extracted (After Processing Logs)

```bash
node <skill-path>/bin/mib.mjs mark-extracted --round-ids "1,2,3" --bit knowledge
```

### Other Commands

```bash
# Initialize memory directory
node <skill-path>/bin/mib.mjs init

# Check health
node <skill-path>/bin/mib.mjs health

# Show version
node <skill-path>/bin/mib.mjs --version

# Show help
node <skill-path>/bin/mib.mjs --help
```

## Standard Workflow

### 1. Session Start (Cold Start)

```
1. Run cold-start-load --agent <name>
2. Review returned knowledge and recent logs
3. Resume work with context restored
```

### 2. Every Conversation Round

```
1. Process user request
2. Before ending turn, run: log --agent <name> --summary "what happened"
3. Note the returned round_id
```

### 3. Periodic Maintenance (round_id % 21 === 0)

```
1. Run maintenance-scan --agent <name> --knowledge-bit-pending true
2. Review pending logs for important patterns
3. Extract insights with upsert-knowledge
4. Record lessons with add-experience
5. Mark processed logs with mark-extracted
```

## Three-Layer Architecture

| Layer | Storage | Purpose | Mutability |
|-------|---------|---------|------------|
| **Info** | `context-logs/` (NDJSON) | Complete audit trail | Append-only |
| **Knowledge** | `knowledge/` (JSON) | Current state, active context | Mutable |
| **Wisdom** | `AGENTS.md` section | Core principles (human-curated) | Rare updates |

## Directory Structure

```
memory-in-box/
├── context-logs/
│   └── <agent>/
│       └── YYYY-MM-DD.jsonl
├── knowledge/
│   └── <agent>/
│       └── <category>-<title>.json
├── experiences/
│   └── <category>-<id>.json
├── todos/
├── projects/
└── indexes/
```

## Integration Examples

### Inject into AGENTS.md / CLAUDE.md

```markdown
## Memory Protocol (memory-in-box)

**Cold Start**: Run first every session:
`node .opencode/skills/memory-in-box/bin/mib.mjs cold-start-load --agent my-agent`

**Every Round**: End each turn with:
`node .opencode/skills/memory-in-box/bin/mib.mjs log --agent my-agent --summary "what happened"`

**Maintenance**: When round_id % 21 === 0, run maintenance-scan and extract knowledge.
```

## References

For design rationale and advanced topics, see:
- `references/design-rationale.md` - Why three layers? Why not a database?
- `references/comparison.md` - memory-in-box vs Claude Session Memory vs MEMORY.md
