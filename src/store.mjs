import { mkdir, appendFile, readFile, rename, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

const SCHEMA_VERSION = 1

function isoNow() {
  return new Date().toISOString()
}

function normalizeTags(tags) {
  if (!tags) return []
  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean)
  }
  return String(tags)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
}

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true })
}

async function readJson(filePath, fallback) {
  if (!existsSync(filePath)) return fallback
  const text = await readFile(filePath, "utf8")
  if (!text.trim()) return fallback
  return JSON.parse(text)
}

async function writeJsonAtomic(filePath, data) {
  const tmpPath = `${filePath}.tmp`
  const text = `${JSON.stringify(data, null, 2)}\n`
  await writeFile(tmpPath, text, "utf8")
  await rename(tmpPath, filePath)
}

async function appendNdjson(filePath, record) {
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8")
}

async function readNdjson(filePath) {
  if (!existsSync(filePath)) return []
  const text = await readFile(filePath, "utf8")
  if (!text.trim()) return []
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

async function writeNdjsonAtomic(filePath, records) {
  const tmpPath = `${filePath}.tmp`
  const text = records.map((record) => JSON.stringify(record)).join("\n")
  await writeFile(tmpPath, text ? `${text}\n` : "", "utf8")
  await rename(tmpPath, filePath)
}

function includesText(record, query) {
  if (!query) return true
  const haystack = [record.summary, record.detail, ...(record.tags || [])]
    .filter((value) => value !== null && value !== undefined)
    .join("\n")
    .toLowerCase()
  return haystack.includes(query.toLowerCase())
}

function matchesTags(record, tags) {
  if (!tags || tags.length === 0) return true
  const recordTags = new Set(normalizeTags(record.tags))
  return normalizeTags(tags).every((tag) => recordTags.has(tag))
}

function matchesAgent(record, agent) {
  if (!agent) return true
  if (record.agent && String(record.agent) === String(agent)) return true
  const recordTags = new Set(normalizeTags(record.tags))
  return recordTags.has(String(agent))
}

function matchesTimeRange(record, since, until) {
  const createdAt = String(record.created_at || "")
  if (since && createdAt < String(since)) return false
  if (until && createdAt > String(until)) return false
  return true
}

function matchesUnextracted(record, bit) {
  if (!bit) return true
  const value = Number(record.knowledge_extracted || 0)
  if (bit === "knowledge") return (value & 1) === 0
  if (bit === "experience") return (value & 2) === 0
  throw new Error("unextracted_bit must be 'knowledge' or 'experience'")
}

function getRecordAgents(record) {
  const agents = new Set()
  if (record.agent) agents.add(String(record.agent))
  for (const tag of normalizeTags(record.tags)) {
    agents.add(tag)
  }
  return [...agents]
}

function buildContextIndexes(records) {
  const byRound = []
  const byAgent = {}
  const byTag = {}
  const unextracted = {
    knowledge: [],
    experience: [],
  }

  const sorted = [...records].sort((a, b) => Number(a.round_id || 0) - Number(b.round_id || 0))
  for (const record of sorted) {
    const roundId = Number(record.round_id)
    byRound.push(roundId)

    for (const agent of getRecordAgents(record)) {
      byAgent[agent] ??= []
      byAgent[agent].push(roundId)
    }

    for (const tag of normalizeTags(record.tags)) {
      byTag[tag] ??= []
      byTag[tag].push(roundId)
    }

    const value = Number(record.knowledge_extracted || 0)
    if ((value & 1) === 0) unextracted.knowledge.push(roundId)
    if ((value & 2) === 0) unextracted.experience.push(roundId)
  }

  return { byRound, byAgent, byTag, unextracted }
}

function buildKnowledgeIndexes(knowledgeItems) {
  const byAgent = {}
  const byAgentCategory = {}
  const byPriority = knowledgeItems
    .slice()
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
    .map((item) => item.id)

  for (const item of knowledgeItems) {
    byAgent[item.agent] ??= []
    byAgent[item.agent].push(item.id)

    byAgentCategory[item.agent] ??= {}
    byAgentCategory[item.agent][item.category] ??= []
    byAgentCategory[item.agent][item.category].push(item.id)
  }

  return { byAgent, byAgentCategory, byPriority }
}

function sortKnowledge(items, sort) {
  if (sort === "updated_desc") {
    return items.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
  }
  return items.sort((a, b) => {
    const priorityDelta = Number(b.priority || 0) - Number(a.priority || 0)
    if (priorityDelta !== 0) return priorityDelta
    return String(b.updated_at).localeCompare(String(a.updated_at))
  })
}

function sortByUpdatedDesc(items) {
  return items.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))
}

function normalizeTodoStatus(status) {
  const value = String(status || "pending").trim()
  return value || "pending"
}

function normalizeProjectStatus(status) {
  const value = String(status || "active").trim()
  return value || "active"
}

function runLegacyAnaDbQuery(projectDir, sql, sourceDb) {
  const exeName = process.platform === "win32" ? "ana-db.exe" : "ana-db"
  const exePath = path.join(projectDir, exeName)
  const env = sourceDb ? { ...process.env, ANA_DB_PATH: sourceDb } : process.env
  try {
    return execFileSync(exePath, ["query", sql], {
      encoding: "utf8",
      cwd: projectDir,
      env,
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    }).trim()
  } catch (error) {
    throw new Error(
      `legacy query failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function parseLegacyTable(text) {
  const trimmed = String(text || "").trim()
  if (!trimmed || trimmed === "(no results)") return []
  const lines = trimmed.split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split("|").map((cell) => cell.trim())
  const rows = []
  for (const line of lines.slice(2)) {
    const cells = line.split("|").map((cell) => cell.trim())
    if (cells.length !== headers.length) continue
    const row = {}
    headers.forEach((header, index) => {
      row[header] = cells[index]
    })
    rows.push(row)
  }
  return rows
}

function isStoreEmpty({ contextLogs, experiences, knowledgeItems, todoItems, projectItems }) {
  return (
    contextLogs.length === 0 &&
    experiences.length === 0 &&
    knowledgeItems.length === 0 &&
    todoItems.length === 0 &&
    projectItems.length === 0
  )
}

function asNullableString(value) {
  if (value === undefined || value === null || value === "") return null
  return String(value)
}

function asNumberOrZero(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function mapLegacyContextLogRow(row) {
  return {
    round_id: asNumberOrZero(row.round_id),
    summary: String(row.summary || ""),
    agent: null,
    project_path: asNullableString(row.project_path),
    detail: asNullableString(row.detail),
    tags: normalizeTags(row.tags),
    knowledge_extracted: asNumberOrZero(row.knowledge_extracted),
    created_at: asNullableString(row.created_at) || isoNow(),
  }
}

function mapLegacyExperienceRow(row) {
  return {
    id: asNumberOrZero(row.id),
    category: String(row.category || ""),
    context: asNullableString(row.context),
    problem: asNullableString(row.problem),
    solution: asNullableString(row.solution),
    lesson: String(row.lesson || ""),
    tags: normalizeTags(row.tags),
    project_path: asNullableString(row.project_path),
    source_round_id: row.source_round_id === "" ? null : asNumberOrZero(row.source_round_id),
    created_at: asNullableString(row.created_at) || isoNow(),
  }
}

function mapLegacyKnowledgeRows(rows) {
  const items = {}
  for (const row of rows) {
    const agent = String(row.agent || "").trim()
    const category = String(row.category || "").trim()
    const title = String(row.title || "").trim()
    if (!agent || !category || !title) continue
    const key = `${agent}::${category}::${title}`
    items[key] = {
      id: key,
      agent,
      category,
      project: asNullableString(row.project),
      title,
      content: String(row.content || ""),
      priority: asNumberOrZero(row.priority),
      updated_at: asNullableString(row.updated_at) || isoNow(),
      created_at: asNullableString(row.created_at) || asNullableString(row.updated_at) || isoNow(),
    }
  }
  return { version: SCHEMA_VERSION, items }
}

function mapLegacyTodoRows(rows) {
  const items = {}
  for (const row of rows) {
    const id = String(row.id || "").trim()
    if (!id) continue
    items[id] = {
      id,
      title: String(row.title || ""),
      description: asNullableString(row.description),
      status: normalizeTodoStatus(row.status),
      created_at: asNullableString(row.created_at) || isoNow(),
      updated_at: asNullableString(row.created_at) || isoNow(),
    }
  }
  return { version: SCHEMA_VERSION, items }
}

function mapLegacyProjectRows(rows) {
  const items = {}
  for (const row of rows) {
    const projectPath = String(row.path || "").trim()
    if (!projectPath) continue
    items[projectPath] = {
      path: projectPath,
      status: normalizeProjectStatus(row.status),
      tech_stack: asNullableString(row.tech_stack),
      description: asNullableString(row.description),
      created_at: asNullableString(row.created_at) || isoNow(),
      last_active: asNullableString(row.last_active) || asNullableString(row.created_at) || isoNow(),
      updated_at: asNullableString(row.last_active) || asNullableString(row.created_at) || isoNow(),
    }
  }
  return { version: SCHEMA_VERSION, items }
}

export async function ensureStore(memoryDir) {
  const logsDir = path.join(memoryDir, "logs")
  const stateDir = path.join(memoryDir, "state")
  const indexesDir = path.join(memoryDir, "indexes")
  const snapshotsDir = path.join(memoryDir, "snapshots")
  const archiveDir = path.join(memoryDir, "archive")

  await Promise.all([
    ensureDir(memoryDir),
    ensureDir(logsDir),
    ensureDir(stateDir),
    ensureDir(indexesDir),
    ensureDir(snapshotsDir),
    ensureDir(archiveDir),
  ])

  const metaPath = path.join(stateDir, "meta.json")
  const knowledgePath = path.join(stateDir, "knowledge.json")
  const todosPath = path.join(stateDir, "todos.json")
  const projectsPath = path.join(stateDir, "projects.json")
  const contextLogPath = path.join(logsDir, "context_log.ndjson")
  const experiencesPath = path.join(logsDir, "experiences.ndjson")

  if (!existsSync(metaPath)) {
    await writeJsonAtomic(metaPath, {
      schema_version: SCHEMA_VERSION,
      next_round_id: 1,
      next_experience_id: 1,
      last_compaction_at: null,
      last_index_rebuild_at: null,
      last_maintenance_at: null,
      created_at: isoNow(),
      updated_at: isoNow(),
    })
  }

  if (!existsSync(knowledgePath)) {
    await writeJsonAtomic(knowledgePath, { version: SCHEMA_VERSION, items: {} })
  }
  if (!existsSync(todosPath)) {
    await writeJsonAtomic(todosPath, { version: SCHEMA_VERSION, items: {} })
  }
  if (!existsSync(projectsPath)) {
    await writeJsonAtomic(projectsPath, { version: SCHEMA_VERSION, items: {} })
  }
  if (!existsSync(contextLogPath)) {
    await writeFile(contextLogPath, "", "utf8")
  }
  if (!existsSync(experiencesPath)) {
    await writeFile(experiencesPath, "", "utf8")
  }

  return {
    memoryDir,
    logsDir,
    stateDir,
    indexesDir,
    snapshotsDir,
    archiveDir,
    metaPath,
    knowledgePath,
    todosPath,
    projectsPath,
    contextLogPath,
    experiencesPath,
  }
}

export async function logEntry(memoryDir, input) {
  const paths = await ensureStore(memoryDir)
  const meta = await readJson(paths.metaPath, null)
  if (!meta) {
    throw new Error("Failed to read meta.json")
  }
  const createdAt = isoNow()
  const roundId = Number(meta.next_round_id || 1)
  const record = {
    round_id: roundId,
    summary: String(input.summary || "").trim(),
    agent: input.agent ?? null,
    project_path: input.projectPath ?? null,
    detail: input.detail ?? null,
    tags: normalizeTags(input.tags),
    knowledge_extracted: 0,
    created_at: createdAt,
  }
  if (!record.summary) {
    throw new Error("summary is required")
  }

  await appendNdjson(paths.contextLogPath, record)
  meta.next_round_id = roundId + 1
  meta.updated_at = createdAt
  await writeJsonAtomic(paths.metaPath, meta)

  return {
    ok: true,
    round_id: roundId,
    created_at: createdAt,
    record,
  }
}

export async function addExperience(memoryDir, input) {
  const paths = await ensureStore(memoryDir)
  const meta = await readJson(paths.metaPath, null)
  if (!meta) {
    throw new Error("Failed to read meta.json")
  }
  const createdAt = isoNow()
  const id = Number(meta.next_experience_id || 1)
  const record = {
    id,
    category: String(input.category || "").trim(),
    context: input.context ?? null,
    problem: input.problem ?? null,
    solution: input.solution ?? null,
    lesson: String(input.lesson || "").trim(),
    tags: normalizeTags(input.tags),
    project_path: input.projectPath ?? null,
    source_round_id:
      input.sourceRoundId === undefined || input.sourceRoundId === null
        ? null
        : Number(input.sourceRoundId),
    created_at: createdAt,
  }

  if (!record.category) {
    throw new Error("category is required")
  }
  if (!record.lesson) {
    throw new Error("lesson is required")
  }

  await appendNdjson(paths.experiencesPath, record)
  meta.next_experience_id = id + 1
  meta.updated_at = createdAt
  await writeJsonAtomic(paths.metaPath, meta)

  return {
    ok: true,
    id,
    created_at: createdAt,
    record,
  }
}

export async function listKnowledge(memoryDir, input) {
  const paths = await ensureStore(memoryDir)
  const knowledge = await readJson(paths.knowledgePath, { version: SCHEMA_VERSION, items: {} })
  const agent = String(input.agent || "").trim()
  if (!agent) {
    throw new Error("agent is required")
  }

  const category = input.category ? String(input.category).trim() : null
  const limit = input.limit === undefined ? undefined : Number(input.limit)
  let items = Object.values(knowledge.items || {})
  items = items.filter((item) => item.agent === agent)
  if (category) {
    items = items.filter((item) => item.category === category)
  }
  items = sortKnowledge(items, input.sort || "priority_desc")
  if (limit !== undefined && Number.isFinite(limit) && limit >= 0) {
    items = items.slice(0, limit)
  }

  return {
    ok: true,
    items,
    count: items.length,
  }
}

export async function upsertKnowledge(memoryDir, input) {
  const paths = await ensureStore(memoryDir)
  const knowledge = await readJson(paths.knowledgePath, { version: SCHEMA_VERSION, items: {} })
  const agent = String(input.agent || "").trim()
  const category = String(input.category || "").trim()
  const title = String(input.title || "").trim()
  const content = String(input.content || "").trim()
  const project = input.project ?? null
  const priority = input.priority === undefined ? 0 : Number(input.priority)
  const timestamp = isoNow()

  if (!agent) throw new Error("agent is required")
  if (!category) throw new Error("category is required")
  if (!title) throw new Error("title is required")
  if (!content) throw new Error("content is required")

  const key = `${agent}::${category}::${title}`
  const existing = knowledge.items[key]
  const record = {
    id: existing?.id || key,
    agent,
    category,
    project,
    title,
    content,
    priority,
    updated_at: timestamp,
    created_at: existing?.created_at || timestamp,
  }
  knowledge.items[key] = record
  await writeJsonAtomic(paths.knowledgePath, knowledge)

  return {
    ok: true,
    key,
    record,
  }
}

export async function deleteKnowledge(memoryDir, input) {
  const paths = await ensureStore(memoryDir)
  const knowledge = await readJson(paths.knowledgePath, { version: SCHEMA_VERSION, items: {} })
  const agent = String(input.agent || "").trim()
  const category = String(input.category || "").trim()
  const title = String(input.title || "").trim()
  if (!agent) throw new Error("agent is required")
  if (!category) throw new Error("category is required")
  if (!title) throw new Error("title is required")

  const key = `${agent}::${category}::${title}`
  const existed = Boolean(knowledge.items[key])
  if (existed) {
    delete knowledge.items[key]
    await writeJsonAtomic(paths.knowledgePath, knowledge)
  }

  return {
    ok: true,
    key,
    deleted: existed,
  }
}

export async function listTodos(memoryDir, input = {}) {
  const paths = await ensureStore(memoryDir)
  const todos = await readJson(paths.todosPath, { version: SCHEMA_VERSION, items: {} })
  const status = input.status ? String(input.status).trim() : null
  const limit = input.limit === undefined ? undefined : Number(input.limit)
  let items = Object.values(todos.items || {})
  if (status) {
    items = items.filter((item) => item.status === status)
  }
  items = sortByUpdatedDesc(items)
  if (limit !== undefined && Number.isFinite(limit) && limit >= 0) {
    items = items.slice(0, limit)
  }
  return {
    ok: true,
    items,
    count: items.length,
  }
}

export async function upsertTodo(memoryDir, input) {
  const paths = await ensureStore(memoryDir)
  const todos = await readJson(paths.todosPath, { version: SCHEMA_VERSION, items: {} })
  const id = String(input.id || input.title || "").trim()
  const title = String(input.title || "").trim()
  const description = input.description ?? null
  const status = normalizeTodoStatus(input.status)
  const timestamp = isoNow()
  if (!id) throw new Error("id is required")
  if (!title) throw new Error("title is required")
  const existing = todos.items[id]
  const record = {
    id,
    title,
    description,
    status,
    created_at: existing?.created_at || timestamp,
    updated_at: timestamp,
  }
  todos.items[id] = record
  await writeJsonAtomic(paths.todosPath, todos)
  return {
    ok: true,
    record,
  }
}

export async function deleteTodo(memoryDir, input) {
  const paths = await ensureStore(memoryDir)
  const todos = await readJson(paths.todosPath, { version: SCHEMA_VERSION, items: {} })
  const id = String(input.id || "").trim()
  if (!id) throw new Error("id is required")
  const existed = Boolean(todos.items[id])
  if (existed) {
    delete todos.items[id]
    await writeJsonAtomic(paths.todosPath, todos)
  }
  return {
    ok: true,
    id,
    deleted: existed,
  }
}

export async function listProjects(memoryDir, input = {}) {
  const paths = await ensureStore(memoryDir)
  const projects = await readJson(paths.projectsPath, { version: SCHEMA_VERSION, items: {} })
  const status = input.status ? String(input.status).trim() : null
  const limit = input.limit === undefined ? undefined : Number(input.limit)
  let items = Object.values(projects.items || {})
  if (status) {
    items = items.filter((item) => item.status === status)
  }
  items = sortByUpdatedDesc(items)
  if (limit !== undefined && Number.isFinite(limit) && limit >= 0) {
    items = items.slice(0, limit)
  }
  return {
    ok: true,
    items,
    count: items.length,
  }
}

export async function upsertProject(memoryDir, input) {
  const paths = await ensureStore(memoryDir)
  const projects = await readJson(paths.projectsPath, { version: SCHEMA_VERSION, items: {} })
  const projectPath = String(input.path || "").trim()
  if (!projectPath) throw new Error("path is required")
  const timestamp = isoNow()
  const existing = projects.items[projectPath]
  const record = {
    path: projectPath,
    status: normalizeProjectStatus(input.status),
    tech_stack: input.techStack ?? existing?.tech_stack ?? null,
    description: input.description ?? existing?.description ?? null,
    created_at: existing?.created_at || timestamp,
    last_active: input.lastActive ?? timestamp,
    updated_at: timestamp,
  }
  projects.items[projectPath] = record
  await writeJsonAtomic(paths.projectsPath, projects)
  return {
    ok: true,
    record,
  }
}

export async function getProject(memoryDir, input) {
  const paths = await ensureStore(memoryDir)
  const projects = await readJson(paths.projectsPath, { version: SCHEMA_VERSION, items: {} })
  const projectPath = String(input.path || "").trim()
  if (!projectPath) throw new Error("path is required")
  const record = projects.items[projectPath] || null
  return {
    ok: true,
    item: record,
    found: Boolean(record),
  }
}

export async function searchLogs(memoryDir, input) {
  const paths = await ensureStore(memoryDir)
  const limit = input.limit === undefined ? undefined : Number(input.limit)
  let items = await readNdjson(paths.contextLogPath)
  items = items.filter((record) => includesText(record, input.text))
  items = items.filter((record) => matchesTags(record, input.tags))
  items = items.filter((record) => matchesAgent(record, input.agent))
  items = items.filter((record) => matchesTimeRange(record, input.since, input.until))
  items = items.filter((record) => {
    if (input.projectPath === undefined || input.projectPath === null || input.projectPath === "") {
      return true
    }
    return String(record.project_path || "") === String(input.projectPath)
  })
  items = items.filter((record) => matchesUnextracted(record, input.unextractedBit))
  items.sort((a, b) => Number(b.round_id || 0) - Number(a.round_id || 0))
  if (limit !== undefined && Number.isFinite(limit) && limit >= 0) {
    items = items.slice(0, limit)
  }
  return {
    ok: true,
    items,
    count: items.length,
  }
}

export async function markExtracted(memoryDir, input) {
  const paths = await ensureStore(memoryDir)
  const roundIds = Array.isArray(input.roundIds)
    ? input.roundIds.map((value) => Number(value)).filter(Number.isFinite)
    : String(input.roundIds || "")
        .split(",")
        .map((value) => Number(value.trim()))
        .filter(Number.isFinite)
  if (roundIds.length === 0) {
    throw new Error("round_ids is required")
  }
  const bit = String(input.bit || "").trim()
  const bitValue = bit === "knowledge" ? 1 : bit === "experience" ? 2 : null
  if (bitValue === null) {
    throw new Error("bit must be 'knowledge' or 'experience'")
  }

  const targetRounds = new Set(roundIds)
  const records = await readNdjson(paths.contextLogPath)
  let updated = 0
  const nextRecords = records.map((record) => {
    if (!targetRounds.has(Number(record.round_id))) return record
    const previous = Number(record.knowledge_extracted || 0)
    const next = previous | bitValue
    if (next !== previous) {
      updated += 1
    }
    return { ...record, knowledge_extracted: next }
  })

  await writeNdjsonAtomic(paths.contextLogPath, nextRecords)
  return {
    ok: true,
    updated,
    round_ids: roundIds,
    bit,
  }
}

export async function listExperiences(memoryDir, input = {}) {
  const paths = await ensureStore(memoryDir)
  const limit = input.limit === undefined ? undefined : Number(input.limit)
  let items = await readNdjson(paths.experiencesPath)
  if (input.category) {
    items = items.filter((item) => item.category === String(input.category))
  }
  if (input.tag) {
    const tag = String(input.tag)
    items = items.filter((item) => normalizeTags(item.tags).includes(tag))
  }
  items.sort((a, b) => Number(b.id || 0) - Number(a.id || 0))
  if (limit !== undefined && Number.isFinite(limit) && limit >= 0) {
    items = items.slice(0, limit)
  }
  return {
    ok: true,
    items,
    count: items.length,
  }
}

export async function deleteExperience(memoryDir, input) {
  const paths = await ensureStore(memoryDir)
  const id = Number(input.id)
  if (!Number.isFinite(id)) {
    throw new Error("id is required")
  }
  const experiences = await readNdjson(paths.experiencesPath)
  const nextExperiences = experiences.filter((item) => Number(item.id) !== id)
  const deleted = nextExperiences.length !== experiences.length
  if (deleted) {
    await writeNdjsonAtomic(paths.experiencesPath, nextExperiences)
  }
  return {
    ok: true,
    id,
    deleted,
  }
}

export async function coldStartLoad(memoryDir, input) {
  const knowledge = await listKnowledge(memoryDir, {
    agent: input.agent,
    category: input.category,
    limit: input.knowledgeLimit,
    sort: "priority_desc",
  })
  const recentUnextractedLogs = await searchLogs(memoryDir, {
    agent: input.agent,
    unextractedBit: input.unextractedBit || "knowledge",
    limit: input.logsLimit === undefined ? 20 : input.logsLimit,
  })
  const recentExperiences = await listExperiences(memoryDir, {
    limit: input.experiencesLimit === undefined ? 10 : input.experiencesLimit,
  })

  return {
    ok: true,
    knowledge: knowledge.items,
    recent_unextracted_logs: recentUnextractedLogs.items,
    recent_experiences: recentExperiences.items,
  }
}

export async function maintenanceScan(memoryDir, input = {}) {
  const knowledgeBitPending = input.knowledgeBitPending !== false
  const experienceBitPending = input.experienceBitPending !== false
  const limit = input.limit === undefined ? 50 : Number(input.limit)
  const safeLimit = Number.isFinite(limit) && limit >= 0 ? limit : 50

  let records = await readNdjson((await ensureStore(memoryDir)).contextLogPath)
  if (input.agent) {
    records = records.filter((record) => matchesAgent(record, input.agent))
  }
  if (input.projectPath) {
    records = records.filter((record) => String(record.project_path || "") === String(input.projectPath))
  }
  records = [...records].sort((a, b) => Number(a.round_id || 0) - Number(b.round_id || 0))

  const knowledgePending = knowledgeBitPending
    ? records.filter((record) => (Number(record.knowledge_extracted || 0) & 1) === 0).slice(0, safeLimit)
    : []
  const experiencePending = experienceBitPending
    ? records
        .filter((record) => {
          const bits = Number(record.knowledge_extracted || 0)
          return (bits & 1) === 1 && (bits & 2) === 0
        })
        .slice(0, safeLimit)
    : []

  return {
    ok: true,
    knowledge_pending: knowledgePending,
    experience_pending: experiencePending,
    counts: {
      knowledge_pending: knowledgePending.length,
      experience_pending: experiencePending.length,
    },
  }
}

export async function rebuildIndexes(memoryDir) {
  const paths = await ensureStore(memoryDir)
  const [contextLogs, knowledge, meta] = await Promise.all([
    readNdjson(paths.contextLogPath),
    readJson(paths.knowledgePath, { version: SCHEMA_VERSION, items: {} }),
    readJson(paths.metaPath, null),
  ])
  if (!meta) {
    throw new Error("Failed to read meta.json")
  }

  const contextIndexes = buildContextIndexes(contextLogs)
  const knowledgeItems = Object.values(knowledge.items || {})
  const knowledgeIndexes = buildKnowledgeIndexes(knowledgeItems)
  const timestamp = isoNow()

  await Promise.all([
    writeJsonAtomic(path.join(paths.indexesDir, "context_log.by_round.json"), {
      version: SCHEMA_VERSION,
      generated_at: timestamp,
      round_ids: contextIndexes.byRound,
    }),
    writeJsonAtomic(path.join(paths.indexesDir, "context_log.by_agent.json"), {
      version: SCHEMA_VERSION,
      generated_at: timestamp,
      agents: contextIndexes.byAgent,
    }),
    writeJsonAtomic(path.join(paths.indexesDir, "context_log.by_tag.json"), {
      version: SCHEMA_VERSION,
      generated_at: timestamp,
      tags: contextIndexes.byTag,
    }),
    writeJsonAtomic(path.join(paths.indexesDir, "context_log.unextracted.json"), {
      version: SCHEMA_VERSION,
      generated_at: timestamp,
      ...contextIndexes.unextracted,
    }),
    writeJsonAtomic(path.join(paths.indexesDir, "knowledge.by_agent.json"), {
      version: SCHEMA_VERSION,
      generated_at: timestamp,
      agents: knowledgeIndexes.byAgent,
    }),
    writeJsonAtomic(path.join(paths.indexesDir, "knowledge.by_agent_category.json"), {
      version: SCHEMA_VERSION,
      generated_at: timestamp,
      agents: knowledgeIndexes.byAgentCategory,
    }),
    writeJsonAtomic(path.join(paths.indexesDir, "knowledge.by_priority.json"), {
      version: SCHEMA_VERSION,
      generated_at: timestamp,
      ids: knowledgeIndexes.byPriority,
    }),
  ])

  meta.last_index_rebuild_at = timestamp
  meta.updated_at = timestamp
  await writeJsonAtomic(paths.metaPath, meta)

  return {
    ok: true,
    generated_at: timestamp,
    context_log_count: contextLogs.length,
    knowledge_count: knowledgeItems.length,
    index_files: [
      "context_log.by_round.json",
      "context_log.by_agent.json",
      "context_log.by_tag.json",
      "context_log.unextracted.json",
      "knowledge.by_agent.json",
      "knowledge.by_agent_category.json",
      "knowledge.by_priority.json",
    ],
  }
}

export async function compact(memoryDir, input = {}) {
  const paths = await ensureStore(memoryDir)
  const snapshotLimit =
    input.snapshotLimit === undefined ? 200 : Math.max(0, Number(input.snapshotLimit) || 0)
  const [contextLogs, experiences, knowledge, meta] = await Promise.all([
    readNdjson(paths.contextLogPath),
    readNdjson(paths.experiencesPath),
    readJson(paths.knowledgePath, { version: SCHEMA_VERSION, items: {} }),
    readJson(paths.metaPath, null),
  ])
  if (!meta) {
    throw new Error("Failed to read meta.json")
  }

  await writeNdjsonAtomic(paths.contextLogPath, contextLogs)
  await writeNdjsonAtomic(paths.experiencesPath, experiences)

  const rebuildResult = await rebuildIndexes(memoryDir)
  const timestamp = isoNow()
  const latestLogs = [...contextLogs]
    .sort((a, b) => Number(b.round_id || 0) - Number(a.round_id || 0))
    .slice(0, snapshotLimit)
  const latestExperiences = [...experiences]
    .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))
    .slice(0, Math.min(snapshotLimit, 50))
  const knowledgeItems = Object.values(knowledge.items || {})
  const snapshot = {
    version: SCHEMA_VERSION,
    generated_at: timestamp,
    counts: {
      context_logs: contextLogs.length,
      experiences: experiences.length,
      knowledge: knowledgeItems.length,
    },
    latest_round_id:
      contextLogs.length === 0
        ? null
        : Math.max(...contextLogs.map((record) => Number(record.round_id || 0))),
    latest_logs: latestLogs,
    latest_experiences: latestExperiences,
    knowledge_summary: knowledgeItems
      .slice()
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
      .slice(0, 50),
  }

  await writeJsonAtomic(path.join(paths.snapshotsDir, "context_log.snapshot.json"), snapshot)
  await writeJsonAtomic(path.join(paths.archiveDir, `compacted-${timestamp.replace(/[:.]/g, "-")}.json`), {
    version: SCHEMA_VERSION,
    compacted_at: timestamp,
    snapshot_limit: snapshotLimit,
    context_log_count: contextLogs.length,
    experience_count: experiences.length,
    knowledge_count: knowledgeItems.length,
  })

  meta.last_compaction_at = timestamp
  meta.updated_at = timestamp
  await writeJsonAtomic(paths.metaPath, meta)

  return {
    ok: true,
    compacted_at: timestamp,
    snapshot_limit: snapshotLimit,
    context_log_count: contextLogs.length,
    experience_count: experiences.length,
    knowledge_count: knowledgeItems.length,
    rebuilt_indexes_at: rebuildResult.generated_at,
  }
}

export async function health(memoryDir) {
  const paths = await ensureStore(memoryDir)
  const [meta, knowledge, todos, projects, contextLogs, experiences] = await Promise.all([
    readJson(paths.metaPath, null),
    readJson(paths.knowledgePath, { version: SCHEMA_VERSION, items: {} }),
    readJson(paths.todosPath, { version: SCHEMA_VERSION, items: {} }),
    readJson(paths.projectsPath, { version: SCHEMA_VERSION, items: {} }),
    readNdjson(paths.contextLogPath),
    readNdjson(paths.experiencesPath),
  ])
  const indexFiles = [
    "context_log.by_round.json",
    "context_log.by_agent.json",
    "context_log.by_tag.json",
    "context_log.unextracted.json",
    "knowledge.by_agent.json",
    "knowledge.by_agent_category.json",
    "knowledge.by_priority.json",
  ]
  const indexStatus = Object.fromEntries(
    indexFiles.map((name) => [name, existsSync(path.join(paths.indexesDir, name))]),
  )
  return {
    ok: true,
    memory_dir: memoryDir,
    schema_version: meta?.schema_version ?? null,
    counts: {
      context_logs: contextLogs.length,
      experiences: experiences.length,
      knowledge: Object.keys(knowledge.items || {}).length,
      todos: Object.keys(todos.items || {}).length,
      projects: Object.keys(projects.items || {}).length,
    },
    meta: {
      next_round_id: meta?.next_round_id ?? null,
      next_experience_id: meta?.next_experience_id ?? null,
      last_index_rebuild_at: meta?.last_index_rebuild_at ?? null,
      last_compaction_at: meta?.last_compaction_at ?? null,
      last_maintenance_at: meta?.last_maintenance_at ?? null,
    },
    indexes: indexStatus,
  }
}

export async function importLegacyDb(memoryDir, input = {}) {
  const paths = await ensureStore(memoryDir)
  const [contextLogs, experiences, knowledge, todos, projects] = await Promise.all([
    readNdjson(paths.contextLogPath),
    readNdjson(paths.experiencesPath),
    readJson(paths.knowledgePath, { version: SCHEMA_VERSION, items: {} }),
    readJson(paths.todosPath, { version: SCHEMA_VERSION, items: {} }),
    readJson(paths.projectsPath, { version: SCHEMA_VERSION, items: {} }),
  ])

  if (
    !input.overwrite &&
    !isStoreEmpty({
      contextLogs,
      experiences,
      knowledgeItems: Object.values(knowledge.items || {}),
      todoItems: Object.values(todos.items || {}),
      projectItems: Object.values(projects.items || {}),
    })
  ) {
    throw new Error(
      "target memory store is not empty; use overwrite=true or import into a fresh directory",
    )
  }

  const projectDir = path.resolve(input.projectDir || process.cwd())
  const sourceDb = input.sourceDb ? path.resolve(input.sourceDb) : undefined

  const contextRows = parseLegacyTable(
    runLegacyAnaDbQuery(
      projectDir,
      "SELECT round_id, summary, project_path, detail, tags, knowledge_extracted, created_at FROM context_log ORDER BY round_id ASC",
      sourceDb,
    ),
  )
  const knowledgeRows = parseLegacyTable(
    runLegacyAnaDbQuery(
      projectDir,
      "SELECT id, agent, category, project, title, content, priority, updated_at, created_at FROM knowledge ORDER BY priority DESC, updated_at DESC",
      sourceDb,
    ),
  )
  const experienceRows = parseLegacyTable(
    runLegacyAnaDbQuery(
      projectDir,
      "SELECT id, category, context, problem, solution, lesson, tags, project_path, source_round_id, created_at FROM experiences ORDER BY id ASC",
      sourceDb,
    ),
  )
  const todoRows = parseLegacyTable(
    runLegacyAnaDbQuery(
      projectDir,
      "SELECT id, title, description, status, created_at FROM todos ORDER BY created_at ASC",
      sourceDb,
    ),
  )
  const projectRows = parseLegacyTable(
    runLegacyAnaDbQuery(
      projectDir,
      "SELECT path, status, tech_stack, description, created_at, last_active FROM projects ORDER BY created_at ASC",
      sourceDb,
    ),
  )

  const importedContextLogs = contextRows.map(mapLegacyContextLogRow)
  const importedExperiences = experienceRows.map(mapLegacyExperienceRow)
  const importedKnowledge = mapLegacyKnowledgeRows(knowledgeRows)
  const importedTodos = mapLegacyTodoRows(todoRows)
  const importedProjects = mapLegacyProjectRows(projectRows)

  const highestRoundId = importedContextLogs.reduce(
    (max, row) => Math.max(max, Number(row.round_id || 0)),
    0,
  )
  const highestExperienceId = importedExperiences.reduce(
    (max, row) => Math.max(max, Number(row.id || 0)),
    0,
  )
  const timestamp = isoNow()

  await writeNdjsonAtomic(paths.contextLogPath, importedContextLogs)
  await writeNdjsonAtomic(paths.experiencesPath, importedExperiences)
  await writeJsonAtomic(paths.knowledgePath, importedKnowledge)
  await writeJsonAtomic(paths.todosPath, importedTodos)
  await writeJsonAtomic(paths.projectsPath, importedProjects)
  await writeJsonAtomic(paths.metaPath, {
    schema_version: SCHEMA_VERSION,
    next_round_id: highestRoundId + 1,
    next_experience_id: highestExperienceId + 1,
    last_compaction_at: null,
    last_index_rebuild_at: null,
    last_maintenance_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    imported_from_legacy_at: timestamp,
    imported_from_legacy_db: sourceDb || path.join(projectDir, "ana.db"),
  })

  const rebuild = await rebuildIndexes(memoryDir)

  return {
    ok: true,
    imported_at: timestamp,
    source_db: sourceDb || path.join(projectDir, "ana.db"),
    counts: {
      context_logs: importedContextLogs.length,
      experiences: importedExperiences.length,
      knowledge: Object.keys(importedKnowledge.items || {}).length,
      todos: Object.keys(importedTodos.items || {}).length,
      projects: Object.keys(importedProjects.items || {}).length,
    },
    rebuilt_indexes_at: rebuild.generated_at,
  }
}
