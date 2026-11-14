// 系统提示词里那句「去哪查完整模型目录」点名的工具，必须是模型此刻真能调的工具。
//
// 2026-09-14 的 20 动词改名（afe85411d8，不留别名）把模型目录读从 `nomi_read target=models` 改成了
// `list_models`，这句提示词没跟上：每一轮都在叫模型去调一个不存在的工具（2026-09-24 同类扫描发现）。
import { describe, expect, it } from 'vitest'
import { MODEL_FACING_TOOL_SPECS, modelCatalogReadSpec } from '../shared/agentCapabilities/modelFacingToolRegistry'
import type { LaneComposerContext } from '../shared/agentLane/laneDesktopContracts'
import { formatLaneModelDelta, formatLaneModelIndex } from './laneModelContext'
import { LANE_TOOL_REQUEST_TOOL_NAME } from './laneToolGroups.mjs'

const context = {
  model: { vendorKey: 'fixture', modelKey: 'text-1' },
  availableModels: [{
    vendor: 'fixture', modelId: 'image-1', kind: 'image', defaultModeId: 'standard',
    modes: [{ modeId: 'standard', params: [] }],
  }],
} as unknown as LaneComposerContext

describe('模型索引那句指路，只点名真能调的工具', () => {
  it('每一个 x_y 形的工具名都在动词声明里（或是 lane 自己的按需加载工具）', () => {
    const text = formatLaneModelIndex(context)
    const callable = new Set([...MODEL_FACING_TOOL_SPECS.map((spec) => spec.name), LANE_TOOL_REQUEST_TOOL_NAME])
    // 先证判据会命中东西，免得「一个都不认识」在文案被改空时恒真。
    const named = [...text.matchAll(/\b[a-z]+(?:_[a-z]+)+\b/g)].map((match) => match[0])
    expect(named.length).toBeGreaterThan(0)
    for (const name of named) expect(callable.has(name), name).toBe(true)
    expect(text).not.toContain('nomi_read')
    expect(text).not.toContain('${')
    // 指路那句必须真的点名「读模型目录」的那个动词（它是谁由声明说了算）。
    expect(named).toContain(modelCatalogReadSpec().name)
  })
})

describe('对用户提到模型时只说显示名，id 只给工具参数', () => {
  const named = { ...context, availableModels: [{ ...context.availableModels![0], displayName: 'Image One (display)' }] } as unknown as LaneComposerContext
  it('默认那一行先写用户认得的名字，id 标明「仅供工具参数」；索引每个模型带显示名；规则写明只说显示名', () => {
    const text = formatLaneModelIndex(named, { text_to_image: { vendor: 'fixture', modelId: 'image-1' } })
    expect(text).toContain('图片默认（文生图）：Image One (display)（modelId: image-1，vendor: fixture——仅供工具参数）')
    expect(text).toContain('image-1（显示名：Image One (display)）')
    expect(text).toContain('只说它的显示名')
    expect(text).toContain('不要念 modelId')
  })
  it('渲染层没给名字：退回目录 label，再退回 modelId——绝不编一个名字', () => {
    const noName = { ...context, availableModels: [{ ...context.availableModels![0], label: '目录名' }] } as unknown as LaneComposerContext
    expect(formatLaneModelIndex(noName, { text_to_image: { vendor: 'fixture', modelId: 'image-1' } })).toContain('图片默认（文生图）：目录名（modelId: image-1')
    expect(formatLaneModelIndex(context, { text_to_image: { vendor: 'fixture', modelId: 'ghost' } })).toContain('图片默认（文生图）：ghost（modelId: ghost')
  })
})

describe('用户声明的默认模型：模型看得到，且说的是同一个模型', () => {
  const declared = { text_to_image: { vendor: 'fixture', modelId: 'image-1' }, image_to_video: { vendor: 'fixture', modelId: 'video-9' } } as const

  it('索引里有「图片默认 / 视频默认」，并带着「没点名用默认、点名听用户、换了要先说」三条规则', () => {
    const text = formatLaneModelIndex(context, declared)
    expect(text).toContain('图片默认（文生图）：image-1（modelId: image-1，vendor: fixture')
    expect(text).toContain('视频默认（图生视频）：video-9（modelId: video-9，vendor: fixture')
    expect(text).toContain('用户没点名模型时')
    expect(text).toContain('以用户点名的为准')
    expect(text).toContain('先在回话里说清为什么换')
    expect(text).toContain('图片默认（改图 / 带参考图）：没有能用的已保存默认')
    expect(text).toContain('视频默认（文生视频）：没有能用的已保存默认')
  })

  it('自动选：四种任务都明确缺省，要求 Agent 从目录点名并回话报显示名', () => {
    const text = formatLaneModelIndex(context, {})
    expect(text.match(/没有能用的已保存默认/g)).toHaveLength(4)
    expect(text).toContain('「自动选」')
    expect(text).toContain('必须在 modelId 里点名一个具体模型')
    expect(text).toContain('从可用目录里挑')
    expect(text).toContain('在回话里用显示名告诉用户挑了谁')
    expect(text).toContain('以用户点名的为准')
  })

  it('未读取默认：目录增量和历史索引不能把未知说成自动选', () => {
    expect(formatLaneModelIndex(context)).not.toContain('没有能用的已保存默认')
    const changed = { ...context, availableModels: [{ ...context.availableModels![0], displayName: 'Updated' }] }
    expect(formatLaneModelDelta(changed, context)).not.toContain('没有能用的已保存默认')
    expect(formatLaneModelIndex({ availableModels: [] } as unknown as LaneComposerContext)).toBe('')
  })
})
