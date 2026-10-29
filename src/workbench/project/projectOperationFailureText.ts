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
/** 进不了回收站的三类原因 + 其余（⑭）：每类一句人话，都说明「项目没有被删除」。 */
const TRASH_FAILURE_KEYS = {
  permission: 'studio.projectTrashFailedPermission',
  'no-trash': 'studio.projectTrashFailedNoTrash',
  'in-use': 'studio.projectTrashFailedInUse',
  unknown: 'studio.projectTrashFailedUnknown',
} as const

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
  if (isWorkspaceBusyError(error)) return t('studio.projectInUseElsewhere') as UserText
  // 删除时项目状态和确认那一刻对不上（主进程拒绝执行）：不是失败，是要按新状态重新确认。
  if (operation === 'delete' && isProjectDeleteStateChangedError(error)) return t('studio.projectDeleteStateChanged') as UserText
  const trashFailure = operation === 'delete' ? projectTrashFailureReason(error) : null
  if (trashFailure) return t(TRASH_FAILURE_KEYS[trashFailure], { bin: context.trashBin ?? '' }) as UserText
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
