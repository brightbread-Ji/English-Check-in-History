import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

const port = Number(process.env.PORT ?? 8787)
const dbPath = path.resolve(projectRoot, process.env.SYNC_DB_PATH ?? 'data/english-learning.sqlite')
const syncToken = process.env.SYNC_TOKEN ?? ''
const corsOrigin = process.env.SYNC_CORS_ORIGIN ?? '*'
const maxBodyBytes = Number(process.env.SYNC_MAX_BODY_BYTES ?? 10 * 1024 * 1024)
const distDir = path.resolve(projectRoot, process.env.STATIC_DIR ?? 'dist')

mkdirSync(path.dirname(dbPath), { recursive: true })

const database = new DatabaseSync(dbPath)
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS datasets (
    dataset_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS resources (
    dataset_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    abilities_json TEXT NOT NULL,
    default_minutes INTEGER NOT NULL,
    enabled INTEGER NOT NULL,
    color TEXT NOT NULL,
    notes TEXT,
    PRIMARY KEY (dataset_id, id),
    FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS schedules (
    dataset_id TEXT NOT NULL,
    id TEXT NOT NULL,
    weekday INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    minutes INTEGER NOT NULL,
    enabled INTEGER NOT NULL,
    PRIMARY KEY (dataset_id, id),
    FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS plan_items (
    dataset_id TEXT NOT NULL,
    id TEXT NOT NULL,
    date TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    planned_minutes INTEGER NOT NULL,
    status TEXT NOT NULL,
    source TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    generated_at TEXT NOT NULL,
    PRIMARY KEY (dataset_id, id),
    FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sessions (
    dataset_id TEXT NOT NULL,
    id TEXT NOT NULL,
    date TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    ability TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    minutes INTEGER NOT NULL,
    note TEXT NOT NULL,
    plan_item_id TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (dataset_id, id),
    FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    dataset_id TEXT PRIMARY KEY,
    child_name TEXT NOT NULL,
    child_age_years INTEGER,
    child_birth_year INTEGER NOT NULL,
    child_birth_month INTEGER NOT NULL,
    child_avatar_id TEXT NOT NULL,
    child_avatar_data_url TEXT,
    daily_intensity TEXT NOT NULL,
    target_min_minutes INTEGER NOT NULL,
    target_max_minutes INTEGER NOT NULL,
    FOREIGN KEY (dataset_id) REFERENCES datasets(dataset_id) ON DELETE CASCADE
  );
`)

const statements = {
  getDatasetMeta: database.prepare('SELECT dataset_id, revision, updated_at FROM datasets WHERE dataset_id = ?'),
  upsertDataset: database.prepare(`
    INSERT INTO datasets (dataset_id, revision, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(dataset_id) DO UPDATE SET
      revision = excluded.revision,
      updated_at = excluded.updated_at
  `),
  getResources: database.prepare(`
    SELECT * FROM resources WHERE dataset_id = ? ORDER BY name COLLATE NOCASE, id
  `),
  getSchedules: database.prepare(`
    SELECT * FROM schedules WHERE dataset_id = ? ORDER BY weekday, start_time, id
  `),
  getPlanItems: database.prepare(`
    SELECT * FROM plan_items WHERE dataset_id = ? ORDER BY date, sort_order, id
  `),
  getSessions: database.prepare(`
    SELECT * FROM sessions WHERE dataset_id = ? ORDER BY date, start_time, created_at, id
  `),
  getSettings: database.prepare('SELECT * FROM settings WHERE dataset_id = ?'),
  deleteResources: database.prepare('DELETE FROM resources WHERE dataset_id = ?'),
  deleteSchedules: database.prepare('DELETE FROM schedules WHERE dataset_id = ?'),
  deletePlanItems: database.prepare('DELETE FROM plan_items WHERE dataset_id = ?'),
  deleteSessions: database.prepare('DELETE FROM sessions WHERE dataset_id = ?'),
  deleteSettings: database.prepare('DELETE FROM settings WHERE dataset_id = ?'),
  insertResource: database.prepare(`
    INSERT INTO resources
      (dataset_id, id, name, type, abilities_json, default_minutes, enabled, color, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  insertSchedule: database.prepare(`
    INSERT INTO schedules
      (dataset_id, id, weekday, start_time, resource_id, minutes, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  insertPlanItem: database.prepare(`
    INSERT INTO plan_items
      (dataset_id, id, date, resource_id, planned_minutes, status, source, sort_order, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  insertSession: database.prepare(`
    INSERT INTO sessions
      (dataset_id, id, date, resource_id, ability, start_time, end_time, minutes, note, plan_item_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  insertSettings: database.prepare(`
    INSERT INTO settings
      (
        dataset_id,
        child_name,
        child_age_years,
        child_birth_year,
        child_birth_month,
        child_avatar_id,
        child_avatar_data_url,
        daily_intensity,
        target_min_minutes,
        target_max_minutes
      )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message)
    this.statusCode = statusCode
  }
}

function asText(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function asBooleanInt(value) {
  return value ? 1 : 0
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(asText(value, '[]'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function normalizeDatasetId(rawDatasetId) {
  const datasetId = decodeURIComponent(rawDatasetId ?? '').trim()
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(datasetId)) {
    throw new HttpError(400, 'Invalid dataset id. Use 1-80 letters, numbers, dots, underscores, or dashes.')
  }
  return datasetId
}

function validatePayload(data) {
  if (!data || typeof data !== 'object') {
    throw new HttpError(400, 'Request body must include a data object.')
  }

  for (const key of ['resources', 'schedules', 'planItems', 'sessions']) {
    if (!Array.isArray(data[key])) {
      throw new HttpError(400, `data.${key} must be an array.`)
    }
  }

  if (!data.settings || typeof data.settings !== 'object') {
    throw new HttpError(400, 'data.settings must be an object.')
  }
}

function getDataset(datasetId) {
  const meta = statements.getDatasetMeta.get(datasetId)
  if (!meta) {
    return {
      datasetId,
      exists: false,
      revision: 0,
      updatedAt: null,
      data: null,
    }
  }

  const settings = statements.getSettings.get(datasetId)
  return {
    datasetId,
    exists: true,
    revision: Number(meta.revision),
    updatedAt: meta.updated_at,
    data: {
      resources: statements.getResources.all(datasetId).map((resource) => ({
        id: resource.id,
        name: resource.name,
        type: resource.type,
        abilities: parseJsonArray(resource.abilities_json),
        defaultMinutes: Number(resource.default_minutes),
        enabled: Boolean(resource.enabled),
        color: resource.color,
        notes: resource.notes ?? '',
      })),
      schedules: statements.getSchedules.all(datasetId).map((schedule) => ({
        id: schedule.id,
        weekday: Number(schedule.weekday),
        startTime: schedule.start_time,
        resourceId: schedule.resource_id,
        minutes: Number(schedule.minutes),
        enabled: Boolean(schedule.enabled),
      })),
      planItems: statements.getPlanItems.all(datasetId).map((plan) => ({
        id: plan.id,
        date: plan.date,
        resourceId: plan.resource_id,
        plannedMinutes: Number(plan.planned_minutes),
        status: plan.status,
        source: plan.source,
        order: Number(plan.sort_order),
        generatedAt: plan.generated_at,
      })),
      sessions: statements.getSessions.all(datasetId).map((session) => ({
        id: session.id,
        date: session.date,
        resourceId: session.resource_id,
        ability: session.ability,
        startTime: session.start_time,
        endTime: session.end_time,
        minutes: Number(session.minutes),
        note: session.note,
        planItemId: session.plan_item_id ?? undefined,
        createdAt: session.created_at,
      })),
      settings: {
        id: 'default',
        childName: settings?.child_name ?? '',
        childAgeYears: settings?.child_age_years ?? undefined,
        childBirthYear: Number(settings?.child_birth_year ?? 2021),
        childBirthMonth: Number(settings?.child_birth_month ?? 1),
        childAvatarId: settings?.child_avatar_id ?? 'rose-princess',
        childAvatarDataUrl: settings?.child_avatar_data_url ?? '',
        dailyIntensity: settings?.daily_intensity ?? 'standard',
        targetMinMinutes: Number(settings?.target_min_minutes ?? 45),
        targetMaxMinutes: Number(settings?.target_max_minutes ?? 75),
      },
    },
  }
}

function saveDataset(datasetId, data, expectedRevision, force) {
  validatePayload(data)

  const current = statements.getDatasetMeta.get(datasetId)
  const currentRevision = Number(current?.revision ?? 0)
  if (!force && expectedRevision !== undefined && Number(expectedRevision) !== currentRevision) {
    throw new HttpError(409, `Remote data changed. Current revision is ${currentRevision}.`)
  }

  const nextRevision = currentRevision + 1
  const updatedAt = new Date().toISOString()

  database.exec('BEGIN IMMEDIATE')
  try {
    statements.upsertDataset.run(datasetId, nextRevision, updatedAt)
    statements.deleteResources.run(datasetId)
    statements.deleteSchedules.run(datasetId)
    statements.deletePlanItems.run(datasetId)
    statements.deleteSessions.run(datasetId)
    statements.deleteSettings.run(datasetId)

    for (const resource of data.resources) {
      statements.insertResource.run(
        datasetId,
        asText(resource.id),
        asText(resource.name),
        asText(resource.type),
        JSON.stringify(Array.isArray(resource.abilities) ? resource.abilities : []),
        asNumber(resource.defaultMinutes),
        asBooleanInt(resource.enabled),
        asText(resource.color),
        asText(resource.notes),
      )
    }

    for (const schedule of data.schedules) {
      statements.insertSchedule.run(
        datasetId,
        asText(schedule.id),
        asNumber(schedule.weekday),
        asText(schedule.startTime),
        asText(schedule.resourceId),
        asNumber(schedule.minutes),
        asBooleanInt(schedule.enabled),
      )
    }

    for (const plan of data.planItems) {
      statements.insertPlanItem.run(
        datasetId,
        asText(plan.id),
        asText(plan.date),
        asText(plan.resourceId),
        asNumber(plan.plannedMinutes),
        asText(plan.status),
        asText(plan.source),
        asNumber(plan.order),
        asText(plan.generatedAt),
      )
    }

    for (const session of data.sessions) {
      statements.insertSession.run(
        datasetId,
        asText(session.id),
        asText(session.date),
        asText(session.resourceId),
        asText(session.ability),
        asText(session.startTime),
        asText(session.endTime),
        asNumber(session.minutes),
        asText(session.note),
        session.planItemId ? asText(session.planItemId) : null,
        asText(session.createdAt),
      )
    }

    statements.insertSettings.run(
      datasetId,
      asText(data.settings.childName),
      data.settings.childAgeYears ?? null,
      asNumber(data.settings.childBirthYear, 2021),
      asNumber(data.settings.childBirthMonth, 1),
      asText(data.settings.childAvatarId),
      asText(data.settings.childAvatarDataUrl),
      asText(data.settings.dailyIntensity, 'standard'),
      asNumber(data.settings.targetMinMinutes, 45),
      asNumber(data.settings.targetMaxMinutes, 75),
    )

    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }

  return {
    datasetId,
    exists: true,
    revision: nextRevision,
    updatedAt,
  }
}

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', corsOrigin)
  response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Sync-Token')
  response.setHeader('Vary', 'Origin')
}

function sendJson(response, statusCode, payload) {
  setCorsHeaders(response)
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(payload))
}

function isAuthorized(request) {
  if (!syncToken) {
    return true
  }

  const authorization = request.headers.authorization ?? ''
  const bearerToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : ''
  const headerToken = request.headers['x-sync-token']
  return bearerToken === syncToken || headerToken === syncToken
}

async function readJsonBody(request) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.byteLength
    if (size > maxBodyBytes) {
      throw new HttpError(413, 'Request body is too large.')
    }
    chunks.push(chunk)
  }

  if (chunks.length === 0) {
    return {}
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.')
  }
}

async function handleApi(request, response, url) {
  if (request.method === 'OPTIONS') {
    setCorsHeaders(response)
    response.writeHead(204)
    response.end()
    return
  }

  if (!isAuthorized(request)) {
    sendJson(response, 401, { error: 'Unauthorized' })
    return
  }

  if (url.pathname === '/api/health' && request.method === 'GET') {
    sendJson(response, 200, {
      ok: true,
      database: dbPath,
      authRequired: Boolean(syncToken),
    })
    return
  }

  const syncMatch = url.pathname.match(/^\/api\/sync\/([^/]+)$/)
  if (!syncMatch) {
    sendJson(response, 404, { error: 'Not found' })
    return
  }

  const datasetId = normalizeDatasetId(syncMatch[1])
  if (request.method === 'GET') {
    sendJson(response, 200, getDataset(datasetId))
    return
  }

  if (request.method === 'PUT') {
    const body = await readJsonBody(request)
    const result = saveDataset(datasetId, body.data ?? body, body.expectedRevision, Boolean(body.force))
    sendJson(response, 200, result)
    return
  }

  sendJson(response, 405, { error: 'Method not allowed' })
}

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
])

async function sendStatic(request, response, url) {
  if (!existsSync(distDir)) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Frontend build not found. Run npm run build first, or use npm run dev for Vite.')
    return
  }

  const pathname = decodeURIComponent(url.pathname)
  const requestedPath = pathname === '/' ? '/index.html' : pathname
  let filePath = path.resolve(distDir, `.${requestedPath}`)

  if (!filePath.startsWith(`${distDir}${path.sep}`) && filePath !== distDir) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Forbidden')
    return
  }

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = path.resolve(distDir, 'index.html')
  }

  const ext = path.extname(filePath)
  response.writeHead(200, {
    'Content-Type': mimeTypes.get(ext) ?? 'application/octet-stream',
    'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  })
  response.end(await readFile(filePath))
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url)
      return
    }

    await sendStatic(request, response, url)
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500
    const message = error instanceof Error ? error.message : 'Internal server error'
    sendJson(response, statusCode, { error: message })
  }
})

server.listen(port, () => {
  console.log(`Sync server listening on http://127.0.0.1:${port}`)
  console.log(`SQLite database: ${dbPath}`)
  if (!syncToken) {
    console.log('SYNC_TOKEN is not set; API is open for local development.')
  }
})
