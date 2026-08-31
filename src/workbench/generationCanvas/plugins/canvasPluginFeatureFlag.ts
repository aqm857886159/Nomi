/** Renderer-only gate. It defaults off so a release cannot silently execute a future plugin. */
export function isCanvasPluginFeatureEnabled(): boolean {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
  return env?.VITE_NOMI_CANVAS_PLUGINS === 'true'
}
