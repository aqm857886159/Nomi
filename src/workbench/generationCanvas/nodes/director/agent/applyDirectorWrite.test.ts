import { beforeEach, describe, expect, it } from 'vitest'
import type { DirectorWriteInput } from '../../../../../../electron/shared/agentCapabilities/directorWrite'
import { applyProposalBatch } from '../../../agent/proposalTxn'
import { applyCompensationOps } from '../../../agent/proposalUndo'
import { generationCanvasTools } from '../../../agent/generationCanvasTools'
import { useGenerationCanvasStore } from '../../../store/generationCanvasStore'
import { DIRECTOR_PLAN_META_KEY, DIRECTOR_PREVIEW_META_KEY } from '../model/directorNodeMeta'
import { directorPreviewSpendBlock, readDirectorPlanMeta, readDirectorPreview } from '../model/directorPreviewState'
import type { DirectorWriteDomainResult } from './applyDirectorWrite'

function resetCanvas() {
  const state = useGenerationCanvasStore.getState()
  for (const node of [...state.nodes]) state.deleteNode(node.id)
}

/** 题库外的最小两镜计划（不取评测题库任何一道）。 */
function plan(lastEnd = 6) {
  return {
    scene: { environment: 'day', template: 'room', tags: ['书房'] },
    actors: [
      { id: 'reader', kind: 'person', desc: '读者', placement: { relation: 'at', ref: 's1-room-floor' } },
      { id: 'friend', kind: 'person', desc: '朋友', placement: { relation: 'in_front_of', ref: 'reader' } },
    ],
    shots: [
      { id: 'wide', window: [0, 3], transitionIn: 'cut', subject: 'reader', subjects: ['reader', 'friend'], size: '全景', angle: 'front', height: 'eye', move: { kind: 'static' } },
      { id: 'close', window: [3, lastEnd], transitionIn: 'cut', subject: 'friend', size: '中景', angle: 'three_quarter', height: 'eye', move: { kind: 'push_in', speed: 'slow' } },
    ],
  }
}

function videoShot(): string {
  const [node] = generationCanvasTools.create_nodes([{ kind: 'video', title: '镜头 1', prompt: '两个人在书房里说话', position: { x: 0, y: 0 } }])
  return node.id
}

async function run(input: DirectorWriteInput) {
  const outcome = await applyProposalBatch([{ toolCallId: 'call-1', toolName: input.operation, effectiveArgs: input as unknown as Record<string, unknown> }])
  if (outcome.status !== 'committed') throw new Error(`aborted: ${outcome.reason}`)
  return { result: outcome.results[0] as DirectorWriteDomainResult, compensation: outcome.compensation }
}

function nodeById(id: string) {
  return useGenerationCanvasStore.getState().nodes.find((node) => node.id === id)
}

describe('applyDirectorWrite (3D-BOX stage_shot executor)', () => {
  beforeEach(resetCanvas)

  it('creates a director node for a video shot with plan, revision, measured cuts and a rendering preview that blocks spending', async () => {
    const shot = videoShot()
    const { result } = await run({ operation: 'create_director_plan', shotNodeId: shot, plan: plan() } as DirectorWriteInput)
    expect(result.applied).toBe(true)
    if (!result.applied) return
    expect(result.revision).toMatch(/^dplan-/)
    expect(result.preview).toMatchObject({ status: 'rendering', targetNodeId: shot })
    expect(result.cuts.map((cut) => cut.shot)).toEqual(['wide', 'close'])
    const director = nodeById(result.directorNodeId)
    expect(readDirectorPlanMeta(director)?.revision).toBe(result.revision)
    expect(readDirectorPreview(director)?.status).toBe('rendering')
    expect(directorPreviewSpendBlock(shot, useGenerationCanvasStore.getState().nodes)).toMatchObject({ reason: 'rendering', directorNodeId: result.directorNodeId })
  })

  it('refuses an image node as the target and writes nothing', async () => {
    const [image] = generationCanvasTools.create_nodes([{ kind: 'image', title: '关键帧', prompt: 'p', position: { x: 0, y: 0 } }])
    const before = useGenerationCanvasStore.getState().nodes.length
    const { result } = await run({ operation: 'create_director_plan', shotNodeId: image.id, plan: plan() } as DirectorWriteInput)
    expect(result).toMatchObject({ applied: false, rejected: 'target_missing' })
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(before)
  })

  it('marks a preview longer than the capture limit as failed, which keeps spending blocked', async () => {
    const shot = videoShot()
    const { result } = await run({ operation: 'create_director_plan', shotNodeId: shot, plan: plan(12) } as DirectorWriteInput)
    expect(result.applied && result.preview).toMatchObject({ status: 'failed' })
    expect(directorPreviewSpendBlock(shot, useGenerationCanvasStore.getState().nodes)).toMatchObject({ reason: 'failed', failure: 'too_long' })
  })

  it('rejects a stale baseRevision with the current revision and leaves the node untouched', async () => {
    const created = (await run({ operation: 'create_director_plan', plan: plan() } as DirectorWriteInput)).result
    if (!created.applied) throw new Error('create failed')
    const before = JSON.stringify(nodeById(created.directorNodeId)?.meta)
    const { result } = await run({ operation: 'patch_director_plan', directorNodeId: created.directorNodeId, baseRevision: 'dplan-0000000000000000', edits: [{ op: 'replace', path: '/shots/close/size', value: '特写' }] })
    expect(result).toMatchObject({ applied: false, rejected: 'stale_revision', currentRevision: created.revision })
    expect(JSON.stringify(nodeById(created.directorNodeId)?.meta)).toBe(before)
  })

  it('reports unchanged for an edit that restates the plan, writes nothing and leaves nothing to undo', async () => {
    const created = (await run({ operation: 'create_director_plan', plan: plan() } as DirectorWriteInput)).result
    if (!created.applied) throw new Error('create failed')
    const before = JSON.stringify(nodeById(created.directorNodeId)?.meta)
    const { result, compensation } = await run({ operation: 'patch_director_plan', directorNodeId: created.directorNodeId, baseRevision: created.revision, edits: [{ op: 'replace', path: '/shots/close/size', value: '中景' }] })
    expect(result).toMatchObject({ applied: true, unchanged: true, revision: created.revision, touched: [] })
    expect(JSON.stringify(nodeById(created.directorNodeId)?.meta)).toBe(before)
    expect(compensation).toEqual([])
  })

  it('applies a named patch, re-renders the preview for the same shot, and undo restores both nodes', async () => {
    const shot = videoShot()
    const created = (await run({ operation: 'create_director_plan', shotNodeId: shot, plan: plan() } as DirectorWriteInput)).result
    if (!created.applied) throw new Error('create failed')
    // 常驻 Host 挂好了预演（视频节点 meta 带上参考视频，导演节点预演 ready）。
    useGenerationCanvasStore.getState().updateNode(shot, { meta: { ...nodeById(shot)?.meta, referenceVideoUrls: ['nomi-local://asset/p/preview-1.mp4'] } })
    useGenerationCanvasStore.getState().updateNode(created.directorNodeId, { meta: { ...nodeById(created.directorNodeId)?.meta, [DIRECTOR_PREVIEW_META_KEY]: { ...readDirectorPreview(nodeById(created.directorNodeId)), status: 'ready', attach: 'video_ref' } } })
    const directorBefore = JSON.stringify(nodeById(created.directorNodeId)?.meta)
    const shotBefore = JSON.stringify(nodeById(shot)?.meta)

    const { result, compensation } = await run({ operation: 'patch_director_plan', directorNodeId: created.directorNodeId, baseRevision: created.revision, edits: [{ op: 'replace', path: '/shots/close/size', value: '特写' }] })
    expect(result).toMatchObject({ applied: true, unchanged: false, touched: ['shot:close'], preview: { status: 'rendering', targetNodeId: shot } })
    if (!result.applied) return
    expect(result.revision).not.toBe(created.revision)
    expect((nodeById(created.directorNodeId)?.meta?.[DIRECTOR_PLAN_META_KEY] as { revision: string }).revision).toBe(result.revision)
    expect(directorPreviewSpendBlock(shot, useGenerationCanvasStore.getState().nodes)?.reason).toBe('rendering')

    // 新预演挂上去之后再撤销：两个节点都回到补丁之前（含上一版已挂好的预演）。
    useGenerationCanvasStore.getState().updateNode(shot, { meta: { ...nodeById(shot)?.meta, referenceVideoUrls: ['nomi-local://asset/p/preview-2.mp4'] } })
    applyCompensationOps(compensation)
    expect(JSON.stringify(nodeById(created.directorNodeId)?.meta)).toBe(directorBefore)
    expect(JSON.stringify(nodeById(shot)?.meta)).toBe(shotBefore)
    expect(directorPreviewSpendBlock(shot, useGenerationCanvasStore.getState().nodes)).toBeNull()
  })

  it('undo of a create deletes the director node and puts the shot back as it was before the preview attached', async () => {
    const shot = videoShot()
    const shotBefore = { meta: JSON.stringify(nodeById(shot)?.meta ?? {}), prompt: nodeById(shot)?.prompt }
    const { result, compensation } = await run({ operation: 'create_director_plan', shotNodeId: shot, plan: plan() } as DirectorWriteInput)
    if (!result.applied) throw new Error('create failed')
    useGenerationCanvasStore.getState().updateNode(shot, { meta: { ...nodeById(shot)?.meta, referenceVideoUrls: ['nomi-local://asset/p/preview.mp4'] }, prompt: `${nodeById(shot)?.prompt}\n@Video1` })
    applyCompensationOps(compensation)
    expect(nodeById(result.directorNodeId)).toBeUndefined()
    expect(JSON.stringify(nodeById(shot)?.meta ?? {})).toBe(shotBefore.meta)
    expect(nodeById(shot)?.prompt).toBe(shotBefore.prompt)
  })
})
