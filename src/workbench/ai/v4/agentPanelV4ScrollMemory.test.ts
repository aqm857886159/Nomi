import { beforeEach, describe, expect, it } from 'vitest'
import { flowScrollMemoryFor, resetFlowScrollMemory } from './agentPanelV4ScrollMemory'

describe('对话流滚动记忆', () => {
  beforeEach(() => resetFlowScrollMemory())

  it('同一条线程拿到同一个盒子——盒子换人就等于位置没记住', () => {
    const first = flowScrollMemoryFor('creation', 'thread-1')
    first.current = { top: 240, atBottom: false }
    expect(flowScrollMemoryFor('creation', 'thread-1').current).toEqual({ top: 240, atBottom: false })
  })

  it('另一条线程 / 另一个面各记各的：位置属于那条对话，不能串过去', () => {
    flowScrollMemoryFor('creation', 'thread-1').current = { top: 240, atBottom: false }
    expect(flowScrollMemoryFor('creation', 'thread-2').current).toEqual({ top: 0, atBottom: true })
    expect(flowScrollMemoryFor('generation', 'thread-1').current).toEqual({ top: 0, atBottom: true })
  })

  it('还没有线程时也给一个盒子（空会话照样能翻，翻了也该记住）', () => {
    const box = flowScrollMemoryFor('creation', null)
    box.current = { top: 12, atBottom: false }
    expect(flowScrollMemoryFor('creation', null).current.top).toBe(12)
  })

  it('记忆有上限，超了从最久没碰的那条丢起——这是便利不是要落盘的东西', () => {
    flowScrollMemoryFor('creation', 'oldest').current = { top: 99, atBottom: false }
    for (let index = 0; index < 16; index += 1) flowScrollMemoryFor('creation', `thread-${index}`)
    expect(flowScrollMemoryFor('creation', 'oldest').current).toEqual({ top: 0, atBottom: true })
    // 刚碰过的那条还在。
    expect(flowScrollMemoryFor('creation', 'thread-15').current).toEqual({ top: 0, atBottom: true })
  })

  it('读一下就算碰过：反复回到同一条线程，它不该被后来的挤掉', () => {
    const kept = flowScrollMemoryFor('creation', 'kept')
    kept.current = { top: 55, atBottom: false }
    for (let index = 0; index < 15; index += 1) {
      flowScrollMemoryFor('creation', `filler-${index}`)
      flowScrollMemoryFor('creation', 'kept')
    }
    expect(flowScrollMemoryFor('creation', 'kept').current.top).toBe(55)
  })
})
