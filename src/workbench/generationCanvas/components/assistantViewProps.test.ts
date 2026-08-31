/**
 * 回归测试：streaming markdown 渲染路径 + status 状态机。
 *
 * 核心目标：直接导入生产代码 deriveAssistantViewProps（AssistantTimeline.tsx 导出的
 * 纯函数），确保
 *   status:'streaming' + 有内容 → streaming=true, isError=false（应渲染 markdown + dots），
 *   而不是被强清空成 loading mark（commit 4157799f 引入的回归）。
 *
 * 测试有牙：对 AssistantTimeline.tsx 里 deriveAssistantViewProps 的任何破坏性修改
 * 都会让此测试变红——不是镜像副本，是真实生产函数。
 */
import { describe, expect, it } from 'vitest'
import { deriveAssistantViewProps } from './AssistantTimeline'
import type { WorkbenchAiMessage } from '../../ai/workbenchAiTypes'

// ---------------------------------------------------------------------------
// 镜像 AssistantMessageView 的渲染决策（hasContent 分支树）
// streaming && !hasContent → loading mark; streaming && hasContent → markdown + dots
// ---------------------------------------------------------------------------

type RenderDecision = 'loading-mark' | 'markdown-with-dots' | 'markdown-only' | 'error'

function renderDecision(
  props: ReturnType<typeof deriveAssistantViewProps>,
  content: string,
): RenderDecision {
  if (props.isError) return 'error'
  const hasContent = content.trim().length > 0
  if (props.streaming && !hasContent) return 'loading-mark'
  if (props.streaming && hasContent) return 'markdown-with-dots'
  return 'markdown-only'
}

// ---------------------------------------------------------------------------
// 测试用例
// ---------------------------------------------------------------------------

describe('deriveAssistantViewProps（生产代码）', () => {
  /**
   * 关键回归：status:'streaming' + 有内容 → markdown 正文 + 流式三点。
   * commit 4157799f 下此 case 会渲染成 loading-mark（content 被强清空成 ''）。
   */
  it('【核心回归】status=streaming + 有内容 → streaming=true, isError=false（应渲染 markdown + dots）', () => {
    const message = { status: 'streaming' as const, content: '正在生成分镜节点...' }
    const props = deriveAssistantViewProps(message)

    expect(props.streaming).toBe(true)
    expect(props.isError).toBe(false)
    // content 由调用方（renderAssistantMessage）直传，不在这里被清空
    expect(renderDecision(props, message.content)).toBe('markdown-with-dots')
  })

  it('status=pending + 空内容 → loading mark（等首 token，正常路径）', () => {
    const message = { status: 'pending' as const, content: '' }
    const props = deriveAssistantViewProps(message)
    expect(props.streaming).toBe(true)
    expect(renderDecision(props, message.content)).toBe('loading-mark')
  })

  it('status=done + 有内容 → 纯 markdown，无 streaming dots', () => {
    const message = { status: 'done' as const, content: '节点已创建，共 3 个镜头。' }
    const props = deriveAssistantViewProps(message)
    expect(props.streaming).toBe(false)
    expect(props.isError).toBe(false)
    expect(renderDecision(props, message.content)).toBe('markdown-only')
  })

  it('content 恰好等于「处理中...」但 status=done → 正常渲染正文（status 是真相源，不做字符串匹配）', () => {
    const message = { status: 'done' as const, content: '处理中...' }
    const props = deriveAssistantViewProps(message)
    expect(props.streaming).toBe(false)
    expect(props.isError).toBe(false)
    expect(renderDecision(props, message.content)).toBe('markdown-only')
  })

  it('status=undefined（旧 session 持久化）→ 不进 streaming 分支（向后兼容）', () => {
    const message = { status: undefined as WorkbenchAiMessage['status'], content: '历史消息' }
    const props = deriveAssistantViewProps(message)
    expect(props.streaming).toBe(false)
    expect(renderDecision(props, message.content)).toBe('markdown-only')
  })

  it('status=error → isError=true（分流到错误卡）', () => {
    const message = { status: 'error' as const, content: '生成区 Agent 执行失败：网络超时' }
    const props = deriveAssistantViewProps(message)
    expect(props.isError).toBe(true)
    expect(renderDecision(props, message.content)).toBe('error')
  })

  it('status=cancelled → streaming=false', () => {
    const message = { status: 'cancelled' as const, content: '已完成。' }
    const props = deriveAssistantViewProps(message)
    expect(props.streaming).toBe(false)
    expect(props.isError).toBe(false)
    expect(renderDecision(props, message.content)).toBe('markdown-only')
  })

  it('旧 session 携带「（错误）」前缀 → isError=true（向后兼容）', () => {
    const message = { status: undefined as WorkbenchAiMessage['status'], content: '（错误）网络超时' }
    const props = deriveAssistantViewProps(message)
    expect(props.isError).toBe(true)
    expect(renderDecision(props, message.content)).toBe('error')
  })
})

// ---------------------------------------------------------------------------
// CanvasAssistantPanel 状态机约定
// ---------------------------------------------------------------------------

describe('CanvasAssistantPanel 状态机约定', () => {
  it('气泡创建时 content 必须为空串 → pending + 空内容 = loading mark', () => {
    const initialBubble: Pick<WorkbenchAiMessage, 'status' | 'content'> = {
      status: 'pending',
      content: '',
    }
    const props = deriveAssistantViewProps(initialBubble)
    expect(props.streaming).toBe(true)
    expect(renderDecision(props, initialBubble.content)).toBe('loading-mark')
  })

  it('首 token 到达后 status 转为 streaming，content 有值 → markdown 渲染', () => {
    const afterFirstToken: Pick<WorkbenchAiMessage, 'status' | 'content'> = {
      status: 'streaming',
      content: '首段内容',
    }
    const props = deriveAssistantViewProps(afterFirstToken)
    expect(props.streaming).toBe(true)
    expect(props.isError).toBe(false)
    expect(renderDecision(props, afterFirstToken.content)).toBe('markdown-with-dots')
  })
})
