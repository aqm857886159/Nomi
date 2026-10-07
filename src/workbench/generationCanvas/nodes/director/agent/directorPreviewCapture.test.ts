import { beforeEach, describe, expect, it } from 'vitest'
import { applyProposalBatch } from '../../../agent/proposalTxn'
import { generationCanvasTools } from '../../../agent/generationCanvasTools'
import { findCanvasChange } from '../../../events/canvasUndoJournal'
import { makeChangeId } from '../../../../../../electron/shared/agentCapabilities/changeId'
import { useGenerationCanvasStore } from '../../../store/generationCanvasStore'
import { directorPreviewSpendBlock, readDirectorPreview } from '../model/directorPreviewState'
import type { DirectorWriteDomainResult } from './applyDirectorWrite'
import { applyPreviewCaptured, markPreviewFailed, previewCapturePlan } from './directorPreviewCapture'

function resetCanvas() {
  const state = useGenerationCanvasStore.getState()
  for (const node of [...state.nodes]) state.deleteNode(node.id)
}

const PLAN = {
  scene: { environment: 'day', template: 'room', tags: ['书房'] },
  actors: [
    { id: 'reader', kind: 'person', desc: '读者', placement: { relation: 'at', ref: 's1-room-floor' } },
    { id: 'friend', kind: 'person', desc: '朋友', placement: { relation: 'in_front_of', ref: 'reader' } },
  ],
  shots: [
    { id: 'wide', window: [0, 3], transitionIn: 'cut', subject: 'reader', size: '全景', angle: 'front', height: 'eye', move: { kind: 'static' } },
    { id: 'close', window: [3, 6], transitionIn: 'cut', subject: 'friend', size: '中景', angle: 'three_quarter', height: 'eye', move: { kind: 'push_in' } },
  ],
}

async function staged() {
  // seedance-2 有 video_ref 槽：预演应挂成参考视频。
  const [shot] = generationCanvasTools.create_nodes([{ kind: 'video', title: '镜头 1', prompt: '书房对话', position: { x: 0, y: 0 }, meta: { archetype: { id: 'seedance-2-apimart', modeId: 't2v' } } }])
  const outcome = await applyProposalBatch([{ toolCallId: 'c1', toolName: 'create_director_plan', effectiveArgs: { operation: 'create_director_plan', shotNodeId: shot.id, plan: PLAN } as unknown as Record<string, unknown> }])
  if (outcome.status !== 'committed') throw new Error('stage failed')
  const result = outcome.results[0] as Extract<DirectorWriteDomainResult, { applied: true }>
  return { shotId: shot.id, directorNodeId: result.directorNodeId, revision: result.revision, proposalId: outcome.proposalId }
}

const node = (id: string) => useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === id)
const output = { id: 'out-1', name: '3D-BOX 预演', width: 1280, height: 720, duration: 6, createdAt: 1 }

describe('3D-BOX preview capture (Host 纯逻辑那一半)', () => {
  beforeEach(resetCanvas)

  it('plans the whole plan at 24fps with the program camera per moment', async () => {
    const { directorNodeId } = await staged()
    const plan = previewCapturePlan(node(directorNodeId)!)
    expect(plan?.fps).toBe(24)
    expect(plan!.times.length).toBeGreaterThan(100)
    expect(plan!.times.length).toBeLessThanOrEqual(240)
    expect(plan!.cameraIdAt(1)).toBe('shot:wide/camera')
    expect(plan!.cameraIdAt(4)).toBe('shot:close/camera')
  })

  it('attaches the finished preview as the shot reference video, marks it ready, lifts the spend gate, and stays inside the staging change for undo', async () => {
    const { shotId, directorNodeId, revision, proposalId } = await staged()
    expect(directorPreviewSpendBlock(shotId, useGenerationCanvasStore.getState().nodes)?.reason).toBe('rendering')
    applyPreviewCaptured(directorNodeId, revision, 'nomi-local://asset/p/preview.mp4', 'asset-preview-1', output)
    expect(readDirectorPreview(node(directorNodeId))).toMatchObject({ status: 'ready', attach: 'video_ref', videoUrl: 'nomi-local://asset/p/preview.mp4', assetId: 'asset-preview-1' })
    expect(node(shotId)?.meta?.referenceVideoUrls).toEqual(['nomi-local://asset/p/preview.mp4'])
    expect(node(shotId)?.prompt).toContain('@Video1')
    expect(directorPreviewSpendBlock(shotId, useGenerationCanvasStore.getState().nodes)).toBeNull()
    // Host 的挂接写入沿用这笔提议的事务身份：撤销 stage_shot 时不被当成「别人的后续改动」。
    expect(findCanvasChange(makeChangeId('canvas', proposalId))?.conflictingEventTypes ?? []).toEqual([])
  })

  it('drops a late result whose revision is no longer current', async () => {
    const { shotId, directorNodeId } = await staged()
    expect(applyPreviewCaptured(directorNodeId, 'dplan-stale', 'nomi-local://asset/p/old.mp4', 'asset-old', output)).toBeNull()
    expect(readDirectorPreview(node(directorNodeId))?.status).toBe('rendering')
    expect(node(shotId)?.meta?.referenceVideoUrls).toBeUndefined()
  })

  it('marks the preview failed after retries, which keeps the shot blocked', async () => {
    const { shotId, directorNodeId, revision } = await staged()
    markPreviewFailed(directorNodeId, revision)
    expect(readDirectorPreview(node(directorNodeId))).toMatchObject({ status: 'failed', reason: 'capture_failed' })
    expect(directorPreviewSpendBlock(shotId, useGenerationCanvasStore.getState().nodes)?.reason).toBe('failed')
  })
})
