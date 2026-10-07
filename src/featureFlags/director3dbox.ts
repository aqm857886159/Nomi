import { getDesktopBridge } from '../desktop/bridge'

/** Renderer-only view of the bootstrap proof. The desktop bridge wins over Vite
 * values so a stale renderer chunk cannot silently turn the packaged app on. */
export function isDirector3DBoxEnabled(): boolean {
  const bridgeValue = getDesktopBridge()?.featureFlags?.director3dbox
  if (bridgeValue) return bridgeValue.enabled
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
  return env?.VITE_NOMI_DIRECTOR_3DBOX === 'true'
}

export function director3DBoxFingerprint(): string {
  return getDesktopBridge()?.featureFlags?.director3dbox?.fingerprint
    ?? `director3dbox:${isDirector3DBoxEnabled() ? 'on' : 'off'}:2026-11-15`
}
