import { unwrapIpcResult } from '../../../electron/shared/contracts/ipcResult'
import { sameProjectAgentBinding, type ProjectBinding } from '../../../electron/shared/projectBinding'
import type { ProjectDeleteIntent } from '../../../electron/shared/projectDeleteIntent'
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
import { writeQuarantineSidecar, type QuarantineFile } from './projectQuarantineSidecar'
import { logRendererWarn } from '../../desktop/rendererLog'
import { readBackupIndex, rememberProjectBackup } from './projectBackup'
import {
  createProjectRecord,
  normalizePayloadWithQuarantine,
  quarantineOfRecord,
  rememberQuarantine,
  normalizeRecord,
  type QuarantinedItem,
  normalizeSummary,
  seedDocFromMarkdown,
} from './projectNormalize'
import { deriveProjectCoverFromNodes, deriveProjectCoverFromRaw, type ProjectCover } from './projectCoverDerive'
import i18n, { getAppLocale } from '../../i18n'
import { invalidateAllProjectAssets } from '../assets/useAllProjectAssets'

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

/**
 * 项目列表摘要的唯一读面（异步）。桌面端走主进程的异步摘要读口，渲染层不再 sendSync 干等主进程扫完全库。
 * 浏览器预览（无桌面桥）读 localStorage，同样以 Promise 返回，调用方只有一种写法。
 */
export async function listLocalProjects(): Promise<WorkbenchProjectSummary[]> {
  const desktop = getDesktopBridge()
  if (desktop) {
    return ((await desktop.projects.listAsync()) as WorkbenchProjectSummary[]).sort((a, b) => b.updatedAt - a.updatedAt)
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
  // 草稿态：用户手动「新建空白」（无 seedKey 播种、无 rootPath 外部绑定）。列表照常返回它；零编辑空壳的整理并进「离开只写欠着的」那条线（2026-10-22）。
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
    return record ? holdQuarantined(id, normalizeRecord(normalizeSummary(record) || (record as WorkbenchProjectSummary), record)) : null
  }
  const summary = readMergedProjectSummaries().find((item) => item.id === id)
  if (!summary) return null
  const raw = readJson(projectRecordKey(id))
  if (!raw) {
    throw new Error(i18n.t('runtime.project.recordMissing', { id }))
  }
  return holdQuarantined(id, normalizeRecord(summary, raw))
}

/**
 * 被隔离的项「这份内容是不是已经另存成了」和「是不是还没告诉创作者」——都按项目 id 记，不进持久化。
 *   · unstashedByProject：打开 / 读盘时被隔离、还没另存成的项。任何一次覆盖项目文件之前必须先把它们写进隔离区，
 *     写不成就抛、这次不覆盖（那一项盘上还在）。这样凡是「读进来再整份写回」的路（打开后自动保存、删素材、运行结局落盘）
 *     都先过这一关，不靠每个调用方自己记得。
 *   · unannouncedByProject：等界面拿走说一次的项。保存时只算新另存的（同一份内容早已在隔离区的不算）；
 *     打开时项目文件里还带着它的，本次会话第一次打开就算（见 announcedOpenThisSession）。
 */
type HeldItem = Readonly<{ item: QuarantinedItem; origin: 'open' | 'save' }>
export type QuarantineNoticeItem = HeldItem & Readonly<{ relativePath: string }>
const unstashedByProject = new Map<string, readonly HeldItem[]>()
const unannouncedByProject = new Map<string, readonly QuarantineNoticeItem[]>()
/** 本次会话里打开时已经说过的隔离文件（按项目）。只在内存里：关掉 Nomi 再开，同一个带坏项的项目会再说一次。 */
const announcedOpenThisSession = new Map<string, Set<string>>()

/** 界面取走这个项目还没说过的那几项（取一次就清）。同一项、同一份内容只会出现一次。 */
export function takeQuarantineNotice(projectId: string): readonly QuarantineNoticeItem[] {
  const items = unannouncedByProject.get(projectId) ?? []
  unannouncedByProject.delete(projectId)
  return items
}

/** 读盘逐项判出来的不合格项，一律先记成「欠着」：凡是读进来再写回的路，写回前都得先把它们另存成。 */
function holdQuarantined(projectId: string, opened: WorkbenchProjectRecordV1): WorkbenchProjectRecordV1 {
  const held = quarantineOfRecord(opened)
  if (held.length) unstashedByProject.set(projectId, held.map((item) => ({ item, origin: 'open' as const })))
  return opened
}

async function stashQuarantineBeforeWrite(projectId: string, fresh: readonly QuarantinedItem[]): Promise<void> {
  const held: HeldItem[] = [...(unstashedByProject.get(projectId) ?? []), ...fresh.map((item) => ({ item, origin: 'save' as const }))]
  if (!held.length) return
  const files: readonly QuarantineFile[] = await writeQuarantineSidecar(projectId, held.map(({ item }) => item))
  unstashedByProject.delete(projectId)
  const seen = announcedOpenThisSession.get(projectId) ?? new Set<string>()
  announcedOpenThisSession.set(projectId, seen)
  const announce = held.flatMap((entry, index): QuarantineNoticeItem[] => {
    const file = files[index]
    if (!file) return []
    // 保存时：只说新另存的（同一份内容盘上已有就不再说，跨会话也不说）。
    // 打开时：盘上的项目文件里还带着它，每次重开都要让创作者知道；同一次会话里只说一次。
    const tell = file.fresh || (entry.origin === 'open' && !seen.has(file.relativePath))
    if (entry.origin === 'open') seen.add(file.relativePath)
    return tell ? [{ ...entry, relativePath: file.relativePath }] : []
  })
  if (announce.length) unannouncedByProject.set(projectId, [...(unannouncedByProject.get(projectId) ?? []), ...announce])
}

export async function readLocalProjectAsync(projectId: string): Promise<WorkbenchProjectRecordV1 | null> {
  const id = String(projectId || '').trim()
  if (!id) return null
  const desktop = getDesktopBridge()
  let opened: WorkbenchProjectRecordV1 | null
  if (desktop?.projects.readAsync) {
    const raw = await desktop.projects.readAsync(id)
    opened = raw ? holdQuarantined(id, normalizeRecord(normalizeSummary(raw) || (raw as WorkbenchProjectSummary), raw)) : null
  } else {
    opened = readLocalProject(id)
  }
  // 盘上已有不合格的一项：项目照常打开，那一项原样留进隔离区（不改盘上的项目文件）。现在就试着另存；没成也不挡打开，
  // 它留在「欠着」里，下一次覆盖项目文件之前（任何调用方）先补写，补不成就不覆盖（见 stashQuarantineBeforeWrite）。
  const held = opened ? quarantineOfRecord(opened) : []
  if (held.length) {
    try {
      await stashQuarantineBeforeWrite(id, [])
    } catch {
      logRendererWarn('project-quarantine-sidecar-failed', { count: held.length, origin: 'open' })
    }
  }
  return opened
}

/**
 * 保存项目「内容」（画布 / 时间轴 / 文档等渲染层拥有的字段）。刻意没有 name 参数：项目名只有改名那一个主人
 * （renameLocalProject），自动保存等内容写口拿「打开那一刻的旧名」写回去会把别的路径改的名字盖掉。
 * 名字沿用盘上现有的；桌面端连 name 字段都不发，让主进程在清单锁内取盘上现值。
 */
export async function saveProjectRecord(
  projectId: string,
  state: WorkbenchProjectPayload,
  expectedBinding?: ProjectBinding,
): Promise<WorkbenchProjectRecordV1> {
  const id = String(projectId || '').trim()
  if (!id) throw new Error('projectId is required')
  const desktop = getDesktopBridge()
  const now = Date.now()
  // 自动保存每 700ms 走一次：只要旧记录的摘要字段（名称 / 创建时间 / 版本号 / 封面风格）。2026-09-25 画布跟手实测：
  // 原来同步 IPC 读回整份项目、再用完整 schema 校验一遍只为取 revision，每次在界面线程上卡 41–154ms。
  // 改为异步读（界面不等主进程读盘），版本号由 normalizeSummary 直接取。
  const existingRecord = desktop ? null : readJson(projectRecordKey(id))
  const existingRaw = desktop ? await (desktop.projects.readAsync ? desktop.projects.readAsync(id) : desktop.projects.read(id)) : existingRecord
  const existing = desktop
    ? normalizeSummary(existingRaw)
    : readMergedProjectSummaries().find((item) => item.id === id)
  const existingRevision = existing?.revision ?? 0
  // 封面 = 本次保存内容的现场派生（媒体类型分流）。刻意不沿用 existing 旧封面：
  // 「派生为空就 keep 旧值」会让陈旧 URL（换环境失效 / 视频 url 混 <img>）永远钉在列表里。
  const cover = deriveProjectCoverFromNodes(state.generationCanvas.nodes)
  const summary: WorkbenchProjectSummary = {
    id,
    name: existing?.name || i18n.t('runtime.project.untitled'),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    revision: existingRevision + 1,
    savedAt: now,
    ...(existing?.thumbStyle ? { thumbStyle: existing.thumbStyle } : {}),
    ...(existing?.seedKey ? { seedKey: existing.seedKey } : {}),
    ...(cover.imageUrls.length ? { thumbnail: cover.imageUrls[0], thumbnailUrls: cover.imageUrls } : {}),
  }
  // 单项不合格只隔离那一项（沿用盘上上一版里同 id 的那份），其余照存；骨架坏了才整份拒（projectNormalize）。
  const normalized = normalizePayloadWithQuarantine(state, { previous: (existingRaw as { payload?: unknown } | null)?.payload })
  const payload = normalized.payload
  const record: WorkbenchProjectRecordV1 = {
    ...summary,
    version: 1,
    payload,
  }
  assertWorkbenchProjectMediaUrlsPersistable(record)
  if (desktop) {
    const { name: _ownedByRename, ...contentRecord } = record
    // 顺序：先把被隔离的项另存好，再覆盖项目文件。另存不成就抛（保存失败、盘上不动），那一项不会三处同时消失。
    await stashQuarantineBeforeWrite(id, normalized.quarantined)
    const saved = unwrapIpcResult(await desktop.projects.save(id, { ...contentRecord, ...(expectedBinding ? { expectedBinding } : {}) }), 'nomi:projects:save-async') as WorkbenchProjectRecordV1
    rememberQuarantine(saved, normalized.quarantined)
    return saved
  }
  if (expectedBinding) {
    const current = workbenchProjectRecordSchema.safeParse(existingRecord)
    if (!current.success || !sameProjectAgentBinding(expectedBinding, { projectId: current.data.id,
      immutableProjectUuid: current.data.immutableProjectUuid ?? '', projectGeneration: current.data.projectGeneration ?? 0 })) throw new Error('project_binding_stale')
    record.immutableProjectUuid = expectedBinding.immutableProjectUuid
    record.projectGeneration = expectedBinding.projectGeneration
  }
  await stashQuarantineBeforeWrite(id, normalized.quarantined)
  if (existingRecord) rememberProjectBackup(id, existingRecord)
  const nextIndex = [summary, ...readMergedProjectSummaries().filter((item) => item.id !== id)]
  writeJson(projectRecordKey(id), record)
  writeIndex(nextIndex)
  rememberQuarantine(record, normalized.quarantined)
  return record
}

/**
 * 只改项目名（列表页「双击改名」的后端）——不动 id/目录/画布/时间轴/分类/分镜方案。
 *
 * 关键：读盘上的**原样** record，只换名字和时间戳再存回，**不经过逐项判（normalizeRecord）**。
 * 逐项判会把不合格的那一项丢掉，再整份写回就等于从盘上抹掉它（2026-11-13 独立验收：改名后坏分镜永久没了）；
 * 也绝不经 saveProjectRecord 的内容窄接口（那会重置 categories、丢 storyboardPlan）。payload 一个字节都不重写。
 * 列表页改的是**任意项目**（可能没打开），更不能拿当前内存状态覆盖它。空名/未变 → no-op 返回原 record。
 */
export async function renameLocalProject(projectId: string, name: string): Promise<WorkbenchProjectRecordV1 | null> {
  const id = String(projectId || '').trim()
  if (!id) return null
  const desktop = getDesktopBridge()
  const raw = desktop ? desktop.projects.read(id) : readJson(projectRecordKey(id))
  const current = normalizeSummary(raw)
  if (!raw || typeof raw !== 'object' || !current) return null
  const nextName = String(name || '').trim()
  if (!nextName || nextName === current.name) return raw as WorkbenchProjectRecordV1
  const now = Date.now()
  // 原样展开：payload 及所有未知字段照搬，只换名字与时间戳。
  const next = { ...(raw as Record<string, unknown>), name: nextName, updatedAt: now, savedAt: now, revision: (current.revision ?? 0) + 1 }
  if (desktop) return unwrapIpcResult(await desktop.projects.save(id, next), 'nomi:projects:save-async') as WorkbenchProjectRecordV1
  rememberProjectBackup(id, raw)
  writeJson(projectRecordKey(id), next)
  writeIndex([{ ...current, name: nextName, updatedAt: now, savedAt: now, revision: next.revision }, ...readMergedProjectSummaries().filter((item) => item.id !== id)])
  return next as unknown as WorkbenchProjectRecordV1
}

/**
 * 桌面端：等主进程把项目文件夹移进回收站（或只解绑）成功后，才清本地缓存；失败原样抛出，什么都不清。
 * 返回主进程说的结果：`deleted: true` 才是「文件夹真进了回收站」；false = 只摘了登记（「只移除」、外部文件夹、文件夹已不在
 * 原位置…）。调用方据此决定提示说什么，不能按「用户点了删除」就说成功（V-library-trash 建议 2）。
 * 没有桌面桥（浏览器预览）没有回收站这回事，只清本地缓存，恒为 false。
 */
export async function deleteLocalProject(projectId: string, intent: ProjectDeleteIntent): Promise<{ id: string; deleted: boolean }> {
  const id = String(projectId || '').trim()
  if (!id) throw new Error('projectId is required')
  const desktop = getDesktopBridge()
  let deleted = false
  if (desktop) {
    deleted = (await desktop.projects.delete(id, intent)).deleted === true
    // 「所有项目的素材」那一份清单里还有这个项目的素材：删项目不经过素材写入层的广播，这里显式作废。
    invalidateAllProjectAssets()
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
  return { id, deleted }
}
