import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import type { LocaleDigest, UpdateEvent } from '../../../electron/shared/updateReminder'
import { UpdateDialogCard } from './UpdateDialog'
import { deriveDialogView } from './updateDialogView'
import { closeUpdateDialog, openUpdateDialog, requestInstall, resetUpdateStoreForTests, startUpdateSync, useUpdateStore } from './updateStore'

const digest: LocaleDigest = { title: '标题', groups: [{ heading: '组', items: ['条目'] }], hiddenGroups: 0 }
const base = { dialogOpen: true, errorStage: null, canAutoInstall: true, macStepsShown: false } as const

describe('更新弹窗显示条件（后台状态从不主动弹窗）', () => {
  it('没被请求过：任何后台状态都不显示', () => {
    for (const phase of ['available', 'downloading', 'downloaded', 'error'] as const) {
      expect(deriveDialogView({ ...base, dialogOpen: false, phase, errorStage: phase === 'error' ? 'download' : null })).toBeNull()
    }
  })

  it('请求过：按阶段给对应那一屏；Mac 点过「去下载」才进三步屏', () => {
    expect(deriveDialogView({ ...base, phase: 'available' })).toBe('available')
    expect(deriveDialogView({ ...base, phase: 'downloading' })).toBe('downloading')
    expect(deriveDialogView({ ...base, phase: 'downloaded' })).toBe('ready')
    expect(deriveDialogView({ ...base, phase: 'error', errorStage: 'download' })).toBe('failed')
    expect(deriveDialogView({ ...base, phase: 'available', canAutoInstall: false })).toBe('available')
    expect(deriveDialogView({ ...base, phase: 'available', canAutoInstall: false, macStepsShown: true })).toBe('mac-steps')
  })

  it('检查开始 / 已是最新 / 空闲 / 手动检查失败：没有可看的详情，不显示', () => {
    for (const phase of ['idle', 'checking', 'up-to-date'] as const) expect(deriveDialogView({ ...base, phase })).toBeNull()
    expect(deriveDialogView({ ...base, phase: 'error', errorStage: 'check' })).toBeNull()
  })
})

describe('检查结束清掉过期弹窗（接真实的状态订阅）', () => {
  beforeEach(() => resetUpdateStoreForTests())

  it('弹窗开着时来了新的检查 / 已是最新事件：弹窗收掉，Mac 三步屏标记也清掉', () => {
    let emit: (event: UpdateEvent) => void = () => undefined
    startUpdateSync({
      snapshot: () => new Promise(() => undefined),
      onEvent: (callback) => { emit = callback; return () => undefined },
    })
    emit({ type: 'available', version: '0.24.0', notes: [], sizeBytes: null, releaseUrl: null })
    expect(useUpdateStore.getState().dialogOpen).toBe(false) // 后台事件不开窗
    openUpdateDialog()
    useUpdateStore.setState({ macStepsShown: true })
    expect(useUpdateStore.getState().dialogOpen).toBe(true)
    emit({ type: 'checking' })
    expect(useUpdateStore.getState()).toMatchObject({ dialogOpen: false, macStepsShown: false })
    openUpdateDialog()
    emit({ type: 'up-to-date' })
    expect(useUpdateStore.getState().dialogOpen).toBe(false)
    closeUpdateDialog()
  })
})

describe('有任务在跑时不显示「重启以更新」', () => {
  const render = (runningTasks: number): string => renderToStaticMarkup(
    <UpdateDialogCard view="ready" version="0.24.0" digest={digest} releaseUrl={null} canAutoInstall runningTasks={runningTasks} />,
  )

  it('有任务：只有说明和「知道了」，没有重启按钮', async () => {
    await i18n.changeLanguage('zh-CN')
    const html = render(3)
    expect(html).toContain('还有 3 个任务在跑')
    expect(html).toContain('知道了')
    expect(html).not.toContain(`${i18n.t('updateReminder.dialog.restart')}</button>`)
  })

  it('没有任务：给「稍后」和「重启以更新」', async () => {
    await i18n.changeLanguage('zh-CN')
    const html = render(0)
    expect(html).toContain(i18n.t('updateReminder.dialog.restart'))
    expect(html).toContain('稍后')
    expect(html).not.toContain('知道了')
  })
})

describe('主进程拒绝立即安装（有任务在跑，数量未知）后，弹窗如实回到「有任务在跑」', () => {
  beforeEach(() => resetUpdateStoreForTests())

  it('requestInstall 收到 busy → installBlocked 置位；成功 / 其他失败不置位；关弹窗清掉', async () => {
    await requestInstall({ install: async () => ({ ok: false, reason: 'busy' }) })
    expect(useUpdateStore.getState().installBlocked).toBe(true)
    closeUpdateDialog()
    expect(useUpdateStore.getState().installBlocked).toBe(false)
    await requestInstall({ install: async () => ({ ok: true }) })
    await requestInstall({ install: async () => ({ ok: false }) })
    await requestInstall({ install: async () => { throw new Error('ipc down') } })
    expect(useUpdateStore.getState().installBlocked).toBe(false)
  })

  it.each([
    ['zh-CN', '还有任务在跑，现在重启会中断它们', '知道了', '重启以更新</button>'],
    ['en', 'Tasks are still running', 'Got it', 'Restart to update</button>'],
  ])('%s：已下载 + installBlocked → 只有说明和确认按钮，没有重启按钮', async (language, running, gotIt, restart) => {
    await i18n.changeLanguage(language)
    const html = renderToStaticMarkup(<UpdateDialogCard view="ready" version="0.24.0" digest={digest} releaseUrl={null} canAutoInstall runningTasks={0} installBlocked />)
    expect(html).toContain(running)
    expect(html).toContain(gotIt)
    expect(html).not.toContain(restart)
  })

  it('上次没装上（failed 屏）重试被拒：显示「有任务在跑」说明、不再显示失败正文和重试按钮', async () => {
    await i18n.changeLanguage('zh-CN')
    const html = renderToStaticMarkup(<UpdateDialogCard view="failed" version="0.24.0" digest={digest} releaseUrl={null} canAutoInstall errorStage="install" errorReason="other" installBlocked />)
    expect(html).toContain('还有任务在跑')
    expect(html).not.toContain('安装程序没能启动')
    expect(html).not.toContain('重试</button>')
  })
})
