import { projectSaveReason, type ProjectSaveReason } from '../../../electron/shared/contracts/projectSaveFailure'
import type { TFunction } from 'i18next'
import { isWorkspaceBusyError } from '../../../electron/shared/contracts/workspaceBusy'
import { isProjectDeleteStateChangedError, projectTrashFailureReason } from '../../../electron/shared/projectDeleteIntent'
import { projectLocationRejection, workspaceFolderCopy, type AppOwnedLocationKind } from '../../../electron/shared/contracts/projectLocation'

/**
 * 项目表面（项目库 / 外壳）上「一句话告诉用户出了什么事」的单一出口。
 *
 * 类根因：以前 `report(projectId, message: string)` 收任意字符串，于是任何调用点都能把主进程报错原文
 * （比如外部工具给子进程加的 `[safe-delete][…] {"count":80}`）直接糊到界面顶上。
 * 现在界面只收 `UserText`——这个品牌类型只有本文件两个函数能铸造：`projectNotice`（词典取词）和
 * `projectOperationFailureText`（按操作 + 错误取词）。原文在类型上传不进来，只能进 `logRendererError`。
 */
declare const userTextBrand: unique symbol
export type UserText = string & { readonly [userTextBrand]: true }

/** 项目表面可以直接说的固定文案（词典键）。新增键必须在这里登记，才铸得出 `UserText`。 */
export type ProjectNoticeKey =
  | 'studio.folderUnsupported'
  | 'studio.renameFailed'
  | 'studio.projectFolderMissing'
  | 'studio.projectNotFound'
  | 'studio.workspaceUnsupported'
  | 'studio.workspaceNoProject'

export function projectNotice(t: TFunction, key: ProjectNoticeKey): UserText {
  return t(key) as UserText
}

/**
 * 有项被隔离（保存时没存进项目 / 打开时没放进项目）的那一句话。创作者要能读懂：哪份分镜、第几镜（从 1 数）、
 * 哪一项（界面上的叫法；对不上的只说到第几镜，绝不露 `plan.shots[12]…` 这种路径）、其余是否已存好、
 * 项目里现在是上一版还是没有、没存上的内容去了哪里。多项合成一句「有 N 处」。
 * 标题 / 分类名是用户自己的内容，只在这里进界面，不进日志。
 */
export type QuarantineNoticeInput = Readonly<{
  origin: 'open' | 'save'
  item: Readonly<{ container: string; field: string; title?: string; keptPreviousVersion: boolean; raw?: unknown }>
}>

/** 镜头里的字段 → 界面叫法（词典键）。没列的字段只说到第几镜。 */
const SHOT_FIELD_KEYS: Readonly<Record<string, string>> = {
  durationSec: 'studio.quarantineFieldDuration',
  prompt: 'studio.quarantineFieldPrompt',
  promptSegments: 'studio.quarantineFieldPrompt',
  referenceBindings: 'studio.quarantineFieldReferences',
  anchorIds: 'studio.quarantineFieldReferences',
  autoReferenced: 'studio.quarantineFieldReferences',
  modelKey: 'studio.quarantineFieldModel',
  modelVendor: 'studio.quarantineFieldModel',
  modeId: 'studio.quarantineFieldModel',
  params: 'studio.quarantineFieldModel',
  shotKind: 'studio.quarantineFieldShotKind',
  keyframe: 'studio.quarantineFieldKeyframe',
  ffDesc: 'studio.quarantineFieldDescription',
  lfDesc: 'studio.quarantineFieldDescription',
  motionDesc: 'studio.quarantineFieldDescription',
}

function quarantineWhere(t: TFunction, item: QuarantineNoticeInput['item']): string {
  if (item.container === 'storyboardDesign') {
    const title = item.title?.trim() || t('studio.quarantineUntitledStoryboard')
    const shot = /^plan\.shots\[(\d+)\](?:\.([A-Za-z]+))?/.exec(item.field)
    if (shot) {
      const number = Number(shot[1]) + 1
      const fieldKey = shot[2] ? SHOT_FIELD_KEYS[shot[2]] : undefined
      return fieldKey
        ? t('studio.quarantineWhereShotField', { title, shot: number, field: t(fieldKey) })
        : t('studio.quarantineWhereShot', { title, shot: number })
    }
    const anchor = /^plan\.anchors\[(\d+)\]/.exec(item.field)
    if (anchor) return t('studio.quarantineWhereAnchor', { title, anchor: Number(anchor[1]) + 1 })
    return t('studio.quarantineWhereStoryboard', { title })
  }
  if (item.container === 'category') {
    const name = item.raw && typeof item.raw === 'object' ? (item.raw as { name?: unknown }).name : undefined
    return typeof name === 'string' && name.trim() ? t('studio.quarantineWhereCategory', { name: name.trim() }) : t('studio.quarantineWhereCategoryUnnamed')
  }
  if (item.container === 'editingPanelLayout') return t('studio.quarantineWhereLayout')
  return t('studio.quarantineWhereOther')
}

export function projectQuarantineNoticeText(t: TFunction, items: readonly QuarantineNoticeInput[]): UserText {
  const where = quarantineWhere(t, items[0]!.item)
  const onOpenOnly = items.every((entry) => entry.origin === 'open')
  if (items.length === 1) {
    if (onOpenOnly) return t('studio.quarantineOpenOne', { where }) as UserText
    return t(items[0]!.item.keptPreviousVersion ? 'studio.quarantineSaveOneKept' : 'studio.quarantineSaveOneMissing', { where }) as UserText
  }
  const count = items.length
  if (onOpenOnly) return t('studio.quarantineOpenMany', { count, where }) as UserText
  const kept = items.filter((entry) => entry.origin === 'save' && entry.item.keptPreviousVersion).length
  const previous = kept === count ? t('studio.quarantinePreviousAllKept')
    : kept === 0 ? t('studio.quarantinePreviousNoneKept')
    : t('studio.quarantinePreviousSomeKept', { kept, missing: count - kept })
  return t('studio.quarantineSaveMany', { count, where, previous }) as UserText
}

export function projectQuarantineRevealLabel(t: TFunction): UserText {
  return t('studio.quarantineRevealFolder') as UserText
}

export type ProjectOperation = 'save' | 'delete' | 'revealFolder' | 'openWorkspace' | 'restore' | 'create' | 'createDemo'

/** 项目位置被拒时，{{place}} 说的是 Nomi 自己的哪类目录（主进程判定：electron/workspace/workspaceLocationPolicy.ts）。 */
const APP_OWNED_PLACE_KEYS: Record<AppOwnedLocationKind, string> = {
  install: 'studio.appOwnedPlaceInstall',
  'app-data': 'studio.appOwnedPlaceAppData',
  temp: 'studio.appOwnedPlaceTemp',
}

/**
 * 操作失败时给用户看哪一句——按操作取人话，说清哪个操作没成、可以怎么办；原文由调用方记日志，不进这里。
 * 本文件刻意不 import 重模块（lane / i18n 初始化）：保存路径的轻量单测靠它保持隔离。lane 失败自己在 `laneFailureText` 里取词（已是 UserText）。
 * 锁被别处占着（另一个 Nomi 窗口 / 另一台电脑经同步盘）不是磁盘权限问题，任何操作都先认它。
 */
type ProjectFailureReason = ProjectSaveReason | 'delete-state-changed' | 'trash-permission' | 'trash-no-trash' | 'trash-in-use' | 'trash-unknown'
// 旧三个特例与保存原因共用一张穷举表。unknown 仍按操作取现有文案。
const FAILURE_KEYS: Record<Exclude<ProjectFailureReason, 'unknown'>, string> = {
  'workspace-busy': 'studio.projectInUseElsewhere',
  'binding-stale': 'studio.projectSaveBindingStale',
  'write-denied': 'studio.projectSaveWriteDenied',
  'in-use': 'studio.projectSaveInUse',
  'disk-full': 'studio.projectSaveDiskFull',
  'not-found': 'studio.projectSaveNotFound',
  'delete-state-changed': 'studio.projectDeleteStateChanged',
  'trash-permission': 'studio.projectTrashFailedPermission',
  'trash-no-trash': 'studio.projectTrashFailedNoTrash',
  'trash-in-use': 'studio.projectTrashFailedInUse',
  'trash-unknown': 'studio.projectTrashFailedUnknown',
}

function failureReason(operation: ProjectOperation, error: unknown): ProjectFailureReason {
  // 保存只认包络；其他旧通道尚未迁移，仍共用既有身份识别。
  if (operation === 'save') return projectSaveReason(error) ?? 'unknown'
  const trash = operation === 'delete' ? projectTrashFailureReason(error) : null
  return isWorkspaceBusyError(error) ? 'workspace-busy'
    : operation === 'delete' && isProjectDeleteStateChangedError(error) ? 'delete-state-changed'
    : trash ? `trash-${trash}` : 'unknown'
}

/** 系统回收站在这个平台上叫什么（Windows 回收站 / macOS 废纸篓）；确认框、成功提示、失败提示共用。 */
export function trashBinKey(platform: string | undefined): 'studio.trashBinWindows' | 'studio.trashBinMac' | 'studio.trashBinLinux' {
  return platform === 'win32' ? 'studio.trashBinWindows' : platform === 'darwin' ? 'studio.trashBinMac' : 'studio.trashBinLinux'
}

export function projectOperationFailureText(
  operation: ProjectOperation,
  error: unknown,
  t: TFunction,
  context: { trashBin?: string } = {},
): UserText {
  const reason = failureReason(operation, error)
  if (reason !== 'unknown') return t(FAILURE_KEYS[reason], { bin: context.trashBin ?? '' }) as UserText
  // 项目位置被拒（「项目在哪」收敛单）：位置在 Nomi 自己的目录里 → 说清为什么、去哪改；打开的是另一个还在的项目文件夹的副本 → 说原文件夹在哪。
  const rejectedPlace = operation === 'create' || operation === 'createDemo' || operation === 'openWorkspace' ? projectLocationRejection(error) : null
  if (rejectedPlace) {
    const place = t(APP_OWNED_PLACE_KEYS[rejectedPlace])
    return t(operation === 'openWorkspace' ? 'studio.workspaceFolderInsideApp' : 'studio.newProjectLocationInsideApp', { place }) as UserText
  }
  const copy = operation === 'openWorkspace' ? workspaceFolderCopy(error) : null
  if (copy) return t('studio.workspaceFolderIsCopy', { name: copy.projectName, path: copy.originalRootPath }) as UserText
  const key = {
    save: 'studio.projectSaveFailed',
    delete: 'studio.projectDeleteFailed',
    revealFolder: 'studio.openFolderFailed',
    openWorkspace: 'studio.openWorkspaceFailed',
    restore: 'studio.projectRestoreFailed',
    create: 'studio.newProjectFailed',
    createDemo: 'studio.demoProjectFailed',
  }[operation]
  return t(key) as UserText
}
