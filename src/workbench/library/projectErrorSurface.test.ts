import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInstance, type TFunction } from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resources } from '../../i18n/resources'

const logRendererError = vi.hoisted(() => vi.fn())
vi.mock('../../desktop/rendererLog', () => ({ logRendererError }))

import { openWorkspaceProjectFromPicker } from './openWorkspaceFlow'
import { projectOperationFailureText, type UserText } from '../project/projectOperationFailureText'
import { WORKSPACE_MANIFEST_BUSY_ERROR_NAME } from '../../../electron/shared/contracts/workspaceBusy'
import type { DesktopBridge } from '../../desktop/bridge'

/**
 * 项目库报错入口：主进程原文只进日志，界面只收一句人话（`UserText`）。
 * 这是 projectErrorSurface 特征测试翻转后的样子（类根因复盘
 * docs/engineering/direction-checks/2026-10-10-library-actions-and-errors.md）。
 */
const RAW = '[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {"count":80}'
const t = ((key: string) => `«${key}»`) as unknown as TFunction

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const read = (file: string): string => stripComments(readFileSync(resolve(process.cwd(), file), 'utf8'))

function bridgeWith(openFolder: () => Promise<unknown>): DesktopBridge {
  return {
    platform: 'win32',
    workspace: { selectFolder: vi.fn(async () => ({ canceled: false, rootPath: '/tmp/x' })), openFolder },
  } as unknown as DesktopBridge
}

beforeEach(() => logRendererError.mockClear())

describe('项目库报错：原文只进日志，界面只给一句人话', () => {
  it('选文件夹打开失败：showMessage 收到词典文案，原文进日志', async () => {
    const showMessage = vi.fn()
    const error = new Error(RAW)
    await openWorkspaceProjectFromPicker({ bridge: bridgeWith(async () => { throw error }), confirmInitialize: vi.fn(), showMessage, t })
    expect(showMessage).toHaveBeenCalledWith('«studio.openWorkspaceFailed»', 'error')
    expect(JSON.stringify(showMessage.mock.calls)).not.toContain('safe-delete')
    expect(logRendererError).toHaveBeenCalledWith('workspace-open-failed', error)
  })

  it('确认初始化后再失败：同样说人话、原文进日志', async () => {
    const showMessage = vi.fn()
    const error = new Error(RAW)
    const openFolder = vi.fn()
      .mockRejectedValueOnce(new Error('Workspace folder is not initialized'))
      .mockRejectedValueOnce(error)
    await openWorkspaceProjectFromPicker({ bridge: bridgeWith(openFolder), confirmInitialize: vi.fn(async () => true), showMessage, t })
    expect(showMessage).toHaveBeenCalledWith('«studio.openWorkspaceFailed»', 'error')
    expect(logRendererError).toHaveBeenCalledWith('workspace-initialize-failed', error)
  })

  it('环境不支持 / 没拿到项目 ID：走词典，不再是硬编码中文', async () => {
    const showMessage = vi.fn()
    await openWorkspaceProjectFromPicker({ bridge: null, confirmInitialize: vi.fn(), showMessage, t })
    await openWorkspaceProjectFromPicker({ bridge: bridgeWith(async () => ({})), confirmInitialize: vi.fn(), showMessage, t })
    expect(showMessage.mock.calls.map((call) => call[0])).toEqual(['«studio.workspaceUnsupported»', '«studio.workspaceNoProject»'])
  })

  // 操作矩阵（清单）：出口的每个操作各取自己的那句；新增操作必须在这里加一行，否则类型 / 门岗拦不住漏登记。
  const OPERATION_MATRIX = [
    ['delete', '«studio.projectDeleteFailed»'],
    ['revealFolder', '«studio.openFolderFailed»'],
    ['openWorkspace', '«studio.openWorkspaceFailed»'],
    ['save', '«studio.projectSaveFailed»'],
    ['restore', '«studio.projectRestoreFailed»'],
    ['create', '«studio.newProjectFailed»'],
    ['createDemo', '«studio.demoProjectFailed»'],
  ] as const
  it.each(OPERATION_MATRIX)('单一出口：%s 取自己的那句，原文不进返回值；锁忙先认', (operation, expected) => {
    expect(projectOperationFailureText(operation, new Error(RAW), t)).toBe(expected)
    const busy = Object.assign(new Error('locked'), { name: WORKSPACE_MANIFEST_BUSY_ERROR_NAME })
    expect(projectOperationFailureText(operation, busy, t)).toBe('«studio.projectInUseElsewhere»')
  })

  it('删除时状态和确认那一刻对不上（经同步 IPC 只剩信息文本）：说「没删、已刷新、请重新确认」，不说删除失败', () => {
    const changed = new Error('ProjectDeleteStateChangedError: project data is no longer readable; refresh and confirm again')
    expect(projectOperationFailureText('delete', changed, t)).toBe('«studio.projectDeleteStateChanged»')
    expect(projectOperationFailureText('save', changed, t)).toBe('«studio.projectSaveFailed»')
  })

  it.each([
    ['permission', 'studio.projectTrashFailedPermission'],
    ['no-trash', 'studio.projectTrashFailedNoTrash'],
    ['in-use', 'studio.projectTrashFailedInUse'],
    ['unknown', 'studio.projectTrashFailedUnknown'],
  ])('删除时进不了回收站（%s，经 invoke 只剩信息文本）：说「没删、为什么」，带上回收站叫法', (reason, key) => {
    const tWithParams = ((k: string, params?: Record<string, unknown>) => `«${k}|${params?.bin ?? ''}»`) as unknown as TFunction
    const error = new Error(`Error invoking remote method 'nomi:projects:delete': Error: ProjectTrashFailedError[${reason}]: project folder was not moved to the trash and nothing was deleted (x)`)
    expect(projectOperationFailureText('delete', error, tWithParams, { trashBin: '回收站' })).toBe(`«${key}|回收站»`)
  })

  // 「项目在哪」收敛单：位置在 Nomi 自己的目录里、打开的是另一个还在的项目文件夹的副本。经同步 IPC（新建项目，只剩信息文本）
  // 和经 invoke（`Error invoking remote method …: Error: …`）都认得出，说清为什么、去哪改；不会放项目的操作不认这两种身份。
  const tParams = ((k: string, params?: Record<string, unknown>) =>
    `«${k}${params ? Object.entries(params).map(([key, value]) => `|${key}=${String(value)}`).join('') : ''}»`) as unknown as TFunction

  it.each([
    ['install', '«studio.appOwnedPlaceInstall»'],
    ['app-data', '«studio.appOwnedPlaceAppData»'],
    ['temp', '«studio.appOwnedPlaceTemp»'],
  ])('新建项目被拒（默认位置在 %s 里，经同步 IPC 只剩信息文本）：说清是哪类目录、去设置换', (kind, place) => {
    const error = new Error(`ProjectLocationRejectedError[${kind}]: refusing to keep projects inside Nomi's own ${kind} directory (F:\\Nomi_new\\xiangmu)`)
    expect(projectOperationFailureText('create', error, tParams)).toBe(`«studio.newProjectLocationInsideApp|place=${place}»`)
    expect(projectOperationFailureText('createDemo', error, tParams)).toBe(`«studio.newProjectLocationInsideApp|place=${place}»`)
  })

  it('打开已有文件夹被拒（在应用目录里，经 invoke）：说清是哪类目录', () => {
    const error = new Error("Error invoking remote method 'nomi:workspace:open-folder': Error: ProjectLocationRejectedError[app-data]: refusing to keep projects inside Nomi's own app-data directory (C:\\Users\\张三\\AppData\\Roaming\\Nomi\\x)")
    expect(projectOperationFailureText('openWorkspace', error, tParams)).toBe('«studio.workspaceFolderInsideApp|place=«studio.appOwnedPlaceAppData»»')
  })

  it('打开的是另一个还在的项目文件夹的副本（经 invoke）：说原项目名和原文件夹在哪，路径里的引号、反斜杠、中文原样带出', () => {
    const original = 'D:\\作品\\"原片" 文件夹'
    const error = new Error(`Error invoking remote method 'nomi:workspace:open-folder': Error: WorkspaceFolderCopyError: ${JSON.stringify({ projectName: '原片', originalRootPath: original })}`)
    expect(projectOperationFailureText('openWorkspace', error, tParams)).toBe(`«studio.workspaceFolderIsCopy|name=原片|path=${original}»`)
  })

  it('这两种身份只在会放项目的操作上认：保存 / 删除 / 打开位置照旧说自己的那句；新建不认副本', () => {
    const rejected = new Error('ProjectLocationRejectedError[install]: refusing (x)')
    const copy = new Error(`WorkspaceFolderCopyError: ${JSON.stringify({ projectName: 'a', originalRootPath: '/a' })}`)
    for (const error of [rejected, copy]) {
      expect(projectOperationFailureText('save', error, t)).toBe('«studio.projectSaveFailed»')
      expect(projectOperationFailureText('delete', error, t)).toBe('«studio.projectDeleteFailed»')
      expect(projectOperationFailureText('revealFolder', error, t)).toBe('«studio.openFolderFailed»')
    }
    expect(projectOperationFailureText('create', copy, t)).toBe('«studio.newProjectFailed»')
  })

  it.each(['zh-CN', 'en'] as const)('真词典（%s）：三句都带上目录类别 / 原项目名 / 原路径，不漏插值', async (language) => {
    const i18n = createInstance()
    await i18n.init({ lng: language, resources, interpolation: { escapeValue: false } })
    const real = i18n.t.bind(i18n) as TFunction
    const texts = [
      projectOperationFailureText('create', new Error('ProjectLocationRejectedError[install]: refusing (x)'), real),
      projectOperationFailureText('openWorkspace', new Error('ProjectLocationRejectedError[temp]: refusing (x)'), real),
      projectOperationFailureText('openWorkspace', new Error(`WorkspaceFolderCopyError: ${JSON.stringify({ projectName: '原片 & <花絮>', originalRootPath: 'D:\\作品\\原片' })}`), real),
    ]
    const studio = resources[language].translation.studio
    expect(texts[0]).toContain(studio.appOwnedPlaceInstall)
    expect(texts[1]).toContain(studio.appOwnedPlaceTemp)
    expect(texts[2]).toContain('原片 & <花絮>')
    expect(texts[2]).toContain('D:\\作品\\原片')
    for (const text of texts) expect(text).not.toMatch(/\{\{|\}\}|ProjectLocationRejectedError|WorkspaceFolderCopyError/)
  })

  it('类型上做不出来：原文字符串不能当 UserText 传进界面', () => {
    const accept = (_message: UserText): void => {}
    // @ts-expect-error 裸字符串（含 error.message）不是 UserText，编译不过
    accept(RAW)
    accept(projectOperationFailureText('delete', new Error(RAW), t))
  })

  it('删除 / 打开项目文件夹（NomiStudioApp 无可注入 harness，钉源码形状）：原文进日志，report 收出口产物', () => {
    const source = read('src/workbench/NomiStudioApp.tsx')
    expect(source).toContain("logRendererError('project-delete-failed', error)")
    expect(source).toContain("report(projectId, projectOperationFailureText('delete', error, t, { trashBin }))")
    expect(source).toContain("logRendererError('project-reveal-folder-failed', error)")
    expect(source).toContain("report(projectId, projectOperationFailureText('revealFolder', error, t))")
    expect(source).not.toMatch(/error instanceof Error && error\.message \? error\.message/)
  })

  it('项目库加载失败：原因折叠在「技术详情」里，不再当正文', () => {
    const source = read('src/workbench/library/ProjectLibraryPage.tsx')
    expect(source).not.toContain('loadFailedReason')
    expect(source).toMatch(/<details[^>]*data-library-load-error-details[\s\S]*technicalDetails[\s\S]*projectsError\.message/)
  })
})
