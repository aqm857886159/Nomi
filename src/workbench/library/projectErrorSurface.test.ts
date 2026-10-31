import { PROJECT_SAVE_REASONS, projectSaveFailure } from '../../../electron/shared/contracts/projectSaveFailure'
import { unwrapIpcResult } from '../../../electron/shared/contracts/ipcResult'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { TFunction } from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  ] as const
  it.each(OPERATION_MATRIX)('单一出口：%s 取自己的那句，原文不进返回值；锁忙先认', (operation, expected) => {
    expect(projectOperationFailureText(operation, new Error(RAW), t)).toBe(expected)
    const busy = Object.assign(new Error('locked'), { name: WORKSPACE_MANIFEST_BUSY_ERROR_NAME })
    const failure = operation === 'save' ? { reason: projectSaveFailure(busy, 'save-project') } : busy
    expect(projectOperationFailureText(operation, failure, t)).toBe('«studio.projectInUseElsewhere»')
  })

  it('保存不再猜旧 invoke 文本，只有结果包络能携带身份', () => {
    const legacy = new Error("Error invoking remote method 'nomi:projects:save-async': WorkspaceManifestLockBusyError: private path")
    expect(projectOperationFailureText('save', legacy, t)).toBe('«studio.projectSaveFailed»')
  })

  it.each(PROJECT_SAVE_REASONS)('保存结果包络 %s 按原因说话，中性句只用于未知', reason => {
    const key = { 'workspace-busy': 'studio.projectInUseElsewhere', 'binding-stale': 'studio.projectSaveBindingStale', 'write-denied': 'studio.projectSaveWriteDenied', 'in-use': 'studio.projectSaveInUse', 'disk-full': 'studio.projectSaveDiskFull', 'not-found': 'studio.projectSaveNotFound', unknown: 'studio.projectSaveFailed' }[reason]
    let error: unknown
    try { unwrapIpcResult({ ok: false, error: 'project-save-failed', reason: { ...projectSaveFailure(null, 'save-project'), kind: reason } }, 'nomi:projects:save-async') } catch (caught) { error = caught }
    expect(projectOperationFailureText('save', error, t)).toBe(`«${key}»`)
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
