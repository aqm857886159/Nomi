import type { ExportJobSnapshot } from '../../../electron/shared/contracts/exportJobManager'
import type { ExportJobStatus } from '../../../electron/shared/contracts/exportTypes'
import { isExportJobTerminalStatus } from '../../../electron/shared/contracts/exportTypes'
import type { ExportJobTaskCenterProjection } from './taskCenterProjection'

type Labels = {
  title: string
  failed: string
  statuses: Record<ExportJobStatus, string>
}

export function buildExportJobTaskRows(
  jobs: readonly ExportJobSnapshot[],
  labels: Labels,
): ExportJobTaskCenterProjection[] {
  return jobs.map((job) => {
    const terminal = isExportJobTerminalStatus(job.status)
    const queued = job.status === 'queued'
    return {
      id: `export-job:${job.id}`,
      kind: 'export_job',
      jobId: job.id,
      title: job.outputName ? `${labels.title} · ${job.outputName}` : labels.title,
      group: terminal ? 'done' : queued ? 'queued' : 'running',
      ...(job.status === 'succeeded'
        ? { outcome: 'success' as const }
        : job.status === 'failed'
          ? { outcome: 'error' as const, error: labels.failed }
          : job.status === 'cancelled'
            ? { outcome: 'cancelled' as const }
            : {}),
      recoverable: false,
      ...(!terminal && !queued
        ? { percent: Math.max(0, Math.min(100, job.progress.ratio * 100)) }
        : {}),
      phaseText: labels.statuses[job.status],
      cancel: terminal ? 'none' : queued ? 'free' : 'interrupt',
      target: { kind: 'export_job' as const, jobId: job.id },
      action: terminal ? null : { kind: 'cancel_export_job' as const, jobId: job.id },
    }
  })
}
