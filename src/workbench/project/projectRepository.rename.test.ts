// 项目库列表「双击改名」的后端（#888）。核心防线：改名只换 name，绝不丢用户数据。
// 探针=改一个内置分类的名字：若改名误走 saveLocalProject 的三部分窄接口（state 不含 categories），
// normalizePayload 的字段重建式会把 categories 重置回内置默认名、丢掉这个改动。存回仍保留自定义
// 分类名 = 证明走的是「读完整 record 只换 name 存回」而非三部分接口。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renameLocalProject } from './projectRepository'
import { createDefaultWorkbenchProjectPayload } from './projectRecordSchema'
import { getDesktopBridge } from '../../desktop/bridge'

vi.mock('../../desktop/bridge', () => ({ getDesktopBridge: vi.fn() }))
const mockedBridge = vi.mocked(getDesktopBridge)

const CUSTOM_CATEGORY_NAME = '我改的分类名'

function fixtureRecord(name: string) {
  const payload = createDefaultWorkbenchProjectPayload()
  if (payload.categories && payload.categories[0]) {
    payload.categories[0] = { ...payload.categories[0], name: CUSTOM_CATEGORY_NAME }
  }
  return { id: 'p1', name, createdAt: 1, updatedAt: 1, revision: 3, version: 1 as const, payload }
}

function mountBridge(record: unknown) {
  const saved: unknown[] = []
  const read = vi.fn(() => record)
  const save = vi.fn((_id: string, rec: unknown) => {
    saved.push(rec)
    return rec
  })
  mockedBridge.mockReturnValue({
    platform: 'darwin',
    projects: { read, save } as never,
    workspace: {} as never,
    cost: {} as never,
    assets: {} as never,
    exports: {} as never,
    tasks: {} as never,
    agents: {} as never,
    modelCatalog: {} as never,
  } as never)
  return { read, save, saved }
}

describe('renameLocalProject', () => {
  beforeEach(() => mockedBridge.mockReset())

  it('改名生效，且存回的 payload 仍保留自定义分类名（没走丢数据的三部分接口）', async () => {
    const { save, saved } = mountBridge(fixtureRecord('旧名'))
    const result = await renameLocalProject('p1', '新名')
    expect(result?.name).toBe('新名')
    expect(save).toHaveBeenCalledTimes(1)
    const savedPayload = (saved[0] as { payload: { categories?: Array<{ name: string }> } }).payload
    expect(savedPayload.categories?.some((c) => c.name === CUSTOM_CATEGORY_NAME)).toBe(true)
  })

  it('revision +1、内容（generationCanvas）原样不动', async () => {
    const { saved } = mountBridge(fixtureRecord('旧名'))
    await renameLocalProject('p1', '新名')
    const rec = saved[0] as { revision: number; payload: { generationCanvas: unknown } }
    expect(rec.revision).toBe(4)
    expect(rec.payload.generationCanvas).toBeTruthy()
  })

  it('空名 / 未变 → no-op，不写盘', async () => {
    const { save } = mountBridge(fixtureRecord('旧名'))
    expect((await renameLocalProject('p1', '   '))?.name).toBe('旧名')
    expect((await renameLocalProject('p1', '旧名'))?.name).toBe('旧名')
    expect(save).not.toHaveBeenCalled()
  })

  it('空 id / 不存在的项目 → null，不炸', async () => {
    mockedBridge.mockReturnValue({
      platform: 'darwin',
      projects: { read: vi.fn(() => null) } as never,
      workspace: {} as never, cost: {} as never, assets: {} as never,
      exports: {} as never, tasks: {} as never, agents: {} as never, modelCatalog: {} as never,
    } as never)
    expect(await renameLocalProject('', '新名')).toBeNull()
    expect(await renameLocalProject('missing', '新名')).toBeNull()
  })
})
