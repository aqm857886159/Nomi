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

export class ExportCancelledError extends Error {
  readonly code = 'cancelled' as const

  constructor(message = 'Export cancelled') {
    super(message)
    this.name = 'ExportCancelledError'
  }
}

/**
 * 跨主进程与渲染层共用的导出取消真值**唯一**判据（概念 `export.cancellation-verdict`）。
 * 主进程 `ipcMain.handle` 抛出的 `ExportCancelledError` 跨 Electron IPC 序列化后 `.name` 会退化为 `'Error'`，
 * 但 `.message` 保留类名 `ExportCancelledError`；此处统一识别，调用方只问此函数。
 */
export function isExportCancelledError(error: unknown): boolean {
  if (error instanceof ExportCancelledError) return true
  if (!(error instanceof Error)) return false
  return error.name === 'ExportCancelledError'
    || error.name === 'AbortError'
    || /\bExportCancelledError\b/.test(error.message)
}
