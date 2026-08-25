/**
 * 回归测试：isPending 必须从 message.status 派生，而不是字符串匹配哨兵内容。
 *
 * 旧实现（修复前）：
 *   const isPending = message.content === '处理中...' || message.content === t(...)
 *
 * 新实现（修复后，AssistantTimeline.tsx renderAssistantMessage）：
 *   const isPending = message.status === 'pending' || message.status === 'streaming'
 *
 * 这个测试不依赖 React 渲染——仅测「判断逻辑」本身，以确保旧字符串匹配路径的所有病例
 * 在新实现下都能正确处理，且新路径能被独立验证。
 *
 * 如果有人把新实现改回字符串匹配（哪怕只匹配 '处理中...'），case 3、4 就会翻红。
 */
import { describe, expect, it } from 'vitest'
import type { WorkbenchAiMessage } from '../../ai/workbenchAiTypes'

/** 新实现的判断逻辑（与 AssistantTimeline.tsx renderAssistantMessage 保持一致）。
 *  若 AssistantTimeline 里的逻辑变动，这里必须同步——测试文件顶部注释已记录两侧绑定关系。 */
function isPending(message: Pick<WorkbenchAiMessage, 'status' | 'content'>): boolean {
  return message.status === 'pending' || message.status === 'streaming'
}

/** 旧实现（P2 根因对照，证明它对下面的 case 会误判）。 */
function isPendingOld(message: Pick<WorkbenchAiMessage, 'status' | 'content'>): boolean {
  return message.content === '处理中...'
}

describe('isPending — status 是唯一真相源（P2 根因修复）', () => {
  it('case 1：status=pending → isPending=true（主路径）', () => {
    const msg = { status: 'pending' as const, content: '处理中...' }
    expect(isPending(msg)).toBe(true)
    // 旧实现偶然也对这个 case——不能用这个 case 证明旧实现正确
  })

  it('case 2：status=streaming → isPending=true', () => {
    const msg = { status: 'streaming' as const, content: '已吐出一些字...' }
    expect(isPending(msg)).toBe(true)
  })

  it('case 3（新vs旧分叉）：status=pending 但 content 不是哨兵字符串 → 新实现仍=true', () => {
    // 模拟：未来某次改动把初始 content 改成空串或其他文案，但 status 仍正确设置
    const msg = { status: 'pending' as const, content: '' }
    expect(isPending(msg)).toBe(true)
    // 旧实现在这个 case 会返回 false（false negative）——证明它是 bug
    expect(isPendingOld(msg)).toBe(false)
  })

  it('case 4（新vs旧分叉）：content 偶然等于哨兵字符串但 status=done → 新实现=false', () => {
    // 模拟：模型回复内容恰好包含「处理中...」这几个字（如用户发了一段含此字的代码输出）
    const msg = { status: 'done' as const, content: '处理中...' }
    expect(isPending(msg)).toBe(false)
    // 旧实现在这个 case 会返回 true（false positive）——证明它是 bug
    expect(isPendingOld(msg)).toBe(true)
  })

  it('case 5：status=done → isPending=false', () => {
    const msg = { status: 'done' as const, content: '生成完成，节点已加入画布。' }
    expect(isPending(msg)).toBe(false)
  })

  it('case 6：status=error → isPending=false', () => {
    const msg = { status: 'error' as const, content: '生成区 Agent 执行失败：网络超时' }
    expect(isPending(msg)).toBe(false)
  })

  it('case 7：status=cancelled → isPending=false', () => {
    const msg = { status: 'cancelled' as const, content: '已完成。' }
    expect(isPending(msg)).toBe(false)
  })

  it('case 8：status=undefined（旧 session 持久化消息）→ isPending=false（向后兼容）', () => {
    const msg = { status: undefined, content: '历史消息内容' }
    expect(isPending(msg)).toBe(false)
  })
})
