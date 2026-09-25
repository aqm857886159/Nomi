import type { ExportJobSnapshot } from '../../../electron/shared/contracts/exportJobManager'
import type { ExportJobStatus } from '../../../electron/shared/contracts/exportTypes'
import { isExportJobTerminalStatus } from '../../../electron/shared/contracts/exportTypes'
import type { ExportJobTaskCenterProjection } from './taskCenterProjection'
import type { TranslationKey } from '../../i18n/translationKey'

type Labels = {
  title: string
  failed: string
  missingFile: string
  diskFull: string
  permissionDenied: string
  mediaUnreadable: string
  statuses: Record<ExportJobStatus, string>
}

/** 任务按钮（徽标）和任务面板共用的一份文案表——此前两边各手抄一份。 */
export function exportJobTaskLabels(t: (key: TranslationKey) => string): Labels {
  return {
    title: t('taskCenter.exportJob.title'),
    failed: t('taskCenter.exportJob.failed'),
    missingFile: t('taskCenter.exportJob.missingFile'),
    diskFull: t('taskCenter.exportJob.diskFull'),
    permissionDenied: t('taskCenter.exportJob.permissionDenied'),
    mediaUnreadable: t('taskCenter.exportJob.mediaUnreadable'),
    statuses: {
      queued: t('taskCenter.exportJob.statuses.queued'),
      preparing: t('taskCenter.exportJob.statuses.preparing'),
      planning: t('taskCenter.exportJob.statuses.planning'),
      rendering: t('taskCenter.exportJob.statuses.rendering'),
      encoding: t('taskCenter.exportJob.statuses.encoding'),
      muxing: t('taskCenter.exportJob.statuses.muxing'),
      finalizing: t('taskCenter.exportJob.statuses.finalizing'),
      succeeded: t('taskCenter.exportJob.statuses.succeeded'),
      failed: t('taskCenter.exportJob.statuses.failed'),
      cancelled: t('taskCenter.exportJob.statuses.cancelled'),
    },
  }
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
          ? { outcome: 'error' as const, error: exportFailureReason(job.error?.code, labels) }
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
      action: !terminal
        ? { kind: 'cancel_export_job' as const, jobId: job.id }
        : job.status === 'succeeded' && job.result?.relativeOutputPath
          ? { kind: 'reveal_export_output' as const, projectId: job.projectId, relativePath: job.result.relativeOutputPath }
          : { kind: 'return_to_export' as const, projectId: job.projectId },
    }
  })
}

/** Only stable diagnostic codes cross into public copy; raw messages contain paths and encoder logs. */
function exportFailureReason(code: string | undefined, labels: Labels): string {
  switch (code) {
    case 'ENOSPC': return labels.diskFull
    case 'EACCES': case 'EPERM': return labels.permissionDenied
    case 'ENOENT': case 'missing_file': return labels.missingFile
    case 'probe_failed': case 'unsupported_media': case 'invalid_probe_output': return labels.mediaUnreadable
    default: return labels.failed
  }
}
