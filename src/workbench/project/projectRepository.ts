import {
  workbenchProjectRecordSchema,
  type WorkbenchProjectPayload,
  type WorkbenchProjectRecordV1,
  type WorkbenchProjectSummary,
} from './projectRecordSchema'
import { assertWorkbenchProjectMediaUrlsPersistable } from './projectMediaMigration'
import { getDesktopBridge } from '../../desktop/bridge'
import { buildTemplateCategories, getProjectTemplate } from '../library/projectTemplates'
import { createDefaultWorkbenchDocument } from '../workbenchTypes'
import { createEmptyStoryboardPlan } from '../generationCanvas/agent/storyboardPlan'
import {
  PROJECT_BACKUP_INDEX_PREFIX,
  PROJECT_BACKUP_PREFIX,
  PROJECT_INDEX_KEY,
  PROJECT_RECORD_PREFIX,
  projectBackupIndexKey,
  projectBackupKey,
  projectRecordKey,
  projectRevisionBackupKey,
  readJson,
  readStorageKeys,
  removeStorageKey,
  writeJson,
} from './projectStorage'
import { readBackupIndex, rememberProjectBackup } from './projectBackup'
import {
  createProjectRecord,
  normalizePayload,
  normalizeRecord,
  normalizeSummary,
  seedDocFromMarkdown,
} from './projectNormalize'
import { deriveProjectCoverFromNodes, deriveProjectCoverFromRaw, type ProjectCover } from './projectCoverDerive'
import i18n, { getAppLocale } from '../../i18n'

// 重导出：实现已拆到 projectStorage（localStorage 原语 + 配额错误），
// 但 projectRepository 对外公共导出面保持不变。
export { ProjectStorageQuotaError } from './projectStorage'

function createProjectId(): string {
  return `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 新建项目的默认名。
 *
 * 为什么要**查一次现有项目**（2026-09-17，W-10）：名字只精确到分钟，同一分钟内建第二个
 * 就和第一个逐字相同。而项目卡上另外两格——缩略图（新项目都是同一张灰色占位）和状态行
 * （都是「刚刚 · 已就绪」）——**本来就该一样**，它们没有身份可言。于是名字是卡片上
 * 唯一能承载身份的那一格，它撞了就等于用户没有任何办法分辨哪个是哪个。
 *
 * 不改成「精确到秒」：秒对用户没有信息（他不会用秒去认项目），只是让每一张卡都变长。
 * 撞了才加序号，没撞就还是原来那个干净的名字——代价只落在真的撞了的那一次上。
 */
export function formatDefaultProjectName(existing: readonly WorkbenchProjectSummary[]): string {
  const time = new Date().toLocaleString(getAppLocale(), {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const base = i18n.t('runtime.project.untitledWithTime', { time })
  const taken = new Set(existing.map((summary) => summary.name))
  if (!taken.has(base)) return base
  for (let ordinal = 2; ordinal <= taken.size + 2; ordinal += 1) {
    const candidate = i18n.t('runtime.project.untitledWithTimeOrdinal', { time, ordinal })
    if (!taken.has(candidate)) return candidate
  }
  return base
}

function readIndex(): WorkbenchProjectSummary[] {
  const raw = readJson(PROJECT_INDEX_KEY)
  if (!Array.isArray(raw)) return []
  return raw
    .flatMap((item): WorkbenchProjectSummary[] => {
      const summary = normalizeSummary(item)
      return summary ? [summary] : []
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
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

/** 封面字段统一从现场派生的 ProjectCover 铺进 summary（imageUrls 才进 thumbnail 字段；视频兜底走 coverVideoUrl）。 */
function summaryCoverFields(cover: ProjectCover): Pick<WorkbenchProjectSummary, 'thumbnail' | 'thumbnailUrls' | 'coverVideoUrl'> {
  return {
    ...(cover.imageUrls.length ? { thumbnail: cover.imageUrls[0], thumbnailUrls: cover.imageUrls } : {}),
    ...(cover.videoUrl ? { coverVideoUrl: cover.videoUrl } : {}),
  }
}

export function listLocalProjects(): WorkbenchProjectSummary[] {
  const desktop = getDesktopBridge()
  if (desktop) {
    return (desktop.projects.list() as WorkbenchProjectSummary[]).sort((a, b) => b.updatedAt - a.updatedAt)
  }
  // 封面永远从 record 内容现场派生（与桌面 main list 同语义）；持久化 summary 里的缩略图
  // 字段只在 record 读不出来时兜底——避免陈旧封面 URL（尤其视频 url 混进 <img>）钉死在列表里。
  return readMergedProjectSummaries().map((summary) => {
    try {
      const raw = readJson(projectRecordKey(summary.id))
      if (raw) {
        const { thumbnail: _t, thumbnailUrls: _ts, ...rest } = summary
        return { ...rest, ...summaryCoverFields(deriveProjectCoverFromRaw(raw)) }
      }
    } catch {
      // ignore
    }
    return summary
  })
}

export function createLocalProject(
  name?: string,
  templateId?: string,
  options: { rootPath?: string; seedKey?: string } = {},
): WorkbenchProjectRecordV1 {
  const now = Date.now()
  const template = getProjectTemplate(templateId || null)
  // 草稿态：用户手动「新建空白」（无 seedKey 播种、无 rootPath 外部绑定）零编辑会被启动 GC 回收。
  // example（seedKey）/打开文件夹（rootPath）不打标记，永不被回收。
  const isDraft = !options.seedKey?.trim() && !options.rootPath?.trim()
  const summary: WorkbenchProjectSummary = {
    id: createProjectId(),
    name: typeof name === 'string' && name.trim() ? name.trim() : formatDefaultProjectName(readIndex()),
    createdAt: now,
    updatedAt: now,
    revision: 0,
    savedAt: now,
    ...(options.seedKey?.trim() ? { seedKey: options.seedKey.trim() } : {}),
    ...(isDraft ? { draft: true } : {}),
  }
  const docDefaults = createDefaultWorkbenchDocument()
  const seededDocument = template.seedDocument
    ? {
        ...docDefaults,
        contentJson: seedDocFromMarkdown(template.seedDocument),
        updatedAt: now,
      }
    : docDefaults
  const record = createProjectRecord(summary, {
    // Keep the starter attached to the seeded document so the editor can open
    // with its two empty structural rows.
    workbenchDocuments: [seededDocument],
    activeDocumentId: seededDocument.id,
    // A new blank project starts with two empty editable rows. This is
    // structural workspace state, not seeded user content: prompts and anchors
    // remain empty until the user or Agent supplies them.
    ...(isDraft
      ? {
          storyboardDesignsByDocumentId: {
            [seededDocument.id]: [{
              id: `starter-${seededDocument.id}`,
              documentId: seededDocument.id,
              title: createEmptyStoryboardPlan().title,
              plan: createEmptyStoryboardPlan(),
              committed: false,
              status: 'draft',
              sourceDocumentUpdatedAt: seededDocument.updatedAt,
              createdAt: now,
              updatedAt: now,
            }],
          },
        }
      : {}),
    categories: buildTemplateCategories(template),
  })
  const desktop = getDesktopBridge()
  if (desktop) {
    return desktop.projects.create(record) as WorkbenchProjectRecordV1
  }
  writeJson(projectRecordKey(summary.id), record)
  writeIndex([summary, ...readMergedProjectSummaries().filter((item) => item.id !== summary.id)])
  return record
}

export function readLocalProject(projectId: string): WorkbenchProjectRecordV1 | null {
  const id = String(projectId || '').trim()
  if (!id) return null
  const desktop = getDesktopBridge()
  if (desktop) {
    const record = desktop.projects.read(id)
    return record ? normalizeRecord(normalizeSummary(record) || (record as WorkbenchProjectSummary), record) : null
  }
  const summary = readMergedProjectSummaries().find((item) => item.id === id)
  if (!summary) return null
  const raw = readJson(projectRecordKey(id))
  if (!raw) {
    throw new Error(i18n.t('runtime.project.recordMissing', { id }))
  }
  return normalizeRecord(summary, raw)
}

export async function readLocalProjectAsync(projectId: string): Promise<WorkbenchProjectRecordV1 | null> {
  const id = String(projectId || '').trim()
  if (!id) return null
  const desktop = getDesktopBridge()
  if (desktop?.projects.readAsync) {
    const record = await desktop.projects.readAsync(id)
    return record ? normalizeRecord(normalizeSummary(record) || (record as WorkbenchProjectSummary), record) : null
  }
  return readLocalProject(id)
}

export async function saveLocalProject(
  projectId: string,
  state: WorkbenchProjectPayload,
  name?: string,
): Promise<WorkbenchProjectRecordV1> {
  const id = String(projectId || '').trim()
  if (!id) throw new Error('projectId is required')
  const desktop = getDesktopBridge()
  const now = Date.now()
  const existingRecord = desktop ? desktop.projects.read(id) : readJson(projectRecordKey(id))
  const existing = desktop
    ? normalizeSummary(existingRecord)
    : readMergedProjectSummaries().find((item) => item.id === id)
  const existingRevision = (() => {
    const parsed = workbenchProjectRecordSchema.safeParse(existingRecord)
    if (parsed.success && typeof parsed.data.revision === 'number') return parsed.data.revision
    return existing?.revision ?? 0
  })()
  // 封面 = 本次保存内容的现场派生（媒体类型分流）。刻意不沿用 existing 旧封面：
  // 「派生为空就 keep 旧值」会让陈旧 URL（换环境失效 / 视频 url 混 <img>）永远钉在列表里。
  const cover = deriveProjectCoverFromNodes(state.generationCanvas.nodes)
  const summary: WorkbenchProjectSummary = {
    id,
    name: typeof name === 'string' && name.trim() ? name.trim() : existing?.name || i18n.t('runtime.project.untitled'),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    revision: existingRevision + 1,
    savedAt: now,
    ...(existing?.thumbStyle ? { thumbStyle: existing.thumbStyle } : {}),
    ...(existing?.seedKey ? { seedKey: existing.seedKey } : {}),
    ...(cover.imageUrls.length ? { thumbnail: cover.imageUrls[0], thumbnailUrls: cover.imageUrls } : {}),
  }
  const payload = normalizePayload(state)
  const record: WorkbenchProjectRecordV1 = {
    ...summary,
    version: 1,
    payload,
  }
  assertWorkbenchProjectMediaUrlsPersistable(record)
  if (desktop) {
    return await desktop.projects.save(id, record) as WorkbenchProjectRecordV1
  }
  if (existingRecord) rememberProjectBackup(id, existingRecord)
  const nextIndex = [summary, ...readMergedProjectSummaries().filter((item) => item.id !== id)]
  writeJson(projectRecordKey(id), record)
  writeIndex(nextIndex)
  return record
}

/**
 * 只改项目名（列表页「双击改名」的后端）——不动 id/目录/画布/时间轴/分类/分镜方案。
 *
 * 关键：读盘上**完整 record** 再存回，**绝不经 saveLocalProject 的三部分窄接口**——那会让
 * normalizePayload（字段重建式）把 categories 重置为内置默认、丢掉 storyboardPlan（数据损坏，
 * 违反 never-wipe-user-data 铁律）。列表页改的是**任意项目**（可能没打开），更不能拿当前内存
 * 状态覆盖它。空名/未变 → no-op 返回原 record。
 */
export async function renameLocalProject(projectId: string, name: string): Promise<WorkbenchProjectRecordV1 | null> {
  const id = String(projectId || '').trim()
  if (!id) return null
  const record = readLocalProject(id)
  if (!record) return null
  const nextName = String(name || '').trim()
  if (!nextName || nextName === record.name) return record
  const now = Date.now()
  const next: WorkbenchProjectRecordV1 = {
    ...record,
    name: nextName,
    updatedAt: now,
    savedAt: now,
    revision: (record.revision ?? 0) + 1,
    // payload 原样保留（含 categories/storyboardPlan/画布/时间轴，零丢失）——只换 name 与时间戳。
  }
  assertWorkbenchProjectMediaUrlsPersistable(next)
  const desktop = getDesktopBridge()
  if (desktop) return await desktop.projects.save(id, next) as WorkbenchProjectRecordV1
  const existingRecord = readJson(projectRecordKey(id))
  if (existingRecord) rememberProjectBackup(id, existingRecord)
  writeJson(projectRecordKey(id), next)
  const summary = normalizeSummary(next) || (next as WorkbenchProjectSummary)
  writeIndex([summary, ...readMergedProjectSummaries().filter((item) => item.id !== id)])
  return next
}

export function deleteLocalProject(projectId: string): void {
  const id = String(projectId || '').trim()
  if (!id) throw new Error('projectId is required')
  const desktop = getDesktopBridge()
  if (desktop) {
    desktop.projects.delete(id)
  }
  removeStorageKey(projectRecordKey(id))
  removeStorageKey(projectBackupKey(id))
  for (const revision of readBackupIndex(id)) {
    removeStorageKey(projectRevisionBackupKey(id, revision))
  }
  removeStorageKey(projectBackupIndexKey(id))
  for (const key of readStorageKeys()) {
    if (key.startsWith(`${PROJECT_BACKUP_PREFIX}${id}:`) || key.startsWith(`${PROJECT_BACKUP_INDEX_PREFIX}${id}`)) {
      removeStorageKey(key)
    }
  }
  writeIndex(readMergedProjectSummaries().filter((item) => item.id !== id))
}
