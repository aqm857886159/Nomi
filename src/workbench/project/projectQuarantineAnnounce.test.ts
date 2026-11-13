import { createInstance, type TFunction } from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../desktop/bridge', () => ({ getDesktopBridge: vi.fn(() => null) }))
vi.mock('../../desktop/rendererLog', () => ({ logRendererError: vi.fn(), logRendererWarn: vi.fn(), logRendererInfo: vi.fn() }))
vi.mock('./projectRepository', () => ({ takeQuarantineNotice: vi.fn() }))
const push = vi.fn()
const toastFn = vi.fn()
vi.mock('../../ui/toast', () => ({ useToastStore: { getState: () => ({ push }) }, toast: (...args: unknown[]) => toastFn(...args) }))

import { resources } from '../../i18n/resources'
import { takeQuarantineNotice, type QuarantineNoticeItem } from './projectRepository'
import { announceQuarantine } from './projectQuarantineAnnounce'

/**
 * 那句提醒交给现有提示件 toast（2026-11-13 第 2 轮协调裁定）：提醒色、不自动消失、这一批只出一条、
 * 桌面端带「打开所在文件夹」直通另存的那一份，没有桌面桥就不出按钮；没有要说的就什么都不出。
 */
async function translator(): Promise<TFunction> {
  const i18n = createInstance()
  await i18n.init({ lng: 'zh-CN', resources, interpolation: { escapeValue: false } })
  return i18n.t.bind(i18n) as TFunction
}
const notice = (i: number): QuarantineNoticeItem => ({
  origin: 'save', relativePath: `.nomi/quarantine/item-${i}.json`,
  item: { container: 'storyboardDesign', field: `plan.shots[${i}].durationSec`, title: `分镜${i}`, keptPreviousVersion: true, raw: {} },
} as unknown as QuarantineNoticeItem)

beforeEach(() => { push.mockReset(); toastFn.mockReset(); vi.mocked(takeQuarantineNotice).mockReset() })

describe('announceQuarantine', () => {
  it('nothing to tell → no toast at all', async () => {
    vi.mocked(takeQuarantineNotice).mockReturnValue([])
    expect(announceQuarantine('p1', await translator(), vi.fn())).toBe(false)
    expect(push).not.toHaveBeenCalled()
  })

  it('a warning that stays until the creator closes it or opens the folder (ttl: false), never an error', async () => {
    vi.mocked(takeQuarantineNotice).mockReturnValue([notice(0)])
    const reveal = vi.fn(async () => ({ ok: true }))
    announceQuarantine('p1', await translator(), reveal)
    expect(push).toHaveBeenCalledTimes(1)
    const toast = push.mock.calls[0]![0]
    expect(toast).toMatchObject({ type: 'warning', ttl: false, dismissible: true, actionLabel: '打开所在文件夹' })
    expect(toast.message).toContain('分镜《分镜0》第 1 镜')
    toast.onAction()
    expect(reveal).toHaveBeenCalledWith({ projectId: 'p1', relativePath: '.nomi/quarantine/item-0.json' })
  })

  it('25 items in one batch → one toast saying 25, not 25 toasts', async () => {
    vi.mocked(takeQuarantineNotice).mockReturnValue(Array.from({ length: 25 }, (_, i) => notice(i)))
    announceQuarantine('p1', await translator(), vi.fn())
    expect(push).toHaveBeenCalledTimes(1)
    expect(push.mock.calls[0]![0].message.startsWith('有 25 处内容格式不对')).toBe(true)
  })

  it('no desktop bridge (browser preview) → the sentence only, no folder button', async () => {
    vi.mocked(takeQuarantineNotice).mockReturnValue([notice(0)])
    announceQuarantine('p1', await translator(), undefined)
    expect(push.mock.calls[0]![0]).not.toHaveProperty('actionLabel')
    expect(push.mock.calls[0]![0]).toMatchObject({ type: 'warning', ttl: false })
  })

  it('opening the folder fails → says so as an error toast, does not throw', async () => {
    vi.mocked(takeQuarantineNotice).mockReturnValue([notice(0)])
    announceQuarantine('p1', await translator(), vi.fn(async () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }) }))
    push.mock.calls[0]![0].onAction()
    await vi.waitFor(() => expect(toastFn).toHaveBeenCalledTimes(1))
    expect(toastFn.mock.calls[0]![1]).toBe('error')
  })
})
