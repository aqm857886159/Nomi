import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateText, getTextGenMode } from './textActions'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { TaskResultDto } from '../../api/taskApi'
import { createProjectSessionTestHarness, testProjectBinding, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'

const PROJECT_ID = 'project-test'

const disk = vi.hoisted(() => new Map<string, unknown>())
const applyCanvasNodePatch = vi.hoisted(() => vi.fn())
const textBrain = vi.hoisted(() => ({ current: null as { vendor: string; modelKey: string } | null }))
vi.mock('../../api/promptLibraryApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/promptLibraryApi')>()),
  getTextBrain: async () => textBrain.current,
}))
vi.mock('../../../desktop/bridge', () => ({
  getDesktopBridge: () => ({ projects: { applyCanvasNodePatch } }),
}))
vi.mock('../../library/localProjectStore', () => ({
  readLocalProjectAsync: vi.fn(async (projectId: string) => structuredClone(disk.get(projectId) ?? null)),
  saveLocalProject: vi.fn(async (projectId: string, payload: unknown, name?: string) => {
    disk.set(projectId, structuredClone({ id: projectId, name, version: 1, immutableProjectUuid: testProjectBinding(projectId).immutableProjectUuid, projectGeneration: testProjectBinding(projectId).projectGeneration, payload }))
    return disk.get(projectId)
  }),
}))

// 注入一个直接返回 chat 文本的 runTask，避免触网/desktop runtime。
const stubRun = async (): Promise<TaskResultDto> => ({
  id: 'task-1',
  kind: 'chat',
  status: 'succeeded',
  assets: [],
  raw: { choices: [{ message: { content: 'NEW TEXT' } }] },
})

function addTextNode(patch: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode {
  const store = useGenerationCanvasStore.getState()
  const created = store.addNode({ kind: 'text', title: '', prompt: '要求', position: { x: 0, y: 0 } })
  store.updateNode(created.id, {
    meta: { modelVendor: 'v', modelKey: 'm', ...(patch.meta || {}) },
    ...(patch.contentJson ? { contentJson: patch.contentJson } : {}),
  })
  return useGenerationCanvasStore.getState().nodes.find((n) => n.id === created.id)!
}

function nodeText(id: string): string {
  const node = useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)
  const content = (node?.contentJson?.content || []) as Array<{ content?: Array<{ text?: string }> }>
  return content.map((block) => (block.content || []).map((c) => c.text || '').join('')).join('\n')
}

let session: ProjectSessionTestHarness
let projectTarget: Awaited<ReturnType<ProjectSessionTestHarness['open']>>
beforeEach(async () => {
  applyCanvasNodePatch.mockReset().mockImplementation(async ({ projectId, nodeId, patch }: {
    projectId: string
    nodeId: string
    patch: Record<string, unknown>
  }) => {
    const record = disk.get(projectId) as {
      id: string
      payload: { generationCanvas: { nodes: GenerationCanvasNode[] } }
    } | undefined
    if (!record) return { applied: false }
    const canvas = record.payload.generationCanvas
    const nodes = canvas.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node)
    disk.set(projectId, structuredClone({ ...record, payload: { ...record.payload, generationCanvas: { ...canvas, nodes } } }))
    return { applied: true }
  })
  useGenerationCanvasStore.setState({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  session = createProjectSessionTestHarness()
  projectTarget = await session.open(PROJECT_ID)
})
afterEach(() => session.dispose())

describe('generateText — 生成模式路由', () => {
  it('getTextGenMode 默认 append，识别 replace/rewrite', () => {
    expect(getTextGenMode({ meta: undefined })).toBe('append')
    expect(getTextGenMode({ meta: { textGenMode: 'replace' } })).toBe('replace')
    expect(getTextGenMode({ meta: { textGenMode: 'rewrite' } })).toBe('rewrite')
    expect(getTextGenMode({ meta: { textGenMode: 'garbage' } })).toBe('append')
  })

  it('续写：append 到已有内容后面', async () => {
    const node = addTextNode({ contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '开头' }] }] } })
    await generateText(node, { projectTarget, runTask: stubRun })
    expect(nodeText(node.id)).toBe('开头\nNEW TEXT')
  })

  it('重写：replace 整篇', async () => {
    const node = addTextNode({
      meta: { textGenMode: 'replace' },
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '旧内容' }] }] },
    })
    await generateText(node, { projectTarget, runTask: stubRun })
    expect(nodeText(node.id)).toBe('NEW TEXT')
  })

  it('改写：不动文档，只打 textPendingSelectionApply 标记交给编辑器落地', async () => {
    const node = addTextNode({
      meta: { textGenMode: 'rewrite', textGenSelection: '要改的那段' },
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '要改的那段' }] }] },
    })
    const result = await generateText(node, { projectTarget, runTask: stubRun })
    // 文档未变
    expect(nodeText(node.id)).toBe('要改的那段')
    // 标记 = 本次 result.id
    const after = useGenerationCanvasStore.getState().nodes.find((n) => n.id === node.id)
    expect(after?.meta?.textPendingSelectionApply).toBe(result.id)
  })

  it('改写但没有选区 → 退回续写（append）', async () => {
    const node = addTextNode({
      meta: { textGenMode: 'rewrite' },
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '开头' }] }] },
    })
    await generateText(node, { projectTarget, runTask: stubRun })
    expect(nodeText(node.id)).toBe('开头\nNEW TEXT')
    const after = useGenerationCanvasStore.getState().nodes.find((n) => n.id === node.id)
    expect(after?.meta?.textPendingSelectionApply).toBeUndefined()
  })
})

describe('generateText — 流式增量落地', () => {
  it('续写：逐 delta 把生长中的文本接在原内容后（中途快照可见增量）', async () => {
    const node = addTextNode({
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '开头' }] }] },
    })
    const snapshots: string[] = []
    // 注入流式执行：每发一个 delta 都记录当前节点文本，验证“逐字增量重渲染”。
    const streamRun = async (
      _vendor: string,
      _request: unknown,
      _projectId: string | null,
      opts: { onDelta?: (delta: string) => void },
    ): Promise<TaskResultDto> => {
      opts.onDelta?.('生成')
      snapshots.push(nodeText(node.id))
      opts.onDelta?.('的全文') // 增量片段（非累积），textActions 内部 buffer += delta
      snapshots.push(nodeText(node.id))
      return { id: 'task-s', kind: 'chat', status: 'succeeded', assets: [], raw: { choices: [{ message: { content: '生成的全文' } }] } }
    }
    await generateText(node, { projectTarget, onTextDelta: () => {}, runTextStream: streamRun })
    // 中途快照证明增量：第一帧只到“生成”，第二帧到全文，且都挂在“开头”之后。
    expect(snapshots[0]).toBe('开头\n生成')
    expect(snapshots[1]).toBe('开头\n生成的全文')
    // 定稿：最终文本接在原内容后。
    expect(nodeText(node.id)).toBe('开头\n生成的全文')
  })

  it('重写：流式整篇替换，最终用 result.text 定稿', async () => {
    const node = addTextNode({
      meta: { textGenMode: 'replace' },
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '旧内容' }] }] },
    })
    const streamRun = async (
      _vendor: string,
      _request: unknown,
      _projectId: string | null,
      opts: { onDelta?: (delta: string) => void },
    ): Promise<TaskResultDto> => {
      opts.onDelta?.('全新')
      opts.onDelta?.('的一篇') // 增量片段
      return { id: 'task-s2', kind: 'chat', status: 'succeeded', assets: [], raw: { choices: [{ message: { content: '全新的一篇' } }] } }
    }
    await generateText(node, { projectTarget, onTextDelta: () => {}, runTextStream: streamRun })
    expect(nodeText(node.id)).toBe('全新的一篇')
  })

  it('项目在流式途中被切走：不再往新项目画布写草稿，定稿写回原项目的盘上副本', async () => {
    disk.clear()
    const node = addTextNode({ contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '开头' }] }] } })
    const streamRun = async (
      _vendor: string,
      _request: unknown,
      projectId: string | null,
      opts: { onDelta?: (delta: string) => void },
    ): Promise<TaskResultDto> => {
      expect(projectId).toBe(PROJECT_ID)
      opts.onDelta?.('生成')
      const origin = useGenerationCanvasStore.getState()
      disk.set(PROJECT_ID, structuredClone({ id: PROJECT_ID, name: 'origin', version: 1, immutableProjectUuid: projectTarget.immutableProjectUuid, projectGeneration: projectTarget.projectGeneration, payload: { generationCanvas: { nodes: origin.nodes, edges: origin.edges, groups: origin.groups, selectedNodeIds: [] } } }))
      await session.open('project-other')
      useGenerationCanvasStore.setState({ nodes: [{ ...node, contentJson: { type: 'doc', content: [] } }], edges: [], selectedNodeIds: [], groups: [] })
      opts.onDelta?.('的全文')
      return { id: 'task-bg', kind: 'chat', status: 'succeeded', assets: [], raw: { choices: [{ message: { content: '生成的全文' } }] } }
    }
    await generateText(node, { projectTarget, onTextDelta: () => {}, runTextStream: streamRun })
    // 新项目里恰好有同 id 节点也不被动（身份按项目比，不按节点 id 猜）。
    expect(nodeText(node.id)).toBe('')
    const saved = (disk.get(PROJECT_ID) as { payload: { generationCanvas: { nodes: GenerationCanvasNode[] } } }).payload.generationCanvas.nodes
    const content = (saved.find((n) => n.id === node.id)?.contentJson?.content || []) as Array<{ content?: Array<{ text?: string }> }>
    expect(content.map((block) => (block.content || []).map((c) => c.text || '').join('')).join('\n')).toBe('开头\n生成的全文')
  })
})

describe('generateText — 加工框预设与「跟随 Agent 的模型」', () => {
  const doc = (text: string) => ({ type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  type Captured = { vendor: string; request: { kind: string; prompt: string; extras?: Record<string, unknown> } }
  const capturing = (reply: string) => {
    const calls: Captured[] = []
    const runTask = async (vendor: string, request: Captured['request']): Promise<TaskResultDto> => {
      calls.push({ vendor, request })
      return { id: 'task-p', kind: 'chat', status: 'succeeded', assets: [], raw: { choices: [{ message: { content: reply } }] } }
    }
    return { calls, runTask }
  }
  function addPlainTextNode(meta: Record<string, unknown> | undefined, body: string): GenerationCanvasNode {
    const store = useGenerationCanvasStore.getState()
    const created = store.addNode({ kind: 'text', title: '', prompt: '', position: { x: 0, y: 0 } })
    store.updateNode(created.id, { ...(meta ? { meta } : {}), contentJson: doc(body) })
    return useGenerationCanvasStore.getState().nodes.find((n) => n.id === created.id)!
  }

  beforeEach(() => { textBrain.current = null })

  it('扩写预设：整篇换成新的一版，给模型的话带着预设要求和现有正文', async () => {
    const node = addTextNode({ meta: { textGenPreset: 'expand' }, contentJson: doc('雨夜便利店') })
    const { calls, runTask } = capturing('一条写得很细的提示词')
    await generateText(node, { projectTarget, runTask })
    expect(nodeText(node.id)).toBe('一条写得很细的提示词')
    expect(calls[0]!.request.kind).toBe('chat')
    expect(calls[0]!.request.prompt).toContain('扩写成一条可以直接交给图片 / 视频生成模型的提示词')
    expect(calls[0]!.request.prompt).toContain('雨夜便利店')
  })

  it('拆成多条预设：结果是一个有序列表（节点里按条显示）', async () => {
    const node = addTextNode({ meta: { textGenPreset: 'split' }, contentJson: doc('一段很长的故事') })
    const { runTask } = capturing('1. 雨夜便利店门口\n2. 林薇推门进店\n3. 怀表滑落')
    await generateText(node, { projectTarget, runTask })
    const content = useGenerationCanvasStore.getState().nodes.find((n) => n.id === node.id)!.contentJson!.content as Array<{ type: string; content?: unknown[] }>
    expect(content).toHaveLength(1)
    expect(content[0]!.type).toBe('orderedList')
    expect(content[0]!.content).toHaveLength(3)
  })

  it('看图写描述：连了图 → 同一条文本流改走 image_to_prompt，图作为参考一并发给模型', async () => {
    const node = addTextNode({ meta: { textGenPreset: 'describe' }, contentJson: doc('') })
    const image = { id: 'img', kind: 'image', title: '林薇', position: { x: 0, y: 0 }, prompt: '', result: { id: 'r1', type: 'image', url: 'https://x/a.png' } } as GenerationCanvasNode
    const edge = { id: 'e1', source: 'img', target: node.id, mode: 'reference', order: 0 } as never
    const { calls, runTask } = capturing('一位穿深色外套的女子')
    await generateText(node, { projectTarget, runTask, referenceContext: { nodes: [image, node], edges: [edge] } })
    expect(calls[0]!.request.kind).toBe('image_to_prompt')
    expect(calls[0]!.request.extras?.referenceImages).toEqual(['https://x/a.png'])
    expect(nodeText(node.id)).toBe('一位穿深色外套的女子')
  })

  it('看图写描述：没连图就当场说清缺什么，不发请求', async () => {
    const node = addTextNode({ meta: { textGenPreset: 'describe' } })
    const { calls, runTask } = capturing('不会被用到')
    await expect(generateText(node, { projectTarget, runTask, referenceContext: { nodes: [node], edges: [] } })).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })

  it('连进来的文字当背景一起发给模型（与下游小签、拼提示词同一个投影）', async () => {
    const node = addTextNode({ meta: { textGenPreset: 'translate' }, contentJson: doc('今晚下雨') })
    const source = { id: 'src', kind: 'text', title: '风格说明', position: { x: 0, y: 0 }, prompt: '', contentJson: doc('冷色夜景，胶片颗粒') } as GenerationCanvasNode
    const edge = { id: 'e2', source: 'src', target: node.id, mode: 'reference', order: 0 } as never
    const { calls, runTask } = capturing('Rain tonight')
    await generateText(node, { projectTarget, runTask, referenceContext: { nodes: [source, node], edges: [edge] } })
    expect(calls[0]!.request.prompt).toContain('冷色夜景，胶片颗粒')
    expect(calls[0]!.request.prompt).toContain('今晚下雨')
  })

  it('节点没选文本模型 = 跟随 Agent 的模型：这一次用 Agent 的文本大脑，不写回节点', async () => {
    textBrain.current = { vendor: 'agent-vendor', modelKey: 'agent-model' }
    const node = addPlainTextNode(undefined, '一句话')
    const { calls, runTask } = capturing('ok')
    await generateText(node, { projectTarget, runTask })
    expect(calls[0]!.vendor).toBe('agent-vendor')
    expect(calls[0]!.request.extras?.modelKey).toBe('agent-model')
    const after = useGenerationCanvasStore.getState().nodes.find((n) => n.id === node.id)!
    expect(after.meta?.modelKey).toBeUndefined()
  })

  it('节点自己选了模型：用它，不去问 Agent', async () => {
    textBrain.current = { vendor: 'agent-vendor', modelKey: 'agent-model' }
    const node = addTextNode({ meta: { modelVendor: 'mine', modelKey: 'my-model' } })
    const { calls, runTask } = capturing('ok')
    await generateText(node, { projectTarget, runTask })
    expect(calls[0]!.vendor).toBe('mine')
  })

  it('没有任何可用的文本模型：报「没有可用的文本模型」（错误卡会给去设置的入口），不静默失败也不发请求', async () => {
    const node = addPlainTextNode(undefined, '一句话')
    const { calls, runTask } = capturing('不会被用到')
    await expect(generateText(node, { projectTarget, runTask })).rejects.toThrow(/No usable text model/)
    expect(calls).toHaveLength(0)
  })
})

describe('generateText — 「停止」真的掐断流', () => {
  it('点停止：abort 信号送到流上，运行以「已取消」收尾，不是红色错误', async () => {
    const node = addTextNode({ contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '开头' }] }] } })
    let seenSignal: AbortSignal | undefined
    const streamRun = (_v: string, _r: unknown, _p: unknown, opts: { onDelta?: (d: string) => void; signal?: AbortSignal }): Promise<TaskResultDto> => {
      seenSignal = opts.signal
      opts.onDelta?.('写到一半')
      return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
      })
    }
    const running = generateText(node, { projectTarget, onTextDelta: () => {}, runTextStream: streamRun })
    const outcome = running.then(() => 'resolved', (error: unknown) => error)
    await vi.waitFor(() => expect(seenSignal).toBeDefined())
    const { requestTaskCancel, clearTaskCancel } = await import('./localTaskControl')
    requestTaskCancel({ id: node.id }, () => {})
    const error = await outcome
    clearTaskCancel(node.id)
    expect(seenSignal?.aborted).toBe(true)
    expect((error as Error).name).toBe('LocalTaskCancelledError')
  })
})
