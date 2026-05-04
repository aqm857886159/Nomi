import { z } from 'zod'
import { normalizeTimeline } from '../timeline/timelineMath'
import type { TimelineState } from '../timeline/timelineTypes'
import { normalizeWorkbenchDocument } from '../workbenchPersistence'
import {
  createDefaultWorkbenchProjectPayload,
  workbenchProjectPayloadSchema,
  workbenchProjectRecordSchema,
  type WorkbenchProjectPayload,
  type WorkbenchProjectRecordLegacy,
  type WorkbenchProjectRecordV1,
  type WorkbenchProjectSummary,
} from './projectRecordSchema'
import type { GenerationCanvasNode, GenerationCanvasSnapshot } from '../generationCanvasV2/model/generationCanvasTypes'
import type { WorkbenchDocument } from '../workbenchTypes'
import { assertWorkbenchProjectMediaUrlsPersistable } from './projectMediaMigration'

function extractCanvasThumbnailUrls(nodes: GenerationCanvasNode[], max = 4): string[] {
  const urls: string[] = []
  for (const node of nodes) {
    if (urls.length >= max) break
    const url = node.result?.url || node.result?.thumbnailUrl
    if (typeof url === 'string' && url.length > 4) urls.push(url)
  }
  return urls
}

function extractThumbnailUrlsFromRaw(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return []
  const r = raw as Record<string, unknown>
  const payload = r.payload as Record<string, unknown> | undefined
  const gc = (payload?.generationCanvas ?? r.generationCanvas) as Record<string, unknown> | undefined
  const nodes = gc?.nodes
  if (!Array.isArray(nodes)) return []
  return extractCanvasThumbnailUrls(nodes as GenerationCanvasNode[])
}

const PROJECT_INDEX_KEY = 'tapcanvas-open-workbench-project-index-v1'
const PROJECT_RECORD_PREFIX = 'tapcanvas-open-workbench-project-v1:'
const PROJECT_BACKUP_PREFIX = 'tapcanvas-open-workbench-project-backup-v1:'
const PROJECT_BACKUP_INDEX_PREFIX = 'tapcanvas-open-workbench-project-backup-index-v1:'
const MAX_PROJECT_BACKUPS = 5

function readJson(key: string): unknown {
  if (typeof window === 'undefined') return null
  try {
    return JSON.parse(window.localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(value))
}

function projectRecordKey(projectId: string): string {
  return `${PROJECT_RECORD_PREFIX}${projectId}`
}

function projectBackupKey(projectId: string): string {
  return `${PROJECT_BACKUP_PREFIX}${projectId}:latest`
}

function projectRevisionBackupKey(projectId: string, revision: number): string {
  return `${PROJECT_BACKUP_PREFIX}${projectId}:r${revision}`
}

function projectBackupIndexKey(projectId: string): string {
  return `${PROJECT_BACKUP_INDEX_PREFIX}${projectId}`
}

function readStorageKeys(): string[] {
  if (typeof window === 'undefined') return []
  return Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
    .filter((key): key is string => typeof key === 'string')
}

function createProjectId(): string {
  return `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function formatDefaultProjectName(): string {
  return `未命名项目 ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
}

function normalizeSummary(input: unknown): WorkbenchProjectSummary | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '未命名项目'
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now()
  const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : updatedAt
  if (!id) return null
  return {
    id,
    name,
    updatedAt,
    createdAt,
    ...(typeof raw.revision === 'number' && Number.isInteger(raw.revision) && raw.revision >= 0 ? { revision: raw.revision } : {}),
    ...(typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) ? { savedAt: raw.savedAt } : {}),
    ...(raw.lastWriteSource === 'local' || raw.lastWriteSource === 'server' ? { lastWriteSource: raw.lastWriteSource } : {}),
    ...(typeof raw.thumbStyle === 'string' && raw.thumbStyle.trim() ? { thumbStyle: raw.thumbStyle.trim() } : {}),
    ...(typeof raw.thumbnail === 'string' && raw.thumbnail.trim() ? { thumbnail: raw.thumbnail.trim() } : {}),
    ...(Array.isArray(raw.thumbnailUrls) && raw.thumbnailUrls.length ? { thumbnailUrls: raw.thumbnailUrls.filter((u): u is string => typeof u === 'string') } : {}),
  }
}

function readIndex(): WorkbenchProjectSummary[] {
  const raw = readJson(PROJECT_INDEX_KEY)
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): WorkbenchProjectSummary[] => {
    const summary = normalizeSummary(item)
    return summary ? [summary] : []
  }).sort((a, b) => b.updatedAt - a.updatedAt)
}

function readRecordSummaries(): WorkbenchProjectSummary[] {
  return readStorageKeys()
    .filter((key) => key.startsWith(PROJECT_RECORD_PREFIX))
    .flatMap((key): WorkbenchProjectSummary[] => {
      const raw = readJson(key)
      const summary = normalizeSummary(raw)
      return summary ? [summary] : []
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

function readMergedProjectSummaries(): WorkbenchProjectSummary[] {
  const byId = new Map<string, WorkbenchProjectSummary>()
  for (const summary of readRecordSummaries()) byId.set(summary.id, summary)
  for (const summary of readIndex()) byId.set(summary.id, summary)
  return Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt)
}

function writeIndex(items: readonly WorkbenchProjectSummary[]): void {
  writeJson(PROJECT_INDEX_KEY, items)
}

function normalizeLegacyRecord(input: unknown): WorkbenchProjectRecordLegacy | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : null
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : null
  if (!id || !name || createdAt == null || updatedAt == null) return null
  return {
    id,
    name,
    createdAt,
    updatedAt,
    ...(typeof raw.thumbStyle === 'string' && raw.thumbStyle.trim() ? { thumbStyle: raw.thumbStyle.trim() } : {}),
    workbenchDocument: raw.workbenchDocument,
    timeline: raw.timeline,
    generationCanvas: raw.generationCanvas,
  }
}

function normalizePayload(input: unknown): WorkbenchProjectPayload {
  const parsed = workbenchProjectPayloadSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error('本地项目记录损坏：payload 缺少必要字段')
  }
  const payload = parsed.data
  return {
    workbenchDocument: normalizeWorkbenchDocument(payload.workbenchDocument),
    timeline: normalizeTimeline(payload.timeline),
    generationCanvas: payload.generationCanvas,
  }
}

function normalizeRecord(summary: WorkbenchProjectSummary, raw: unknown): WorkbenchProjectRecordV1 {
  const legacyParsed = workbenchProjectRecordSchema.safeParse(raw)
  if (legacyParsed.success) {
    return {
      ...legacyParsed.data,
      payload: normalizePayload(legacyParsed.data.payload),
    }
  }
  const legacy = normalizeLegacyRecord(raw)
  if (!legacy) {
    throw new Error(`本地项目记录损坏：${summary.id}`)
  }
  const payload = normalizePayload(legacy)
  return {
    ...summary,
    version: 1,
    payload,
  }
}

function createProjectRecord(summary: WorkbenchProjectSummary, payload?: Partial<WorkbenchProjectPayload>): WorkbenchProjectRecordV1 {
  return {
    ...summary,
    revision: summary.revision ?? 0,
    savedAt: summary.savedAt ?? summary.updatedAt,
    lastWriteSource: summary.lastWriteSource ?? 'local',
    version: 1,
    payload: {
      ...createDefaultWorkbenchProjectPayload(),
      ...(payload || {}),
    },
  }
}

function readBackupIndex(projectId: string): number[] {
  const raw = readJson(projectBackupIndexKey(projectId))
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is number => typeof item === 'number' && Number.isInteger(item) && item >= 0)
    .sort((a, b) => b - a)
}

function writeBackupIndex(projectId: string, revisions: readonly number[]): void {
  writeJson(projectBackupIndexKey(projectId), revisions)
}

function rememberProjectBackup(projectId: string, rawRecord: unknown): void {
  const parsed = workbenchProjectRecordSchema.safeParse(rawRecord)
  if (!parsed.success) {
    writeJson(projectBackupKey(projectId), rawRecord)
    return
  }
  const revision = parsed.data.revision ?? 0
  writeJson(projectBackupKey(projectId), rawRecord)
  writeJson(projectRevisionBackupKey(projectId, revision), rawRecord)
  const nextRevisions = [revision, ...readBackupIndex(projectId).filter((item) => item !== revision)]
    .slice(0, MAX_PROJECT_BACKUPS)
  writeBackupIndex(projectId, nextRevisions)
}

export function listLocalProjects(): WorkbenchProjectSummary[] {
  return readMergedProjectSummaries().map((summary) => {
    if (summary.thumbnailUrls?.length) return summary
    try {
      const raw = readJson(projectRecordKey(summary.id))
      const thumbnailUrls = extractThumbnailUrlsFromRaw(raw)
      if (thumbnailUrls.length) return { ...summary, thumbnailUrls, thumbnail: thumbnailUrls[0] }
    } catch {
      // ignore
    }
    return summary
  })
}

export function createLocalProject(name?: string): WorkbenchProjectRecordV1 {
  const now = Date.now()
  const summary: WorkbenchProjectSummary = {
    id: createProjectId(),
    name: typeof name === 'string' && name.trim() ? name.trim() : formatDefaultProjectName(),
    createdAt: now,
    updatedAt: now,
    revision: 0,
    savedAt: now,
    lastWriteSource: 'local',
  }
  const record = createProjectRecord(summary)
  writeJson(projectRecordKey(summary.id), record)
  writeIndex([summary, ...readMergedProjectSummaries().filter((item) => item.id !== summary.id)])
  return record
}

export function readLocalProject(projectId: string): WorkbenchProjectRecordV1 | null {
  const id = String(projectId || '').trim()
  if (!id) return null
  const summary = readMergedProjectSummaries().find((item) => item.id === id)
  if (!summary) return null
  const raw = readJson(projectRecordKey(id))
  if (!raw) {
    throw new Error(`本地项目记录缺失：${id}`)
  }
  return normalizeRecord(summary, raw)
}

export function saveLocalProject(
  projectId: string,
  state: {
    workbenchDocument: WorkbenchDocument
    timeline: TimelineState
    generationCanvas: GenerationCanvasSnapshot
  },
  name?: string,
): WorkbenchProjectRecordV1 {
  const id = String(projectId || '').trim()
  if (!id) throw new Error('projectId is required')
  const now = Date.now()
  const existing = readMergedProjectSummaries().find((item) => item.id === id)
  const existingRecord = readJson(projectRecordKey(id))
  const existingRevision = (() => {
    const parsed = workbenchProjectRecordSchema.safeParse(existingRecord)
    if (parsed.success && typeof parsed.data.revision === 'number') return parsed.data.revision
    return existing?.revision ?? 0
  })()
  const thumbnailUrls = extractCanvasThumbnailUrls(state.generationCanvas.nodes)
  const thumbnail = thumbnailUrls[0] || existing?.thumbnail
  const summary: WorkbenchProjectSummary = {
    id,
    name: typeof name === 'string' && name.trim() ? name.trim() : existing?.name || '未命名项目',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    revision: existingRevision + 1,
    savedAt: now,
    lastWriteSource: 'local',
    ...(existing?.thumbStyle ? { thumbStyle: existing.thumbStyle } : {}),
    ...(thumbnail ? { thumbnail } : {}),
    ...(thumbnailUrls.length ? { thumbnailUrls } : existing?.thumbnailUrls?.length ? { thumbnailUrls: existing.thumbnailUrls } : {}),
  }
  const payload = normalizePayload(state)
  const record: WorkbenchProjectRecordV1 = {
    ...summary,
    version: 1,
    payload,
  }
  assertWorkbenchProjectMediaUrlsPersistable(record)
  if (existingRecord) rememberProjectBackup(id, existingRecord)
  const nextIndex = [summary, ...readMergedProjectSummaries().filter((item) => item.id !== id)]
  writeJson(projectRecordKey(id), record)
  writeIndex(nextIndex)
  return record
}
