import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createProductionTrajectoryRecorder, measureProductionTrajectory, validateProductionTrajectory } from '../../scripts/productionTrajectoryContract.mjs'

function call(id, tool, request, extra = {}) {
  return {
    callId: id,
    tool,
    transport: 'mcp-stdio',
    request,
    resultSource: 'production-run-service',
    eventCursors: [1],
    ...extra,
  }
}

function goodTrace() {
  const projectId = 'project-real-30s'
  const runId = 'run-real-30s'
  const calls = [
    call('c1', 'nomi_start_playbook', { projectId, playbook: 'brand.promo', brief: { goal: '一段有因果的 30 秒短片' } }),
    call('c2', 'nomi_get_run', { projectId, runId }),
    call('c3', 'nomi_decide_gate', { projectId, runId, gateId: 'gate-direction-v1', decision: 'approved', choiceKey: 'street' }, {
      elicitation: { action: 'accept', actorRole: 'human-simulator', control: 'direction-choice' },
      eventCursors: [3, 4],
    }),
    call('c4', 'nomi_get_artifact', { projectId, runId, artifactId: 'artifact-script-v1' }),
    call('c5', 'nomi_review_artifact', { projectId, runId, artifactId: 'artifact-script-v1', expectedVersion: 1, decision: 'approved' }, {
      humanDecision: { actorRole: 'human-simulator', inputSource: 'desktop-click', control: 'approve-script', artifactVersion: 1 },
      eventCursors: [8, 9],
    }),
    call('c6', 'nomi_get_artifact', { projectId, runId, artifactId: 'artifact-storyboard-v1' }),
    call('c7', 'nomi_review_artifact', { projectId, runId, artifactId: 'artifact-storyboard-v1', expectedVersion: 1, decision: 'approved' }, {
      humanDecision: { actorRole: 'human-simulator', inputSource: 'desktop-click', control: 'approve-storyboard', artifactVersion: 1 },
      eventCursors: [12, 13],
    }),
    call('c8', 'nomi_materialize_storyboard', { projectId, runId, artifactId: 'artifact-storyboard-v1', expectedVersion: 1 }, { eventCursors: [15, 16] }),
    call('c9', 'nomi_read_canvas', { projectId }),
    call('c10', 'nomi_subscribe_run', { projectId, runId, afterCursor: 0 }),
    call('c11', 'nomi_get_artifact', { projectId, runId, artifactId: 'artifact-export-v1' }),
    call('c12', 'nomi_approve_rough_cut', { projectId, runId }, {
      humanDecision: { actorRole: 'human-simulator', inputSource: 'mcp-elicitation', control: 'rough-cut-and-export' },
      eventCursors: [21, 22],
    }),
  ]
  const shots = Array.from({ length: 6 }, (_, index) => {
    const shotId = `shot-${index + 1}`
    return {
      shotId,
      nodeId: `node-${shotId}`,
      artifactId: `artifact-video-${index + 1}`,
      provider: 'apimart',
      model: 'doubao-seedance-2.0',
      providerTaskId: `task-${index + 1}`,
      status: 'adopted',
      attempt: 1,
      observedAtCallId: 'c10',
      ...(index === 3 ? {
        attempt: 2,
        retryCount: 1,
        parentJobId: 'job-shot-4-attempt-1',
        retryReason: '第4镜抽帧出现第二张脸；根因是“从下方进入”引入未约束空间',
      } : {}),
    }
  })
  return {
    schemaVersion: 1,
    kind: 'nomi-production-trajectory',
    captureMode: 'live-mcp',
    producer: { kind: 'production-run-service', source: 'Nomi' },
    // This fixture exercises the Nomi-local UI path. The external-only policy
    // is covered by external-agent-single-surface.test.mjs with originHost
    // explicitly set to codex.
    client: { name: 'Nomi desktop', protocolVersion: '2025-11-25', originHost: 'nomi', actorId: 'main-agent' },
    project: { projectId, artifactRoot: 'nomi-project', runId },
    calls,
    decisions: [
      { decisionId: 'd1', callId: 'c3', kind: 'direction', gateId: 'gate-direction-v1', decision: 'approved', actorRole: 'human-simulator', inputSource: 'mcp-elicitation', eventCursor: 4 },
      { decisionId: 'd2', callId: 'c5', kind: 'artifact-review', artifactId: 'artifact-script-v1', artifactVersion: 1, decision: 'approved', actorRole: 'human-simulator', inputSource: 'desktop-click', eventCursor: 9 },
      { decisionId: 'd3', callId: 'c7', kind: 'artifact-review', artifactId: 'artifact-storyboard-v1', artifactVersion: 1, decision: 'approved', actorRole: 'human-simulator', inputSource: 'desktop-click', eventCursor: 13 },
    ],
    events: [
      { cursor: 1, type: 'run.created', runId },
      { cursor: 2, type: 'gate.waiting', runId },
      { cursor: 4, type: 'gate.decided', runId },
      { cursor: 9, type: 'artifact.reviewed', runId },
      { cursor: 13, type: 'artifact.reviewed', runId },
      { cursor: 16, type: 'plan.attached', runId },
      { cursor: 20, type: 'job.adopted', runId },
      { cursor: 21, type: 'run.completed', runId },
    ],
    artifacts: [
      { artifactId: 'artifact-brief-v1', kind: 'brief', version: 1, status: 'adopted', source: 'production-run-service', sourceCallId: 'c1', projectRelativePath: '.nomi/runs/run-real-30s/brief-v1.json' },
      { artifactId: 'artifact-script-v1', kind: 'script', version: 1, status: 'adopted', source: 'nomi-agent', sourceCallId: 'c4', reviewDecisionId: 'd2', reviewStatus: 'approved', contentHash: 'hash-script-v1', projectRelativePath: '.nomi/runs/run-real-30s/script-v1.json' },
      { artifactId: 'artifact-storyboard-v1', kind: 'storyboard', version: 1, status: 'adopted', source: 'nomi-agent', sourceCallId: 'c6', sourceArtifactId: 'artifact-script-v1', sourceVersion: 1, reviewDecisionId: 'd3', reviewStatus: 'approved', contentHash: 'hash-storyboard-v1', projectRelativePath: '.nomi/runs/run-real-30s/storyboard-v1.json' },
      { artifactId: 'artifact-timeline-v1', kind: 'timeline', version: 1, status: 'adopted', source: 'production-run-service', sourceCallId: 'c10', projectRelativePath: '.nomi/runs/run-real-30s/timeline-v1.json' },
      { artifactId: 'artifact-export-v1', kind: 'export', version: 1, status: 'adopted', source: 'production-run-service', sourceCallId: 'c11', projectRelativePath: 'exports/nomi-run-real-30s.mp4' },
    ],
    canvas: {
      sourceCallId: 'c9',
      materializeCallId: 'c8',
      nodes: shots.map(({ shotId, nodeId }) => ({ nodeId, kind: 'video', shotId, sourceArtifactId: 'artifact-storyboard-v1', observed: true })),
      connections: [{ source: 'anchor-woman', target: 'node-shot-1', mode: 'reference' }],
    },
    jobs: [...shots.map((shot, index) => ({
      jobId: index === 3 ? 'job-shot-4-attempt-2' : `job-${shot.shotId}`,
      ...shot,
      source: 'run-projection',
    })), {
      jobId: 'job-shot-4-attempt-1', shotId: 'shot-4', nodeId: 'node-shot-4', artifactId: 'artifact-video-4-rejected',
      provider: 'apimart', model: 'doubao-seedance-2.0', providerTaskId: 'task-4-rejected', status: 'needs_attention', attempt: 1,
      observedAtCallId: 'c10', source: 'run-projection',
    }],
    qa: {
      source: 'frame-analysis',
      captureMethod: 'ffmpeg-extract-frames',
      filmPath: 'exports/nomi-run-real-30s.mp4',
      analysisPath: '.nomi/runs/run-real-30s/frame-analysis/frame-analysis.json',
      verdict: 'pass',
      perShot: shots.map(({ shotId }) => ({ shotId, early: 'frames/early.jpg', middle: 'frames/middle.jpg', late: 'frames/late.jpg', verdict: 'pass', evidence: ['shot-contact-sheet.jpg'] })),
      boundaries: Array.from({ length: 5 }, (_, index) => ({ fromShotId: `shot-${index + 1}`, toShotId: `shot-${index + 2}`, verdict: 'pass', evidence: [`boundary-${index + 1}.jpg`] })),
      audio: { waveform: 'audio-waveform.png', verdict: 'pass', audible: true },
    },
    iterations: [{
      round: 1,
      failureId: 'shot-4-second-face',
      symptomEvidence: ['frame-analysis/shot-4-middle.jpg'],
      rootCause: '视频提示词“从下方进入”没有锁定桌下空间，模型补出第二个人脸。',
      designComparison: '设计要求单人、桌面动作、桌下为空；实际请求只传了“从下方进入”，信息守恒失败。',
      fix: '把动作改成“双手始终在桌面上”，显式禁止第二个人、脸、眼睛和倒影。',
      nextRound: 2,
      retryJobId: 'job-shot-4-attempt-2',
    }],
  }
}

describe('real MCP production trajectory contract', () => {
  it('accepts only a live MCP trace with human decisions and durable products', () => {
    assert.deepEqual(validateProductionTrajectory(goodTrace()), { ok: true, errors: [] })
  })

  it('reports derived trajectory metrics instead of trusting Agent self-report', () => {
    const metrics = measureProductionTrajectory(goodTrace())
    assert.equal(metrics.trajectoryVerdict, 'pass')
    assert.equal(metrics.requiredMcpToolCoverage, 1)
    assert.equal(metrics.humanDecisionCoverage, 1)
    assert.equal(metrics.canvasShotNodeCount, 6)
    assert.equal(metrics.providerTaskTraceRate, 1)
    assert.equal(metrics.retryCount, 1)
    assert.equal(metrics.retryLineageRate, 1)
    assert.equal(metrics.frameEvidenceCoverage, 1)
    assert.equal(metrics.boundaryPassRate, 1)
    assert.equal(metrics.audibleAudioPass, true)
    assert.equal(metrics.rootCauseIterationCount, 1)
  })

  it('recorder only appends observations and keeps the contract fail-closed', () => {
    const recorder = createProductionTrajectoryRecorder({ projectId: 'project-1', runId: 'run-1', client: { name: 'codex' } })
    recorder.recordMcpCall({ callId: 'c1', tool: 'nomi_start_playbook', transport: 'mcp-stdio', resultSource: 'production-run-service', request: {}, eventCursors: [1] })
    const snapshot = recorder.snapshot()
    assert.equal(snapshot.calls.length, 1)
    assert.equal(recorder.metrics().mcpCallCount, 1)
    assert.equal(recorder.validate().ok, false)
    snapshot.calls[0].tool = 'nomi_generate'
    assert.equal(recorder.snapshot().calls[0].tool, 'nomi_start_playbook')
  })

  it('does not count unrelated MCP tools as production coverage', () => {
    const trace = goodTrace()
    trace.calls = trace.calls.map((entry) => ({ ...entry, tool: 'nomi_list_projects' }))
    assert.equal(measureProductionTrajectory(trace).requiredMcpToolCoverage, 0)
  })

  it('rejects a hand-written approved status disguised as a product result', () => {
    const trace = goodTrace()
    trace.captureMode = 'scripted-fixture'
    trace.artifacts[1].source = 'manual'
    trace.decisions[1].actorRole = 'main-agent'
    const result = validateProductionTrajectory(trace)
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((error) => /live-mcp|manual|human-simulator/i.test(error)))
  })

  it('rejects a fake MCP call that has no service provenance or human click evidence', () => {
    const trace = goodTrace()
    trace.calls[7].resultSource = 'hand-written-json'
    delete trace.calls[6].humanDecision
    const result = validateProductionTrajectory(trace)
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((error) => /production-run-service|human.*decision|click|elicitation/i.test(error)))
  })

  it('rejects generation and QA that cannot be traced to provider jobs and frames', () => {
    const trace = goodTrace()
    trace.jobs[3].providerTaskId = undefined
    trace.qa.perShot[2].evidence = []
    trace.iterations[0].rootCause = ''
    const result = validateProductionTrajectory(trace)
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((error) => /providerTaskId|frame evidence|rootCause/i.test(error)))
  })
})
