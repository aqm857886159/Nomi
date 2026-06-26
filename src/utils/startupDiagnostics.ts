type StartupMark = {
  label: string
  time: number
}

const marks: StartupMark[] = []
const startedAt = now()
const SLOW_STEP_MS = 250

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function markStartup(label: string): void {
  const time = now()
  marks.push({ label, time })
  const previous = marks[marks.length - 2]
  const delta = previous ? time - previous.time : time - startedAt
  const total = time - startedAt
  if (delta >= SLOW_STEP_MS || total >= SLOW_STEP_MS) {
    console.info(`[nomi:start] ${label} +${delta.toFixed(1)}ms total=${total.toFixed(1)}ms`)
  }
}

export function timeStartupStep<T>(label: string, work: () => T, warnMs = SLOW_STEP_MS): T {
  const start = now()
  try {
    return work()
  } finally {
    const duration = now() - start
    if (duration >= warnMs) {
      console.info(`[nomi:start] ${label} took ${duration.toFixed(1)}ms`)
    }
  }
}

export async function timeStartupStepAsync<T>(label: string, work: () => Promise<T>, warnMs = SLOW_STEP_MS): Promise<T> {
  const start = now()
  try {
    return await work()
  } finally {
    const duration = now() - start
    if (duration >= warnMs) {
      console.info(`[nomi:start] ${label} took ${duration.toFixed(1)}ms`)
    }
  }
}

export function markStartupProbe(label: string, payload?: Record<string, unknown>): void {
  const bridge = typeof window !== 'undefined' ? window.nomiDesktop : undefined
  bridge?.startupProbe?.mark(label, payload)
}
