import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestRenderer } = vi.hoisted(() => ({ requestRenderer: vi.fn() }))
vi.mock('./rendererBridge', () => ({ requestRenderer }))

import { notifyHostConfigRepaired } from './hostConfigRepairNotice'

describe('host config repair notice', () => {
  beforeEach(() => {
    requestRenderer.mockReset()
    requestRenderer.mockResolvedValue({ notified: true })
  })

  it('hands the renderer every client whose config was actually rewritten', async () => {
    await notifyHostConfigRepaired({ clientLabels: ['Claude Code', 'Codex'] })
    expect(requestRenderer).toHaveBeenCalledTimes(1)
    const [op, payload] = requestRenderer.mock.calls[0]
    expect(op).toBe('host-config.repaired')
    expect(payload).toEqual({ clients: ['Claude Code', 'Codex'] })
  })

  it('says nothing when nothing was rewritten', async () => {
    await notifyHostConfigRepaired({ clientLabels: [] })
    expect(requestRenderer).not.toHaveBeenCalled()
  })

  it('does not let a missing window fail the capability-core start', async () => {
    // 修复本身已经落盘了，这条提示是锦上添花。窗口还没建好/已经关了的时候它必须安静地失败，
    // 否则一次「没人接」就会把整个能力核启动链拖成 rejected。
    requestRenderer.mockRejectedValue(new Error('renderer target not committed'))
    await expect(notifyHostConfigRepaired({ clientLabels: ['Cursor'] })).resolves.toBeUndefined()
  })
})
