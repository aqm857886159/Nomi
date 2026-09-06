// 待决登记表的**引用稳定性**——这条不是洁癖，是一次真机崩溃的防线。
//
// 这张表是 `useSyncExternalStore` 的数据源，React 用 `Object.is` 比相邻两次 `getSnapshot()`。
// 每次都返回新数组 = 「变了」永远成立 = 无限重渲染 = 错误边界兜住整个工作台，
// 用户看到的是「工作台加载失败」，而不是那张该浮出来的审批卡。
// 2026-09-06 由 `tests/ux/agent-v4-short-film.walk.mjs` 在真机上抓到：
// 空态本来就共用一个冻结数组，所以只有**有待决的那一刻**才炸——正是审批卡该出现的那一刻。
import { beforeEach, describe, expect, it } from 'vitest'
import { agentPanelV4PendingTools, pendingToolKey } from './agentPanelV4PendingTools'
import type { ToolCallEvent } from '../workbenchAgentRunner'

const BINDING = 'uuid-a:1'

function call(toolCallId: string, turnId = 'turn-1'): ToolCallEvent {
  return {
    turnId,
    toolCallId,
    toolName: 'nomi_document_edit',
    args: { operation: 'append' },
    isPending: () => true,
    confirm: async () => undefined,
  }
}

describe('待决登记表对 useSyncExternalStore 是引用稳定的', () => {
  beforeEach(() => agentPanelV4PendingTools.reset())

  it('没有改动时，反复问拿到同一个引用（空态与非空态都要）', () => {
    expect(agentPanelV4PendingTools.listFor(BINDING)).toBe(agentPanelV4PendingTools.listFor(BINDING))
    agentPanelV4PendingTools.register(call('c1'), BINDING)
    const first = agentPanelV4PendingTools.listFor(BINDING)
    expect(agentPanelV4PendingTools.listFor(BINDING)).toBe(first)
    expect(first).toHaveLength(1)
  })

  it('有改动时引用必须变——否则界面不会跟着更新（阳性对照）', () => {
    agentPanelV4PendingTools.register(call('c1'), BINDING)
    const before = agentPanelV4PendingTools.listFor(BINDING)
    agentPanelV4PendingTools.settle(pendingToolKey(call('c1')), 'approved')
    expect(agentPanelV4PendingTools.listFor(BINDING)).not.toBe(before)
    expect(agentPanelV4PendingTools.listFor(BINDING)[0].state).toBe('approved')
  })

  it('换一个项目绑定问，不会拿到上一个绑定的缓存', () => {
    agentPanelV4PendingTools.register(call('c1'), BINDING)
    expect(agentPanelV4PendingTools.listFor(BINDING)).toHaveLength(1)
    expect(agentPanelV4PendingTools.listFor('uuid-b:1')).toHaveLength(0)
    expect(agentPanelV4PendingTools.listFor(BINDING)).toHaveLength(1)
  })

  it('回合结束清掉这一回合的记录，别的回合不受牵连', () => {
    agentPanelV4PendingTools.register(call('c1', 'turn-1'), BINDING)
    agentPanelV4PendingTools.register(call('c2', 'turn-2'), BINDING)
    agentPanelV4PendingTools.clearTurn('turn-1')
    const left = agentPanelV4PendingTools.listFor(BINDING)
    expect(left).toHaveLength(1)
    expect(left[0].call.turnId).toBe('turn-2')
  })

  it('同一个决定不会被双击发两次', () => {
    const key = pendingToolKey(call('c1'))
    agentPanelV4PendingTools.register(call('c1'), BINDING)
    expect(agentPanelV4PendingTools.beginResolving(key)).toBe(true)
    expect(agentPanelV4PendingTools.beginResolving(key)).toBe(false)
    agentPanelV4PendingTools.endResolving(key)
    expect(agentPanelV4PendingTools.beginResolving(key)).toBe(true)
  })
})
