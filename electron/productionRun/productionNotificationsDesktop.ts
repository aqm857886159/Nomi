// A5 系统通知 · electron 胶水层（薄）：决策在 productionNotifications.ts（纯逻辑，单测在那边）。
// 只干三件事：① 前台不打扰（用户正看着 Nomi）；② 发原生通知；③ 点击拉回窗口并深链到该 run
// （复用 nomi:production-deep-link 通道，renderer 既有处理器会定位到 run）。
// 通知钩子绝不允许影响制作主流程：全部 try/catch 吞错。

import { ensureMainWindow } from '../mainWindowPresence'
import { showDesktopNotification } from '../desktopNotification'

import { createNoticeDedupe, decideProductionNotice } from './productionNotifications'
import type { ProductionRun, RunEvent } from './productionRunTypes'

async function focusAndDeepLink(target: { projectId: string; runId: string }): Promise<void> {
  const win = await ensureMainWindow('production-notification')
  if (win && !win.isDestroyed()) win.webContents.send('nomi:production-deep-link', target)
}

/** 装一个可直接塞给 service deps.onEvents 的监听器。 */
export function createProductionNotificationsListener(): (events: RunEvent[], run: ProductionRun) => void {
  const allow = createNoticeDedupe()
  return (events, run) => {
    try {
      const decided = decideProductionNotice(events, run)
      if (!decided || !allow(decided.key)) return
      showDesktopNotification({ title: decided.title, body: decided.body,
        event: decided.soundEvent, onClick: () => focusAndDeepLink(decided.target).catch(() => undefined) })
    } catch {
      // 通知失败不影响制作。
    }
  }
}
