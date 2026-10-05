import type { DesktopProxyStatus } from '../../desktop/bridge'

export function proxyPillTone(status: DesktopProxyStatus): { key: string; ok: boolean } {
  if (status.unsupported) return { key: 'pillUnsupported', ok: false }
  if (status.mode === 'off' || !status.activeUrl) {
    if (status.localProxyDetected) return { key: 'pillLocalProxy', ok: true }
    return { key: 'pillDirect', ok: false }
  }
  return { key: status.mode === 'custom' ? 'pillCustom' : 'pillSystem', ok: true }
}
