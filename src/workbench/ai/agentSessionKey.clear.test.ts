import { afterEach, describe, expect, it, vi } from 'vitest'

// safeClearAgentSession 包住 desktopClient.clearWorkbenchAgentSession：
// 成功正常 await；失败 console.warn 记一次日志后吞掉，**永不外抛**（best-effort 清会话）。
// mock 掉真实 IPC 客户端，只验包装行为。
vi.mock('../../api/desktopClient', () => ({
  clearWorkbenchAgentSession: vi.fn(async () => {}),
}))

import { clearWorkbenchAgentSession } from '../../api/desktopClient'
import { safeClearAgentSession } from './agentSessionKey'

const mockClear = clearWorkbenchAgentSession as unknown as ReturnType<typeof vi.fn>

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('safeClearAgentSession —— 带日志的安全包装（B1b 清会话一致化）', () => {
  it('把 sessionKey 原样透传给 clearWorkbenchAgentSession', async () => {
    mockClear.mockResolvedValueOnce(undefined)
    await safeClearAgentSession('nomi:shot-verify:proj-1')
    expect(mockClear).toHaveBeenCalledTimes(1)
    expect(mockClear).toHaveBeenCalledWith('nomi:shot-verify:proj-1')
  })

  it('底层 reject 时不外抛（resolve void），并 console.warn 记一次', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockClear.mockRejectedValueOnce(new Error('ipc down'))
    // 不应抛：await 正常返回
    await expect(safeClearAgentSession('nomi:workbench:p:creation')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    // 日志里带上 sessionKey，便于定位是哪条会话清失败
    expect(String(warn.mock.calls[0]?.join(' '))).toContain('nomi:workbench:p:creation')
  })

  it('成功路径不打 warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockClear.mockResolvedValueOnce(undefined)
    await safeClearAgentSession('nomi:production-directions:x')
    expect(warn).not.toHaveBeenCalled()
  })
})
