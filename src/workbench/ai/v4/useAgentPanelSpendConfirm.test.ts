import { describe, expect, it, vi } from 'vitest'
import { hasPendingSpendCapability, pendingSpendOfRead } from './useAgentPanelSpendConfirm'
import { getDesktopBridge } from '../../../desktop/bridge'

vi.mock('../../../desktop/bridge', () => ({ getDesktopBridge: vi.fn() }))

const ROW = { operationId: 'op-1', projectId: 'project-1', shots: [] } as never

describe('spend surface capability guard（preload 静态面）', () => {
  it('reports unavailable without pendingSpend capability', () => {
    vi.mocked(getDesktopBridge).mockReturnValue({ productionRuns: {} } as never)
    expect(hasPendingSpendCapability()).toBe(false)
  })
  it('reports available when pendingSpend exists', () => {
    vi.mocked(getDesktopBridge).mockReturnValue({ productionRuns: { pendingSpend: vi.fn() } } as never)
    expect(hasPendingSpendCapability()).toBe(true)
  })
})

// 主进程那份读结果 → 卡上该有什么。2026-09-14：三种现实各走各的路——
//   ready + rows → 第一笔；ready + [] → 没有；off → 没有卡也**没有错**（本会话按配置没装这条面）。
// 只有主进程真的**拒绝**（装配抛了）才走 catch 渲那张会说话的卡；那条路在 missingInterventionCard.test.ts。
describe('pendingSpendOfRead：off 不是失败', () => {
  it('ready 就取第一笔', () => {
    expect(pendingSpendOfRead({ surface: 'ready', rows: [ROW] })).toBe(ROW)
    expect(pendingSpendOfRead({ surface: 'ready', rows: [] })).toBeUndefined()
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
