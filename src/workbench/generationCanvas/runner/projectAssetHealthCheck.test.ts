import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDesktopBridge } from '../../../desktop/bridge'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { runProjectAssetHealthCheck } from './projectAssetHealthCheck'

vi.mock('../../../desktop/bridge', () => ({ getDesktopBridge: vi.fn() }))
const mockedBridge = vi.mocked(getDesktopBridge)

function bridgeWithImport(importRemoteUrl: ReturnType<typeof vi.fn>) {
  return { assets: { importRemoteUrl } } as unknown as ReturnType<typeof getDesktopBridge>
}

function seedVideoNode(url: string): string {
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'video', title: '镜头', prompt: 's' })
  useGenerationCanvasStore.getState().updateNode(node.id, {
    status: 'success',
    result: { id: `${node.id}-r`, type: 'video', url, createdAt: 1 },
  })
  return node.id
}

function urlOf(nodeId: string): string | undefined {
  return useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId)?.result?.url
}

function currentGuard() {
  return { signal: new AbortController().signal, assertCurrent: vi.fn() }
}

describe('runProjectAssetHealthCheck — 开项目抢救漏落的厂商临时 URL', () => {
  beforeEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
    mockedBridge.mockReset()
  })

  it('http 节点 → 下载落地并写回本地 url；nomi-local 节点原样不动、不调 bridge', async () => {
    const importRemoteUrl = vi.fn().mockResolvedValue({
      id: 'a1',
      data: { url: 'nomi-local://asset/proj-1/assets/generated/v.mp4' },
    })
    mockedBridge.mockReturnValue(bridgeWithImport(importRemoteUrl))
    const staleNode = seedVideoNode('https://cdn.vendor/v.mp4')
    const healthyNode = seedVideoNode('nomi-local://asset/proj-1/assets/generated/ok.mp4')

    await runProjectAssetHealthCheck('proj-1', currentGuard())

    expect(urlOf(staleNode)).toBe('nomi-local://asset/proj-1/assets/generated/v.mp4')
    expect(urlOf(healthyNode)).toBe('nomi-local://asset/proj-1/assets/generated/ok.mp4')
    // 只为 http 那一个节点下载，健康的不碰
    expect(importRemoteUrl).toHaveBeenCalledTimes(1)
    expect(importRemoteUrl).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://cdn.vendor/v.mp4' }))
  })

  it('救不回（URL 已过期，下载失败）→ 保持原 http，交给播放守卫诚实报错', async () => {
    const importRemoteUrl = vi.fn().mockRejectedValue(new Error('403'))
    mockedBridge.mockReturnValue(bridgeWithImport(importRemoteUrl))
    const node = seedVideoNode('https://cdn.vendor/expired.mp4')

    await runProjectAssetHealthCheck('proj-1', currentGuard())

    expect(urlOf(node)).toBe('https://cdn.vendor/expired.mp4')
  })

  it('projectId 空 → 直接返回，不扫不调 bridge', async () => {
    const importRemoteUrl = vi.fn()
    mockedBridge.mockReturnValue(bridgeWithImport(importRemoteUrl))
    seedVideoNode('https://cdn.vendor/v.mp4')

    await runProjectAssetHealthCheck('', currentGuard())

    expect(importRemoteUrl).not.toHaveBeenCalled()
  })

  it('体检期间节点被换掉（用户重生成）→ 不用旧结果覆盖新的', async () => {
    let resolveImport: (value: unknown) => void = () => {}
    const importRemoteUrl = vi.fn().mockImplementation(
      () => new Promise((resolve) => { resolveImport = resolve }),
    )
    mockedBridge.mockReturnValue(bridgeWithImport(importRemoteUrl))
    const node = seedVideoNode('https://cdn.vendor/v.mp4')

    const check = runProjectAssetHealthCheck('proj-1', currentGuard())
    // 下载在途时，用户重生成把该节点换成了新的本地结果
    useGenerationCanvasStore.getState().updateNode(node, {
      result: { id: 'fresh', type: 'video', url: 'nomi-local://asset/proj-1/assets/generated/fresh.mp4', createdAt: 2 },
    })
    resolveImport({ data: { url: 'nomi-local://asset/proj-1/assets/generated/stale.mp4' } })
    await check

    // 新结果不被过期体检的旧本地化覆盖
    expect(urlOf(node)).toBe('nomi-local://asset/proj-1/assets/generated/fresh.mp4')
  })

  it('does not write a localized result after the hydration epoch is superseded', async () => {
    let resolveImport: (value: unknown) => void = () => {}
    const importRemoteUrl = vi.fn().mockImplementation(
      () => new Promise((resolve) => { resolveImport = resolve }),
    )
    mockedBridge.mockReturnValue(bridgeWithImport(importRemoteUrl))
    const node = seedVideoNode('https://cdn.vendor/v.mp4')
    let current = true
    const guard = {
      signal: new AbortController().signal,
      assertCurrent: vi.fn(() => {
        if (!current) throw new Error('project_hydration_superseded')
      }),
    }

    const check = runProjectAssetHealthCheck('proj-1', guard)
    current = false
    resolveImport({ data: { url: 'nomi-local://asset/proj-1/assets/generated/late.mp4' } })

    await expect(check).rejects.toThrow('project_hydration_superseded')
    expect(urlOf(node)).toBe('https://cdn.vendor/v.mp4')
  })
})
