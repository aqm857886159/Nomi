// 3D-BOX 开关的两张工具面：开关关时对外 MCP 面、preload 取证白名单与改动前逐字节相同；开关开时
// `stage_shot` 换芯到仅内部的 `director.write`，对外 MCP 面仍然逐字节不变。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installDirector3DBoxFace, resetDirector3DBoxFaceForTests } from '../shared/featureFlags/director3dboxFace'

async function face(enabled: boolean) {
  vi.resetModules()
  resetDirector3DBoxFaceForTests()
  installDirector3DBoxFace(enabled)
  const { MCP_TOOL_RESOLVER } = await import('./mcpToolCatalog')
  const { MODEL_FACING_TOOL_SPECS } = await import('../shared/agentCapabilities/modelFacingToolRegistry')
  const { CAPABILITY_CONTRACTS, resolveCapabilityAlias } = await import('../shared/agentCapabilities/registry')
  const { canvasWriteCaptureOperations } = await import('../surfacePortPreloadBridge')
  return {
    mcp: JSON.stringify(MCP_TOOL_RESOLVER.list()),
    internal: MODEL_FACING_TOOL_SPECS.filter((spec) => spec.profiles?.includes('internal') ?? true),
    contracts: CAPABILITY_CONTRACTS.map((contract) => contract.id),
    stageShotOwner: resolveCapabilityAlias('stage_shot')?.contract.id,
    capture: canvasWriteCaptureOperations(enabled),
  }
}

afterEach(() => {
  resetDirector3DBoxFaceForTests()
  vi.resetModules()
})

const PRE_3DBOX_CAPTURE_OPERATIONS = [
  'set_node_prompt', 'set_node_text', 'create_canvas_nodes', 'connect_canvas_edges', 'tidy_canvas', 'propose_storyboard_plan',
  'patch_shots', 'arrange_storyboard_to_timeline', 'create_staging_reference', 'create_camera_move', 'delete_canvas_nodes',
]

describe('3D-BOX tool face', () => {
  // 开关关 = 改动前逐字节（3b 交付时与 a6e067250 上的 tools/list 做过 sha256 比对，见 3b 报告）。
  // 开关开时对外 MCP 的工具、参数 schema 一个不变；唯一差别是 `nomi_canvas_edit` 的说明书里不再拼旧
  // `stage_shot` 那段（说明书从内部动词派生，旧动词在开关开的构建里不装配）。`director.write` 永不出现在对外面。
  it('changes nothing on the external MCP face except the folded legacy stage_shot prose when on', async () => {
    const off = JSON.parse((await face(false)).mcp) as Array<Record<string, unknown>>
    const on = JSON.parse((await face(true)).mcp) as Array<Record<string, unknown>>
    expect(on.map((tool) => tool.name)).toEqual(off.map((tool) => tool.name))
    for (const [index, tool] of on.entries()) {
      const before = off[index]
      if (tool.name === 'nomi_canvas_edit') {
        expect({ ...tool, description: '' }).toEqual({ ...before, description: '' })
        expect(String(before.description).startsWith('Change how existing nodes relate')).toBe(true)
        expect(String(tool.description)).not.toContain('Attach a staging')
      } else {
        expect(tool).toEqual(before)
      }
    }
    expect(JSON.stringify(on)).not.toContain('director.write')
  }, 60_000)

  it('assembles exactly one stage_shot per build and moves it to the internal-only contract when on', async () => {
    const off = await face(false)
    const on = await face(true)
    expect(off.internal.filter((spec) => spec.name === 'stage_shot').map((spec) => spec.contractId)).toEqual(['canvas.write'])
    expect(on.internal.filter((spec) => spec.name === 'stage_shot').map((spec) => spec.contractId)).toEqual(['director.write'])
    expect(on.internal.map((spec) => spec.name)).toEqual(off.internal.map((spec) => spec.name))
    expect(off.contracts).not.toContain('director.write')
    expect(on.contracts).toContain('director.write')
    expect(off.stageShotOwner).toBe('canvas.write')
    expect(on.stageShotOwner).toBe('director.write')
  }, 60_000)

  it('keeps the preload capture whitelist identical when off and only appends the two director operations when on', async () => {
    const off = await face(false)
    expect([...off.capture]).toEqual(PRE_3DBOX_CAPTURE_OPERATIONS)
    const on = await face(true)
    expect([...on.capture]).toEqual([...PRE_3DBOX_CAPTURE_OPERATIONS, 'create_director_plan', 'patch_director_plan'])
  }, 60_000)

  it('drops a director capture request at the preload boundary when the flag is off', async () => {
    const { createCanvasReadSurfacePreloadBridge } = await import('../surfacePortPreloadBridge')
    const listeners = new Map<string, (payload: unknown) => void>()
    const events = { subscribe: (channel: string, listener: (payload: unknown) => void) => { listeners.set(channel, listener); return () => undefined }, send: () => undefined }
    const seen: string[] = []
    for (const enabled of [false, true]) {
      listeners.clear()
      const bridge = createCanvasReadSurfacePreloadBridge(async () => undefined, events, { director3dbox: enabled })
      bridge.onCanvasWriteCapture((request) => { seen.push(`${enabled}:${request.operation}`); return { ok: true } as never })
      const listener = [...listeners.values()][0]
      listener({ requestId: 'r1', binding: { projectId: 'p' }, operation: 'create_director_plan', input: {} })
    }
    expect(seen).toEqual(['true:create_director_plan'])
  })
})

describe('3D-BOX tool face survives the lane schema bridge', () => {
  // 真机首跑抓到的：外层 .describe() 盖掉了计划 schema 自己那句描述，lane 装配期的无损断言当场抛，
  // 整个 Agent 面板起不来。单测这里按开关开 / 关各把全部内部动词过一遍同一个桥。
  it.each([false, true])('every internal verb converts without information loss (flag %s)', async (enabled) => {
    const { internal } = await face(enabled)
    const { toModelVisibleSchema } = await import('../agentLane/laneToolSchema.mts')
    for (const spec of internal) {
      expect(() => toModelVisibleSchema(spec.schema, { toolName: spec.name } as never), spec.name).not.toThrow()
    }
  }, 60_000)
})
