import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  addProjectNodes,
  connectProjectNodes,
  createNamedProject,
  deleteProjectNodes,
  generateOnProject,
  listAllProjects,
  readProjectCanvas,
  referencesFromEdges,
  setProjectNodePrompt,
} from './core'
import { createDiskGateway } from './gateway'

describe('referencesFromEdges（连参考边=喂参考图，headless 兜底）', () => {
  const snap = {
    nodes: [
      { id: 'a', kind: 'image', result: { url: 'nomi-local://a.png' } },
      { id: 'b', kind: 'image' },
      { id: 'c', kind: 'image', url: 'nomi-local://c.png' },
    ],
    edges: [
      { id: 'e1', source: 'a', target: 'b', mode: 'reference', order: 1 },
      { id: 'e2', source: 'c', target: 'b', mode: 'character_ref', order: 0 },
    ],
    groups: [],
    selectedNodeIds: [],
  } as never
  it('收集指向目标节点的参考类入边的源资产，按 order 排', () => {
    expect(referencesFromEdges(snap, 'b')).toEqual(['nomi-local://c.png', 'nomi-local://a.png'])
  })
  it('无入边目标返回空', () => {
    expect(referencesFromEdges(snap, 'a')).toEqual([])
  })
  it('非参考类边（first_frame 等）不计入此兜底', () => {
    const s = { ...(snap as object), edges: [{ id: 'e', source: 'a', target: 'b', mode: 'first_frame', order: 0 }] } as never
    expect(referencesFromEdges(s, 'b')).toEqual([])
  })
})

const tempRoots: string[] = []
let mockedDocumentsRoot = ''
let mockedUserDataRoot = ''

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'documents') return mockedDocumentsRoot
      return mockedUserDataRoot
    },
    getAppPath: () => process.cwd(),
  },
}))

function makeTempDir(name = 'nomi-capcore-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name))
  tempRoots.push(dir)
  return dir
}

beforeEach(() => {
  mockedDocumentsRoot = makeTempDir('nomi-capcore-documents-')
  mockedUserDataRoot = makeTempDir('nomi-capcore-user-data-')
  delete process.env.NOMI_PROJECTS_DIR
})

afterEach(() => {
  delete process.env.NOMI_PROJECTS_DIR
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('capabilityCore/core (磁盘网关：直写 project.json)', () => {
  it('建项目 → 加节点 → 连线 → 改提示词 → 读画布，全程落盘且重读一致', async () => {
    const project = createNamedProject('能力核测试项目')
    expect(project.id).toBeTruthy()
    expect(listAllProjects().some((item) => item.id === project.id)).toBe(true)
    const gateway = createDiskGateway(project.id)

    const { ids } = await addProjectNodes(gateway, [
      { kind: 'text', prompt: '一句产品脚本' },
      { kind: 'image', title: '镜头 1' },
    ])
    expect(ids).toHaveLength(2)

    const connected = await connectProjectNodes(gateway, [{ source: ids[0], target: ids[1], mode: 'reference' }])
    expect(connected.edgeIds).toHaveLength(1)
    expect(connected.skipped).toHaveLength(0)

    const prompted = await setProjectNodePrompt(gateway, ids[1], '电影感写实，黄昏光线')
    expect(prompted.changed).toBe(true)

    // 重新读（从盘）—— 验证持久化往返一致。
    const canvas = await readProjectCanvas(createDiskGateway(project.id))
    expect(canvas.nodes).toHaveLength(2)
    expect(canvas.edges).toHaveLength(1)
    const shot = canvas.nodes.find((node) => node.id === ids[1])
    expect(shot?.prompt).toBe('电影感写实，黄昏光线')
  })

  it('删节点连带清边，落盘后边为空', async () => {
    const project = createNamedProject('删节点测试')
    const gateway = createDiskGateway(project.id)
    const { ids } = await addProjectNodes(gateway, [{ kind: 'image' }, { kind: 'video' }])
    await connectProjectNodes(gateway, [{ source: ids[0], target: ids[1] }])
    const removed = await deleteProjectNodes(gateway, [ids[0]])
    expect(removed.deleted).toEqual([ids[0]])
    const canvas = await readProjectCanvas(createDiskGateway(project.id))
    expect(canvas.nodes).toHaveLength(1)
    expect(canvas.edges).toHaveLength(0)
  })

  it('generate 构造正确请求体（注入 runTask 不打 vendor）并把结果落回节点', async () => {
    const project = createNamedProject('生成测试')
    const captured: Array<{ vendor: string; request: unknown }> = []
    const fakeRunTask = async (payload: { vendor: string; request: unknown }) => {
      captured.push(payload)
      return {
        id: 'task-xyz',
        status: 'succeeded',
        assets: [{ type: 'image', url: 'nomi-local://asset/p/img.png', providerUrl: 'https://cdn/img.png' }],
      }
    }

    const out = await generateOnProject(
      { projectId: project.id, intent: 'image', prompt: '一只赛博朋克猫', vendor: 'apimart', modelKey: 'seedream-4', references: ['https://cdn/ref.png'] },
      createDiskGateway(project.id),
      fakeRunTask,
    )

    expect(out.status).toBe('succeeded')
    expect(captured).toHaveLength(1)
    // 请求体：高层 TaskRequest，extras 带 modelKey/projectId/nodeId/referenceImages，kind 由 intent 推。
    const req = captured[0].request as { kind: string; prompt: string; extras: Record<string, unknown> }
    expect(captured[0].vendor).toBe('apimart')
    expect(req.kind).toBe('text_to_image')
    expect(req.prompt).toBe('一只赛博朋克猫')
    expect(req.extras.modelKey).toBe('seedream-4')
    expect(req.extras.projectId).toBe(project.id)
    expect(req.extras.nodeId).toBe(out.nodeId)
    expect(req.extras.referenceImages).toEqual(['https://cdn/ref.png'])

    // 结果落回节点：重读画布该节点 hasResult。
    const canvas = await readProjectCanvas(createDiskGateway(project.id))
    expect(canvas.nodes.find((node) => node.id === out.nodeId)?.hasResult).toBe(true)
  })

  it('generate：video + 有参考图 → image_to_video', async () => {
    const project = createNamedProject('视频意图测试')
    let kind = ''
    await generateOnProject(
      { projectId: project.id, intent: 'video', prompt: '镜头推进', vendor: 'apimart', modelKey: 'seedance', references: ['https://cdn/first.png'] },
      createDiskGateway(project.id),
      async (payload) => {
        kind = (payload.request as { kind: string }).kind
        return { id: 't', status: 'succeeded', assets: [] }
      },
    )
    expect(kind).toBe('image_to_video')
  })

  it('未知项目抛清晰错误', async () => {
    await expect(readProjectCanvas(createDiskGateway('ghost-id'))).rejects.toThrow(/项目不存在/)
  })
})
