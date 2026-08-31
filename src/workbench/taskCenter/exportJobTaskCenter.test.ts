import { describe, expect, it } from 'vitest'

import type { ExportJobSnapshot } from '../../../electron/export/exportJobManager'
import { buildExportJobTaskRows } from './exportJobTaskCenter'

function snapshot(overrides: Partial<ExportJobSnapshot> = {}): ExportJobSnapshot {
  return {
    id: 'job-a',
    projectId: 'project-a',
    projectIdentity: {
      projectId: 'project-a',
      immutableProjectUuid: '11111111-1111-4111-8111-111111111111',
      projectGeneration: 1,
      canonicalRootDigest: 'root-a',
    },
    projectDir: '/private/project-a',
    jobDir: '/private/project-a/.nomi/exports/job-a',
    manifest: {
      version: 1,
      projectId: 'project-a',
      createdAt: '2026-08-29T00:00:00.000Z',
      timeline: { fps: 30, durationFrames: 60, range: { startFrame: 0, endFrame: 60 }, tracks: [] },
      profile: { preset: 'publish', container: 'mp4', quality: 'standard', width: 1920, height: 1080, fps: 30, videoCodec: 'h264', pixelFormat: 'yuv420p', audioCodec: 'none', audioMode: 'mute' },
      assets: {},
      execution: { backend: 'filtergraph' },
    },
    manifestIntegrity: 'canonical',
    outputName: 'final-cut',
    status: 'encoding',
    progress: { ratio: 0.375, stage: 'encoding', message: 'private encoder detail' },
    cancelled: false,
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:01.000Z',
    ...overrides,
  }
}

const labels = {
  title: 'Export',
  failed: 'Export failed',
  statuses: {
    queued: 'Queued', preparing: 'Preparing', planning: 'Planning', rendering: 'Rendering', encoding: 'Encoding',
    muxing: 'Muxing', finalizing: 'Finalizing', succeeded: 'Exported', failed: 'Failed', cancelled: 'Cancelled',
  },
} as const

describe('ExportJob TaskCenter projection', () => {
  it('projects the real ratio and existing exact cancel action without copied paths or ETA', () => {
    const [row] = buildExportJobTaskRows([snapshot()], labels)

    expect(row).toEqual({
      id: 'export-job:job-a',
      kind: 'export_job',
      jobId: 'job-a',
      title: 'Export · final-cut',
      group: 'running',
      recoverable: false,
      percent: 37.5,
      phaseText: 'Encoding',
      cancel: 'interrupt',
      target: { kind: 'export_job', jobId: 'job-a' },
      action: { kind: 'cancel_export_job', jobId: 'job-a' },
    })
    expect(JSON.stringify(row)).not.toContain('/private')
    expect(JSON.stringify(row)).not.toContain('private encoder detail')
    expect(JSON.stringify(row)).not.toContain('eta')
  })

  it('maps queued and terminal snapshots without inventing active work', () => {
    const rows = buildExportJobTaskRows([
      snapshot({ id: 'queued', status: 'queued', progress: { ratio: 0, stage: 'queued', message: 'Queued' } }),
      snapshot({ id: 'done', status: 'succeeded', progress: { ratio: 1, stage: 'succeeded', message: 'Succeeded' } }),
      snapshot({ id: 'failed', status: 'failed', progress: { ratio: 0.4, stage: 'failed', message: 'Failed' }, error: { message: '/private/input.webm failed' } }),
      snapshot({ id: 'cancelled', status: 'cancelled', progress: { ratio: 0.1, stage: 'cancelled', message: 'Cancelled' } }),
    ], labels)

    expect(rows.map((row) => ({ id: row.jobId, group: row.group, outcome: row.outcome, action: row.action, error: row.error }))).toEqual([
      { id: 'queued', group: 'queued', outcome: undefined, action: { kind: 'cancel_export_job', jobId: 'queued' }, error: undefined },
      { id: 'done', group: 'done', outcome: 'success', action: null, error: undefined },
      { id: 'failed', group: 'done', outcome: 'error', action: null, error: 'Export failed' },
      { id: 'cancelled', group: 'done', outcome: 'cancelled', action: null, error: undefined },
    ])
  })
})
