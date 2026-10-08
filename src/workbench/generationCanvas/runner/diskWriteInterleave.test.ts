// 方向检查 docs/plan/2026-10-07-canvas-landing-direction-check.md §3 预测 ③（特征测试清单第 4 条）：
// 同一个**没在前台**的项目文件有两个读改写的写手，分在两个进程：
// - 渲染进程：后台运行的结局投递（runProjectDelivery.deliverRunOutcome：读盘 → 叠结局 → 整份存回）；
// - 主进程：headless / 混合网关的外部 MCP 写（gateway.createDiskGateway().apply：读盘 → 三方合并 → 整份存回）。
// 两边各自只在**本进程内**串行，进程之间没有共享锁，也没有 revision 校验。
//
// 钉现状：网关先写、投递后写（投递读的是网关写之前那份）→ 外部改动被投递整份盖掉（`it.fails` = 期望两边都在，今天红）。
// 反过来（投递先写、网关后写）今天就是对的：网关在**写那一刻**重新读盘再合并。
// 这一刀（画布写边界统一）不修这条：修法要么给项目文件加 revision CAS，要么让渲染进程的盘上投递改走主进程同一个写口，
// 两条都碰项目保存协议，交协调会话定。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const disk = vi.hoisted(() => ({
  record: null as null | { id: string; payload: Record<string, unknown> },
  gate: null as null | Promise<void>,
  entered: null as null | (() => void),
}))

vi.mock('../../project/projectCanvasReadSurface', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../project/projectCanvasReadSurface')>()),
  isProjectBindingOpen: () => false,
}))

// 渲染进程这一侧的读盘 / 存盘（真实形状：异步 IPC 往返）；`gate` 让测试把「读完、还没存」停在中间。
vi.mock('../../library/localProjectStore', () => ({
  readLocalProjectAsync: async () => {
    const snapshot = structuredClone(disk.record)
    disk.entered?.()
    if (disk.gate) await disk.gate
    return snapshot
  },
  saveLocalProject: async (_projectId: string, payload: Record<string, unknown>) => {
    disk.record = { ...disk.record!, payload: structuredClone(payload) }
    return disk.record
  },
}))

// 主进程这一侧（真实网关代码，只把仓库接到同一份内存盘上）。
vi.mock('../../../../electron/projects/repository', () => ({
  readProject: () => structuredClone(disk.record),
  saveProject: async (_projectId: string, record: { id: string; payload: Record<string, unknown> }) => {
    disk.record = structuredClone(record)
    return disk.record
  },
}))
vi.mock('../../../../electron/capabilityCore/rendererBridge', () => ({ requestRenderer: vi.fn(), requestRendererDecision: vi.fn() }))
vi.mock('../../../desktop/bridge', () => ({
  getDesktopBridge: () => ({ projects: {
    applyCanvasNodePatch: async ({ projectId, nodeId, patch }: { projectId: string; nodeId: string; patch: Record<string, unknown> }) => {
      const record = disk.record as { id: string; payload: { generationCanvas: { nodes: GenerationCanvasNode[] } } } | null
      if (!record || record.id !== projectId) return { applied: false }
      record.payload.generationCanvas.nodes = record.payload.generationCanvas.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node)
      return { applied: true }
    },
  } }),
}))

import { createDiskGateway } from '../../../../electron/capabilityCore/gateway'
import { deliverRunOutcome, type RunProjectTarget } from './runProjectDelivery'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

const TARGET = { projectId: 'p-bg', immutableProjectUuid: 'u-bg', projectGeneration: 1 } as RunProjectTarget
const shot = (id: string, prompt: string): GenerationCanvasNode => ({ id, kind: 'image', title: id, prompt, position: { x: 0, y: 0 }, categoryId: 'shots' })

function seedDisk(): void {
  disk.gate = null
  disk.entered = null
  disk.record = {
    id: TARGET.projectId,
    payload: { generationCanvas: { nodes: [shot('a', 'a prompt'), shot('b', 'b prompt')], edges: [], groups: [] } },
  } as never
  Object.assign(disk.record!, { immutableProjectUuid: TARGET.immutableProjectUuid, projectGeneration: TARGET.projectGeneration })
}

const diskNode = (id: string) => (disk.record!.payload.generationCanvas as { nodes: GenerationCanvasNode[] }).nodes.find((node) => node.id === id)

async function externalPromptEdit(): Promise<void> {
  const gateway = createDiskGateway(TARGET.projectId)
  const base = await gateway.readDoc()
  const next = { ...base, nodes: base.nodes.map((node) => (node.id === 'b' ? { ...node, prompt: 'external prompt' } : node)) }
  await gateway.apply(next as never, base)
}

const RESULT = { kind: 'result', result: { id: 'r-bg', type: 'image', url: 'nomi-local://bg.png', createdAt: 5 } } as const

describe('prediction ③: background delivery (renderer) and external disk write (main) interleave on one project file', () => {
  beforeEach(seedDisk)

  it('current: delivery writes first, the gateway re-reads at write time — both changes stay', async () => {
    await deliverRunOutcome(TARGET, 'a', RESULT)
    await externalPromptEdit()
    expect(diskNode('a')?.result?.id).toBe('r-bg')
    expect(diskNode('b')?.prompt).toBe('external prompt')
  })

  it('delivery reads, the gateway writes, and the main write port preserves the external edit', async () => {
    let release!: () => void
    disk.gate = new Promise<void>((resolve) => { release = resolve })
    const read = new Promise<void>((resolve) => { disk.entered = resolve })
    const delivery = deliverRunOutcome(TARGET, 'a', RESULT)
    await read // 投递已经读完盘、还没存回
    await externalPromptEdit()
    disk.gate = null
    release()
    await delivery
    expect(diskNode('a')?.result?.id).toBe('r-bg')
    expect(diskNode('b')?.prompt).toBe('external prompt')
  })
})
