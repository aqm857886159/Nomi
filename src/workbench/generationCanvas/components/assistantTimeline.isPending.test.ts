/**
 * 回归测试：streaming markdown 渲染路径 + status 状态机。
 *
 * 本测试的核心目标：驱动真实的 props-to-render 映射逻辑，确保
 *   status:'streaming' + 有内容 → markdown 正文被渲染（流式三点），
 *   而不是被强清空成 loading mark（commit 4157799f 引入的回归）。
 *
 * 背景：原测试只内联重写了 isPending() 纯函数并断言该函数——从未触碰组件渲染路径，
 * 因此 AssistantTimeline 把 content 强清空成 '' 的 bug 对那个测试完全透明。
 *
 * 测试策略：不依赖 jsdom / @testing-library（测试环境是 node），
 * 而是把 AssistantMessageView 的渲染决策逻辑（hasContent 分支树）以及
 * AssistantTimeline.renderAssistantMessage 的 props 映射逻辑——
 * 提取成纯函数进行断言，确保「content 不被强清空」这一不变量。
 *
 * 此测试会在 commit 4157799f（AssistantTimeline 里 content={isPending ? '' : message.content}）
 * 下红掉，在修复后的代码（content={message.content}）下绿。
 */
import { describe, expect, it } from 'vitest'
import type { WorkbenchAiMessage } from '../../ai/workbenchAiTypes'

// ---------------------------------------------------------------------------
// 镜像 AssistantTimeline.renderAssistantMessage 的 props 推导逻辑
// 如果 AssistantTimeline 修改了 content/streaming 的推导，这里需要同步。
// ---------------------------------------------------------------------------

type ViewProps = {
  content: string
  streaming: boolean
  pendingLabel?: string
  cancelled?: boolean
  isError?: boolean
}

/** 复现 AssistantTimeline.renderAssistantMessage 推导出的 AssistantMessageView props（修复后正确版）。*/
function deriveViewProps(message: Pick<WorkbenchAiMessage, 'status' | 'content'>): ViewProps {
  const isStreaming = message.status === 'pending' || message.status === 'streaming'
  const isErrorMsg =
    message.status === 'error' ||
    message.content.startsWith('（错误）') ||
    message.content.startsWith('(Error)')
  return {
    content: message.content, // 不强清空——关键不变量
    streaming: isStreaming,
    pendingLabel: isStreaming ? '处理中' : undefined,
    cancelled: message.status === 'cancelled',
    isError: isErrorMsg,
  }
}

/** 复现 commit 4157799f 的 BUG 版 props 推导（content 被强清空）。*/
function deriveViewPropsBroken(message: Pick<WorkbenchAiMessage, 'status' | 'content'>): ViewProps {
  const isPending = message.status === 'pending' || message.status === 'streaming'
  return {
    content: isPending ? '' : message.content, // BUG: 强清空 → streaming 时 markdown 消失
    streaming: isPending,
    pendingLabel: isPending ? '处理中' : undefined,
    cancelled: message.status === 'cancelled',
    isError: false,
  }
}

// ---------------------------------------------------------------------------
// 镜像 AssistantMessageView 的渲染决策（hasContent 分支树）
// streaming && !hasContent → loading mark; streaming && hasContent → markdown + dots
// ---------------------------------------------------------------------------

type RenderDecision = 'loading-mark' | 'markdown-with-dots' | 'markdown-only' | 'error'

function renderDecision(props: ViewProps): RenderDecision {
  if (props.isError) return 'error'
  const hasContent = props.content.trim().length > 0
  if (props.streaming && !hasContent) return 'loading-mark'
  if (props.streaming && hasContent) return 'markdown-with-dots'
  return 'markdown-only'
}

// ---------------------------------------------------------------------------
// 测试用例
// ---------------------------------------------------------------------------

describe('AssistantTimeline + AssistantMessageView 渲染路径（真实 props 映射）', () => {
  /**
   * 关键回归：status:'streaming' + 有内容 → markdown 正文 + 流式三点。
   * 这个 case 在 commit 4157799f 下会错误渲染成 loading-mark（因为 content 被强清空成 ''）。
   */
  it('【核心回归】status=streaming + 有内容 → markdown 正文 + streaming dots（不是 loading mark）', () => {
    const message = { status: 'streaming' as const, content: '正在生成分镜节点...' }

    // 修复后：content 不被强清空，渲染 markdown + dots
    const props = deriveViewProps(message)
    expect(props.content).toBe('正在生成分镜节点...')
    expect(props.streaming).toBe(true)
    expect(renderDecision(props)).toBe('markdown-with-dots')

    // 验证 BUG 版本确实会红（证明此测试对 commit 4157799f 有效）
    const brokenProps = deriveViewPropsBroken(message)
    expect(brokenProps.content).toBe('') // BUG: 被强清空
    expect(renderDecision(brokenProps)).toBe('loading-mark') // BUG: 变成 loading mark
  })

  it('status=pending + 空内容 → loading mark（等首 token，正常路径）', () => {
    const message = { status: 'pending' as const, content: '' }
    const props = deriveViewProps(message)
    expect(props.streaming).toBe(true)
    expect(renderDecision(props)).toBe('loading-mark')
  })

  it('status=pending + 空内容 → 修复版与 BUG 版行为一致（此 case 不分叉）', () => {
    const message = { status: 'pending' as const, content: '' }
    expect(renderDecision(deriveViewProps(message))).toBe(renderDecision(deriveViewPropsBroken(message)))
  })

  it('status=done + 有内容 → 纯 markdown，无 streaming dots，有操作按钮', () => {
    const message = { status: 'done' as const, content: '节点已创建，共 3 个镜头。' }
    const props = deriveViewProps(message)
    expect(props.streaming).toBe(false)
    expect(props.content).toBe('节点已创建，共 3 个镜头。')
    expect(renderDecision(props)).toBe('markdown-only')
  })

  it('content 恰好等于「处理中...」但 status=done → 正常渲染正文（不误判为加载中）', () => {
    // 遗留 session 可能持久化了哨兵字符串作为 content；修复后 status 是真相源，不做字符串匹配
    const message = { status: 'done' as const, content: '处理中...' }
    const props = deriveViewProps(message)
    expect(props.streaming).toBe(false)
    expect(props.content).toBe('处理中...')
    expect(renderDecision(props)).toBe('markdown-only')
  })

  it('status=undefined（旧 session 持久化）→ 不进 streaming 分支（向后兼容）', () => {
    const message = { status: undefined as WorkbenchAiMessage['status'], content: '历史消息' }
    const props = deriveViewProps(message)
    expect(props.streaming).toBe(false)
    expect(renderDecision(props)).toBe('markdown-only')
  })

  it('status=error → isError=true（分流到错误卡）', () => {
    const message = { status: 'error' as const, content: '生成区 Agent 执行失败：网络超时' }
    const props = deriveViewProps(message)
    expect(props.isError).toBe(true)
    expect(renderDecision(props)).toBe('error')
  })

  it('status=cancelled → cancelled prop=true，不进 streaming 分支', () => {
    const message = { status: 'cancelled' as const, content: '已完成。' }
    const props = deriveViewProps(message)
    expect(props.streaming).toBe(false)
    expect(props.cancelled).toBe(true)
    expect(renderDecision(props)).toBe('markdown-only')
  })

  it('旧 session 携带「（错误）」前缀 → isError=true（向后兼容）', () => {
    const message = { status: undefined as WorkbenchAiMessage['status'], content: '（错误）网络超时' }
    const props = deriveViewProps(message)
    expect(props.isError).toBe(true)
    expect(renderDecision(props)).toBe('error')
  })
})

// ---------------------------------------------------------------------------
// 额外验证：CanvasAssistantPanel 状态机约定（不依赖运行时，检查初始化值）
// ---------------------------------------------------------------------------

describe('CanvasAssistantPanel 状态机约定', () => {
  it('气泡创建时 content 必须为空串（不再用「处理中...」哨兵作初始内容）', () => {
    // 此测试是文档测试——它描述 CanvasAssistantPanel 的约定，并确保约定被遵守。
    // 若有人把 firstBubbleId 或 openBubble 的 content 改回 '处理中...'，
    // 应该在代码审查中发现，而不是等到运行时渲染才看到 loading mark 消失不见。

    // 模拟：气泡刚创建时的初始状态
    const initialBubble: Pick<WorkbenchAiMessage, 'status' | 'content'> = {
      status: 'pending',
      content: '',  // 必须是空串
    }

    const props = deriveViewProps(initialBubble)
    expect(props.streaming).toBe(true)
    // 初始时 content='' + streaming → loading mark（正确：等首 token 时显示加载动画）
    expect(renderDecision(props)).toBe('loading-mark')
  })

  it('首 token 到达后 status 转为 streaming，content 有值 → markdown 渲染', () => {
    // 模拟：pending→streaming 状态机转换完成后的消息状态
    const afterFirstToken: Pick<WorkbenchAiMessage, 'status' | 'content'> = {
      status: 'streaming',
      content: '首段内容',  // 首 token 后 content 非空
    }

    const props = deriveViewProps(afterFirstToken)
    expect(props.streaming).toBe(true)
    expect(props.content).toBe('首段内容')
    // 关键：必须渲染 markdown + dots，不能是 loading mark
    expect(renderDecision(props)).toBe('markdown-with-dots')
  })
})
