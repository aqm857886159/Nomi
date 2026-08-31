import { describe, expect, it } from 'vitest'

import type { VideoAnalysisTask } from '../../../electron/videoAnalysis/contracts'
import { buildVideoAnalysisTaskRows } from './videoAnalysisTaskCenter'

function task(patch: Partial<VideoAnalysisTask> = {}): VideoAnalysisTask {
  return {
    schemaVersion: 1,
    analysisId: 'analysis-1',
    projectId: 'project-a',
    source: { kind: 'project_asset', relativePath: 'assets/reference.mp4' },
    sourceNodeId: 'video-node-1',
    engineOrigin: 'http://127.0.0.1:8931',
    externalInference: false,
    status: 'running',
    stage: 'analyzing_evidence',
    engineTaskId: 'task-0123456789abcdef0123456789abcdef',
    sourceSha256: 'a'.repeat(64),
    engineName: 'eccut-local',
    engineVersion: 'v2',
    engineStage: 3,
    engineStageTotal: 6,
    stageText: 'OCR',
    errorCode: null,
    errorMessage: null,
    createdAt: '2026-08-08T08:00:00.000Z',
    updatedAt: '2026-08-08T08:00:10.000Z',
    startedAt: '2026-08-08T08:00:01.000Z',
    completedAt: null,
    lastEngineCheckAt: '2026-08-08T08:00:10.000Z',
    lastEngineUpdateAt: '2026-08-08T08:00:04.000Z',
    resultAvailable: false,
    ...patch,
  }
}

const labels = {
  title: '视频拆解',
  submissionUnknown: '正在只读核对提交结果',
  engineOffline: '本地引擎离线',
  stages: {
    queued: '排队',
    reading_media: '读取视频',
    analyzing_evidence: '分析画面与文字',
    structuring: '整理结构',
    completed: '完成',
  },
}

describe('video analysis task-center projection', () => {
  it('declares its own durable target, verified cancellation action, elapsed time, and stale engine state', () => {
    const [row] = buildVideoAnalysisTaskRows([task()], Date.parse('2026-08-08T08:00:25.000Z'), labels)

    expect(row).toMatchObject({
      kind: 'video_analysis',
      group: 'running',
      cancel: 'interrupt',
      target: { kind: 'video_analysis', projectId: 'project-a', analysisId: 'analysis-1', nodeId: 'video-node-1' },
      action: { kind: 'cancel_video_analysis', projectId: 'project-a', analysisId: 'analysis-1' },
      stalled: true,
      elapsedMs: 24_000,
    })
    expect(row?.percent).toBeUndefined()
  })

  it('keeps unknown submissions visibly reconciling without generation retry semantics', () => {
    const rows = buildVideoAnalysisTaskRows([
      task({ analysisId: 'done', status: 'completed', stage: 'completed', completedAt: '2026-08-08T08:00:12.000Z' }),
      task({ analysisId: 'unknown', status: 'submission_unknown', errorMessage: 'receipt unknown' }),
    ], Date.parse('2026-08-08T08:00:25.000Z'), labels)

    expect(rows[0]).toMatchObject({ group: 'done', outcome: 'success', action: null })
    expect(rows[1]).toMatchObject({
      group: 'running',
      recoverable: true,
      phaseText: '正在只读核对提交结果',
      action: null,
      error: 'receipt unknown',
    })
    expect(rows[1]?.outcome).toBeUndefined()
  })

  it('labels an unreachable running task as offline and keeps verified cancellation available', () => {
    const [row] = buildVideoAnalysisTaskRows([
      task({ status: 'engine_unreachable', lastEngineUpdateAt: null }),
    ], Date.parse('2026-08-08T08:00:25.000Z'), labels)

    expect(row).toMatchObject({
      group: 'running',
      phaseText: '本地引擎离线',
      cancel: 'interrupt',
      stalled: true,
    })
  })
})
