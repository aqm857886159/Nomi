import { describe, expect, it, vi } from 'vitest'

const { importProjectAsset } = vi.hoisted(() => ({ importProjectAsset: vi.fn(async (input: unknown) => input) }))
vi.mock('./core', () => ({ importProjectAsset }))

import { dispatchAssetImport } from './assetImportRoute'
import { MCP_REQUEST_SIGNAL } from './mcpProtocol'

describe('asset.import 的路由体', () => {
  it('协议层挂在 params 上的请求信号交给导入：客户端断开 = 中止这次导入的转码', async () => {
    const controller = new AbortController()
    const params: Record<string, unknown> = { projectId: 'p1', path: '/tmp/a.mov', title: ' clip-a ' }
    Object.defineProperty(params, MCP_REQUEST_SIGNAL, { value: controller.signal })
    await dispatchAssetImport(params)
    expect(importProjectAsset).toHaveBeenLastCalledWith({ projectId: 'p1', path: '/tmp/a.mov', title: 'clip-a', signal: controller.signal })
  })

  it('没有请求信号（回环 RPC 那一跳过了 JSON）就不带 signal；多余字段照旧拒', async () => {
    await dispatchAssetImport({ projectId: 'p1', path: '/tmp/a.mov' })
    expect(importProjectAsset).toHaveBeenLastCalledWith({ projectId: 'p1', path: '/tmp/a.mov' })
    expect(() => dispatchAssetImport({ projectId: 'p1', path: '/tmp/a.mov', extra: 1 })).toThrow()
  })
})
