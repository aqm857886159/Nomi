// 3D-BOX 花钱闸：预演挂好以后导演工程又被手改过（过期）→ 用户直接在视频节点上点 ↑ 也要挡（协调 10-16 定）。
// 判据与「出成片」同一份（directorPreviewIsStale）。走真 stage_shot 执行体、真预演写回（applyPreviewCaptured，带渲染源指纹）、
// 真渲染端处理函数（director.preview-blocks，主进程单镜 Run 准入问的就是它）、真节点生成可否判据（canRunGenerationNode）。
import { beforeEach, describe, expect, it } from 'vitest'
import { applyProposalBatch } from '../generationCanvas/agent/proposalTxn'
import { generationCanvasTools } from '../generationCanvas/agent/generationCanvasTools'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import type { DirectorWriteDomainResult } from '../generationCanvas/nodes/director/agent/applyDirectorWrite'
import { applyPreviewCaptured, previewCapturePlan, requestDirectorPreviewRender } from '../generationCanvas/nodes/director/agent/directorPreviewCapture'
import { DIRECTOR_PREVIEW_META_KEY, DIRECTOR_PROJECT_META_KEY } from '../generationCanvas/nodes/director/model/directorNodeMeta'
import { readDirectorPreview } from '../generationCanvas/nodes/director/model/directorPreviewState'
import { normalizeDirectorProject } from '../generationCanvas/nodes/director/model/directorProject'
import { canRunGenerationNode } from '../generationCanvas/runner/generationRunController'
import { directorPreviewBlocksOp } from './directorPreviewBlocksOp'
import { directorWriteSemanticInputSchema } from '../../../electron/shared/agentCapabilities/directorWrite'

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

async function stagedAndRendered() {
  const [shot] = generationCanvasTools.create_nodes([{ kind: 'video', title: 'shot-a', prompt: 'p', position: { x: 0, y: 0 }, meta: { archetype: { id: 'seedance-2-apimart', modeId: 't2v' } } }])
  const outcome = await applyProposalBatch([{ toolCallId: 'c1', toolName: 'create_director_plan', effectiveArgs: directorWriteSemanticInputSchema.parse({ operation: 'create_director_plan', shotNodeId: shot.id, plan: PLAN }) as unknown as Record<string, unknown> }])
  if (outcome.status !== 'committed') throw new Error('stage failed')
  const directorNodeId = (outcome.results[0] as Extract<DirectorWriteDomainResult, { applied: true }>).directorNodeId
  render(directorNodeId, 'nomi-local://asset/p/preview-1.mp4')
  return { shotId: shot.id, directorNodeId }
}

/** 与常驻 Host 同一条路：按节点此刻的工程排采帧计划 → 写回 ready（带渲染源指纹）。 */
function render(directorNodeId: string, url: string): void {
  const plan = previewCapturePlan(node(directorNodeId)!)
  if (!plan) throw new Error('no capture plan')
  applyPreviewCaptured(directorNodeId, plan.revision, url, 'asset-preview', output, plan.sourceFingerprint)
}

/** 在精修里手改：第一台机位换焦距，写回节点（编辑器的写回规矩就是这样落盘的）。 */
function handEdit(directorNodeId: string): void {
  const project = normalizeDirectorProject(node(directorNodeId)?.meta?.[DIRECTOR_PROJECT_META_KEY])
  project.scenes[0].cameras[0].fov += 10
  useGenerationCanvasStore.getState().updateNode(directorNodeId, { meta: { ...node(directorNodeId)!.meta, [DIRECTOR_PROJECT_META_KEY]: project } })
}

const canPress = (shotId: string) => {
  const state = useGenerationCanvasStore.getState()
  return canRunGenerationNode(node(shotId)!, { nodes: state.nodes, edges: state.edges })
}

beforeEach(() => {
  const state = useGenerationCanvasStore.getState()
  for (const item of [...state.nodes]) state.deleteNode(item.id)
})

describe('3D-BOX spend gate: a stale preview blocks the shot like rendering / failed', () => {
  it('a fresh preview lets the shot spend', async () => {
    const { shotId } = await stagedAndRendered()
    expect(directorPreviewBlocksOp({ nodeIds: [shotId] }).blocks).toEqual([])
    expect(canPress(shotId)).toBe(true)
  })

  it('after a hand edit the preview is stale: the main-process admission is told to block and the node ↑ cannot send', async () => {
    const { shotId, directorNodeId } = await stagedAndRendered()
    handEdit(directorNodeId)
    expect(directorPreviewBlocksOp({ nodeIds: [shotId] }).blocks).toEqual([{ nodeId: shotId, reason: 'stale' }])
    expect(canPress(shotId)).toBe(false)
  })

  it('the one-click re-render (same door as Produce) renders the edited project and lifts the block', async () => {
    const { shotId, directorNodeId } = await stagedAndRendered()
    handEdit(directorNodeId)
    expect(requestDirectorPreviewRender(directorNodeId)).toBe(true)
    expect(directorPreviewBlocksOp({ nodeIds: [shotId] }).blocks).toEqual([{ nodeId: shotId, reason: 'rendering' }])
    render(directorNodeId, 'nomi-local://asset/p/preview-2.mp4')
    expect(directorPreviewBlocksOp({ nodeIds: [shotId] }).blocks).toEqual([])
    expect(canPress(shotId)).toBe(true)
  })

  it('a preview rendered before fingerprints existed has unknown freshness: stale before the first paid generation, one free re-render lifts it', async () => {
    const { shotId, directorNodeId } = await stagedAndRendered()
    const { sourceFingerprint: _drop, ...legacy } = readDirectorPreview(node(directorNodeId))!
    useGenerationCanvasStore.getState().updateNode(directorNodeId, { meta: { ...node(directorNodeId)!.meta, [DIRECTOR_PREVIEW_META_KEY]: legacy } })
    // 没动过工程也一样：没有指纹 = 没法证明它对得上当前工程，花钱前要先重渲一次（本机免费）
    expect(directorPreviewBlocksOp({ nodeIds: [shotId] }).blocks).toEqual([{ nodeId: shotId, reason: 'stale' }])
    expect(canPress(shotId)).toBe(false)
    handEdit(directorNodeId)
    expect(directorPreviewBlocksOp({ nodeIds: [shotId] }).blocks).toEqual([{ nodeId: shotId, reason: 'stale' }])
    // 沿用现有的「重渲」入口；重渲出的新预演带指纹，放行
    expect(requestDirectorPreviewRender(directorNodeId)).toBe(true)
    render(directorNodeId, 'nomi-local://asset/p/preview-2.mp4')
    expect(directorPreviewBlocksOp({ nodeIds: [shotId] }).blocks).toEqual([])
    expect(canPress(shotId)).toBe(true)
  })
})

describe('3D-BOX spend gate: a corrupted preview record is freshness-unknown, like a legacy one', () => {
  const corrupt = (directorNodeId: string, shotId: string) => useGenerationCanvasStore.getState().updateNode(directorNodeId, { meta: { ...node(directorNodeId)!.meta, [DIRECTOR_PREVIEW_META_KEY]: { status: 'weird', targetNodeId: shotId } } })

  it('invalid status / missing revision no longer reads as "no preview": the shot is blocked until one free re-render', async () => {
    const { shotId, directorNodeId } = await stagedAndRendered()
    corrupt(directorNodeId, shotId)
    expect(directorPreviewBlocksOp({ nodeIds: [shotId] }).blocks).toEqual([{ nodeId: shotId, reason: 'stale' }])
    expect(canPress(shotId)).toBe(false)
    expect(requestDirectorPreviewRender(directorNodeId)).toBe(true)
    expect(readDirectorPreview(node(directorNodeId))?.targetNodeId).toBe(shotId)
    render(directorNodeId, 'nomi-local://asset/p/preview-2.mp4')
    expect(directorPreviewBlocksOp({ nodeIds: [shotId] }).blocks).toEqual([])
    expect(canPress(shotId)).toBe(true)
  })
})
