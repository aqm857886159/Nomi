import { describe, it, expect, beforeEach } from 'vitest'
import type { ReconcileDeviation } from './reconcile'
import { useShotVerifyStore, buildContentFixMessage } from './shotVerifyStore'
import { DEFAULT_LOOP_MAX_ROUNDS } from './storyboardLoopBudget'

const content = (where: string): ReconcileDeviation => ({
  where,
  field: '身份',
  expected: '与设定一致',
  actual: '第 1 档',
  reason: `${where} 脸不对`,
  kind: 'content',
  shotNodeId: where,
})

describe('shotVerifyStore 状态机', () => {
  beforeEach(() => useShotVerifyStore.getState().clear())

  it('setDeviations 有偏差 → status ready、不动预算', () => {
    useShotVerifyStore.getState().setDeviations([content('镜5')])
    const s = useShotVerifyStore.getState()
    expect(s.status).toBe('ready')
    expect(s.deviations).toHaveLength(1)
    expect(s.budget.roundsUsed).toBe(0)
    expect(s.exhausted).toBe(false)
  })

  it('收敛(偏差清零)→ 预算回满 + exhausted 复位', () => {
    const st = useShotVerifyStore.getState()
    st.setDeviations([content('镜5')])
    st.consumeRound()
    expect(useShotVerifyStore.getState().budget.roundsUsed).toBe(1)
    st.setDeviations([]) // 收敛
    const s = useShotVerifyStore.getState()
    expect(s.deviations).toEqual([])
    expect(s.budget.roundsUsed).toBe(0) // 回满
    expect(s.exhausted).toBe(false)
  })

  it('预算只减不回弹:点修→暂藏(markFixing)→再校验仍有偏差,预算不回弹', () => {
    const st = useShotVerifyStore.getState()
    st.setDeviations([content('镜5')])
    expect(st.consumeRound()).toBe(true) // 第1轮
    st.markFixing() // 暂藏卡,不动预算
    expect(useShotVerifyStore.getState().budget.roundsUsed).toBe(1)
    expect(useShotVerifyStore.getState().deviations).toEqual([])
    // 重生后再校验仍有偏差
    useShotVerifyStore.getState().setDeviations([content('镜5')])
    expect(useShotVerifyStore.getState().budget.roundsUsed).toBe(1) // 没回弹
  })

  it('预算耗尽 → consumeRound 返回 false + exhausted=true(半自动封顶,绝不无限回灌)', () => {
    const st = useShotVerifyStore.getState()
    st.setDeviations([content('镜5')])
    for (let i = 0; i < DEFAULT_LOOP_MAX_ROUNDS; i += 1) {
      expect(st.consumeRound()).toBe(true)
      st.markFixing()
      useShotVerifyStore.getState().setDeviations([content('镜5')])
    }
    // 预算用尽:再点修被拒
    expect(useShotVerifyStore.getState().consumeRound()).toBe(false)
    expect(useShotVerifyStore.getState().exhausted).toBe(true)
  })

  it('仍有偏差且预算耗尽时,setDeviations 把 exhausted 置真', () => {
    const st = useShotVerifyStore.getState()
    st.setDeviations([content('镜5')])
    st.consumeRound()
    st.consumeRound() // 默认 2 轮用尽
    useShotVerifyStore.getState().setDeviations([content('镜5')])
    expect(useShotVerifyStore.getState().exhausted).toBe(true)
  })

  it('clear 全复位', () => {
    const st = useShotVerifyStore.getState()
    st.setDeviations([content('镜5')])
    st.consumeRound()
    st.clear()
    const s = useShotVerifyStore.getState()
    expect(s.status).toBe('idle')
    expect(s.deviations).toEqual([])
    expect(s.budget.roundsUsed).toBe(0)
  })
})

describe('buildContentFixMessage', () => {
  it('列出每条内容偏差 + 让 AI 只改这几镜走确认闸', () => {
    const msg = buildContentFixMessage([content('镜头5'), content('镜头7'), { where: 'x', field: '边', expected: '', actual: '', kind: 'structure' }])
    expect(msg).toContain('镜头5')
    expect(msg).toContain('镜头7')
    expect(msg).toContain('run_generation_batch')
    expect(msg).toContain('不要动其它已经正常的镜头')
    expect(msg).not.toContain('· x（边）') // 结构偏差不进内容修复消息
  })
})
