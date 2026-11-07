export type ProcessMotionCapability = {
  renderer: string | null
  prefersReducedMotion: boolean
}

/** Read browser inputs separately so the decision can also be checked outside React. */
export function readProcessMotionCapability(): ProcessMotionCapability {
  const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (typeof document === 'undefined') return { renderer: '', prefersReducedMotion }
  let gl: WebGLRenderingContext | null = null
  try {
    gl = document.createElement('canvas').getContext('webgl')
    if (!gl) return { renderer: null, prefersReducedMotion }
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '') : ''
    return { renderer, prefersReducedMotion }
  } catch {
    return { renderer: null, prefersReducedMotion }
  } finally {
    // Release this temporary probe even if reading fails.
    try { gl?.getExtension('WEBGL_lose_context')?.loseContext() } catch { /* Cleanup cannot invalidate a capability read. */ }
  }
}

/** Pure admission policy shared by the UI and real-renderer performance scenarios. */
export function shouldReduceProcessMotion({ renderer, prefersReducedMotion }: ProcessMotionCapability): boolean {
  return prefersReducedMotion || renderer === null || /swiftshader|llvmpipe|software/i.test(renderer)
}
