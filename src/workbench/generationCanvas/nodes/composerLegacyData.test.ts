/**
 * 旧项目打开后，节点上的参数、参考、提示词引用都不丢（B3 验收第 4 条）。
 *
 * 旧项目里的节点是这样存的：meta 里钉着档案方式（omni / firstlast）、上传参考在 `referenceImageUrls`、
 * 首帧在 `firstFrameUrl`、参数是各自的键，提示词里是 `@[asset:url]` 标记。B3 只换了**呈现**——
 * 这里用真函数把这些旧数据从头走一遍：存着的方式只当偏好读、存盘不改写，参考一张不少、引用标记一个不丢，
 * 提示词里引用块要显示的名字也能从旧数据里算出来。
 */
import { describe, expect, it } from 'vitest'
import { resolveArchetypeForModel } from '../../../../electron/shared/modelArchetypes'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { mentionUrlsInOrder } from '../../assets/promptMentions'
import { resolveReferenceInfos } from '../../assets/referenceNames'
import { currentReferenceMedia } from './mentionCandidates'
import { archetypeModeChoices } from './controls/channelModeReach'
import { applyHumanModeChoice, collectModeInputs, effectiveArchetypeMode } from './controls/archetypeMeta'
import { readReferenceList } from './controls/referenceList'
import { resolveReferencePlacement } from '../runner/referenceSlots'
import { buildModeMenu } from './controls/modeMenuModel'

const spec = resolveArchetypeForModel({ modelKey: 'seedance-2', vendorKey: 'apimart', meta: {} } as never)!
const U1 = 'http://x/refs/a.png'
const U2 = 'http://x/refs/b.png'
const UP = 'http://x/refs/from-node.png'
const legacyPrompt = `@[asset:${encodeURIComponent(U1)}] 走进 @[asset:${encodeURIComponent(UP)}]，镜头推近`

const legacyOmni = {
  id: 't', kind: 'video', title: '旧镜头', prompt: legacyPrompt, position: { x: 0, y: 0 },
  meta: { modelKey: 'seedance-2', archetype: { id: 'seedance-2', modeId: 'omni', variantId: 'fast' }, referenceImageUrls: [U1, U2], aspect_ratio: '9:16', duration: 8, resolution: '720p' },
} as unknown as GenerationCanvasNode
const source = { id: 's', kind: 'image', title: '旧角色', position: { x: 0, y: 0 }, result: { id: 'r', type: 'image', url: UP, createdAt: 1 } } as GenerationCanvasNode
const edges = [{ id: 'e', source: 's', target: 't', mode: 'reference' }] as GenerationCanvasEdge[]

describe('旧项目的节点在 B3 下', () => {
  it('参考一张不少：连线 + 上传，顺序不变', () => {
    const media = currentReferenceMedia(legacyOmni, [legacyOmni, source], edges)
    expect(media.map((m) => m.url)).toEqual([UP, U1, U2])
  })

  it('提示词里的引用标记一个不丢，名字能从旧数据算出来', () => {
    expect(mentionUrlsInOrder(legacyPrompt)).toEqual([U1, UP])
    const infos = resolveReferenceInfos({
      nodeId: 't', references: [{ url: UP, kind: 'image' }, { url: U1, kind: 'image' }],
      nodes: [legacyOmni, source], edges, library: null, fallbackName: () => '参考图',
    })
    expect(infos.get(UP)).toMatchObject({ name: '旧角色', source: 'canvas', fromEdge: true })
    expect(infos.get(U1)).toMatchObject({ name: 'a', source: 'upload' })
  })

  it('存着的方式只当偏好读、存盘不改写：参考方式有图，方式格显示的、按它发的都是全能参考', () => {
    const before = JSON.stringify(legacyOmni.meta)
    const resolved = effectiveArchetypeMode(spec, legacyOmni, { nodes: [legacyOmni, source], edges })
    expect(resolved).toMatchObject({ mode: { id: 'omni' }, status: 'ok', taken: 3 })
    const inputs = collectModeInputs(legacyOmni, { nodes: [legacyOmni, source], edges })
    const menu = buildModeMenu({ nodeKind: 'video', archetype: spec, visible: archetypeModeChoices(spec), inputs: inputs.inputs, firstFrameEmpty: inputs.firstFrameEmpty, resolvedModeId: resolved.mode.id })
    expect(menu?.activeId).toBe('omni')
    expect(JSON.stringify(legacyOmni.meta)).toBe(before)
  })

  it('参数一个不丢：选方式只写偏好，比例 / 时长 / 变体原样；参考列表不动，前两张落首帧 / 尾帧', () => {
    const next = applyHumanModeChoice(legacyOmni.meta!, spec, 'firstlast')
    expect(next).toMatchObject({ aspect_ratio: '9:16', duration: 8, archetype: { id: 'seedance-2', modeId: 'firstlast', variantId: 'fast' } })
    expect(next.referenceImageUrls).toEqual([U1, U2])
    const placed = resolveReferencePlacement({ ...legacyOmni, meta: next }, [legacyOmni], [])
    expect(placed.slots.map((slot) => slot.fills.map((fill) => fill.url))).toEqual([[U1], [U2]])
  })

  it('旧的首尾帧节点：首帧原样（读进参考列表、落回首帧），只剩一张也不被收回成文生', () => {
    const meta = { modelKey: 'seedance-2', archetype: { id: 'seedance-2', modeId: 'firstlast' }, firstFrameUrl: U1 }
    const node = { ...legacyOmni, meta } as GenerationCanvasNode
    const mode = effectiveArchetypeMode(spec, node, { nodes: [node], edges: [] }).mode
    expect(mode.intent).not.toBe('text')
    expect(readReferenceList(meta, mode)).toEqual([U1])
    const placed = resolveReferencePlacement(node, [node], [])
    expect(placed.slots[0]!.fills.map((fill) => fill.url)).toEqual([U1])
  })

  it('旧参考方式节点里以前藏着的首帧（#1269 条件 4）：读进来、先放一边——参考行看得见（不会发）、不在用；选首尾帧也不落；参数不丢', () => {
    const STALE = 'http://x/refs/stale-first.png'
    const meta = { ...legacyOmni.meta!, firstFrameUrl: STALE }
    const placed = resolveReferencePlacement({ ...legacyOmni, meta }, [legacyOmni], [])
    expect(placed.slots.flatMap((slot) => slot.fills.map((fill) => fill.url))).toEqual([U1, U2])
    expect(placed).toMatchObject({ unused: [STALE], parked: [STALE] })
    const next = applyHumanModeChoice(meta, spec, 'firstlast')
    expect(next).toMatchObject({ aspect_ratio: '9:16', duration: 8, referenceImageUrls: [U1, U2, STALE], referenceParkedUrls: [STALE] })
    const there = resolveReferencePlacement({ ...legacyOmni, meta: next }, [legacyOmni], [])
    expect(there.slots.map((slot) => slot.fills.map((fill) => fill.url))).toEqual([[U1], [U2]])
    expect(there.parked).toEqual([STALE])
  })
})
