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
  referencesFromEdges,
  resolveCapabilityPollTimeoutMs,
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

describe('headless 轮询预算', () => {
  it('视频默认等待 15 分钟，非视频维持 4 分钟，显式环境变量优先', () => {
    expect(resolveCapabilityPollTimeoutMs('text_to_video', undefined)).toBe(900_000)
    expect(resolveCapabilityPollTimeoutMs('image_to_video', undefined)).toBe(900_000)
    expect(resolveCapabilityPollTimeoutMs('text_to_image', undefined)).toBe(240_000)
    expect(resolveCapabilityPollTimeoutMs('image_to_video', '1234')).toBe(1234)
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
        confirmSpend: async () => null,
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
    // ⚠️ 这条**曾经断言 text_to_image**——本用例明明传了 references，却把「参考图被丢掉」写成了规范，
    // 于是 bug 有测试保护、一直没人发现。真生成实测才暴露：喂「橘猫戴红围巾坐雪景窗台」的照片说
    // 「把围巾改成蓝色」，出来的是另一只白猫的插画（火山 Seedream 与 apimart 两条路都中招）。
    // 带参考图 = 改图，与 video 那支对称。
    expect(req.kind).toBe('image_edit')
    expect(req.prompt).toBe('一只赛博朋克猫')
    expect(req.extras.modelKey).toBe('seedream-4')
    expect(req.extras.projectId).toBe(project.id)
    expect(req.extras.nodeId).toBe(out.nodeId)
    expect(req.extras.referenceImages).toEqual(['https://cdn/ref.png'])

    // 结果落回节点：重读画布该节点 hasResult。
    const canvas = await readRawProjectCanvas(project.id)
    expect(canvas.nodes.find((node) => node.id === out.nodeId)?.result).toBeTruthy()
  })

  it('generate：image + 没有参考图 → text_to_image（别反过来把纯文生也当改图）', async () => {
    const project = createNamedProject('纯文生图意图测试')
    let kind = ''
    await generateOnProject(
      { projectId: project.id, intent: 'image', prompt: '一只赛博朋克猫', vendor: 'apimart', modelKey: 'seedream-4' },
      createDiskGateway(project.id),
      async (payload) => {
        kind = (payload.request as { kind: string }).kind
        return { id: 't', status: 'succeeded', assets: [] }
      },
    )
    expect(kind).toBe('text_to_image')
  })

  // W1d：kind 按目录 derive——catalog 里模型声明了参考模式时，带参考生成用它选 kind（不硬编码 defaultKind）。
  // 落一份最小 catalog 到设置根（mockedUserDataRoot = getSettingsRoot），让 referenceModeForIntent 读得到。
  function seedCatalog(models: unknown[], mappings: unknown[]): void {
    const now = new Date().toISOString()
    const catalog = {
      version: 9,
      vendors: [{ key: 'apimart', name: 'APImart', enabled: true, authType: 'none', providerKind: 'openai-compatible', createdAt: now, updatedAt: now }],
      models, mappings, apiKeysByVendor: {},
    }
    fs.writeFileSync(path.join(mockedUserDataRoot, 'model-catalog.json'), JSON.stringify(catalog), 'utf8')
  }

  it('generate：image + 参考图 + 目录把参考模式声明在 text_to_image（读 image_urls）→ derive 出 text_to_image（≠硬编码 image_edit，证明真查目录）', async () => {
    // 关键：这个模型的**唯一**带参考模式挂在 text_to_image 上（少见但合法：某些中转的「改图」就复用 t2i 端点+图键）。
    // 硬编码 defaultKindForIntent('image', hasRefs) 会回 image_edit（那条 mapping 不存在 → 护栏拒），derive 则回
    // text_to_image（真实可发）。两者分叉 → 这条用例把「是否真查目录」和「是否只是硬编码」区分开（防假绿）。
    const project = createNamedProject('kind-derive-分叉')
    seedCatalog(
      [{ modelKey: 'relay-edit', vendorKey: 'apimart', labelZh: 'Relay 改图', kind: 'image', enabled: true, createdAt: 't', updatedAt: 't' }],
      [{ id: 't2i', vendorKey: 'apimart', modelKey: 'relay-edit', taskKind: 'text_to_image', name: 't2i', enabled: true, create: { method: 'POST', path: '/x', body: { image_urls: '{{request.params.image_urls}}' } }, createdAt: 't', updatedAt: 't' }],
    )
    let req: { kind: string; extras: Record<string, unknown> } | null = null
    await generateOnProject(
      { projectId: project.id, intent: 'image', prompt: '把围巾改成蓝色', vendor: 'apimart', modelKey: 'relay-edit', references: ['https://cdn/anchor.jpg'] },
      createDiskGateway(project.id),
      async (payload) => { req = payload.request as typeof req; return { id: 't', status: 'succeeded', assets: [{ type: 'image', url: 'nomi-local://gen.png' }] } },
    )
    expect(req!.kind).toBe('text_to_image') // derive 出真实带参考模式，而非硬编码 image_edit
    // 参考经 core 落进 extras.referenceImages（wire 侧 runtime 再投影到 image_urls——core 注入的 runTask 不过 runtime，此处验 core 职责）。
    expect(req!.extras.referenceImages).toEqual(['https://cdn/anchor.jpg'])
  })

  it('generate：video + 参考图 + 目录只声明 image_to_video → derive 出 image_to_video', async () => {
    const project = createNamedProject('kind-derive-i2v')
    seedCatalog(
      [{ modelKey: 'seedance', vendorKey: 'apimart', labelZh: 'Seedance', kind: 'video', enabled: true, createdAt: 't', updatedAt: 't' }],
      [{ id: 'i2v', vendorKey: 'apimart', modelKey: 'seedance', taskKind: 'image_to_video', name: 'i2v', enabled: true, create: { method: 'POST', path: '/x', body: { image_urls: '{{request.params.image_urls}}' } }, createdAt: 't', updatedAt: 't' }],
    )
    let kind = ''
    await generateOnProject(
      { projectId: project.id, intent: 'video', prompt: '缓慢推近', vendor: 'apimart', modelKey: 'seedance', references: ['https://cdn/frame.jpg'] },
      createDiskGateway(project.id),
      async (payload) => { kind = (payload.request as { kind: string }).kind; return { id: 't', status: 'succeeded', assets: [{ type: 'video', url: 'nomi-local://v.mp4' }] } },
    )
    expect(kind).toBe('image_to_video')
  })

  it('generate：image + 参考图 + 目录无任何带参考模式 → 回退硬编码 defaultKind（image_edit），护栏语义不变', async () => {
    const project = createNamedProject('kind-derive-回退')
    seedCatalog(
      [{ modelKey: 'zimage', vendorKey: 'apimart', labelZh: 'Z-Image', kind: 'image', enabled: true, createdAt: 't', updatedAt: 't' }],
      [{ id: 't2i', vendorKey: 'apimart', modelKey: 'zimage', taskKind: 'text_to_image', name: 't2i', enabled: true, create: { method: 'POST', path: '/x', body: { size: '{{request.params.size}}' } }, createdAt: 't', updatedAt: 't' }],
    )
    let kind = ''
    await generateOnProject(
      { projectId: project.id, intent: 'image', prompt: '改图', vendor: 'apimart', modelKey: 'zimage', references: ['https://cdn/x.jpg'] },
      createDiskGateway(project.id),
      async (payload) => { kind = (payload.request as { kind: string }).kind; return { id: 't', status: 'succeeded', assets: [] } },
    )
    expect(kind).toBe('image_edit') // derive 返 null → 回退 defaultKindForIntent（走护栏诚实拒绝路径，语义一字不动）
  })

  it('generate：显式 input.kind 覆盖目录 derive（最高优先）', async () => {
    const project = createNamedProject('kind-显式覆盖')
    seedCatalog(
      [{ modelKey: 'seedream', vendorKey: 'apimart', labelZh: 'Seedream', kind: 'image', enabled: true, createdAt: 't', updatedAt: 't' }],
      [{ id: 'edit', vendorKey: 'apimart', modelKey: 'seedream', taskKind: 'image_edit', name: 'edit', enabled: true, create: { method: 'POST', path: '/x', body: { image_urls: '{{request.params.image_urls}}' } }, createdAt: 't', updatedAt: 't' }],
    )
    let kind = ''
    await generateOnProject(
      { projectId: project.id, intent: 'image', kind: 'text_to_image', prompt: '纯文生', vendor: 'apimart', modelKey: 'seedream', references: ['https://cdn/x.jpg'] },
      createDiskGateway(project.id),
      async (payload) => { kind = (payload.request as { kind: string }).kind; return { id: 't', status: 'succeeded', assets: [] } },
    )
    expect(kind).toBe('text_to_image') // 显式 kind 赢过 derive 的 image_edit
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

  // 病根回归：轮询到点旧版只 break，result 保持 queued 且不带 error —— 调用方（MCP/agent/CLI）
  // 拿到一个**永远非终态**的结果，等同「一直转圈但没人告诉你出了什么事」。到点必须落终态。
  it('generate：轮询超时必须落 failed + 诚实原因，不能静默返回 queued', async () => {
    const project = createNamedProject('轮询超时测试')
    const previous = process.env.NOMI_POLL_TIMEOUT_MS
    process.env.NOMI_POLL_TIMEOUT_MS = '1'
    try {
      let polls = 0
      const out = await generateOnProject(
        { projectId: project.id, intent: 'image', prompt: '一只猫', vendor: 'apimart', modelKey: 'seedream-4' },
        createDiskGateway(project.id),
        async () => ({ id: 'task-stuck', status: 'queued', assets: [] }),
        async () => {
          polls += 1
          return { result: { id: 'task-stuck', status: 'queued', assets: [] } }
        },
      )
      expect(polls).toBeGreaterThan(0)
      expect(out.status).toBe('failed')
    } finally {
      if (previous === undefined) delete process.env.NOMI_POLL_TIMEOUT_MS
      else process.env.NOMI_POLL_TIMEOUT_MS = previous
    }
  })

  it('未知项目抛清晰错误', async () => {
    await expect(readRawProjectCanvas('ghost-id')).rejects.toThrow(/项目不存在/)
  })

  // ── W2 §3 I2V 两跳（参考图 → 首帧 I2I → I2V）：接线层断言。判据/编排的分支矩阵在 i2vTwoHop.test.ts。 ──

  it('两跳：video + 参考 + 模型 body 读 first_frame_url → 先发一次 image 出首帧，再把它当 firstFrameUrl 发 I2V', async () => {
    const project = createNamedProject('两跳-生效')
    seedCatalog(
      // 两跳需要**两个模型**：视频模型出这一镜，外加一个真的图片模型来画首帧静帧。
      // 曾经这里只种视频模型也能过——因为 runTaskFn 是桩，桩不管你要什么 kind 都还你一张图。
      // 真机上 findExecutableModel 按 kind 过滤，拿视频模型发 image_edit 必然抛错（L3-F1b 抓出）。
      [
        { modelKey: 'seedance', vendorKey: 'apimart', labelZh: 'Seedance', kind: 'video', enabled: true, createdAt: 't', updatedAt: 't' },
        { modelKey: 'seedream', vendorKey: 'apimart', labelZh: 'Seedream', kind: 'image', enabled: true, createdAt: 't', updatedAt: 't' },
      ],
      [
        { id: 'i2v', vendorKey: 'apimart', modelKey: 'seedance', taskKind: 'image_to_video', name: 'i2v', enabled: true, create: { method: 'POST', path: '/v', body: { first_frame_url: '{{request.params.first_frame_url}}' } }, createdAt: 't', updatedAt: 't' },
        { id: 'paint', vendorKey: 'apimart', modelKey: 'seedream', taskKind: 'image_edit', name: 'paint', enabled: true, create: { method: 'POST', path: '/i', body: { image_urls: '{{request.params.image_urls}}' } }, createdAt: 't', updatedAt: 't' },
      ],
    )
    const calls: Array<{ kind: string; firstFrameUrl?: unknown; grantId?: unknown }> = []
    await generateOnProject(
      { projectId: project.id, intent: 'video', prompt: '小周抬头看钟', vendor: 'apimart', modelKey: 'seedance', references: ['nomi-local://anchor.png'] },
      createDiskGateway(project.id),
      async (payload) => {
        const req = payload.request as { kind: string; extras?: Record<string, unknown> }
        calls.push({ kind: req.kind, firstFrameUrl: req.extras?.firstFrameUrl, grantId: req.extras?.grantId })
        return req.kind === 'image_edit'
          ? { id: 'ff', status: 'succeeded', assets: [{ type: 'image', url: 'nomi-local://ff.png' }] }
          : { id: 'v', status: 'succeeded', assets: [{ type: 'video', url: 'nomi-local://v.mp4' }] }
      },
    )
    // 两次 vendor 调用，顺序 = 先首帧图、后视频。
    expect(calls.map((c) => c.kind)).toEqual(['image_edit', 'image_to_video'])
    // 第 2 跳把首帧图填进 firstFrameUrl（archetypeInput 会投影成模型的 first_frame_url 键）。
    expect(calls[1].firstFrameUrl).toBe('nomi-local://ff.png')
  })

  it('两跳降级：模型**完全不吃图片参考**（纯文生）→ 只发一次（不白跑首帧）', async () => {
    // 夹具原本用的是 `reference_image_urls`——那其实**是**一条图片参考通道，只是没有「专用首帧键」这个名字。
    // 旧判据用手写正则猜键名，把它判成「不能带首帧」，于是这条测试固化了错误行为。
    // （同一个洞让两跳在 Seedance 上从来没触发过，见 docs/audit/2026-08-20-l3-f1-full-journey。）
    // 要保住这条测试的**本意**（模型根本收不到图 → 别浪费一跳），夹具必须是真的纯文生 body。
    const project = createNamedProject('两跳-降级-纯文生')
    seedCatalog(
      [{ modelKey: 'plainvid', vendorKey: 'apimart', labelZh: 'Plain', kind: 'video', enabled: true, createdAt: 't', updatedAt: 't' }],
      [{ id: 'i2v', vendorKey: 'apimart', modelKey: 'plainvid', taskKind: 'image_to_video', name: 'i2v', enabled: true, create: { method: 'POST', path: '/v', body: { prompt: '{{request.prompt}}', duration: '{{request.params.duration}}', generate_audio: '{{request.params.generate_audio}}' } }, createdAt: 't', updatedAt: 't' }],
    )
    const kinds: string[] = []
    await generateOnProject(
      { projectId: project.id, intent: 'video', prompt: 'p', vendor: 'apimart', modelKey: 'plainvid', references: ['nomi-local://a.png'] },
      createDiskGateway(project.id),
      async (payload) => { kinds.push((payload.request as { kind: string }).kind); return { id: 't', status: 'succeeded', assets: [{ type: 'video', url: 'nomi-local://v.mp4' }] } },
    )
    expect(kinds).toEqual(['image_to_video'])
  })

  it('★两跳哨兵：body 用数组式参考键（reference_image_urls / image_urls，无专用首帧键）→ **照样两跳**', async () => {
    // 这是 L3-F1 那个 bug 在 core 层的哨兵：Seedance 用 image_urls，旧正则 `image_url$` 匹配不上，
    // 于是招牌功能在主力模型上从来没跑过，而 L3-W2 还报了「两跳真跑」。
    const project = createNamedProject('两跳-数组参考键')
    seedCatalog(
      [
        { modelKey: 'arrvid', vendorKey: 'apimart', labelZh: 'Arr', kind: 'video', enabled: true, createdAt: 't', updatedAt: 't' },
        { modelKey: 'seedream', vendorKey: 'apimart', labelZh: 'Seedream', kind: 'image', enabled: true, createdAt: 't', updatedAt: 't' },
      ],
      [
        { id: 'i2v', vendorKey: 'apimart', modelKey: 'arrvid', taskKind: 'image_to_video', name: 'i2v', enabled: true, create: { method: 'POST', path: '/v', body: { image_urls: '{{request.params.image_urls}}' } }, createdAt: 't', updatedAt: 't' },
        { id: 'paint', vendorKey: 'apimart', modelKey: 'seedream', taskKind: 'image_edit', name: 'paint', enabled: true, create: { method: 'POST', path: '/i', body: { image_urls: '{{request.params.image_urls}}' } }, createdAt: 't', updatedAt: 't' },
      ],
      )
    const calls: Array<{ kind: string; refs?: unknown }> = []
    await generateOnProject(
      { projectId: project.id, intent: 'video', prompt: 'p', vendor: 'apimart', modelKey: 'arrvid', references: ['nomi-local://a.png'] },
      createDiskGateway(project.id),
      async (payload) => {
        const req = payload.request as { kind: string; extras?: Record<string, unknown> }
        calls.push({ kind: req.kind, refs: req.extras?.referenceImages })
        return req.kind === 'image_to_video'
          ? { id: 'v', status: 'succeeded', assets: [{ type: 'video', url: 'nomi-local://v.mp4' }] }
          : { id: 'ff', status: 'succeeded', assets: [{ type: 'image', url: 'nomi-local://ff.png' }] }
      },
    )
    expect(calls.map((c) => c.kind)).toEqual(['image_edit', 'image_to_video'])
    // 且第 2 跳的参考通道换成了**那张首帧静帧**，不再是原始锚卡——
    // 锚卡是中性灰背景的证件照，拿它当 i2v 驱动图等于让视频从证件照开始动。
    expect(calls[1].refs).toEqual(['nomi-local://ff.png'])
  })

  it('★两跳根因哨兵之二：图片模型是**异步 vendor**（首调只返 taskId）→ 必须轮询到终态，不能当「没出图」', async () => {
    // L3-F1b 第三轮真机抓出的最后一环：seedream 走「提交 → 轮询」，首调没有 assets，
    // 而首帧那跳直接读 assets[0] → 永远判「首帧未产出可用图」→ 每次都降级。
    // 主路径一直有轮询，这条支路漏了。**单测以前测不出来是因为桩同步返图**——桩不会 queued。
    const project = createNamedProject('两跳-异步画师')
    seedCatalog(
      [
        { modelKey: 'seedance', vendorKey: 'apimart', labelZh: 'Seedance', kind: 'video', enabled: true, createdAt: 't', updatedAt: 't' },
        { modelKey: 'seedream', vendorKey: 'apimart', labelZh: 'Seedream', kind: 'image', enabled: true, createdAt: 't', updatedAt: 't' },
      ],
      [
        { id: 'i2v', vendorKey: 'apimart', modelKey: 'seedance', taskKind: 'image_to_video', name: 'i2v', enabled: true, create: { method: 'POST', path: '/v', body: { first_frame_url: '{{request.params.first_frame_url}}' } }, createdAt: 't', updatedAt: 't' },
        { id: 'paint', vendorKey: 'apimart', modelKey: 'seedream', taskKind: 'image_edit', name: 'paint', enabled: true, create: { method: 'POST', path: '/i', body: { image_urls: '{{request.params.image_urls}}' } }, createdAt: 't', updatedAt: 't' },
      ],
    )
    const kinds: string[] = []
    let polls = 0
    const out = await generateOnProject(
      { projectId: project.id, intent: 'video', prompt: 'p', vendor: 'apimart', modelKey: 'seedance', references: ['nomi-local://a.png'] },
      createDiskGateway(project.id),
      // 画师像真 vendor 一样先返 queued（无 assets）；视频那跳同步返（简化）。
      async (payload) => {
        const req = payload.request as { kind: string }
        kinds.push(req.kind)
        return req.kind === 'image_edit'
          ? { id: 'ff-task', status: 'queued', assets: [] }
          : { id: 'v', status: 'succeeded', assets: [{ type: 'video', url: 'nomi-local://v.mp4' }] }
      },
      async () => {
        polls += 1
        return { result: { id: 'ff-task', status: 'succeeded', assets: [{ type: 'image', url: 'nomi-local://ff.png' }] } }
      },
    ) as { advisories?: string[] }
    expect(kinds).toEqual(['image_edit', 'image_to_video']) // 两跳真的都发了
    expect(polls).toBeGreaterThan(0) // 而且真的轮询了，没把 queued 当成「没出图」
    expect((out.advisories || []).join('\n')).not.toContain('未走') // 没有降级
  })

  it('★两跳根因哨兵：目录里只有视频模型、没有图片模型 → 降级一跳，且**把理由说出来**（不静默）', async () => {
    // L3-F1b 真机抓出的根因：第 1 跳曾拿视频模型自己去发 image_edit，findExecutableModel 按 kind
    // 过滤必然失败 → 抛错 → runFirstHop 吞掉 → 静默降级。外面只看得到「两跳没跑」，查了半小时。
    // 降级本身没错（韧性设计），**沉默才是错**。
    const project = createNamedProject('两跳-无画师')
    seedCatalog(
      [{ modelKey: 'seedance', vendorKey: 'apimart', labelZh: 'Seedance', kind: 'video', enabled: true, createdAt: 't', updatedAt: 't' }],
      [{ id: 'i2v', vendorKey: 'apimart', modelKey: 'seedance', taskKind: 'image_to_video', name: 'i2v', enabled: true, create: { method: 'POST', path: '/v', body: { first_frame_url: '{{request.params.first_frame_url}}' } }, createdAt: 't', updatedAt: 't' }],
    )
    const kinds: string[] = []
    const out = await generateOnProject(
      { projectId: project.id, intent: 'video', prompt: 'p', vendor: 'apimart', modelKey: 'seedance', references: ['nomi-local://a.png'] },
      createDiskGateway(project.id),
      async (payload) => { kinds.push((payload.request as { kind: string }).kind); return { id: 't', status: 'succeeded', assets: [{ type: 'video', url: 'nomi-local://v.mp4' }] } },
    ) as { advisories?: string[] }
    expect(kinds).toEqual(['image_to_video']) // 只发一次，没白跑首帧
    const said = (out.advisories || []).join('\n')
    expect(said).toContain('未走')
    expect(said).toContain('图片模型') // 说清楚缺的是什么，而不是「失败了」
  })

  it('两跳韧性：首帧那跳抛错 → 降级发视频（首帧失败绝不拖垮整个生成）', async () => {
    const project = createNamedProject('两跳-首帧失败')
    seedCatalog(
      [
        { modelKey: 'seedance', vendorKey: 'apimart', labelZh: 'Seedance', kind: 'video', enabled: true, createdAt: 't', updatedAt: 't' },
        { modelKey: 'seedream', vendorKey: 'apimart', labelZh: 'Seedream', kind: 'image', enabled: true, createdAt: 't', updatedAt: 't' },
      ],
      [
        { id: 'i2v', vendorKey: 'apimart', modelKey: 'seedance', taskKind: 'image_to_video', name: 'i2v', enabled: true, create: { method: 'POST', path: '/v', body: { first_frame_url: '{{request.params.first_frame_url}}' } }, createdAt: 't', updatedAt: 't' },
        { id: 'paint', vendorKey: 'apimart', modelKey: 'seedream', taskKind: 'image_edit', name: 'paint', enabled: true, create: { method: 'POST', path: '/i', body: { image_urls: '{{request.params.image_urls}}' } }, createdAt: 't', updatedAt: 't' },
      ],
    )
    const kinds: string[] = []
    const out = await generateOnProject(
      { projectId: project.id, intent: 'video', prompt: 'p', vendor: 'apimart', modelKey: 'seedance', references: ['nomi-local://a.png'] },
      createDiskGateway(project.id),
      async (payload) => {
        const kind = (payload.request as { kind: string }).kind
        kinds.push(kind)
        if (kind === 'image_edit') throw new Error('首帧 vendor 500')
        return { id: 'v', status: 'succeeded', assets: [{ type: 'video', url: 'nomi-local://v.mp4' }] }
      },
    )
    expect(kinds).toEqual(['image_edit', 'image_to_video']) // 首帧失败后照样发视频
    expect(out.status).toBe('succeeded')
  })

  it('两跳不触发：无参考图 → T2V 兜底，只发一次（蓝图幕2「T2V 降级为无参考兜底」）', async () => {
    const project = createNamedProject('两跳-无参考')
    seedCatalog(
      [{ modelKey: 'seedance', vendorKey: 'apimart', labelZh: 'Seedance', kind: 'video', enabled: true, createdAt: 't', updatedAt: 't' }],
      [{ id: 'i2v', vendorKey: 'apimart', modelKey: 'seedance', taskKind: 'image_to_video', name: 'i2v', enabled: true, create: { method: 'POST', path: '/v', body: { first_frame_url: '{{request.params.first_frame_url}}' } }, createdAt: 't', updatedAt: 't' }],
    )
    const kinds: string[] = []
    await generateOnProject(
      { projectId: project.id, intent: 'video', prompt: '纯文生视频', vendor: 'apimart', modelKey: 'seedance' },
      createDiskGateway(project.id),
      async (payload) => { kinds.push((payload.request as { kind: string }).kind); return { id: 't', status: 'succeeded', assets: [] } },
    )
    expect(kinds).toEqual(['text_to_video'])
  })

  // ── W1 审片环 hook（方案 T5）：默认不传 makeVerifyDeps = 行为逐字节不变；传了才判分。 ──

  it('审片环回归：不传 makeVerifyDeps → 返回对象逐字节同今天（无 verify 字段、键集不变）', async () => {
    const project = createNamedProject('审片回归-无deps')
    const out = await generateOnProject(
      { projectId: project.id, intent: 'image', prompt: '一只猫', vendor: 'apimart', modelKey: 'seedream-4' },
      createDiskGateway(project.id),
      async () => ({ id: 't', status: 'succeeded', assets: [{ type: 'image', url: 'nomi-local://a.png' }] }),
    )
    // 键集恰为 { nodeId, status, assets }（text 分支不触发；**不含 verify**）——默认路径与旧版一致。
    expect(Object.keys(out).sort()).toEqual(['assets', 'nodeId', 'status'])
    expect('verify' in out).toBe(false)
    expect(out.status).toBe('succeeded')
  })

  it('审片环回归：传了 makeVerifyDeps 但生成失败 → 不判分、无 verify（审片只在成功产物上跑）', async () => {
    const project = createNamedProject('审片回归-失败不判')
    let depsMade = false
    await expect(generateOnProject(
      {
        projectId: project.id, intent: 'image', prompt: '一只猫', vendor: 'apimart', modelKey: 'seedream-4',
        makeVerifyDeps: () => { depsMade = true; return stubVerifyDeps('{"scores":{"identity":1}}') },
      },
      createDiskGateway(project.id),
      async () => { throw new Error('vendor down') },
    )).rejects.toThrow(/vendor down/)
    expect(depsMade).toBe(false) // 生成失败 → 审片分支根本不进
  })

  it('审片环：传 stub makeVerifyDeps（judge 低分）→ 返回带 verify.flagged 红标 + retries', async () => {
    const project = createNamedProject('审片-低分红标')
    const out = await generateOnProject(
      {
        projectId: project.id, intent: 'image', prompt: '小周站在冰柜前', vendor: 'apimart', modelKey: 'seedream-4',
        // judge 恒返身份 1 档 → 触发重试；重试后仍 1 档（stub 不变）→ K=2 用尽 → 红标。
        makeVerifyDeps: () => stubVerifyDeps('{"scores":{"identity":1,"composition":5,"continuity":5},"reason":"张冠李戴"}'),
      },
      createDiskGateway(project.id),
      async () => ({ id: 't', status: 'succeeded', assets: [{ type: 'image', url: 'nomi-local://gen.png' }] }),
    )
    expect(out.verify).toBeDefined()
    expect(out.verify?.evaluated).toBe(true)
    expect(out.verify?.passed).toBe(false)
    expect(out.verify?.retries).toBe(2) // K≤2 封顶
    expect(out.verify?.flagged.map((f) => f.dimension)).toEqual(['identity'])
  })

  it('审片环：judge 首发即高分 → verify.passed、零重试、无红标', async () => {
    const project = createNamedProject('审片-一次过')
    const out = await generateOnProject(
      {
        projectId: project.id, intent: 'image', prompt: '小周', vendor: 'apimart', modelKey: 'seedream-4',
        makeVerifyDeps: () => stubVerifyDeps('{"scores":{"identity":5,"composition":5,"continuity":5},"reason":"好"}'),
      },
      createDiskGateway(project.id),
      async () => ({ id: 't', status: 'succeeded', assets: [{ type: 'image', url: 'nomi-local://gen.png' }] }),
    )
    expect(out.verify?.passed).toBe(true)
    expect(out.verify?.retries).toBe(0)
    expect(out.verify?.flagged).toEqual([])
  })

  // L3 韧性修复（2026-08-19）：判分挂起/连续失败 → orchestrate 硬界收成 skipped(reason)。
  // core 必须把「带 reason 的诚实跳过」也挂到返回 verify（供交付显「审片：跳过（原因）」，D4 不藏），
  // 而不是像纯静默跳过那样丢弃——且生成结果照常返回。
  it('审片环：judge 挂起 → 硬界 skipped(reason) 挂到返回 verify、生成结果照常返回', async () => {
    const project = createNamedProject('审片-判分挂起跳过')
    const hangDeps: import('./shotVerifyOrchestrate').ShotVerifyDeps = {
      visionAvailable: () => true,
      extractFrame: async (u) => u,
      judge: () => new Promise<string>(() => {}), // 永不 resolve（模拟端点挂死/连续 500）
      regenerate: async () => ({ frameSourceUrl: 'x', isVideo: false }),
    }
    const out = await generateOnProject(
      {
        projectId: project.id, intent: 'image', prompt: '小周', vendor: 'apimart', modelKey: 'seedream-4',
        makeVerifyDeps: () => hangDeps,
        verifyDeadlineMs: 40, // 快速界，测试不等真 60s
      },
      createDiskGateway(project.id),
      async () => ({ id: 't', status: 'succeeded', assets: [{ type: 'image', url: 'nomi-local://gen.png' }] }),
    )
    // 生成结果照常返回（钱没白花）
    expect(out.status).toBe('succeeded')
    expect(out.assets?.[0]?.url).toBe('nomi-local://gen.png')
    // 审片诚实跳过挂上，带人话原因
    expect(out.verify).toBeDefined()
    expect(out.verify?.evaluated).toBe(false)
    expect(out.verify?.skipped).toBe(true)
    expect(out.verify?.reason).toBeTruthy()
  })
})

/** 审片 deps 桩：judge 恒返给定判决 JSON；regenerate 返新图 url；视觉恒可用；不真打 vendor。 */
function stubVerifyDeps(verdictJson: string): import('./shotVerifyOrchestrate').ShotVerifyDeps {
  let regen = 0
  return {
    visionAvailable: () => true,
    extractFrame: async (u) => u,
    judge: async () => verdictJson,
    regenerate: async () => { regen += 1; return { frameSourceUrl: `nomi-local://re-${regen}.png`, isVideo: false } },
  }
}
