import type { ProjectAgentStatus } from '../../../../electron/shared/projectAgentContracts'

/** Keep elapsed time a derived display value; lifecycle timestamps stay Host-owned. */
export function residentToolElapsedMs(
  status: ProjectAgentStatus,
  createdAt?: string,
  updatedAt?: string,
  now = Date.now(),
): number | undefined {
  const started = createdAt ? Date.parse(createdAt) : Number.NaN
  if (!Number.isFinite(started)) return undefined
  const terminal = status === 'done' || status === 'failed' || status === 'declined' || status === 'stopped'
  const ended = terminal && updatedAt ? Date.parse(updatedAt) : now
  if (!Number.isFinite(ended)) return undefined
  return Math.max(0, ended - started)
}

/** Compact, unit-bearing value that fits the resident row at narrow widths. */
export function formatResidentToolElapsed(milliseconds: number | undefined): string {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds < 0) return ''
  if (milliseconds < 1_000) return '<1s'
  const totalSeconds = Math.floor(milliseconds / 1_000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  return `${minutes}:${String(totalSeconds % 60).padStart(2, '0')}`
}
