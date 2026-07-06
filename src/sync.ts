import type { AppSettings, PlanItem, Resource, StudySession, WeeklySchedule } from './types'

export type SyncData = {
  resources: Resource[]
  schedules: WeeklySchedule[]
  planItems: PlanItem[]
  sessions: StudySession[]
  settings: AppSettings
}

export type SyncConfig = {
  baseUrl: string
  datasetId: string
  token: string
}

export type RemoteSnapshot = {
  datasetId: string
  exists: boolean
  revision: number
  updatedAt: string | null
  data: SyncData | null
}

export type PushResult = {
  datasetId: string
  exists: boolean
  revision: number
  updatedAt: string
}

const storageKey = 'english-learning-sync-config'
const defaultConfig: SyncConfig = {
  baseUrl: import.meta.env.VITE_SYNC_API_URL ?? '',
  datasetId: 'default',
  token: '',
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, '')
}

function syncUrl(config: SyncConfig) {
  const baseUrl = normalizeBaseUrl(config.baseUrl)
  const datasetId = encodeURIComponent(config.datasetId.trim() || 'default')
  return `${baseUrl}/api/sync/${datasetId}`
}

function authHeaders(config: SyncConfig): Record<string, string> {
  const token = config.token.trim()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function readJsonResponse(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return response.json()
  }
  return { error: await response.text() }
}

export function loadSyncConfig(): SyncConfig {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) {
      return defaultConfig
    }
    const parsed = JSON.parse(raw) as Partial<SyncConfig>
    return {
      baseUrl: parsed.baseUrl ?? defaultConfig.baseUrl,
      datasetId: parsed.datasetId ?? defaultConfig.datasetId,
      token: parsed.token ?? defaultConfig.token,
    }
  } catch {
    return defaultConfig
  }
}

export function saveSyncConfig(config: SyncConfig) {
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      baseUrl: normalizeBaseUrl(config.baseUrl),
      datasetId: config.datasetId.trim() || 'default',
      token: config.token.trim(),
    }),
  )
}

export async function fetchRemoteData(config: SyncConfig): Promise<RemoteSnapshot> {
  const response = await fetch(syncUrl(config), {
    headers: authHeaders(config),
  })
  const body = await readJsonResponse(response)
  if (!response.ok) {
    throw new Error(body.error ?? '读取云端数据失败')
  }
  return body as RemoteSnapshot
}

export async function pushRemoteData(
  config: SyncConfig,
  data: SyncData,
  expectedRevision?: number,
): Promise<PushResult> {
  const response = await fetch(syncUrl(config), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(config),
    },
    body: JSON.stringify({ data, expectedRevision }),
  })
  const body = await readJsonResponse(response)
  if (!response.ok) {
    throw new Error(body.error ?? '上传云端数据失败')
  }
  return body as PushResult
}
