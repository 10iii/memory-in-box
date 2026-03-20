# Design Rationale

## Why Three Layers?

The three-layer architecture (Info → Knowledge → Wisdom) mirrors how humans process and retain information:

### 1. Info Layer (Episodic Memory)
- **What**: Raw, timestamped events
- **Why append-only**: Like a journal—you don't edit past entries. Immutability ensures audit trail integrity.
- **Format**: NDJSON (one JSON object per line) for easy streaming and grep-ability

### 2. Knowledge Layer (Semantic Memory)
- **What**: Structured, agent-scoped state (current todos, project status, active decisions)
- **Why mutable**: Knowledge changes as projects evolve. A "completed" todo should be marked done, not just logged.
- **Why agent-scoped**: Each agent has different concerns. Xihe's project knowledge differs from Zhulong's patrol state.

### 3. Wisdom Layer (Crystallized Insights)
- **What**: Hard-won lessons that transcend individual projects
- **Why human-curated**: AI agents can suggest wisdom entries, but humans decide what's worth preserving long-term
- **Why in AGENTS.md**: Hot-reload on every session. No extra file reads needed.

## Why Not a Database?

We considered SQLite, LevelDB, and other embedded databases. Here's why we chose plain files:

| Concern | Database | Plain Files |
|---------|----------|-------------|
| **Transparency** | Binary blobs, hard to inspect | `cat` / `grep` / `jq` work out of the box |
| **Git-friendliness** | Binary diffs, merge conflicts | Line-based diffs, meaningful history |
| **Portability** | Requires runtime (libsqlite, etc.) | Any filesystem works |
| **Debugging** | Need specialized tools | Open in any text editor |
| **Recovery** | Corruption requires DB repair tools | Edit JSON by hand if needed |
| **Framework agnostic** | Some DBs don't work in all runtimes | Files work everywhere |

### The SQLite Experience

We actually started with SQLite (`ana.db`). Problems we hit:

1. **UTF-8 encoding issues**: Standard `sqlite3` CLI garbles Chinese text. Required building a Rust wrapper (`ana-db`) just to handle encoding.
2. **Binary opacity**: When things broke, debugging required `SELECT * FROM` instead of just `cat`-ing a file.
3. **Git noise**: Every commit with DB changes showed binary diffs—no way to review what actually changed.
4. **Migration overhead**: Schema changes required migration scripts instead of just changing JSON shape.

Plain files eliminated all these issues.

## Why NDJSON for Logs?

NDJSON (Newline-Delimited JSON) offers the best trade-offs for append-only logs:

| Format | Pros | Cons |
|--------|------|------|
| **JSON Array** | Standard format | Must parse entire file to append; can't stream |
| **CSV** | Human-readable rows | No nested data; escaping hell |
| **Protobuf/MsgPack** | Compact, fast | Binary; not human-readable |
| **NDJSON** | Append-friendly; line = record; grep works | Slightly larger than binary |

```bash
# Easy operations with NDJSON:
tail -1 log.ndjson                    # Last entry
grep "error" log.ndjson               # Find errors
wc -l log.ndjson                      # Count entries
cat log.ndjson | jq '.summary'        # Extract field
echo '{"new":"entry"}' >> log.ndjson  # Append
```

## Why Manual Knowledge Extraction?

Some systems auto-summarize conversations. We chose explicit extraction for several reasons:

1. **Quality control**: Auto-generated summaries often miss what matters or include noise
2. **Agent agency**: The agent decides what's worth remembering—this teaches better judgment
3. **Auditability**: You can trace exactly which logs became which knowledge entries
4. **Cost efficiency**: No constant summarization API calls

The `maintenance-scan` workflow gives agents structured time to reflect—like humans reviewing notes at the end of a day.

## Why Not Use Claude's Built-in Memory?

Claude Code has session memory. So do some other AI systems. Why build our own?

| Feature | Built-in Memory | memory-in-box |
|---------|-----------------|---------------|
| **Control** | Black box | Full visibility |
| **Portability** | Locked to one system | Works with any agent framework |
| **Structure** | Flat summaries | Three-layer hierarchy |
| **Git tracking** | Not possible | Full history |
| **Multiple agents** | Usually single-agent | Multi-agent support |
| **Customization** | None | Full control over schema |

Built-in memory is convenient but opaque. memory-in-box sacrifices some convenience for transparency and control.

## Performance Considerations

### Why Indexes?

Pure file scanning works for small logs (<1000 entries). Beyond that, we maintain JSON index files:

```
indexes/
├── context_log.by_agent.json      # { "xihe": [round_ids], "zhulong": [...] }
├── context_log.by_tag.json        # { "debug": [round_ids], "feishu": [...] }
├── context_log.unextracted.json   # [round_ids not yet processed]
└── knowledge.by_agent.json        # { "xihe": [knowledge_ids], ... }
```

Indexes are auto-rebuilt on inconsistency. They accelerate common queries:
- "All xihe logs from today"
- "Unextracted logs for maintenance"
- "All knowledge with category=project_status"

### Why Daily Log Files?

Logs are partitioned by date: `context-logs/xihe/2026-03-20.jsonl`

Benefits:
- Natural retention policy (delete old date files)
- Smaller files for faster operations
- Easy backup by date range
- Grep across specific time periods

## Security Considerations

### What NOT to Log

memory-in-box logs are plain text files. Never log:
- API keys or secrets
- User passwords
- Private keys
- PII without consent

Add a `.gitignore` entry if your logs might contain sensitive data:

```gitignore
memory-in-box/context-logs/**/*.jsonl
```

Or use the `--no-detail` flag for sensitive summaries.

## Future Directions

Things we're considering but haven't built:

1. **Automatic log rotation**: Archive logs older than N days
2. **Encryption at rest**: For sensitive deployments
3. **Remote sync**: Push/pull memory to cloud storage
4. **Web UI**: Browse logs and knowledge in a dashboard
5. **Semantic search**: Embed logs for similarity queries

These remain future work to keep the core simple.
