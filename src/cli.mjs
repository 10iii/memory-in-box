import path from "node:path"
import { fileURLToPath } from "node:url"
import { readFileSync } from "node:fs"

import {
  addExperience,
  compact,
  coldStartLoad,
  deleteExperience,
  deleteKnowledge,
  deleteTodo,
  ensureStore,
  getProject,
  health,
  importLegacyDb,
  maintenanceScan,
  listExperiences,
  listKnowledge,
  listProjects,
  listTodos,
  logEntry,
  markExtracted,
  rebuildIndexes,
  searchLogs,
  upsertProject,
  upsertKnowledge,
  upsertTodo,
} from "./store.mjs"

function printJson(stream, value) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`)
}

function printText(stream, value) {
  stream.write(`${value}\n`)
}

function getVersion() {
  try {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = path.dirname(__filename)
    const pkgPath = path.join(__dirname, "..", "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    return pkg.version
  } catch {
    return "unknown"
  }
}

function usage() {
  return [
    "Usage:",
    "  memory-skill init [--dir PATH]",
    "  memory-skill log --summary TEXT [--agent NAME] [--project-path PATH] [--detail TEXT] [--tags a,b] [--dir PATH] [--format json|text]",
    "  memory-skill search-logs [--text TEXT] [--tags a,b] [--agent NAME] [--project-path PATH] [--since ISO] [--until ISO] [--unextracted-bit knowledge|experience] [--limit N] [--dir PATH] [--format json|text]",
    "  memory-skill mark-extracted --round-ids 1,2 [--bit knowledge|experience] [--dir PATH] [--format json|text]",
    "  memory-skill cold-start-load --agent NAME [--knowledge-limit N] [--logs-limit N] [--experiences-limit N] [--unextracted-bit knowledge|experience] [--dir PATH] [--format json|text]",
    "  memory-skill maintenance-scan [--agent NAME] [--project-path PATH] [--knowledge-bit-pending true|false] [--experience-bit-pending true|false] [--limit N] [--dir PATH] [--format json|text]",
    "  memory-skill rebuild-indexes [--dir PATH] [--format json|text]",
    "  memory-skill compact [--snapshot-limit N] [--dir PATH] [--format json|text]",
    "  memory-skill upsert-knowledge --agent NAME --category NAME --title TEXT --content TEXT [--project NAME] [--priority N] [--dir PATH] [--format json|text]",
    "  memory-skill delete-knowledge --agent NAME --category NAME --title TEXT [--dir PATH] [--format json|text]",
    "  memory-skill list-knowledge --agent NAME [--category NAME] [--limit N] [--sort priority_desc|updated_desc] [--dir PATH] [--format json|text]",
    "  memory-skill add-experience --category NAME --lesson TEXT [--context TEXT] [--problem TEXT] [--solution TEXT] [--tags a,b] [--project-path PATH] [--source-round-id N] [--dir PATH] [--format json|text]",
    "  memory-skill list-experiences [--category NAME] [--tag NAME] [--limit N] [--dir PATH] [--format json|text]",
    "  memory-skill delete-experience --id N [--dir PATH] [--format json|text]",
    "  memory-skill upsert-todo --id ID --title TEXT [--description TEXT] [--status pending|completed|cancelled] [--dir PATH] [--format json|text]",
    "  memory-skill list-todos [--status STATUS] [--limit N] [--dir PATH] [--format json|text]",
    "  memory-skill delete-todo --id ID [--dir PATH] [--format json|text]",
    "  memory-skill upsert-project --path PATH [--status active|archived] [--tech-stack TEXT] [--description TEXT] [--last-active ISO] [--dir PATH] [--format json|text]",
    "  memory-skill list-projects [--status STATUS] [--limit N] [--dir PATH] [--format json|text]",
    "  memory-skill get-project --path PATH [--dir PATH] [--format json|text]",
    "  memory-skill health [--dir PATH] [--format json|text]",
    "  memory-skill import-legacy-db [--project-dir PATH] [--source-db PATH] [--overwrite true|false] [--dir PATH] [--format json|text]",
  ].join("\n")
}

function parseArgs(argv) {
  if (argv.length === 0) {
    return { command: null, options: {} }
  }
  const [command, ...rest] = argv
  const options = {}
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]
    if (!token.startsWith("--")) {
      continue
    }
    const key = token.slice(2)
    const next = rest[i + 1]
    if (next === undefined || next.startsWith("--")) {
      options[key] = true
      continue
    }
    options[key] = next
    i += 1
  }
  return { command, options }
}

function getMemoryDir(options) {
  return path.resolve(options.dir || path.join(process.cwd(), "memory-in-box"))
}

function formatTextResult(command, result) {
  if (command === "init") {
    return `Initialized memory store at ${result.memory_dir}`
  }
  if (command === "log") {
    return `Logged round ${result.round_id}`
  }
  if (command === "add-experience") {
    return `Added experience ${result.id}`
  }
  if (command === "list-knowledge") {
    if (result.count === 0) return "No knowledge items found"
    return result.items.map((item) => `[${item.priority ?? 0}] ${item.title}`).join("\n")
  }
  if (command === "list-todos") {
    if (result.count === 0) return "No todo items found"
    return result.items.map((item) => `[${item.status}] ${item.id}: ${item.title}`).join("\n")
  }
  if (command === "list-projects") {
    if (result.count === 0) return "No projects found"
    return result.items.map((item) => `[${item.status}] ${item.path}`).join("\n")
  }
  if (command === "health") {
    return `Memory health OK: logs=${result.counts.context_logs}, knowledge=${result.counts.knowledge}, experiences=${result.counts.experiences}, todos=${result.counts.todos}, projects=${result.counts.projects}`
  }
  if (command === "maintenance-scan") {
    return `Maintenance scan: knowledge_pending=${result.counts.knowledge_pending}, experience_pending=${result.counts.experience_pending}`
  }
  if (command === "delete-experience") {
    return result.deleted ? `Deleted experience ${result.id}` : `Experience ${result.id} not found`
  }
  if (command === "import-legacy-db") {
    return `Imported legacy DB into ${result.memory_dir}: logs=${result.counts.context_logs}, knowledge=${result.counts.knowledge}, experiences=${result.counts.experiences}, todos=${result.counts.todos}, projects=${result.counts.projects}`
  }
  return null
}

function formatResult(command, result, stream) {
  const format = result.format || "json"
  if (format === "text") {
    const textResult = formatTextResult(command, result)
    if (textResult !== null) {
      printText(stream, textResult)
      return
    }
  }
  printJson(stream, result)
}

export async function runCli(argv, stdout, stderr) {
  // Handle global flags first (before parsing command)
  if (argv.includes("--version") || argv.includes("-v")) {
    printText(stdout, `memory-in-box v${getVersion()}`)
    return 0
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    printText(stdout, usage())
    return 0
  }

  const { command, options } = parseArgs(argv)
  if (!command || options.help) {
    printText(stderr, usage())
    return command ? 0 : 1
  }

  try {
    const memoryDir = getMemoryDir(options)

    if (command === "init") {
      await ensureStore(memoryDir)
      formatResult(
        command,
        { ok: true, memory_dir: memoryDir, format: options.format || "json" },
        stdout,
      )
      return 0
    }

    if (command === "search-logs") {
      const result = await searchLogs(memoryDir, {
        text: options.text,
        tags: options.tags,
        agent: options.agent,
        projectPath: options["project-path"],
        since: options.since,
        until: options.until,
        unextractedBit: options["unextracted-bit"],
        limit: options.limit,
      })
      formatResult(command, { ...result, format: options.format || "json" }, stdout)
      return 0
    }

    if (command === "mark-extracted") {
      const result = await markExtracted(memoryDir, {
        roundIds: options["round-ids"],
        bit: options.bit || "knowledge",
      })
      formatResult(command, { ...result, format: options.format || "json" }, stdout)
      return 0
    }

    if (command === "cold-start-load") {
      const result = await coldStartLoad(memoryDir, {
        agent: options.agent,
        category: options.category,
        knowledgeLimit: options["knowledge-limit"],
        logsLimit: options["logs-limit"],
        experiencesLimit: options["experiences-limit"],
        unextractedBit: options["unextracted-bit"],
      })
      formatResult(command, { ...result, format: options.format || "json" }, stdout)
      return 0
    }

    if (command === "maintenance-scan") {
      const result = await maintenanceScan(memoryDir, {
        agent: options.agent,
        projectPath: options["project-path"],
        knowledgeBitPending: options["knowledge-bit-pending"] === undefined ? undefined : options["knowledge-bit-pending"] !== "false",
        experienceBitPending: options["experience-bit-pending"] === undefined ? undefined : options["experience-bit-pending"] !== "false",
        limit: options.limit,
      })
      formatResult(command, { ...result, format: options.format || "json" }, stdout)
      return 0
    }

    if (command === "log") {
      const result = await logEntry(memoryDir, {
        summary: options.summary,
        agent: options.agent,
        projectPath: options["project-path"],
        detail: options.detail,
        tags: options.tags,
      })
      formatResult(command, { ...result, format: options.format || "json" }, stdout)
      return 0
    }

    if (command === "upsert-knowledge") {
      const result = await upsertKnowledge(memoryDir, {
        agent: options.agent,
        category: options.category,
        title: options.title,
        content: options.content,
        project: options.project,
        priority: options.priority,
      })
      formatResult(command, { ...result, format: options.format || "json" }, stdout)
      return 0
    }

    if (command === "delete-knowledge") {
      const result = await deleteKnowledge(memoryDir, {
        agent: options.agent,
        category: options.category,
        title: options.title,
      })
      formatResult(command, { ...result, format: options.format || "json" }, stdout)
      return 0
    }

    if (command === "list-knowledge") {
      const result = await listKnowledge(memoryDir, {
        agent: options.agent,
        category: options.category,
        limit: options.limit,
        sort: options.sort,
      })
      formatResult(command, { ...result, format: options.format || "json" }, stdout)
      return 0
    }

    if (command === "list-experiences") {
      const result = await listExperiences(memoryDir, {
        category: options.category,
        tag: options.tag,
        limit: options.limit,
      })
      formatResult(command, { ...result, format: options.format || "json" }, stdout)
      return 0
    }

    if (command === "delete-experience") {
      const result = await deleteExperience(memoryDir, {
        id: options.id,
      })
      formatResult(command, { ...result, format: options.format || "json" }, stdout)
      return 0
    }

    if (command === "add-experience") {
      const result = await addExperience(memoryDir, {
        category: options.category,
        context: options.context,
        problem: options.problem,
        solution: options.solution,
        lesson: options.lesson,
        tags: options.tags,
        projectPath: options["project-path"],
        sourceRoundId: options["source-round-id"],
      })
      formatResult(command, { ...result, format: options.format || "json" }, stdout)
      return 0
    }

    if (command === "rebuild-indexes") {
      const result = await rebuildIndexes(memoryDir)
      formatResult(command, { ...result, format: options.format || "json" }, stdout)
      return 0
    }

    if (command === "upsert-todo") {
      const result = await upsertTodo(memoryDir, {
        id: options.id,
        title: options.title,
        description: options.description,
        status: options.status,
      })
      formatResult(command, { ...result, format: options.format || "json" }, stdout)
      return 0
    }

    if (command === "list-todos") {
      const result = await listTodos(memoryDir, {
        status: options.status,
        limit: options.limit,
      })
      formatResult(command, { ...result, format: options.format || "json" }, stdout)
      return 0
    }

    if (command === "delete-todo") {
      const result = await deleteTodo(memoryDir, {
        id: options.id,
      })
      formatResult(command, { ...result, format: options.format || "json" }, stdout)
      return 0
    }

    if (command === "upsert-project") {
      const result = await upsertProject(memoryDir, {
        path: options.path,
        status: options.status,
        techStack: options["tech-stack"],
        description: options.description,
        lastActive: options["last-active"],
      })
      formatResult(command, { ...result, format: options.format || "json" }, stdout)
      return 0
    }

    if (command === "list-projects") {
      const result = await listProjects(memoryDir, {
        status: options.status,
        limit: options.limit,
      })
      formatResult(command, { ...result, format: options.format || "json" }, stdout)
      return 0
    }

    if (command === "get-project") {
      const result = await getProject(memoryDir, {
        path: options.path,
      })
      formatResult(command, { ...result, format: options.format || "json" }, stdout)
      return 0
    }

    if (command === "health") {
      const result = await health(memoryDir)
      formatResult(command, { ...result, format: options.format || "json" }, stdout)
      return 0
    }

    if (command === "import-legacy-db") {
      const result = await importLegacyDb(memoryDir, {
        projectDir: options["project-dir"],
        sourceDb: options["source-db"],
        overwrite: options.overwrite === "true",
      })
      formatResult(
        command,
        { ...result, memory_dir: memoryDir, format: options.format || "json" },
        stdout,
      )
      return 0
    }

    if (command === "compact") {
      const result = await compact(memoryDir, {
        snapshotLimit: options["snapshot-limit"],
      })
      formatResult(command, { ...result, format: options.format || "json" }, stdout)
      return 0
    }

    printText(stderr, `Unknown command: ${command}`)
    printText(stderr, usage())
    return 1
  } catch (error) {
    printJson(stderr, {
      ok: false,
      error: {
        code: "CLI_ERROR",
        message: error instanceof Error ? error.message : String(error),
      },
    })
    return 1
  }
}
