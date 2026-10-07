// 外部（MCP）写画布 = 读整张图 → 主进程算 → 整张写回。读和写之间如果落了一次生成结局（钱已花），
// 写回不许把它盖掉；外部写入只改它声明要改的东西。
// 矩阵 = 两种网关（A：App 开着、项目在前台 → 渲染层 store；B：读写盘）× 每种 MCP 画布写操作 × 每种落地。
// 两种网关都走真实 core 函数 + 真实网关；A 模式的 rendererBridge 直接接到真实的渲染层 handler。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const roots = vi.hoisted(() => ({ documents: '', userData: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'documents' ? roots.documents : roots.userData),
    getAppPath: () => process.cwd(),
  },
}))

vi.mock('../../../electron/capabilityCore/rendererBridge', async () => {
  const { handleCapabilityApply } = await import('./capabilityApplyHandler')
  return {
    requestRenderer: (op: string, payload: unknown) => handleCapabilityApply(op, payload),
    requestRendererDecision: async () => ({ confirmed: true }),
  }
})

vi.mock('../project/projectCanvasReadSurface', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../project/projectCanvasReadSurface')>()),
  isProjectBindingOpen: () => true,
}))

import { addProjectNodes, connectProjectNodes, createNamedProject, deleteProjectNodes, setProjectNodePrompt } from '../../../electron/capabilityCore/core'
import { createDiskGateway, createRendererGateway, type ProjectGateway } from '../../../electron/capabilityCore/gateway'
import { readProject, saveProject } from '../../../electron/projects/repository'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { nodeRunOutcomePatch, type NodeRunOutcome } from '../generationCanvas/store/nodeRunOutcome'
import { deliverRunOutcome, type RunProjectTarget } from '../generationCanvas/runner/runProjectDelivery'
import type { GenerationCanvasNode, GenerationNodeResult, TiptapDocJson } from '../generationCanvas/model/generationCanvasTypes'

const TARGET = { projectId: 'p-ext', immutableProjectUuid: 'u-ext', projectGeneration: 1 } as RunProjectTarget
const SHOT = 'shot-1'
const OTHER = 'shot-2'
const TEXT = 'text-1'
const LANDED: GenerationNodeResult = { id: 'r-landed', type: 'image', url: 'nomi-local://landed.png', createdAt: 2 }
const DOC: TiptapDocJson = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'paid text' }] }] }

function seedNodes(): GenerationCanvasNode[] {
  const base = (id: string, kind: GenerationCanvasNode['kind'], x: number): GenerationCanvasNode => ({
    id, kind, title: id, position: { x, y: 40 }, prompt: `${id} prompt`, categoryId: 'shots', shotIndex: undefined,
  })
  return [base(SHOT, 'image', 100), base(OTHER, 'image', 600), { ...base(TEXT, 'text', 1100), categoryId: 'shots' }]
}

const tempRoots: string[] = []
const tempDir = (prefix: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempRoots.push(dir)
  return dir
}

type Mode = Readonly<{
  name: string
  setup: () => Promise<{ projectId: string; gateway: ProjectGateway }>
  /** 落一次结局：A = 渲染层真实投递（store）；B = 后台项目的盘上投递（同一个 nodeRunOutcomePatch 写盘）。 */
  land: (projectId: string, nodeId: string, outcome: NodeRunOutcome) => Promise<void>
  /** 用户此刻新建一个节点（读图之后）。 */
  createNode: (projectId: string, node: GenerationCanvasNode) => Promise<void>
  read: (projectId: string) => Promise<GenerationCanvasNode[]>
  readEdges: (projectId: string) => Promise<Array<{ source: string; target: string }>>
}>

function readDiskNodes(projectId: string): GenerationCanvasNode[] {
  const payload = readProject(projectId)!.payload as { generationCanvas: { nodes: GenerationCanvasNode[] } }
  return payload.generationCanvas.nodes
}

async function writeDiskNodes(projectId: string, change: (nodes: GenerationCanvasNode[]) => GenerationCanvasNode[]): Promise<void> {
  const record = readProject(projectId)!
  const payload = record.payload as { generationCanvas: { nodes: GenerationCanvasNode[] } }
  await saveProject(projectId, { ...record, payload: { ...payload, generationCanvas: { ...payload.generationCanvas, nodes: change(payload.generationCanvas.nodes) } } })
}

const MODES: readonly Mode[] = [
  {
    name: 'renderer gateway (project open)',
    setup: async () => {
      useGenerationCanvasStore.getState().restoreSnapshot({ nodes: seedNodes(), edges: [], groups: [], selectedNodeIds: [] })
      return { projectId: '', gateway: createRendererGateway('') }
    },
    land: async (_projectId, nodeId, outcome) => {
      await deliverRunOutcome(TARGET, nodeId, outcome)
    },
    createNode: async (_projectId, node) => {
      const created = useGenerationCanvasStore.getState().addNode({ kind: node.kind, title: node.title, position: node.position })
      createdIds.set(node.id, created.id)
    },
    read: async () => useGenerationCanvasStore.getState().nodes,
    readEdges: async () => useGenerationCanvasStore.getState().edges,
  },
  {
    name: 'disk gateway (project not in foreground)',
    setup: async () => {
      const project = createNamedProject('external write keeps landed')
      const record = readProject(project.id)!
      const payload = { ...(record.payload as Record<string, unknown>), generationCanvas: { nodes: seedNodes(), edges: [], groups: [] } }
      await saveProject(project.id, { ...record, payload })
      return { projectId: project.id, gateway: createDiskGateway(project.id) }
    },
    land: async (projectId, nodeId, outcome) => {
      await writeDiskNodes(projectId, (nodes) => nodes.map((node) => (node.id === nodeId ? { ...node, ...nodeRunOutcomePatch(node, outcome) } : node)))
    },
    createNode: async (projectId, node) => {
      createdIds.set(node.id, node.id)
      await writeDiskNodes(projectId, (nodes) => [...nodes, node])
    },
    read: async (projectId) => readDiskNodes(projectId),
    readEdges: async (projectId) => (readProject(projectId)!.payload as { generationCanvas: { edges: Array<{ source: string; target: string }> } }).generationCanvas.edges,
  },
]

const createdIds = new Map<string, string>()

type Landing = Readonly<{
  name: string
  land: (mode: Mode, projectId: string) => Promise<void>
  assertLanded: (nodes: GenerationCanvasNode[]) => void
}>

const find = (nodes: GenerationCanvasNode[], id: string) => nodes.find((node) => node.id === id)

const LANDINGS: readonly Landing[] = [
  {
    name: 'generation result',
    land: async (mode, projectId) => {
      await mode.land(projectId, SHOT, { kind: 'run-started', run: { id: 'run-a', status: 'running', startedAt: 10, updatedAt: 10 } })
      await mode.land(projectId, SHOT, { kind: 'result', result: LANDED })
    },
    assertLanded: (nodes) => {
      expect(find(nodes, SHOT)?.result?.id).toBe('r-landed')
      expect(find(nodes, SHOT)?.history?.map((entry) => entry.id)).toEqual(['r-landed'])
      expect(find(nodes, SHOT)?.status).toBe('success')
    },
  },
  {
    name: 'text finalisation',
    land: async (mode, projectId) => {
      await mode.land(projectId, TEXT, { kind: 'run-started', run: { id: 'run-t', status: 'running', startedAt: 10, updatedAt: 10 } })
      await mode.land(projectId, TEXT, { kind: 'content', contentJson: DOC, runId: 'run-t' })
    },
    assertLanded: (nodes) => expect(find(nodes, TEXT)?.contentJson).toEqual(DOC),
  },
  {
    name: 'generation in flight',
    land: async (mode, projectId) => {
      await mode.land(projectId, SHOT, { kind: 'run-started', run: { id: 'run-f', status: 'running', startedAt: 10, updatedAt: 10 } })
    },
    assertLanded: (nodes) => {
      expect(find(nodes, SHOT)?.status).toBe('running')
      expect(find(nodes, SHOT)?.runs?.[0]?.id).toBe('run-f')
    },
  },
]

type ExternalWrite = Readonly<{
  name: string
  run: (gateway: ProjectGateway, projectId: string) => Promise<unknown>
  assertApplied: (nodes: GenerationCanvasNode[], edges: Array<{ source: string; target: string }>) => void
}>

const EXTERNAL_WRITES: readonly ExternalWrite[] = [
  {
    name: 'set prompt',
    run: (gateway) => setProjectNodePrompt(gateway, SHOT, 'external prompt'),
    assertApplied: (nodes) => expect(find(nodes, SHOT)?.prompt).toBe('external prompt'),
  },
  {
    name: 'add nodes',
    run: (gateway, projectId) => addProjectNodes(gateway, [{ kind: 'image', title: 'ext A' }, { kind: 'image', title: 'ext B' }], projectId),
    assertApplied: (nodes) => expect(nodes.filter((node) => node.title === 'ext A' || node.title === 'ext B')).toHaveLength(2),
  },
  {
    name: 'delete another node',
    run: (gateway) => deleteProjectNodes(gateway, [OTHER]),
    assertApplied: (nodes) => expect(find(nodes, OTHER)).toBeUndefined(),
  },
  {
    name: 'connect nodes',
    run: (gateway) => connectProjectNodes(gateway, [{ source: OTHER, target: SHOT, mode: 'reference' }]),
    assertApplied: (_nodes, edges) => expect(edges.some((edge) => edge.source === OTHER && edge.target === SHOT)).toBe(true),
  },
]

/** 真实网关包一层：读图返回之后、写回之前，落一次结局（模拟方案卡开着 / 主进程在算的那段时间）。 */
function landAfterRead(gateway: ProjectGateway, land: () => Promise<void>): ProjectGateway {
  return {
    ...gateway,
    readDoc: async () => {
      const doc = await gateway.readDoc()
      await land()
      return doc
    },
  }
}

beforeEach(() => {
  roots.documents = tempDir('nomi-extwrite-documents-')
  roots.userData = tempDir('nomi-extwrite-user-data-')
  createdIds.clear()
})

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('an external canvas write never overwrites an outcome that landed after it read the canvas', () => {
  const matrix = MODES.flatMap((mode) => EXTERNAL_WRITES.flatMap((write) => LANDINGS.map((landing) => [mode.name, write.name, landing.name, mode, write, landing] as const)))

  it.each(matrix)('%s · %s · %s', async (_m, _w, _l, mode, write, landing) => {
    const { projectId, gateway } = await mode.setup()
    await write.run(landAfterRead(gateway, () => landing.land(mode, projectId)), projectId)
    const nodes = await mode.read(projectId)
    landing.assertLanded(nodes)
    write.assertApplied(nodes, await mode.readEdges(projectId))
  })

  it.each(MODES.map((mode) => [mode.name, mode] as const))('%s · a node the user created (and generated) after the read survives', async (_name, mode) => {
    const { projectId, gateway } = await mode.setup()
    const fresh: GenerationCanvasNode = { id: 'fresh-node', kind: 'image', title: 'fresh', position: { x: 1600, y: 40 }, prompt: '', categoryId: 'shots' }
    await setProjectNodePrompt(landAfterRead(gateway, async () => {
      await mode.createNode(projectId, fresh)
      await mode.land(projectId, createdIds.get('fresh-node')!, { kind: 'result', result: LANDED })
    }), SHOT, 'external prompt')
    const nodes = await mode.read(projectId)
    expect(find(nodes, createdIds.get('fresh-node')!)?.result?.id).toBe('r-landed')
    expect(find(nodes, SHOT)?.prompt).toBe('external prompt')
  })
})
