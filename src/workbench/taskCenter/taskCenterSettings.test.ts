import { afterEach, expect, it, vi } from 'vitest'
import { notifyBatchFinished } from './taskCenterSettings'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('foreground keeps the existing in-app feedback', () => {
  vi.stubGlobal('document', { hasFocus: () => true })
  expect(notifyBatchFinished({ title: 'done', body: '' })).toBe('none')
})
it('passes event intent to the desktop owner without cached sound preferences', () => {
  vi.stubGlobal('document', { hasFocus: () => false })
  const show = vi.fn().mockResolvedValue({ ok: true })
  // 桌面接口只经 window 的真读口交出去（getDesktopBridge 读它），不换掉主人模块；装假桥这一类归批 3 一起迁。
  vi.stubGlobal('window', { nomiDesktop: { notifications: { show } } })
  notifyBatchFinished({ title: 'failed', body: 'retry', event: 'decision' })
  expect(show).toHaveBeenCalledWith({ title: 'failed', body: 'retry', event: 'decision' })
})
it('missing desktop bridge never synthesizes a second sound', () => {
  vi.stubGlobal('document', { hasFocus: () => false })
  vi.stubGlobal('window', {})
  expect(notifyBatchFinished({ title: 'done', body: '' })).toBe('none')
})
