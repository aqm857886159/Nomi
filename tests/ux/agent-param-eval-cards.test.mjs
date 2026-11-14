import { describe, expect, it } from 'vitest'
import { approvalDecision, createCardDriver } from './agent-param-eval-cards.mjs'

describe('按题意答审批卡', () => {
  it.each(['delete_from_canvas', 'undo'])('%s 声明批准或拒绝，缺省标记未声明', (tool) => {
    expect(approvalDecision({ approvals: { [tool]: 'approve' } }, tool)).toEqual({ decision: 'approve', declared: true })
    expect(approvalDecision({ approvals: { [tool]: 'decline' } }, tool)).toEqual({ decision: 'decline', declared: true })
    expect(approvalDecision({}, tool)).toEqual({ decision: 'decline', declared: false })
  })
  it('任何声明都不能批准花钱、未知工具或非法值', () => {
    for (const tool of ['generate', 'spend', 'unknown']) expect(approvalDecision({ approvals: { [tool]: 'approve' } }, tool).decision).toBe('decline')
    expect(approvalDecision({ approvals: { undo: 'yes' } }, 'undo').declared).toBe(false)
  })
  it.each(['approve', 'decline', undefined])('真实 driver 分支按 %s 操作并记录声明状态', async (decision) => {
    const clicks = []
    let present = true
    const absent = { filter() { return this }, first() { return this }, isVisible: async () => false, count: async () => 0, waitFor: async () => {} }
    const approval = {
      first() { return this }, count: async () => present ? 1 : 0,
      locator: (selector) => ({ isVisible: async () => true, click: async () => { clicks.push(selector); present = false } }),
    }
    const win = { locator: (selector) => selector.includes('approval-reversible') ? approval : absent, waitForTimeout: async () => {} }
    const driver = createCardDriver({ win, panel: '#panel', outputDir: '/unused' })
    const result = await driver.driveTurn('probe', { task: { approvals: { undo: decision } }, pendingTool: () => 'undo' })
    expect(clicks).toEqual([decision === 'approve' ? '[data-v4-control="confirm"]' : '[data-v4-control="confirm-reject"]'])
    expect(result.cardsAnswered).toEqual([`approval:undo:${decision === 'approve' ? 'approve' : 'decline'}:${decision ? 'declared' : 'unspecified'}`])
  })
})
