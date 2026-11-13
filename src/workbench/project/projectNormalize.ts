import { normalizeTimeline } from '../timeline/timelineMath'
import { normalizeWorkbenchDocument } from '../workbenchPersistence'
import { createDefaultWorkbenchDocument, type StoryboardDesign, type WorkbenchDocument } from '../workbenchTypes'
import { logRendererWarn } from '../../desktop/rendererLog'
import {
  createDefaultWorkbenchProjectPayload,
  pendingAssetDeletionSchema,
  workbenchProjectPayloadSkeletonSchema,
  workbenchProjectRecordSchema,
  type WorkbenchProjectPayload,
  type WorkbenchProjectRecordLegacy,
  type WorkbenchProjectRecordV1,
  type WorkbenchProjectSummary,
} from './projectRecordSchema'
import { normalizeCategories, projectCategorySchema } from './projectCategories'
import { editingPanelLayoutSchema } from '../preview/panelLayout'
import { issuesOfZodError, storyboardDesignSchema, type SchemaFieldIssue } from '../creation/storyboard/storyboardDesignSchema'
import { storyboardDraftPlanSchema } from '../generationCanvas/agent/storyboardPlanSchema'
import { renumberStoryboardShots } from '../../../electron/shared/storyboard/storyboardSubjectIdentity'
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

// z.record 的键来自用户数据，不能进入诊断包；只记录 schema 字段和数组序号，不记录值/原文。
type SchemaIssue = { path: PropertyKey[]; unionErrors?: readonly { issues: readonly SchemaIssue[] }[] }
function issueFieldPaths(issues: readonly SchemaIssue[]): string {
  const records = new Set(['storyboardDesignsByDocumentId', 'params', 'referenceBindings', 'continuity'])
  const leaves = (items: readonly SchemaIssue[]): readonly SchemaIssue[] => items.flatMap(issue =>
    issue.unionErrors ? issue.unionErrors.flatMap(branch => leaves(branch.issues)) : [issue],
  )
  return leaves(issues).slice(0, 8).map(({ path }) => path.map((part, index) =>
    index > 0 && records.has(String(path[index - 1])) ? '*' : String(part),
  ).join('.') || '(root)').join('; ')
}

/**
 * 存盘 / 读盘时「这一项不合格、被隔离」的一条记录。`raw` 是原样内容（只进隔离区文件，**不进日志**）；
 * 日志和遥测只记 `field`（容器名 + 字段路径，记录键遮蔽）。
 */
export type QuarantinedItem = Readonly<{
  container: 'storyboardDesign' | 'category' | 'editingPanelLayout' | 'pendingAssetDeletion'
  /** 字段路径，只含 schema 字段名和数组序号：`plan.shots[2].durationSec`。 */
  field: string
  issues: readonly SchemaFieldIssue[]
  raw: unknown
  /** 分镜设计才有：界面那一句话要说「哪份分镜」（标题是用户内容，只用于界面，不进日志）。 */
  title?: string
  /** 沿用了盘上上一个版本（没有就不写这一项）。 */
  keptPreviousVersion: boolean
}>

/** 这条记录（存盘返回 / 读盘得到）里有哪几项被隔离：界面那一句话和隔离区文件读它。记录对象一变就没有，不进持久化。 */
const quarantineByRecord = new WeakMap<object, readonly QuarantinedItem[]>()
export function rememberQuarantine(record: object, items: readonly QuarantinedItem[]): void {
  if (items.length) quarantineByRecord.set(record, items)
}
export function quarantineOfRecord(record: object): readonly QuarantinedItem[] {
  return quarantineByRecord.get(record) ?? []
}

export type NormalizedPayload = Readonly<{ payload: WorkbenchProjectPayload; quarantined: readonly QuarantinedItem[] }>

const NORMALIZE_SLOW_LOG_MS = 50

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function itemTitle(raw: unknown): string | undefined {
  const title = asRecord(raw)?.title
  return typeof title === 'string' && title.trim() ? title.trim() : undefined
}

/** 盘上上一个版本里，同 id 且自己合格的那一份分镜设计（没有就 undefined）。 */
function previousDesignOf(previous: unknown, documentId: string, id: unknown): StoryboardDesign | undefined {
  if (typeof id !== 'string' || !id) return undefined
  const designs = asRecord(asRecord(previous)?.storyboardDesignsByDocumentId)?.[documentId]
  if (!Array.isArray(designs)) return undefined
  const found = designs.find(item => asRecord(item)?.id === id)
  const parsed = storyboardDesignSchema.safeParse(found)
  return parsed.success ? parsed.data as StoryboardDesign : undefined
}

/**
 * 持久化的唯一入口（存盘与读盘共用）。**结构骨架坏了才整份拒**（payload 不是对象、画布 nodes 不是数组…）；
 * 单项（一份分镜设计 / 一个分类 / 版式 / 一条待删素材）不合格只隔离那一项：
 *   · 分镜设计：沿用 `options.previous`（盘上上一个版本）里同 id 的那份，没有就不写这一项；
 *   · 原样内容随返回值交给调用方写进项目的隔离区；其余照存。
 * 写入口先挡住（store setter 用同一份草稿面校验），所以正常情况下 `quarantined` 恒为空。
 */
export function normalizePayloadWithQuarantine(input: unknown, options: { previous?: unknown } = {}): NormalizedPayload {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const result = normalizePayloadItems(input, options)
  const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt
  if (elapsed >= NORMALIZE_SLOW_LOG_MS) logRendererWarn('project-normalize-slow', { elapsedMs: Math.round(elapsed) })
  if (result.quarantined.length) {
    logRendererWarn('project-item-quarantined', {
      count: result.quarantined.length,
      fields: result.quarantined.slice(0, 8).map(item => `${item.container}.${item.field}`).join('; '),
    })
  }
  return result
}

export function normalizePayload(input: unknown, options: { previous?: unknown } = {}): WorkbenchProjectPayload {
  return normalizePayloadWithQuarantine(input, options).payload
}

function normalizePayloadItems(input: unknown, options: { previous?: unknown }): NormalizedPayload {
  const parsed = workbenchProjectPayloadSkeletonSchema.safeParse(input)
  if (!parsed.success) {
    logRendererWarn('project-payload-rejected', { issues: issueFieldPaths(parsed.error.issues) })
    throw new Error(i18n.t('runtime.project.corruptPayload'))
  }
  const quarantined: QuarantinedItem[] = []
  const quarantine = (container: QuarantinedItem['container'], raw: unknown, issues: readonly SchemaFieldIssue[], keptPreviousVersion = false): void => {
    quarantined.push({ container, field: issues[0]?.path ?? '(root)', issues, raw, keptPreviousVersion, ...(container === 'storyboardDesign' && itemTitle(raw) ? { title: itemTitle(raw) } : {}) })
  }
  const skeleton = parsed.data
  // 分镜设计：一项一项判。容器不是数组 → 这一篇原稿的整包进隔离区。
  let designsByDocument: Record<string, StoryboardDesign[]> | undefined
  if (skeleton.storyboardDesignsByDocumentId) {
    designsByDocument = {}
    for (const [documentId, list] of Object.entries(skeleton.storyboardDesignsByDocumentId)) {
      if (!Array.isArray(list)) { quarantine('storyboardDesign', list, [{ path: '(not-an-array)', problem: 'needs array of designs' }]); continue }
      const kept: StoryboardDesign[] = []
      for (const item of list) {
        const one = storyboardDesignSchema.safeParse(item)
        if (one.success) { kept.push(one.data as StoryboardDesign); continue }
        const previous = previousDesignOf(options.previous, documentId, asRecord(item)?.id)
        quarantine('storyboardDesign', item, issuesOfZodError(one.error.issues as never), Boolean(previous))
        if (previous) kept.push(previous)
      }
      designsByDocument[documentId] = kept
    }
  }
  const categories = skeleton.categories === undefined ? undefined : skeleton.categories.filter((item) => {
    const one = projectCategorySchema.safeParse(item)
    if (!one.success) quarantine('category', item, issuesOfZodError(one.error.issues as never))
    return one.success
  })
  const pendingAssetDeletions = skeleton.pendingAssetDeletions?.filter((item) => {
    const one = pendingAssetDeletionSchema.safeParse(item)
    if (!one.success) quarantine('pendingAssetDeletion', item, issuesOfZodError(one.error.issues as never))
    return one.success
  }) as WorkbenchProjectPayload['pendingAssetDeletions']
  let editingPanelLayout: WorkbenchProjectPayload['editingPanelLayout']
  if (skeleton.editingPanelLayout !== undefined) {
    const one = editingPanelLayoutSchema.safeParse(skeleton.editingPanelLayout)
    if (one.success) editingPanelLayout = one.data
    else {
      const previous = editingPanelLayoutSchema.safeParse(asRecord(options.previous)?.editingPanelLayout)
      quarantine('editingPanelLayout', skeleton.editingPanelLayout, issuesOfZodError(one.error.issues as never), previous.success)
      if (previous.success) editingPanelLayout = previous.data
    }
  }
  const payload = {
    ...skeleton,
    categories,
    pendingAssetDeletions,
    editingPanelLayout,
    storyboardDesignsByDocumentId: designsByDocument,
  }
  return { payload: buildPayload(payload, input), quarantined }
}

type ItemizedPayload = Omit<ReturnType<typeof workbenchProjectPayloadSkeletonSchema.parse>, 'categories' | 'pendingAssetDeletions' | 'editingPanelLayout' | 'storyboardDesignsByDocumentId'> & {
  categories: unknown[] | undefined
  pendingAssetDeletions: WorkbenchProjectPayload['pendingAssetDeletions']
  editingPanelLayout: WorkbenchProjectPayload['editingPanelLayout']
  storyboardDesignsByDocumentId: Record<string, StoryboardDesign[]> | undefined
}

function buildPayload(payload: ItemizedPayload, input: unknown): WorkbenchProjectPayload {
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
    ? withShotNumbersOnlyCountingShots(payload.storyboardDesignsByDocumentId)
    : (() => {
        const migrated: Record<string, StoryboardDesign[]> = {}
        // 迁移读不动一份旧方案时，用户失去的是整份分镜——那件事不许静默发生。schema 这一侧
        // 已经回到「剥离未知键」（见 storyboardDraftPlanSchema 头注释），所以走到这里只剩真正残缺的
        // 记录；至少把是谁、缺哪个字段留在控制台，别让它变成「打开项目分镜就没了」的谜。
        const reportUnreadablePlan = (_documentId: string, issues: readonly { path: PropertyKey[] }[]): void => {
          logRendererWarn('storyboard-plan-migration-skipped', { issues: issueFieldPaths(issues) })
        }
        const legacyEntries = legacyMap
          ? Object.entries(legacyMap).flatMap(([documentId, value]) => {
              if (!value || typeof value !== 'object') return []
              const entry = value as Record<string, unknown>
              const plan = storyboardDraftPlanSchema.safeParse(entry.plan)
              if (!plan.success) { reportUnreadablePlan(documentId, plan.error.issues); return [] }
              return [[documentId, { plan: plan.data, committed: entry.committed === true }] as const]
            })
          : (() => {
              if (raw[legacyPlanKey] === undefined) return []
              const plan = storyboardDraftPlanSchema.safeParse(raw[legacyPlanKey])
              if (!plan.success) { reportUnreadablePlan(activeDocumentId, plan.error.issues); return [] }
              return [[activeDocumentId, { plan: plan.data, committed: raw[legacyCommittedKey] === true }] as const]
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
    ...(payload.editingPanelLayout ? { editingPanelLayout: payload.editingPanelLayout } : {}),
    ...(payload.pendingAssetDeletions?.length ? { pendingAssetDeletions: payload.pendingAssetDeletions } : {}),
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

/**
 * 从原始 record 上取未经 zod 剥离的 payload；取不到就退回 undefined，让
 * normalizePayload 自己走「缺字段」的既有兜底（它第一步就 safeParse）。
 */
function readRawPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return undefined
  return (raw as { payload?: unknown }).payload
}

export function normalizeRecord(summary: WorkbenchProjectSummary, raw: unknown): WorkbenchProjectRecordV1 {
  const legacyParsed = workbenchProjectRecordSchema.safeParse(raw)
  if (legacyParsed.success) {
    const normalized = normalizePayloadWithQuarantine(readRawPayload(raw))
    const opened: WorkbenchProjectRecordV1 = {
      ...legacyParsed.data,
      // 迁移必须吃**原始** payload，不能吃 zod 解析后的那份：payload schema 是普通
      // z.object，会把它不认识的键默默剥掉——而已退役的那三个老键（见上面
      // legacyMapKey / legacyPlanKey / legacyCommittedKey 三处拼装）恰恰就不在 schema 里。
      // 喂解析后的那份，兼容读取就永远看不见它们：老项目的分镜方案打开即静默消失，
      // 随后任何一次自动保存会把它从盘上永久抹掉。
      // normalizePayload 自己第一步就重新 safeParse，喂原始值不会放宽任何校验。
      payload: normalized.payload,
    }
    rememberQuarantine(opened, normalized.quarantined)
    return opened
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
  const normalized = normalizePayloadWithQuarantine(legacy)
  const opened: WorkbenchProjectRecordV1 = { ...summary, version: 1, payload: normalized.payload }
  rememberQuarantine(opened, normalized.quarantined)
  return opened
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

/**
 * 读盘归位（2026-10-05）：分镜主体身份的唯一 owner 落地之前，Agent 建的方案把参考卡排进了镜号
 * （2 张参考卡 + 2 镜的方案，镜头行号是 03、04）。镜号只是「它在镜头里的位置」，镜头身份是 shotId，
 * 所以每一镜都有 shotId 的方案按位置归位成 1..N 不改任何身份（分镜表与画布节点按 shotId 绑定）。
 * 有镜头没 shotId 的（旧的手建方案，身份按镜号派生）一字不动——它们本来就是连续的，动了反而换身份。
 */
function withShotNumbersOnlyCountingShots(designs: Record<string, StoryboardDesign[]>): Record<string, StoryboardDesign[]> {
  return Object.fromEntries(Object.entries(designs).map(([documentId, list]) => [documentId, list.map((design) => {
    const shots = design.plan.shots
    if (!shots.every((shot) => typeof shot.shotId === 'string' && shot.shotId.trim())) return design
    const renumbered = renumberStoryboardShots(shots)
    return renumbered.every((shot, position) => shot === shots[position]) ? design : { ...design, plan: { ...design.plan, shots: renumbered } }
  })]))
}
