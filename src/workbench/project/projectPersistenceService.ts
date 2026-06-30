import { readLocalProjectAsync, saveLocalProject, type LocalProjectSummary } from '../library/localProjectStore'
import { readWindowUrlParam } from '../windowUrlParam'
import { upgradeWorkbenchProjectMediaUrls, normalizeLegacyImageAssetKinds } from './projectMediaMigration'
import {
  clearActiveWorkbenchProjectSaveTarget,
  replayCanvasEventTailAndSealGenesis,
  restoreWorkbenchProjectPayload,
  subscribeWorkbenchProjectPersistence,
} from './workbenchProjectSession'
import type { WorkbenchProjectPayload, WorkbenchProjectRecordV1 } from './projectRecordSchema'
import { migrateProjectRecord, type CategoryMigrationDiagnostic } from './projectCategoryMigration'
import { migrateProjectV51ToV60 } from './projectV51ToV60Migration'
import { backfillShotIndexes } from '../generationCanvas/model/shotNumbering'

let lastCategoryMigrationDiagnostic: CategoryMigrationDiagnostic | null = null

// 迁移幂等的语义相等（P2 根因 / 守纪律「幂等判定用语义相等不用引用相等」）：
// hydrate 时串行跑多道迁移，其中任一道（如 v51→v60 把跨分类 derivedFrom 计入 anyChange，
// 或任何返回 `{ ...record }` 的 no-op）都会换掉顶层引用，于是旧的 `upgraded !== project`
// 判定恒为 true → 每次打开都 re-save → revision 单调漂移（实测漂到 706）+ 反复弹「已升级」
// toast。改用对「会落盘的内容」做深比较：真无变更就不写盘、不 ++revision。
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// 语义相等里要跳过的 bookkeeping 元字段——它们由「保存/迁移动作本身」产生（updatedAt 来自
// Date.now()、revision 由 ++ 累加），不是内容。否则两份内容全等、仅 updatedAt 差 1ms 的 payload
// 会被判为不等：① migratedRecordNeedsPersist 误判「需写盘」→ 又一次保存（自激振荡，正是 line 47-53
// 刻意要避免的）；② 比较两份新建 default payload 的测试因跨毫秒边界 flaky。与下方 migratedRecord
// NeedsPersist 注释「刻意不比较 revision/savedAt/updatedAt」同一意图，这里把它落到实现层（任意深度）。
const SEMANTIC_EQUALS_IGNORED_KEYS = new Set(['updatedAt', 'createdAt', 'savedAt', 'revision'])

function semanticKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record).filter((key) => record[key] !== undefined && !SEMANTIC_EQUALS_IGNORED_KEYS.has(key))
}

/**
 * 结构化深比较：plain object（忽略 key 顺序、跳过值为 undefined 的键、跳过 bookkeeping 元字段）
 * / array / 基本类型。只服务 workbenchPayloadSemanticEquals（内容语义相等），故在此跳过 bookkeeping。
 */
function deepValueEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => deepValueEquals(item, b[index]))
  }
  if (isPlainRecord(a) && isPlainRecord(b)) {
    const keysA = semanticKeys(a)
    const keysB = semanticKeys(b)
    if (keysA.length !== keysB.length) return false
    return keysA.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepValueEquals(a[key], b[key]))
  }
  return false
}

/** 两份 payload 语义是否一致（引用无关、key 顺序无关）。 */
export function workbenchPayloadSemanticEquals(a: WorkbenchProjectPayload, b: WorkbenchProjectPayload): boolean {
  return deepValueEquals(a, b)
}

/**
 * 迁移后的记录是否「真的需要写盘」。只看会被持久化且语义相关的字段：
 * - name（用户可见）
 * - payload（画布/时间轴/文档/分类等全部内容）
 * 刻意不比较 revision/savedAt/updatedAt 这类 bookkeeping 元字段——它们由保存动作本身产生，
 * 不该反过来触发又一次保存（否则就是自激振荡）。
 */
export function migratedRecordNeedsPersist(
  original: WorkbenchProjectRecordV1,
  upgraded: WorkbenchProjectRecordV1,
): boolean {
  if (Object.is(original, upgraded)) return false
  if (original.name !== upgraded.name) return true
  return !workbenchPayloadSemanticEquals(original.payload, upgraded.payload)
}

/** Returns + clears the most recent Phase E4 migration diagnostic (for toast UI). */
export function consumeCategoryMigrationDiagnostic(): CategoryMigrationDiagnostic | null {
  const value = lastCategoryMigrationDiagnostic
  lastCategoryMigrationDiagnostic = null
  return value
}

const LAST_ACTIVE_PROJECT_KEY = 'nomi-workbench-last-active-project-v1'

type Dependencies = {
  setActiveProject: (project: LocalProjectSummary | null) => void
  setView: (view: 'library' | 'studio') => void
  onSaveError: (error: unknown) => void
}


function writeLastActiveProjectId(projectId: string): void {
  if (typeof window === 'undefined') return
  const id = projectId.trim()
  if (!id) return
  window.localStorage.setItem(LAST_ACTIVE_PROJECT_KEY, id)
}

export type WorkbenchProjectPersistenceService = {
  hydrateProject: (projectId: string) => Promise<WorkbenchProjectRecordV1 | null>
  hydrateInitialProject: (projects: readonly LocalProjectSummary[]) => Promise<WorkbenchProjectRecordV1 | null>
  persistProject: (project: LocalProjectSummary, payload: WorkbenchProjectPayload) => Promise<WorkbenchProjectRecordV1>
  bindProjectPersistence: (input: {
    project: LocalProjectSummary
    isHydrating: () => boolean
    canPersist: () => boolean
    onSaved: (record: WorkbenchProjectRecordV1) => void
    onSaveError: (error: unknown) => void
  }) => () => void
}

export function createWorkbenchProjectPersistenceService(deps: Dependencies): WorkbenchProjectPersistenceService {
  const persistProject = async (project: LocalProjectSummary, payload: WorkbenchProjectPayload): Promise<WorkbenchProjectRecordV1> => {
    const localSaved = saveLocalProject(project.id, payload, project.name)
    writeLastActiveProjectId(localSaved.id)
    deps.setActiveProject(localSaved)
    return localSaved
  }

  const bindProjectPersistence = (input: {
    project: LocalProjectSummary
    isHydrating: () => boolean
    canPersist: () => boolean
    onSaved: (record: WorkbenchProjectRecordV1) => void
    onSaveError: (error: unknown) => void
  }): (() => void) => {
    return subscribeWorkbenchProjectPersistence({
      projectId: input.project.id,
      projectName: input.project.name,
      isHydrating: input.isHydrating,
      canPersist: input.canPersist,
      saveProject: async (_projectId, payload, _projectName) => {
        const localSaved = saveLocalProject(input.project.id, payload, input.project.name)
        writeLastActiveProjectId(localSaved.id)
        return localSaved
      },
      onSaved: input.onSaved,
      onSaveError: input.onSaveError,
    })
  }

  const hydrateProject = async (projectId: string): Promise<WorkbenchProjectRecordV1 | null> => {
    const project = await readLocalProjectAsync(projectId)
    if (!project) return null
    clearActiveWorkbenchProjectSaveTarget()
    const mediaUpgraded = await upgradeWorkbenchProjectMediaUrls(project)
    const { record: catUpgraded, diagnostic } = migrateProjectRecord(mediaUpgraded)
    const { record: v60Upgraded } = migrateProjectV51ToV60(catUpgraded)
    // A1.5：历史导入/切图/裁剪/截图的 image 节点改判为 asset（素材卡）。
    const assetUpgraded = normalizeLegacyImageAssetKinds(v60Upgraded)
    // 镜头编号存储身份化（审计 A2）：存量项目缺 shotIndex 的镜头节点按
    // (y, x, id) 确定性回填一次；此后编号不再随布局/添加节点漂移。
    const shotBackfill = backfillShotIndexes(assetUpgraded.payload.generationCanvas.nodes)
    const upgraded = shotBackfill.changed
      ? {
          ...assetUpgraded,
          payload: {
            ...assetUpgraded.payload,
            generationCanvas: {
              ...assetUpgraded.payload.generationCanvas,
              nodes: shotBackfill.nodes,
            },
          },
        }
      : assetUpgraded
    // 语义相等判定（不再用引用相等）：多道迁移即便换了顶层引用，只要落盘内容没变就
    // 不写盘、不 ++revision、不弹「已升级」toast。修 revision 单调漂移根因。
    const changed = migratedRecordNeedsPersist(project, upgraded)
    if (changed && !diagnostic.alreadyMigrated && (diagnostic.migratedNodes > 0 || diagnostic.removedNodes > 0 || diagnostic.categoriesSeeded)) {
      lastCategoryMigrationDiagnostic = diagnostic
    }
    if (changed) {
      saveLocalProject(upgraded.id, upgraded.payload, upgraded.name)
    }
    restoreWorkbenchProjectPayload(upgraded.payload)
    // S5-b-1:重放快照没盖到的事件尾巴(崩溃恢复),完成后以含尾后态发 genesis。
    await replayCanvasEventTailAndSealGenesis(upgraded.id, upgraded.payload)
    writeLastActiveProjectId(upgraded.id)
    deps.setActiveProject(upgraded)
    deps.setView('studio')
    return upgraded
  }

  const hydrateInitialProject = async (_projects: readonly LocalProjectSummary[]): Promise<WorkbenchProjectRecordV1 | null> => {
    const explicitProjectId = readWindowUrlParam('projectId')
    if (!explicitProjectId) return null
    return hydrateProject(explicitProjectId)
  }

  return {
    hydrateProject,
    hydrateInitialProject,
    persistProject,
    bindProjectPersistence,
  }
}
