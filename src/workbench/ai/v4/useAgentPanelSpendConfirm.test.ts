import { describe, expect, it, vi } from 'vitest'
import { pendingSpendOfRead } from './useAgentPanelSpendConfirm'

const ROW = { operationId: 'op-1', projectId: 'project-1', shots: [] } as never

// 推过来的那份读结果 → 卡上该有什么（2026-09-14 定三种现实；2026-10-05 起它随对话投影推来，不再轮询）：
//   ready + rows → 第一笔；ready + [] → 没有；off → 没有卡也**没有错**（本会话按配置没装这条面）；
//   缺席（这一侧没接读口）→ 没有。unreadable 不在这里：它是一张会说话的卡，那条路在 missingInterventionCard.test.ts。
describe('pendingSpendOfRead：off 不是失败', () => {
  it('ready 就取第一笔', () => {
    expect(pendingSpendOfRead({ surface: 'ready', rows: [ROW] })).toBe(ROW)
    expect(pendingSpendOfRead({ surface: 'ready', rows: [] })).toBeUndefined()
  })
  it('投影里还没有这一项 / 读不到：都不是「卡上那一笔」', () => {
    expect(pendingSpendOfRead(undefined)).toBeUndefined()
    expect(pendingSpendOfRead({ surface: 'unreadable', reason: 'projection-failed' })).toBeUndefined()
  })
  it.each([
    { surface: 'off', phase: 'disabled', reason: 'env' },
    { surface: 'off', phase: 'disabled', reason: 'low-memory' },
    { surface: 'off', phase: 'starting' },
    { surface: 'off', phase: 'stopped' },
  ] as const)('off（%j）→ 没有卡，也不留下任何 console 痕迹', (read) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(pendingSpendOfRead(read)).toBeUndefined()
      expect(error).not.toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })
})
