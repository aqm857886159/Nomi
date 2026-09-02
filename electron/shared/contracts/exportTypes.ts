export const EXPORT_JOB_STATUSES = [
  'queued',
  'preparing',
  'planning',
  'rendering',
  'encoding',
  'muxing',
  'finalizing',
  'succeeded',
  'failed',
  'cancelled',
] as const

export type ExportJobStatus = (typeof EXPORT_JOB_STATUSES)[number]

export function isExportJobTerminalStatus(status: ExportJobStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}
