// 外部 MCP 宿主触发的两个纯渲染层副作用（capabilityApplyHandler 只做 dispatch，同
// multiShotCanvasLanding 的分工）。两条都不碰项目 store、不需要项目租约：
//   1. integration.open-credentials：主进程已把窗口叫到前台，这里把设置对话框停在「模型」。
//      供应商与预填由持久 handoff 驱动（见 OnboardingDrawer），这里不传也不猜任何供应商身份。
//   2. host-config.repaired：主进程只在真的改了配置文件时才发这一条，并附上该重启哪些助手
//      （Claude Code / Codex / Cursor 或用户自建 profile）。名字从修复结果来，不在这里再写死一个。
import i18n, { getAppLocale } from '../../i18n'
import { toast } from '../../ui/toast'

/** 未处理返回 null，让 capabilityApplyHandler 继续走它自己的 switch。 */
export function handleMcpHostSurfaceOp(op: string, data: Record<string, unknown>): Record<string, unknown> | null {
  if (op === 'integration.open-credentials') {
    window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'models' } }))
    return { opened: true }
  }
  if (op === 'host-config.repaired') {
    const clients = Array.isArray(data.clients) ? data.clients.filter((name): name is string => typeof name === 'string') : []
    if (!clients.length) return { notified: false }
    toast(i18n.t('studio.hostConfigRepaired', { clients: clients.join(getAppLocale() === 'en' ? ', ' : '、') }), 'info')
    return { notified: true }
  }
  return null
}
