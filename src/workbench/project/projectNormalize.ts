import { normalizeTimeline } from '../timeline/timelineMath'
import { normalizeWorkbenchDocument } from '../workbenchPersistence'
import { createDefaultWorkbenchDocument, type StoryboardDesign, type WorkbenchDocument } from '../workbenchTypes'
import {
  createDefaultWorkbenchProjectPayload,
  workbenchProjectPayloadSchema,
  workbenchProjectRecordSchema,
  type WorkbenchProjectPayload,
  type WorkbenchProjectRecordLegacy,
  type WorkbenchProjectRecordV1,
  type WorkbenchProjectSummary,
} from './projectRecordSchema'
import { normalizeCategories } from './projectCategories'
import { storyboardPlanSchema } from '../generationCanvas/agent/storyboardPlanSchema'
import i18n from '../../i18n'

// 封面派生已收口到 ./projectCoverDerive（媒体类型分流版，2026-08-01）：
// 旧 extractCanvasThumbnailUrls / extractThumbnailUrlsFromRaw 对视频/音频结果也取 url 塞
// 进 <img>，纯导入视频项目封面必「加载失败」。派生真相源与 main 侧等价关系见那边头注释。

export function normalizeSummary(input: unknown): WorkbenchProjectSummary | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : i18n.t('runtime.project.untitled')
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
      ? {
          thumbnailUrls: raw.thumbnailUrls.filter((u): u is string => typeof u === 'string'),
        }
      : {}),
    ...(typeof raw.seedKey === 'string' && raw.seedKey.trim() ? { seedKey: raw.seedKey.trim() } : {}),
    ...(raw.source === 'native' || raw.source === 'folder' ? { source: raw.source } : {}),
    ...(typeof raw.rootPath === 'string' && raw.rootPath.trim()
      ? { rootPath: raw.rootPath.trim() }
      : typeof raw.lastKnownRootPath === 'string' && raw.lastKnownRootPath.trim()
        ? { rootPath: raw.lastKnownRootPath.trim() }
        : {}),
    ...(typeof raw.missing === 'boolean' ? { missing: raw.missing } : {}),
  }
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

export function normalizePayload(input: unknown): WorkbenchProjectPayload {
  const parsed = workbenchProjectPayloadSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(i18n.t('runtime.project.corruptPayload'))
  }
  const payload = parsed.data
  // P2 多文档迁移：优先读新字段 workbenchDocuments；老项目只有 workbenchDocument → 包装成单元素集合。
  const legacyDoc = payload.workbenchDocument
  const documents = Array.isArray(payload.workbenchDocuments) && payload.workbenchDocuments.length
    ? payload.workbenchDocuments
    : legacyDoc
      ? [legacyDoc]
      : [createDefaultWorkbenchDocument()]
  const activeId = payload.activeDocumentId
  const normalizedDocuments = documents.map(normalizeWorkbenchDocument)
  const firstDocumentId = normalizedDocuments[0].id
  const activeDocumentId = activeId && documents.some((d) => (d as WorkbenchDocument).id === activeId)
    ? activeId
    : firstDocumentId
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const legacyMapKey = ['storyboard', 'Plans'].join('')
  const legacyPlanKey = ['storyboard', 'Plan'].join('')
  const legacyCommittedKey = ['storyboard', 'Plan', 'Committed'].join('')
  const legacyMap = raw[legacyMapKey] && typeof raw[legacyMapKey] === 'object' ? raw[legacyMapKey] as Record<string, unknown> : undefined
  const owner = payload.storyboardDesignsByDocumentId
    ? payload.storyboardDesignsByDocumentId
    : (() => {
        const migrated: Record<string, StoryboardDesign[]> = {}
        const legacyEntries = legacyMap
          ? Object.entries(legacyMap).flatMap(([documentId, value]) => {
              if (!value || typeof value !== 'object') return []
              const entry = value as Record<string, unknown>
              const plan = storyboardPlanSchema.safeParse(entry.plan)
              if (!plan.success) return []
              return [[documentId, { plan: plan.data, committed: entry.committed === true }] as const]
            })
          : (() => {
              const plan = storyboardPlanSchema.safeParse(raw[legacyPlanKey])
              return plan.success ? [[activeDocumentId, { plan: plan.data, committed: raw[legacyCommittedKey] === true }] as const] : []
            })()
        for (const [documentId, entry] of legacyEntries) {
          const document = normalizedDocuments.find((item) => item.id === documentId)
          const now = Date.now()
          migrated[documentId] = [{
            id: `migrated-${documentId}`,
            documentId,
            title: entry.plan.title.trim(),
            plan: entry.plan,
            committed: entry.committed,
            status: entry.committed ? 'committed' : 'draft',
            sourceDocumentUpdatedAt: document?.updatedAt ?? now,
            createdAt: now,
            updatedAt: now,
          }]
        }
        return migrated
      })()
  return {
    workbenchDocuments: normalizedDocuments,
    activeDocumentId,
    timeline: normalizeTimeline(payload.timeline),
    generationCanvas: payload.generationCanvas,
    categories: normalizeCategories(payload.categories),
    generationCanvasLastSeq: payload.generationCanvasLastSeq,
    ...(Object.values(owner).some((designs) => designs.length > 0) ? { storyboardDesignsByDocumentId: owner } : {}),
  }
}

/**
 * True when the raw record carries any persisted creation content. A workspace
 * that was initialized by "打开文件夹" on an existing folder (but never saved)
 * has a minimal manifest payload (just `{ rootPath }`) and none of these fields.
 */
function recordHasPersistedContent(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  const rec = raw as Record<string, unknown>
  const containers: Array<Record<string, unknown> | undefined> = [
    rec,
    rec.payload && typeof rec.payload === 'object' ? (rec.payload as Record<string, unknown>) : undefined,
  ]
  return containers.some((container) =>
    Boolean(container && (container.workbenchDocument || container.timeline || container.generationCanvas)),
  )
}

export function normalizeRecord(summary: WorkbenchProjectSummary, raw: unknown): WorkbenchProjectRecordV1 {
  const legacyParsed = workbenchProjectRecordSchema.safeParse(raw)
  if (legacyParsed.success) {
    return {
      ...legacyParsed.data,
      payload: normalizePayload(legacyParsed.data.payload),
    }
  }
  // Freshly-initialized workspace (existing folder opened via "打开文件夹",
  // never saved): its manifest payload is minimal (just rootPath). Open it as
  // an empty project with default payload instead of throwing 记录损坏 and
  // failing to open silently.
  if (!recordHasPersistedContent(raw)) {
    return {
      ...summary,
      version: 1,
      payload: createDefaultWorkbenchProjectPayload(),
    }
  }
  const legacy = normalizeLegacyRecord(raw)
  if (!legacy) {
    throw new Error(i18n.t('runtime.project.corruptRecord', { id: summary.id }))
  }
  const payload = normalizePayload(legacy)
  return {
    ...summary,
    version: 1,
    payload,
  }
}

export function createProjectRecord(
  summary: WorkbenchProjectSummary,
  payload?: Partial<WorkbenchProjectPayload>,
): WorkbenchProjectRecordV1 {
  return {
    ...summary,
    revision: summary.revision ?? 0,
    savedAt: summary.savedAt ?? summary.updatedAt,
    version: 1,
    payload: {
      ...createDefaultWorkbenchProjectPayload(),
      ...(payload || {}),
    },
  }
}

export function seedDocFromMarkdown(markdown: string): unknown {
  const lines = markdown.split(/\r?\n/)
  const blocks: Array<Record<string, unknown>> = []
  for (const line of lines) {
    const trimmed = line.replace(/\s+$/, '')
    if (!trimmed) continue
    if (trimmed.startsWith('# ')) {
      blocks.push({
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: trimmed.slice(2) }],
      })
    } else if (trimmed.startsWith('## ')) {
      blocks.push({
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: trimmed.slice(3) }],
      })
    } else {
      blocks.push({
        type: 'paragraph',
        content: [{ type: 'text', text: trimmed }],
      })
    }
  }
  return { type: 'doc', content: blocks }
}
