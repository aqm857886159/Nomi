import { describe, expect, it } from 'vitest'
import { MODEL_ARCHETYPES } from '../../../../../electron/shared/modelArchetypes'
import type { ArchetypeMode, ArchetypeReferenceSlot, ModelArchetype } from '../../../../../electron/shared/modelArchetypes/types'
import type { PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../../../generationCanvas/model/generationCanvasTypes'
import { buildArchetypeInputParams } from '../../../generationCanvas/nodes/controls/archetypeMeta'
import { resolveGenerationReferences } from '../../../generationCanvas/runner/generationReferenceResolver'
import { missingRequiredSlots } from './shotRowModel'

/**
 * 类级不变量：分镜行对「计划首帧」的记账，必须与**生成时真正发出去的东西**一致——全档案、全视频模式。
 *
 * 开了首帧的视频镜落画布是「首帧图节点 —first_frame 边→ 视频节点」（storyboardPlan.buildShotRowNodes）。
 * 这里不重新描述那张首帧会落进哪个槽，而是**真的走一遍发送路径**：真 resolver（generationReferenceResolver）
 * 解析那条边，真请求体构造（buildArchetypeInputParams）逐槽看它有没有被发出去。
 * 然后要求：分镜行判「缺」的必填槽 = 发送路径**没**用计划首帧填满的必填槽。
 *
 * 为什么是类级：0.22.0 的误报不是某一个模型的事——所有「只有 image_ref、没有 first_frame 槽」的
 * 图生视频模式（APIMart Seedance 2.0 i2v、Kling、Sora、Wan、Runway……）开了首帧都一样红。
 */

const FRAME_URL = 'https://fixture.invalid/storyboard-first-frame.png'

const keyframeShot: PlanShot = { index: 1, shotKind: 'video', durationSec: 5, anchorIds: [], prompt: 'p', keyframe: { enabled: true } }

/** 发送路径用计划首帧填了这个槽几张（把槽单独拎出来构造请求体，看首帧 URL 有没有出现在里面）。 */
function sentByFirstFrameEdge(archetype: ModelArchetype, mode: ArchetypeMode, slot: ArchetypeReferenceSlot): number {
  const isolated: ArchetypeMode = { ...mode, slots: [slot], combineSlotsInto: undefined }
  const single: ModelArchetype = { ...archetype, modes: [isolated], defaultModeId: mode.id }
  const meta = { archetype: { id: archetype.id, modeId: mode.id } }
  const video: GenerationCanvasNode = { id: 'shot', kind: 'video', title: '', position: { x: 0, y: 0 }, meta }
  const keyframe: GenerationCanvasNode = {
    id: 'keyframe', kind: 'image', title: '', position: { x: 0, y: 0 }, status: 'success', meta: {},
    result: { id: 'frame', type: 'image', url: FRAME_URL, createdAt: 1 },
  }
  const edge: GenerationCanvasEdge = { id: 'first-frame', source: 'keyframe', target: 'shot', mode: 'first_frame' }
  const references = resolveGenerationReferences(video, { nodes: [video, keyframe], edges: [edge] })
  const body = JSON.stringify(buildArchetypeInputParams(meta, single, references))
  return body.includes(FRAME_URL) ? 1 : 0
}

const videoModes = MODEL_ARCHETYPES
  .filter((archetype) => archetype.kind === 'video')
  .flatMap((archetype) => archetype.modes.map((mode) => ({ archetype, mode })))

describe('计划首帧 × 缺必填参考：与发送路径同一口径（全视频档案）', () => {
  it('扫到的模式里确实有「只有 image_ref 的图生视频」——这张表不是空转', () => {
    const imageRefOnly = videoModes.filter(({ mode }) =>
      !mode.slots.some((slot) => slot.kind === 'first_frame') && mode.slots.some((slot) => slot.kind === 'image_ref' && slot.min >= 1))
    expect(imageRefOnly.map(({ archetype, mode }) => `${archetype.id}/${mode.id}`)).toContain('seedance-2-apimart/i2v')
    expect(imageRefOnly.length).toBeGreaterThan(5)
  })

  it.each(videoModes.map(({ archetype, mode }) => [`${archetype.id}/${mode.id}`, archetype, mode] as const))(
    '%s：开了首帧、没绑任何参考时，缺的恰好是发送路径没填满的必填槽',
    (_label, archetype, mode) => {
      const expected = mode.slots
        .filter((slot) => slot.min >= 1 && sentByFirstFrameEdge(archetype, mode, slot) < slot.min)
        .map((slot) => slot.kind)
      expect(missingRequiredSlots(mode, keyframeShot, []).map((slot) => slot.kind)).toEqual(expected)
    },
  )

  it('计划首帧最多落一个槽：没有哪个模式会把同一张首帧同时发进两个槽（否则「落哪个槽」就不是一个问题）', () => {
    for (const { archetype, mode } of videoModes) {
      const filled = mode.slots.filter((slot) => sentByFirstFrameEdge(archetype, mode, slot) > 0).map((slot) => slot.kind)
      expect(filled.length, `${archetype.id}/${mode.id} → ${filled.join(',')}`).toBeLessThanOrEqual(1)
    }
  })
})
