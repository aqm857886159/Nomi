import type { TFunction } from 'i18next'
import { describe, expect, it, vi } from 'vitest'

import { runProjectDeleteFlow, type ProjectDeleteFlowDeps, type ProjectDeleteTarget } from './projectDeleteFlow'

// 项目库删除流程（⑭ 进回收站 + V-plibrary2 第 3 轮建议：灰卡点删除，断言交给主进程的是「只移除」）。
// t 用「键 + 参数」原样回显，断言看的是选了哪个键、带了什么参数，不抄词典文案。
const t = ((key: string, params?: Record<string, unknown>) => (params ? `«${key}|${JSON.stringify(params)}»` : `«${key}»`)) as unknown as TFunction

// mainDeleted：主进程这次说的 deleted。delete-files 真把文件夹移进回收站才是 true；「只移除」主进程一律回 false。
function harness(overrides: Partial<ProjectDeleteFlowDeps> = {}, mainDeleted = true) {
  const calls = {
    confirm: [] as Array<{ title: string; message: string; confirmLabel: string }>,
    deleted: [] as Array<{ id: string; intent: string }>,
    released: 0,
    left: 0,
    movedToTrash: [] as string[],
    removedWithoutTrash: [] as string[],
    failed: [] as Array<{ id: string; error: unknown; trashBin: string }>,
  }
  const deps: ProjectDeleteFlowDeps = {
    t,
    platform: 'win32',
    confirm: async (options) => { calls.confirm.push(options); return true },
    isActive: () => false,
    releaseActive: async () => { calls.released += 1 },
    leaveToLibrary: () => { calls.left += 1 },
    deleteLocalProject: async (id, intent) => { calls.deleted.push({ id, intent }); return { deleted: mainDeleted } },
    onMovedToTrash: (message) => { calls.movedToTrash.push(message) },
    onRemovedWithoutTrash: (message) => { calls.removedWithoutTrash.push(message) },
    onFailed: (id, error, trashBin) => { calls.failed.push({ id, error, trashBin }) },
    ...overrides,
  }
  return { deps, calls }
}

const grayOutside: ProjectDeleteTarget = { id: 'p-gray', name: '灰卡', source: 'native', unreadableReason: 'outside-workspace' }
const grayUnreadable: ProjectDeleteTarget = { id: 'p-gray2', name: '灰卡二', source: 'native', unreadableReason: 'unreadable' }
const local: ProjectDeleteTarget = { id: 'p-local', name: '本地', source: 'native' }

describe('项目库删除流程', () => {
  it.each([grayOutside, grayUnreadable])('灰卡（$unreadableReason）点删除：确认框说「从项目库移除」，交给主进程的是 unbind，不进回收站', async (project) => {
    const { deps, calls } = harness({}, false)
    await runProjectDeleteFlow(project, deps)
    expect(calls.confirm[0].title).toBe('«studio.removeProjectTitle»')
    expect(calls.confirm[0].message).toContain('studio.removeProjectMessage')
    expect(calls.deleted).toEqual([{ id: project.id, intent: 'unbind' }])
    expect(calls.movedToTrash).toEqual([])
    expect(calls.removedWithoutTrash).toEqual([]) // 用户要的就是「只移除」，没有哪句话需要纠正
  })

  it('文件夹找不到的本地卡点删除：确认框说「从项目库移除」，不提回收站，交给主进程的是 unbind', async () => {
    const { deps, calls } = harness({}, false)
    await runProjectDeleteFlow({ id: 'p-missing', name: '找不到', source: 'native', missing: true }, deps)
    expect(calls.confirm[0].title).toBe('«studio.removeProjectTitle»')
    expect(calls.confirm[0].message).toContain('studio.removeProjectMessage')
    expect(calls.deleted).toEqual([{ id: 'p-missing', intent: 'unbind' }])
    expect(calls.movedToTrash).toEqual([])
    expect(calls.removedWithoutTrash).toEqual([])
  })

  it('外部文件夹点删除：同样只移除', async () => {
    const { deps, calls } = harness({}, false)
    await runProjectDeleteFlow({ id: 'p-folder', name: '外部', source: 'folder' }, deps)
    expect(calls.deleted).toEqual([{ id: 'p-folder', intent: 'unbind' }])
    expect(calls.movedToTrash).toEqual([])
    expect(calls.removedWithoutTrash).toEqual([])
  })

  it.each([
    ['win32', 'studio.trashBinWindows'],
    ['darwin', 'studio.trashBinMac'],
    ['linux', 'studio.trashBinLinux'],
  ])('本地项目（%s）：确认框说移到这个平台的回收站，意图 delete-files，成功后提示「已移到回收站」', async (platform, binKey) => {
    const { deps, calls } = harness({ platform })
    await runProjectDeleteFlow(local, deps)
    const bin = `«${binKey}»`
    expect(calls.confirm[0].message).toBe(`«studio.deleteProjectMessage|${JSON.stringify({ name: '本地', bin })}»`)
    expect(calls.deleted).toEqual([{ id: 'p-local', intent: 'delete-files' }])
    expect(calls.movedToTrash).toEqual([`«studio.projectMovedToTrash|${JSON.stringify({ name: '本地', bin })}»`])
  })

  // V-library-trash 建议 2：成功提示按「用户点了删除」弹，不按主进程真的移进了回收站弹。项目文件夹在访达里被挪走、库页没刷新时点删除，
  // 主进程找不到文件夹、只摘了登记，回 deleted:false——这时说「已移到废纸篓」是句假话（实际什么都没进废纸篓）。
  it.each([
    ['win32', 'studio.trashBinWindows'],
    ['darwin', 'studio.trashBinMac'],
    ['linux', 'studio.trashBinLinux'],
  ])('本地项目（%s）主进程说没移进回收站（deleted:false）：不提示「已移到回收站」，如实说只从项目库移除', async (platform, binKey) => {
    const { deps, calls } = harness({ platform }, false)
    await runProjectDeleteFlow(local, deps)
    const bin = `«${binKey}»`
    expect(calls.deleted).toEqual([{ id: 'p-local', intent: 'delete-files' }])
    expect(calls.movedToTrash).toEqual([])
    expect(calls.removedWithoutTrash).toEqual([`«studio.projectRemovedWithoutTrash|${JSON.stringify({ name: '本地', bin })}»`])
    expect(calls.failed).toEqual([]) // 没出错，只是没有东西可移
  })

  it('用户取消：什么都不做', async () => {
    const { deps, calls } = harness({ confirm: async () => false })
    await runProjectDeleteFlow(local, deps)
    expect(calls.deleted).toEqual([])
    expect(calls.released).toBe(0)
  })

  it('进不了回收站：交给失败处理（带上回收站叫法），不提示成功', async () => {
    const failure = new Error("Error invoking remote method 'nomi:projects:delete': Error: ProjectTrashFailedError[no-trash]: ...")
    const { deps, calls } = harness({ deleteLocalProject: async () => { throw failure } })
    await runProjectDeleteFlow(local, deps)
    expect(calls.failed).toEqual([{ id: 'p-local', error: failure, trashBin: '«studio.trashBinWindows»' }])
    expect(calls.movedToTrash).toEqual([])
  })

  it('删的是正打开的项目：先释放再删；没删成也回项目库（项目还在，卡片上显示原因）', async () => {
    const order: string[] = []
    const { deps, calls } = harness({
      isActive: (id) => id === 'p-local',
      releaseActive: async () => { order.push('release') },
      deleteLocalProject: async () => { order.push('delete'); throw new Error('ProjectTrashFailedError[in-use]: x') },
      leaveToLibrary: () => { order.push('leave') },
    })
    await runProjectDeleteFlow(local, deps)
    expect(order).toEqual(['release', 'delete', 'leave'])
    expect(calls.failed).toHaveLength(1)
  })

  it('删的不是正打开的项目：不释放、不跳转', async () => {
    const leave = vi.fn()
    const release = vi.fn(async () => {})
    const { deps } = harness({ leaveToLibrary: leave, releaseActive: release })
    await runProjectDeleteFlow(local, deps)
    expect(release).not.toHaveBeenCalled()
    expect(leave).not.toHaveBeenCalled()
  })
})
