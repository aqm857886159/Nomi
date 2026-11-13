/**
 * 超过预演上限（10 秒）按**当前工程**判（V-3dbox 10-16：精修里把片段拉到 11 秒，「出成片」照常可点、预演被压进 10 秒）。
 * 走真画布 store、真 stage_shot 执行体、真预演写回、真「出成片」准备、真重渲写口、真花钱闸、真节点生成可否判据。
 * 以前「超长」只在 Agent 写计划那一刻判一次、记在预演上；手改拉长从来没人再问。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { applyProposalBatch } from '../../../agent/proposalTxn'
import { generationCanvasTools } from '../../../agent/generationCanvasTools'
import { useGenerationCanvasStore } from '../../../store/generationCanvasStore'
import { canRunGenerationNode } from '../../../runner/generationRunController'
import { DIRECTOR_PREVIEW_META_KEY, DIRECTOR_PROJECT_META_KEY } from '../model/directorNodeMeta'
import {
  directorPreviewSpendBlock, directorPreviewSpendBlockMessageKey, directorProduceButtonState, directorProduceState,
  directorProjectSeconds, readDirectorPreview,
} from '../model/directorPreviewState'
import { normalizeDirectorProject } from '../model/directorProject'
import type { DirectorProject } from '../model/directorTypes'
import { entityClips } from '../model/timeGrid'
import type { DirectorWriteDomainResult } from './applyDirectorWrite'
import { applyPreviewCaptured, previewCapturePlan, requestDirectorPreviewRender } from './directorPreviewCapture'
import { prepareProduceFromPreview } from './directorProduce'
import { directorWriteSemanticInputSchema } from '../../../../../../electron/shared/agentCapabilities/directorWrite'

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
const output = { id: 'out-1', name: 'preview-output', width: 1280, height: 720, duration: 6, createdAt: 1 }
const node = (id: string) => useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === id)
const projectOf = (id: string): DirectorProject => normalizeDirectorProject(node(id)?.meta?.[DIRECTOR_PROJECT_META_KEY])

async function stagedAndRendered() {
  const [shot] = generationCanvasTools.create_nodes([{ kind: 'video', title: '镜头 1', prompt: 'p', position: { x: 0, y: 0 }, meta: { archetype: { id: 'seedance-2-apimart', modeId: 't2v' } } }])
  const outcome = await applyProposalBatch([{ toolCallId: 'c1', toolName: 'create_director_plan', effectiveArgs: directorWriteSemanticInputSchema.parse({ operation: 'create_director_plan', shotNodeId: shot.id, plan: PLAN }) as unknown as Record<string, unknown> }])
  if (outcome.status !== 'committed') throw new Error('stage failed')
  const directorNodeId = (outcome.results[0] as Extract<DirectorWriteDomainResult, { applied: true }>).directorNodeId
  const plan = previewCapturePlan(node(directorNodeId)!)
  if (!plan) throw new Error('no capture plan')
  applyPreviewCaptured(directorNodeId, plan.revision, 'nomi-local://asset/p/preview-1.mp4', 'asset-preview', output, plan.sourceFingerprint)
  return { shotId: shot.id, directorNodeId }
}

/** 精修里把场景末尾的片段拉到 `seconds`（V-3dbox 的做法：所有收尾片段的 endTime 改成 11）。 */
function stretchTo(directorNodeId: string, seconds: number): void {
  const project = projectOf(directorNodeId)
  const scene = project.scenes[0]
  const end = directorProjectSeconds(node(directorNodeId)?.meta?.[DIRECTOR_PROJECT_META_KEY])
  for (const entity of [...scene.objects, ...scene.cameras]) {
    for (const clip of entityClips(entity)) if (Math.abs(clip.endTime - end) < 1e-6) clip.endTime = seconds
  }
  // entityClips 返回的是同一批片段对象：改的就是工程里的片段
  useGenerationCanvasStore.getState().updateNode(directorNodeId, { meta: { ...node(directorNodeId)!.meta, [DIRECTOR_PROJECT_META_KEY]: project } })
}

beforeEach(() => {
  const state = useGenerationCanvasStore.getState()
  for (const item of [...state.nodes]) state.deleteNode(item.id)
})

describe('3D-BOX preview length is judged on the current project', () => {
  it('a 6-second scene with a fresh preview can be produced', async () => {
    const { directorNodeId } = await stagedAndRendered()
    expect(directorProjectSeconds(node(directorNodeId)?.meta?.[DIRECTOR_PROJECT_META_KEY])).toBeCloseTo(6)
    expect(directorProduceButtonState(readDirectorPreview(node(directorNodeId)), projectOf(directorNodeId), 2)).toBe('idle')
  })

  it('stretched to 11s by hand: the button greys out as too long, produce writes nothing, no re-render, no new node', async () => {
    const { directorNodeId } = await stagedAndRendered()
    stretchTo(directorNodeId, 11)
    const project = projectOf(directorNodeId)
    expect(directorProjectSeconds(node(directorNodeId)?.meta?.[DIRECTOR_PROJECT_META_KEY])).toBeCloseTo(11)
    const previewBefore = readDirectorPreview(node(directorNodeId))
    expect(directorProduceButtonState(previewBefore, project, 2)).toBe('too_long')
    expect(directorProduceState(previewBefore, project, 2)).toEqual({ kind: 'failed', tooLong: true })
    const nodesBefore = useGenerationCanvasStore.getState().nodes.length
    expect(prepareProduceFromPreview(directorNodeId, project)).toEqual({ kind: 'blocked', reason: 'too_long' })
    expect(requestDirectorPreviewRender(directorNodeId)).toBe(false)
    expect(readDirectorPreview(node(directorNodeId))).toEqual(previewBefore)
    expect(useGenerationCanvasStore.getState().nodes.length).toBe(nodesBefore)
  })

  it('stretched to 11s: the attached preview (squeezed into 10s) no longer lets the shot spend', async () => {
    const { shotId, directorNodeId } = await stagedAndRendered()
    stretchTo(directorNodeId, 11)
    const block = directorPreviewSpendBlock(shotId, useGenerationCanvasStore.getState().nodes)
    expect(block).toEqual({ reason: 'failed', directorNodeId, failure: 'too_long' })
    expect(directorPreviewSpendBlockMessageKey(block!)).toBe('director.agent.spendBlockedTooLong')
    const state = useGenerationCanvasStore.getState()
    expect(canRunGenerationNode(node(shotId)!, { nodes: state.nodes, edges: state.edges })).toBe(false)
  })

  it('shortened back under the limit: a preview once marked too long can be re-rendered again', async () => {
    const { directorNodeId } = await stagedAndRendered()
    const preview = readDirectorPreview(node(directorNodeId))!
    useGenerationCanvasStore.getState().updateNode(directorNodeId, { meta: { ...node(directorNodeId)!.meta, [DIRECTOR_PREVIEW_META_KEY]: { ...preview, status: 'failed', reason: 'too_long', videoUrl: undefined } } })
    const project = projectOf(directorNodeId)
    expect(directorProduceState(readDirectorPreview(node(directorNodeId)), project, 2)).toEqual({ kind: 'needs_render' })
    expect(requestDirectorPreviewRender(directorNodeId)).toBe(true)
    expect(readDirectorPreview(node(directorNodeId))?.status).toBe('rendering')
  })
})
