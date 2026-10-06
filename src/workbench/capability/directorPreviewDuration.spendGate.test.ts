// 3D-BOX 花钱闸复核时长：预演挂好以后镜头时长又被改了（draft_shots 改候选）→ 出卡前预检拿主进程候选的时长比对，
// 对不上就不出卡。走真的落地盖章（materializeShots）+ 真的渲染端处理函数（director.preview-blocks）+ 真的预演写回（applyPreviewCaptured）。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../project/projectSessionTestHarness'
import { materializeShots } from './multiShotCanvasLanding'
import { directorPreviewBlocksOp } from './directorPreviewBlocksOp'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { resetClientIdRegistry } from '../generationCanvas/agent/applyCanvasToolCall'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { applyPreviewCaptured } from '../generationCanvas/nodes/director/agent/directorPreviewCapture'
import { readDirectorPreview } from '../generationCanvas/nodes/director/model/directorPreviewState'

const RUN = 'run-duration-1'

function addDirector(id: string, preview: Record<string, unknown>) {
  const node = { id, kind: 'director', title: '', position: { x: 0, y: 0 }, meta: { directorPreview: { revision: 'dplan-1', updatedAt: 1, ...preview } } } as unknown as GenerationCanvasNode
  useGenerationCanvasStore.getState().restoreSnapshot({ ...useGenerationCanvasStore.getState(), nodes: [...useGenerationCanvasStore.getState().nodes, node], edges: [], groups: [] } as never)
}

describe('3D-BOX 花钱闸：预演时长 vs 候选时长', () => {
  let shotNode: string
  let project: ProjectSessionTestHarness
  afterEach(() => project.dispose())
  beforeEach(async () => {
    project = createProjectSessionTestHarness(); await project.open('project-a')
    resetClientIdRegistry()
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
    const landed = await materializeShots({ materializationOperationId: `canvas-landing:${RUN}`, runId: RUN, shots: [{ shotId: 'shot-1', kind: 'video', prompt: 'p', candidate: { candidateId: 'c1', revision: 1 } }] })
    shotNode = landed.bindings[0].nodeId
  })

  it('预演渲染出来多长，写回 ready 时记下来（离屏帧数 / 帧率）', () => {
    addDirector('d1', { status: 'rendering', targetNodeId: shotNode })
    applyPreviewCaptured('d1', 'dplan-1', 'nomi-local://asset/p/preview.mp4', 'asset-pre', { id: 'o1', name: '预演', width: 1280, height: 720, duration: 6, createdAt: 1 })
    expect(readDirectorPreview(useGenerationCanvasStore.getState().nodes.find((node) => node.id === 'd1'))).toMatchObject({ status: 'ready', durationSeconds: 6 })
  })

  it('预演 6 秒、候选改成 8 秒 → 挡（说出两个数）；一样长 → 放行；候选没声明时长 → 不挡', () => {
    addDirector('d1', { status: 'ready', attach: 'video_ref', assetId: 'asset-pre', durationSeconds: 6, targetNodeId: shotNode })
    const references = { 'shot-1': ['asset-pre'] }
    expect(directorPreviewBlocksOp({ operationId: RUN, candidateReferences: references, candidateDurations: { 'shot-1': 8 } }).blocks)
      .toEqual([{ nodeId: shotNode, shotId: 'shot-1', reason: 'duration_mismatch', previewSeconds: 6, shotSeconds: 8 }])
    expect(directorPreviewBlocksOp({ operationId: RUN, candidateReferences: references, candidateDurations: { 'shot-1': 6 } }).blocks).toEqual([])
    expect(directorPreviewBlocksOp({ operationId: RUN, candidateReferences: references, candidateDurations: {} }).blocks).toEqual([])
  })

  it('只写进提示词的预演（模型没有参考视频槽）不比时长：参考视频根本不随付费载荷走', () => {
    addDirector('d1', { status: 'ready', attach: 'prompt_only', durationSeconds: 6, targetNodeId: shotNode })
    expect(directorPreviewBlocksOp({ operationId: RUN, candidateReferences: { 'shot-1': [] }, candidateDurations: { 'shot-1': 8 } }).blocks).toEqual([])
  })
})
