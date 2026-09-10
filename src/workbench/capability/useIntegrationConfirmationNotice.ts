import React from 'react'
import i18n from '../../i18n'
import { getDesktopBridge } from '../../desktop/bridge'
import { notify } from '../../ui/notificationPolicy'

/**
 * 「有一次接入在等你确认」的全局可见提示。
 *
 * 为什么需要它：接入的花费确认面板只在 设置 → 模型 → 接入抽屉 里渲染。外部 AI 宿主
 * 发起接入时，队列里躺着一条 `verification` handoff，而 GUI 什么都不显示——用户不主动
 * 翻到设置页就永远看不见。2026-09-10 的真实宿主实测里，这一条正是「花钱确认关走不通」
 * 的第一层：人被通知不到，agent 等不到人，于是 agent 选择再 confirm 一次，把上一次点击洗掉。
 *
 * 实现刻意不新造任何东西：数据源是已经在跑的持久 handoff 队列（`integrationHandoffSubscribe`
 * / `integrationHandoffList`，见 electron/integrationCertification/handoffQueue.ts），
 * 提示走全仓唯一的背景通知 `notify({ level: 'background' })`，动作走既有的
 * `nomi-open-settings` 事件——与 mcpHostSurfaceOps.ts 里那条宿主配置提示同一套。
 */
export function useIntegrationConfirmationNotice(): void {
  React.useEffect(() => {
    const bridge = getDesktopBridge()?.onboarding
    const list = bridge?.integrationHandoffList
    if (!list) return
    let alive = true
    const announced = new Set<string>()
    const refresh = async (): Promise<void> => {
      let entries: Awaited<ReturnType<typeof list>>
      try {
        entries = await list()
      } catch {
        return
      }
      if (!alive) return
      const pending = entries.filter((entry) => entry.target === 'verification')
      // 队列里没有了 = 人已经点过或会话取消了：撤掉提示，别留一条点了没反应的僵尸。
      for (const requestId of [...announced]) {
        if (pending.some((entry) => entry.requestId === requestId)) continue
        announced.delete(requestId)
      }
      for (const entry of pending) {
        if (announced.has(entry.requestId)) continue
        announced.add(entry.requestId)
        notify({
          identity: `integration-confirm:${entry.requestId}`,
          reason: 'pending-confirmation',
          level: 'background',
          type: 'warning',
          message: i18n.t('studio.integrationConfirmPending', { name: entry.display?.name || entry.sessionId }),
          actionLabel: i18n.t('studio.integrationConfirmPendingAction'),
          onAction: () => window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'models' } })),
        })
      }
    }
    void refresh()
    const unsubscribe = bridge?.integrationHandoffSubscribe?.(() => { void refresh() })
    return () => {
      alive = false
      unsubscribe?.()
    }
  }, [])
}
