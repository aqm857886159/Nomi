import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  addProjectNodes,
  connectProjectNodes,
  createNamedProject,
  deleteProjectNodes,
  listAllProjects,
  setProjectNodePrompt,
} from './core'
import { createDiskGateway, type PlanConfirmInfo, type ProjectGateway } from './gateway'

async function readRawProjectCanvas(projectId: string): Promise<{
  nodes: Array<{ id: string; prompt?: string; result?: unknown }>
  edges: unknown[]
}> {
  return await createDiskGateway(projectId).readDoc() as {
    nodes: Array<{ id: string; prompt?: string; result?: unknown }>
    edges: unknown[]
  }
}

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
  vi.stubEnv("NOMI_PROJECTS_DIR", undefined)
})

afterEach(() => {
  vi.stubEnv("NOMI_PROJECTS_DIR", undefined)
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
    const canvas = await readRawProjectCanvas(project.id)
    expect(canvas.nodes).toHaveLength(2)
    expect(canvas.edges).toHaveLength(1)
    const shot = canvas.nodes.find((node) => node.id === ids[1])
    expect(shot?.prompt).toBe('电影感写实，黄昏光线')
  })

  it('方案门（Phase B）：≥2 节点弹门确认，批准落画布 / 拒绝不落回 cancelled / 单节点不弹', async () => {
    function mockGateway(planApproved: boolean) {
      const planCalls: PlanConfirmInfo[] = []
      let applyCount = 0
      const gateway: ProjectGateway = {
        readDoc: async () => ({ nodes: [], edges: [] }),
        apply: async () => { applyCount += 1 },
        confirmPlan: async (info) => { planCalls.push(info); return planApproved },
      }
      return { gateway, planCalls, getApplyCount: () => applyCount }
    }

    // 批准 → 落画布，方案门带对齐的 nodeCount/titles/projectId。
    const approved = mockGateway(true)
    const okRes = await addProjectNodes(approved.gateway, [{ kind: 'image', title: '镜 1' }, { kind: 'image', title: '镜 2' }], 'proj-1')
    expect(approved.planCalls).toHaveLength(1)
    expect(approved.planCalls[0]).toMatchObject({ nodeCount: 2, projectId: 'proj-1', titles: ['镜 1', '镜 2'] })
    expect(okRes.ids).toHaveLength(2)
    expect(okRes.cancelled).toBeUndefined()
    expect(approved.getApplyCount()).toBe(1)

    // 拒绝 → 不落画布（apply 零调用）、回 cancelled。
    const rejected = mockGateway(false)
    const noRes = await addProjectNodes(rejected.gateway, [{ kind: 'image' }, { kind: 'video' }], 'proj-1')
    expect(rejected.planCalls).toHaveLength(1)
    expect(noRes.cancelled).toBe(true)
    expect(noRes.ids).toEqual([])
    expect(rejected.getApplyCount()).toBe(0)

    // 单节点不算「方案」→ 不弹门，直落。
    const single = mockGateway(true)
    const oneRes = await addProjectNodes(single.gateway, [{ kind: 'image', title: '一张图' }], 'proj-1')
    expect(single.planCalls).toHaveLength(0)
    expect(oneRes.ids).toHaveLength(1)
  })

  it('删节点连带清边，落盘后边为空', async () => {
    const project = createNamedProject('删节点测试')
    const gateway = createDiskGateway(project.id)
    const { ids } = await addProjectNodes(gateway, [{ kind: 'image' }, { kind: 'video' }])
    await connectProjectNodes(gateway, [{ source: ids[0], target: ids[1] }])
    const removed = await deleteProjectNodes(gateway, [ids[0]])
    expect(removed.deleted).toEqual([ids[0]])
    const canvas = await readRawProjectCanvas(project.id)
    expect(canvas.nodes).toHaveLength(1)
    expect(canvas.edges).toHaveLength(0)
  })

  it('未知项目抛清晰错误', async () => {
    await expect(readRawProjectCanvas('ghost-id')).rejects.toThrow(/项目不存在/)
  })
})
