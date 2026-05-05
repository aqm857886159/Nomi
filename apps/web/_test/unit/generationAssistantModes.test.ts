import React from 'react'
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentsChatResponseDto } from '../../src/api/server'
import { sendWorkbenchAiMessage } from '../../src/workbench/ai/workbenchAiClient'
import { sendGenerationCanvasAgentMessage } from '../../src/workbench/generationCanvasV2/agent/generationCanvasAgentClient'
import CanvasAssistantPanel from '../../src/workbench/generationCanvasV2/components/CanvasAssistantPanel'
import { useGenerationCanvasStore } from '../../src/workbench/generationCanvasV2/store/generationCanvasStore'
import { useWorkbenchStore } from '../../src/workbench/workbenchStore'
import { shouldSubmitAiComposerOnEnter } from '../../src/workbench/ai/aiComposerKeyboard'

vi.mock('../../src/workbench/ai/workbenchAiClient', () => ({
  sendWorkbenchAiMessage: vi.fn(),
}))

const sendWorkbenchAiMessageMock = vi.mocked(sendWorkbenchAiMessage)

function response(text: string): AgentsChatResponseDto {
  return {
    id: 'test-response',
    vendor: 'agents',
    text,
  }
}

function planText(prompt = 'cinematic watercolor frame'): string {
  return `<generation_canvas_plan>${JSON.stringify({
    action: 'create_generation_canvas_nodes',
    summary: 'create nodes',
    nodes: [
      {
        clientId: 'n1',
        kind: 'image',
        title: '关键画面',
        prompt,
        position: { x: 160, y: 260 },
      },
    ],
    edges: [],
  })}</generation_canvas_plan>`
}

function renderAssistant(): void {
  render(
    React.createElement(
      MantineProvider,
      { forceColorScheme: 'light' },
      React.createElement(CanvasAssistantPanel),
    ),
  )
}

function resetGenerationCanvas(): void {
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [] })
  useGenerationCanvasStore.getState().resetGenerationAiConversation()
  useGenerationCanvasStore.getState().setGenerationAiCollapsed(false)
  useWorkbenchStore.getState().setCreationDocumentTools(null)
}

describe('generation assistant mode contract', () => {
  beforeEach(() => {
    resetGenerationCanvas()
  })

  it('chat mode only returns an answer and does not require a generation_canvas_plan', async () => {
    sendWorkbenchAiMessageMock.mockResolvedValueOnce(response('这是对当前节点失败原因的解释。'))

    const result = await sendGenerationCanvasAgentMessage({
      message: '这个节点为什么失败？',
      snapshot: { nodes: [], edges: [], selectedNodeIds: [] },
      selectedNodes: [],
      mode: 'chat',
    })

    expect(result.plan).toBeUndefined()
    expect(result.response.text).toContain('失败原因')
    expect(sendWorkbenchAiMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('当前模式：问答'),
    }))
  })

  it('agent mode requires a parseable plan for node creation', async () => {
    sendWorkbenchAiMessageMock.mockResolvedValueOnce(response(planText()))

    const result = await sendGenerationCanvasAgentMessage({
      message: '做一个水彩关键画面',
      snapshot: { nodes: [], edges: [], selectedNodeIds: [] },
      selectedNodes: [],
      mode: 'agent',
    })

    expect(result.plan?.nodes).toHaveLength(1)
    expect(result.plan?.nodes[0]?.kind).toBe('image')
    expect(sendWorkbenchAiMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('当前模式：Agent'),
    }))
  })

  it('refine mode sends selected node context and parses a single-node prompt update plan', async () => {
    sendWorkbenchAiMessageMock.mockResolvedValueOnce(response(planText('锁定角色脸型，增强逆光氛围')))
    const selectedNode = useGenerationCanvasStore.getState().addNode({
      kind: 'image',
      title: '角色图',
      prompt: '原始提示词',
      select: true,
    })

    const result = await sendGenerationCanvasAgentMessage({
      message: '润色这个节点',
      snapshot: useGenerationCanvasStore.getState().readSnapshot(),
      selectedNodes: [selectedNode],
      mode: 'refine',
    })

    expect(result.plan?.nodes).toHaveLength(1)
    expect(result.plan?.nodes[0]?.prompt).toBe('锁定角色脸型，增强逆光氛围')
    expect(sendWorkbenchAiMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('当前模式：润色'),
    }))
    expect(sendWorkbenchAiMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('"id": "' + selectedNode.id + '"'),
    }))
  })

  it('agent mode fails explicitly when the response omits a valid generation_canvas_plan', async () => {
    sendWorkbenchAiMessageMock.mockResolvedValueOnce(response('我只能给出说明，未返回计划。'))

    await expect(sendGenerationCanvasAgentMessage({
      message: '创建一个节点',
      snapshot: { nodes: [], edges: [], selectedNodeIds: [] },
      selectedNodes: [],
      mode: 'agent',
    })).rejects.toThrow('节点计划 JSON')
  })

  it('refine mode keeps the selected node and updates only its prompt', async () => {
    sendWorkbenchAiMessageMock.mockResolvedValueOnce(response(planText('更电影感的黄昏水彩镜头')))
    const node = useGenerationCanvasStore.getState().addNode({
      kind: 'image',
      title: '待润色节点',
      prompt: '普通画面',
      select: true,
    })

    renderAssistant()
    fireEvent.change(screen.getByLabelText('AI 模式'), { target: { value: 'refine' } })
    fireEvent.change(screen.getByLabelText('给生成助手发送消息'), { target: { value: '把选中节点改得更电影感' } })
    fireEvent.click(screen.getByLabelText('生成 AI 发送'))

    await waitFor(() => {
      expect(useGenerationCanvasStore.getState().nodes.find((item) => item.id === node.id)?.prompt).toBe('更电影感的黄昏水彩镜头')
    })
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(1)
    expect(screen.getByText('已更新选中节点的提示词。')).toBeInTheDocument()
  })

  it('agent mode creates editable nodes and connections from the plan', async () => {
    sendWorkbenchAiMessageMock.mockResolvedValueOnce(response(planText('雨夜街道的第一帧')))

    renderAssistant()
    fireEvent.change(screen.getByLabelText('AI 模式'), { target: { value: 'agent' } })
    fireEvent.change(screen.getByLabelText('给生成助手发送消息'), { target: { value: '做一帧雨夜街道' } })
    fireEvent.click(screen.getByLabelText('生成 AI 发送'))

    await waitFor(() => {
      expect(useGenerationCanvasStore.getState().nodes).toHaveLength(1)
    })
    expect(useGenerationCanvasStore.getState().nodes[0]?.prompt).toBe('雨夜街道的第一帧')
    expect(screen.getByText(/已创建 1 个待确认节点/)).toBeInTheDocument()
  })

  it('submits with Enter but keeps Shift+Enter as textarea input', async () => {
    sendWorkbenchAiMessageMock.mockResolvedValue(response('这是问答模式回复。'))

    renderAssistant()
    fireEvent.change(screen.getByLabelText('AI 模式'), { target: { value: 'chat' } })
    const input = screen.getByLabelText('给生成助手发送消息')
    fireEvent.change(input, { target: { value: '解释当前画布' } })

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(sendWorkbenchAiMessageMock).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(sendWorkbenchAiMessageMock).toHaveBeenCalledTimes(1)
    })
    expect(await screen.findByText('这是问答模式回复。')).toBeInTheDocument()
  })

  it('does not submit Enter while IME composition is active', () => {
    const event = {
      key: 'Enter',
      shiftKey: false,
      nativeEvent: { isComposing: true },
    } as unknown as React.KeyboardEvent<HTMLTextAreaElement>

    expect(shouldSubmitAiComposerOnEnter(event)).toBe(false)
  })

  it('copy reply action writes assistant text to clipboard when no document tools are mounted', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    sendWorkbenchAiMessageMock.mockResolvedValueOnce(response('可复制的回复内容'))

    renderAssistant()
    fireEvent.change(screen.getByLabelText('AI 模式'), { target: { value: 'chat' } })
    fireEvent.change(screen.getByLabelText('给生成助手发送消息'), { target: { value: '回答一下' } })
    fireEvent.click(screen.getByLabelText('生成 AI 发送'))

    fireEvent.click(await screen.findByLabelText('复制回复'))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('可复制的回复内容')
    })
    expect(screen.getByLabelText('已复制')).toBeInTheDocument()
  })

  it('reply action inserts assistant text into the creation document when document tools are mounted', async () => {
    const insertAtCursor = vi.fn<(content: string) => void>()
    useWorkbenchStore.getState().setCreationDocumentTools({
      readFullText: () => '',
      readSelectionText: () => '',
      insertAtCursor,
      replaceSelection: () => undefined,
      appendToEnd: () => undefined,
      writeDocument: () => undefined,
      generateStoryboardNode: () => undefined,
      generateAssetNode: () => undefined,
    })
    sendWorkbenchAiMessageMock.mockResolvedValueOnce(response('写入文档的回复'))

    renderAssistant()
    fireEvent.change(screen.getByLabelText('AI 模式'), { target: { value: 'chat' } })
    fireEvent.change(screen.getByLabelText('给生成助手发送消息'), { target: { value: '回答一下' } })
    fireEvent.click(screen.getByLabelText('生成 AI 发送'))

    fireEvent.click(await screen.findByLabelText('粘贴到文档'))

    expect(insertAtCursor).toHaveBeenCalledWith('写入文档的回复')
    expect(screen.getByLabelText('已粘贴到文档')).toBeInTheDocument()
  })
})
