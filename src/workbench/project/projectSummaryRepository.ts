import type { WorkbenchProjectSummary } from './projectRecordSchema'
import { getDesktopBridge } from '../../desktop/bridge'
import { timeStartupStep, timeStartupStepAsync } from '../../utils/startupDiagnostics'

const PROJECT_INDEX_KEY = 'tapcanvas-open-workbench-project-index-v1'
const PROJECT_RECORD_PREFIX = 'tapcanvas-open-workbench-project-v1:'

function readJson(key: string): unknown {
  if (typeof window === 'undefined') return null
  try {
    return JSON.parse(window.localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}

function readStorageKeys(): string[] {
  if (typeof window === 'undefined') return []
  return Array.from({ length: window.localStorage.length }, (_, index) =>
    window.localStorage.key(index),
  ).filter((key): key is string => typeof key === 'string')
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
    ...(typeof raw.revision === 'number' && Number.isInteger(raw.revision) && raw.revision >= 0
      ? { revision: raw.revision }
      : {}),
    ...(typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) ? { savedAt: raw.savedAt } : {}),
    ...(typeof raw.thumbStyle === 'string' && raw.thumbStyle.trim() ? { thumbStyle: raw.thumbStyle.trim() } : {}),
    ...(typeof raw.thumbnail === 'string' && raw.thumbnail.trim() ? { thumbnail: raw.thumbnail.trim() } : {}),
    ...(Array.isArray(raw.thumbnailUrls) && raw.thumbnailUrls.length
      ? { thumbnailUrls: raw.thumbnailUrls.filter((url): url is string => typeof url === 'string') }
      : {}),
  }
}

function extractThumbnailUrlsFromRaw(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return []
  const record = raw as Record<string, unknown>
  const payload = record.payload as Record<string, unknown> | undefined
  const generationCanvas = (payload?.generationCanvas ?? record.generationCanvas) as
    | Record<string, unknown>
    | undefined
  const nodes = generationCanvas?.nodes
  if (!Array.isArray(nodes)) return []
  const urls: string[] = []
  for (const node of nodes) {
    if (urls.length >= 4) break
    const result = (node as { result?: { url?: unknown; thumbnailUrl?: unknown } }).result
    const url = result?.url || result?.thumbnailUrl
    if (typeof url === 'string' && url.length > 4) urls.push(url)
  }
  return urls
}

function readIndex(): WorkbenchProjectSummary[] {
  const raw = readJson(PROJECT_INDEX_KEY)
  if (!Array.isArray(raw)) return []
  return raw
    .flatMap((item): WorkbenchProjectSummary[] => {
      const summary = normalizeSummary(item)
      return summary ? [summary] : []
    })
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

function readRecordSummaries(): WorkbenchProjectSummary[] {
  return readStorageKeys()
    .filter((key) => key.startsWith(PROJECT_RECORD_PREFIX))
    .flatMap((key): WorkbenchProjectSummary[] => {
      const raw = readJson(key)
      const summary = normalizeSummary(raw)
      return summary ? [summary] : []
    })
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

function readMergedProjectSummaries(): WorkbenchProjectSummary[] {
  const byId = new Map<string, WorkbenchProjectSummary>()
  for (const summary of readRecordSummaries()) byId.set(summary.id, summary)
  for (const summary of readIndex()) byId.set(summary.id, summary)
  return Array.from(byId.values()).sort((left, right) => right.updatedAt - left.updatedAt)
}

export function listLocalProjectSummaries(): WorkbenchProjectSummary[] {
  const desktop = getDesktopBridge()
  if (desktop) {
    return timeStartupStep(
      'desktop.projects.list',
      () =>
        (desktop.projects.list() as WorkbenchProjectSummary[]).sort(
          (left, right) => right.updatedAt - left.updatedAt,
        ),
    )
  }
  return readMergedProjectSummaries().map((summary) => {
    if (summary.thumbnailUrls?.length) return summary
    try {
      const raw = readJson(`${PROJECT_RECORD_PREFIX}${summary.id}`)
      const thumbnailUrls = extractThumbnailUrlsFromRaw(raw)
      if (thumbnailUrls.length) {
        return {
          ...summary,
          thumbnailUrls,
          thumbnail: thumbnailUrls[0],
        }
      }
    } catch {
      // ignore invalid thumbnail metadata while listing summaries
    }
    return summary
  })
}

export async function listLocalProjectSummariesAsync(): Promise<WorkbenchProjectSummary[]> {
  const desktop = getDesktopBridge()
  if (!desktop?.projects.listAsync) {
    return listLocalProjectSummaries()
  }
  return timeStartupStepAsync(
    'desktop.projects.listAsync',
    async () =>
      ((await desktop.projects.listAsync!()) as WorkbenchProjectSummary[]).sort(
        (left, right) => right.updatedAt - left.updatedAt,
      ),
  )
}
