// 不变量：apimart 的「首尾帧模式 size 必须 adaptive」这条硬约束，**必须压得住节点上残留的旧值**。
//
// 为什么这条必须单独钉（2026-08-12 真机走查发现的真实情形）：用户在画布上先用别的模型
// （如 Vidu Q3，比例默认 16:9）建了节点，再切到 Seedance 2.5——切换会把比例带过来，节点上
// 实际持久化着 size:"16:9"（走查时从 project.json 里读到的原文就是这样）。
// 如果 fixedParams 只是「默认值」而不是「覆盖」，用户切到首尾帧模式就会带着 16:9 发出去，
// 被 apimart 拒——而且这个失败只在「先用别的模型再切过来」的路径上出现，最难复现。
//
// 档案侧的静态断言在 seedance25ApimartContract.test.ts；这里测的是**组装出的请求参数**。
import { describe, expect, it } from 'vitest'
import { buildArchetypeInputParams } from '../../workbench/generationCanvas/nodes/controls/archetypeMeta'
import { SEEDANCE_2_5_APIMART_ARCHETYPE } from '../../../electron/shared/videoCapabilities'

/** 模拟「从别的模型切过来」的节点：比例残留 16:9。 */
const carriedOver = (modeId: string) => ({
  size: '16:9',
  aspect_ratio: '16:9',
  resolution: '720p',
  archetype: { id: SEEDANCE_2_5_APIMART_ARCHETYPE.id, modeId },
})

describe('Seedance 2.5 apimart · 首尾帧硬约束压得住残留值', () => {
  it.each(['first', 'firstlast'])('forces size=adaptive in %s mode even when the node carries 16:9', (modeId) => {
    const params = buildArchetypeInputParams(carriedOver(modeId), SEEDANCE_2_5_APIMART_ARCHETYPE, {
      firstFrameUrl: 'https://example.com/a.png',
      lastFrameUrl: 'https://example.com/b.png',
    })
    expect(params.size, `${modeId} 模式没能把残留的 16:9 覆盖成 adaptive`).toBe('adaptive')
  })

  // 文生视频没有这条约束 —— 档案**不注入** size，用户在 meta 里选的值原样流到 wire。
  // （buildArchetypeInputParams 只产出「槽位 + fixedParams + model」，标量参数走 meta 那条路；
  //  taskTemplateParams 里 ...refInput 排在 size 之后，所以档案注入的键才压得过 meta——
  //  也正因为这个顺序，上面首尾帧那两条才成立。）
  it('does not inject a ratio in text-to-video, leaving the user choice untouched', () => {
    const params = buildArchetypeInputParams(carriedOver('t2v'), SEEDANCE_2_5_APIMART_ARCHETYPE)
    expect(params.size).toBeUndefined()
  })

  // 首尾帧走 image_with_roles 角色数组（apimart 契约），不是 kie 的独立 first/last_frame_url。
  it('packs first and last frames into image_with_roles', () => {
    const params = buildArchetypeInputParams(carriedOver('firstlast'), SEEDANCE_2_5_APIMART_ARCHETYPE, {
      firstFrameUrl: 'https://example.com/a.png',
      lastFrameUrl: 'https://example.com/b.png',
    })
    expect(params.image_with_roles).toEqual([
      { url: 'https://example.com/a.png', role: 'first_frame' },
      { url: 'https://example.com/b.png', role: 'last_frame' },
    ])
    expect(params.first_frame_url, 'apimart 通道不该出现 kie 的字段名').toBeUndefined()
  })
})
