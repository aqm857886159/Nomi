import { beforeEach, describe, expect, it } from 'vitest'
import { generateText, getTextGenMode } from './textActions'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { TaskResultDto } from '../../api/taskApi'

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

beforeEach(() => {
  useGenerationCanvasStore.setState({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
})

describe('generateText — 生成模式路由', () => {
  it('getTextGenMode 默认 append，识别 replace/rewrite', () => {
    expect(getTextGenMode({ meta: undefined })).toBe('append')
    expect(getTextGenMode({ meta: { textGenMode: 'replace' } })).toBe('replace')
    expect(getTextGenMode({ meta: { textGenMode: 'rewrite' } })).toBe('rewrite')
    expect(getTextGenMode({ meta: { textGenMode: 'garbage' } })).toBe('append')
  })

  it('续写：append 到已有内容后面', async () => {
    const node = addTextNode({ contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '开头' }] }] } })
    await generateText(node, { runTask: stubRun })
    expect(nodeText(node.id)).toBe('开头\nNEW TEXT')
  })

  it('重写：replace 整篇', async () => {
    const node = addTextNode({
      meta: { textGenMode: 'replace' },
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '旧内容' }] }] },
    })
    await generateText(node, { runTask: stubRun })
    expect(nodeText(node.id)).toBe('NEW TEXT')
  })

  it('改写：不动文档，只打 textPendingSelectionApply 标记交给编辑器落地', async () => {
    const node = addTextNode({
      meta: { textGenMode: 'rewrite', textGenSelection: '要改的那段' },
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '要改的那段' }] }] },
    })
    const result = await generateText(node, { runTask: stubRun })
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
    await generateText(node, { runTask: stubRun })
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
      opts: { onDelta?: (delta: string) => void },
    ): Promise<TaskResultDto> => {
      opts.onDelta?.('生成')
      snapshots.push(nodeText(node.id))
      opts.onDelta?.('的全文') // 增量片段（非累积），textActions 内部 buffer += delta
      snapshots.push(nodeText(node.id))
      return { id: 'task-s', kind: 'chat', status: 'succeeded', assets: [], raw: { choices: [{ message: { content: '生成的全文' } }] } }
    }
    await generateText(node, { onTextDelta: () => {}, runTextStream: streamRun })
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
      opts: { onDelta?: (delta: string) => void },
    ): Promise<TaskResultDto> => {
      opts.onDelta?.('全新')
      opts.onDelta?.('的一篇') // 增量片段
      return { id: 'task-s2', kind: 'chat', status: 'succeeded', assets: [], raw: { choices: [{ message: { content: '全新的一篇' } }] } }
    }
    await generateText(node, { onTextDelta: () => {}, runTextStream: streamRun })
    expect(nodeText(node.id)).toBe('全新的一篇')
  })
})
