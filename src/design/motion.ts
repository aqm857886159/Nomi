// Shared by Tailwind at build time and renderer APIs that require numeric durations.
export const NOMI_DURATION_MS = {
  instant: 0,
  micro: 110,
  fast: 150,
  normal: 220,
  spatial: 360,
  morph: 550,
} as const

export function exitDurationMs(enterMs: number): number {
  return Math.round((enterMs * 2) / 30) * 10
}

const durations = {
  ...NOMI_DURATION_MS,
  'fast-exit': exitDurationMs(NOMI_DURATION_MS.fast),
  'normal-exit': exitDurationMs(NOMI_DURATION_MS.normal),
  'spatial-exit': exitDurationMs(NOMI_DURATION_MS.spatial),
  'media-loading-cycle': 1250,
}

export const NOMI_EASE = {
  out: [0.2, 0.7, 0.3, 1],
  in: [0.3, 0, 0.8, 0.15],
  spatial: [0.16, 1, 0.3, 1],
  'in-out': [0.4, 0, 0.2, 1],
} satisfies Record<string, [number, number, number, number]>

export const NOMI_DURATION_VARS = Object.fromEntries(
  Object.entries(durations).map(([key, ms]) => [`--nomi-duration-${key}`, `${ms}ms`]),
)
export const NOMI_EASE_VARS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(NOMI_EASE).map(([key, curve]) =>
    [`--nomi-ease-${key}`, `cubic-bezier(${curve.join(', ')})`],
  )),
  '--nomi-ease-fast': 'var(--nomi-ease-out)',
  '--nomi-ease-morph': 'var(--nomi-ease-spatial)',
}

export type ProcessMotionCapability = {
  renderer: string | null
  prefersReducedMotion: boolean
}

/**
 * The no-argument probe also runs in a standalone browser realm via page.evaluate.
 * Keep its body self-contained. Ordinary UI readers request only the live media
 * query, which never allocates a WebGL context.
 */
export function readBrowserMotion(input: 'media-query'): MediaQueryList | undefined
export function readBrowserMotion(): ProcessMotionCapability
export function readBrowserMotion(input?: 'media-query'): MediaQueryList | ProcessMotionCapability | undefined {
  const query = typeof window === 'undefined' ? undefined : window.matchMedia?.('(prefers-reduced-motion: reduce)')
  if (input === 'media-query') return query
  const prefersReducedMotion = query?.matches ?? false
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

export function reducedMotionQuery(): MediaQueryList | undefined {
  return readBrowserMotion('media-query')
}

export function shouldReduceMotion(): boolean {
  return reducedMotionQuery()?.matches ?? false
}

// Match the specificity of :enabled:active when the OS requests a static press.
export const TEXT_BUTTON_PRESS = 'enabled:active:scale-[0.97] motion-reduce:active:scale-100 motion-reduce:enabled:active:scale-100'
