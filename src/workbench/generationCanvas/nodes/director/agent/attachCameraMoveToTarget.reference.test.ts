// I-3d-ref：3D 预演参考图挂接缺口（D1 同网址标记让挂接跳过 / D2 提示词编号写死）。
// 反例先红：这些用例在修复前失败。真值来源是参考列表的**实际发送顺序**（orderedSentMediaReferenceUrls，与
// buildArchetypeInputParams 同一个函数）；提示词里的引用按 projectPromptForSend 投影后才是模型看到的编号。
import { describe, expect, it } from 'vitest'
import { projectPromptForSend } from '../../../../../../electron/shared/storyboard/promptMentions'
import { archetypeForNode } from '../../../agent/referenceEdgeCapability'
import type { GenerationCanvasNode } from '../../../model/generationCanvasTypes'
import { effectiveArchetypeModeWithInputs, orderedSentMediaReferenceUrls } from '../../controls/archetypeMeta'
import { EDGE_MODE_SLOTS } from '../../../../../../electron/shared/canvas/edgeAdmission'
import { CAMERA_MOVE_ATTACHED_URL_KEY, computeAttachCameraMove, type AttachCameraMoveOutcome } from './attachCameraMoveToTarget'

const PV = 'nomi-local://p/preview.mp4'
const preview = { kind: 'preview' as const, cuts: [{ start: 0, end: 3, shotSize: '全景', move: 'static' }], notes: [] as string[] }
const OMNI = { id: 'seedance-2-apimart', modeId: 'omni' }
const WITH_SLOT = { id: 'seedance-2-apimart', modeId: 't2v' }
const NO_SLOT = { id: 'veo-3.1', modeId: 't2v' }

function shot(overrides: { prompt?: string; meta?: Record<string, unknown> } = {}): GenerationCanvasNode {
  return { id: 'v', kind: 'video', title: 'v', prompt: overrides.prompt ?? '两人对话', x: 0, y: 0, width: 100, height: 100, meta: { archetype: WITH_SLOT, ...(overrides.meta ?? {}) } } as unknown as GenerationCanvasNode
}

function applied(node: GenerationCanvasNode, outcome: AttachCameraMoveOutcome): GenerationCanvasNode {
  if (outcome.kind !== 'patch') throw new Error(`expected patch, got ${outcome.kind}`)
  return { ...node, meta: outcome.patch.meta, ...(outcome.patch.prompt !== undefined ? { prompt: outcome.patch.prompt } : {}) } as GenerationCanvasNode
}

function attach(node: GenerationCanvasNode, edgeVideoUrls: string[] = []): GenerationCanvasNode {
  return applied(node, computeAttachCameraMove(node, PV, preview, { edgeVideoUrls }))
}

/** 模型最终看到的提示词 + 实际发出去的参考视频顺序：与发送路径同一个投影、同一份有序参考；方式按输入现算（2026-11-12）。 */
function sent(node: GenerationCanvasNode, edgeVideos: string[] = []): { prompt: string; videos: string[] } {
  const edgeInputs = edgeVideos.map(() => ({ slots: EDGE_MODE_SLOTS.reference, asset: 'video' as const }))
  const mode = effectiveArchetypeModeWithInputs(archetypeForNode(node)!, node, { nodes: [node], edges: [] }, edgeInputs).mode
  const ordered = orderedSentMediaReferenceUrls((node.meta ?? {}) as Record<string, unknown>, mode, { image: [], video: edgeVideos, audio: [] })
  return { prompt: projectPromptForSend(node.prompt ?? '', ordered), videos: ordered.filter((item) => item.kind === 'video').map((item) => item.url) }
}

const refs = (node: GenerationCanvasNode): unknown => node.meta?.referenceVideoUrls

describe('computeAttachCameraMove — 预演挂接按「当前实际槽 / 参考列表 / 提示词」判断，不信网址标记', () => {
  it('D1：无槽模型准备过（标记已写）→ 换成有槽模型再挂 → 参考视频重新挂上，不早退', () => {
    const prepared = attach(shot({ meta: { archetype: NO_SLOT } }))
    expect(prepared.meta?.[CAMERA_MOVE_ATTACHED_URL_KEY]).toBe(PV)
    const switched = { ...prepared, meta: { ...prepared.meta, archetype: WITH_SLOT } } as GenerationCanvasNode
    const outcome = computeAttachCameraMove(switched, PV, preview)
    expect(outcome.kind).toBe('patch')
    expect(outcome.kind === 'patch' && outcome.mode).toBe('video_ref')
    expect(refs(applied(switched, outcome))).toEqual([PV])
  })

  it('D1：用户手动删掉预演参考（标记还在）→ 再挂 → 重新挂上', () => {
    const attached = attach(shot())
    const deleted = { ...attached, meta: { ...attached.meta, referenceVideoUrls: [] } } as GenerationCanvasNode
    expect(refs(applied(deleted, computeAttachCameraMove(deleted, PV, preview)))).toEqual([PV])
  })

  // 方式按输入现算（2026-11-12）：存着的偏好被改回文生，参考视频还在 → 照样按全能参考发、预演照发；已经挂好 → 不再写。
  it('D1：存着的方式偏好被改回文生（标记还在、参考视频还在）→ 照样按参考发出预演，再挂是 noop', () => {
    const attached = attach(shot())
    const away = { ...attached, meta: { ...attached.meta, archetype: WITH_SLOT } } as GenerationCanvasNode
    expect(sent(away).videos).toEqual([PV])
    expect(computeAttachCameraMove(away, PV, preview)).toEqual({ kind: 'noop' })
  })

  it('D2：已有一个用户视频参考，再追加预演 → 模型看到的引用编号指向预演那一项（@video2），不是第一个用户片', () => {
    const next = attach(shot({ meta: { archetype: OMNI, referenceVideoUrls: ['nomi://user-clip.mp4'] } }))
    const { prompt, videos } = sent(next)
    expect(videos).toEqual(['nomi://user-clip.mp4', PV])
    expect(prompt).toMatch(/@video2 跟随这段参考视频的运镜/)
    expect(prompt).not.toMatch(/@[Vv]ideo1 跟随/)
  })

  it('D2：画布上已连了一条视频边（连线排在前）→ 预演编号随之后移（@video2），用户的片不被删', () => {
    const next = attach(shot(), ['nomi://edge-clip.mp4'])
    const { prompt, videos } = sent(next, ['nomi://edge-clip.mp4'])
    expect(videos).toEqual(['nomi://edge-clip.mp4', PV])
    expect(prompt).toMatch(/@video2 跟随这段参考视频的运镜/)
  })

  it('D2：参考视频槽已被用户的片占满（上限 3）→ 一个都不删；预演不假装挂上，改成文字兜底 + 警告', () => {
    const clips = ['nomi://c1.mp4', 'nomi://c2.mp4', 'nomi://c3.mp4']
    const base = shot({ meta: { archetype: OMNI, referenceVideoUrls: clips } })
    const outcome = computeAttachCameraMove(base, PV, preview)
    expect(outcome.kind).toBe('patch')
    if (outcome.kind !== 'patch') return
    expect(outcome.mode).toBe('prompt_only')
    expect(outcome.patch.meta.referenceVideoUrls).toEqual(clips)
    expect(outcome.patch.prompt).toContain('3D-BOX 预演运镜：')
    expect(outcome.toast?.level).toBe('warning')
    expect(sent(applied(base, outcome)).prompt).not.toMatch(/@video\d 跟随/)
  })

  it('换成不支持参考视频的模型再挂 → 给出「只能靠文字」的现有提示；提示词里不留指向空气的引用句', () => {
    const attached = attach(shot())
    const switched = { ...attached, meta: { ...attached.meta, archetype: NO_SLOT } } as GenerationCanvasNode
    const outcome = computeAttachCameraMove(switched, PV, preview)
    expect(outcome.kind).toBe('patch')
    if (outcome.kind !== 'patch') return
    expect(outcome.mode).toBe('prompt_only')
    expect(outcome.toast?.message).toBeTruthy()
    expect(outcome.patch.prompt).toContain('3D-BOX 预演运镜：')
    expect(outcome.patch.prompt).not.toContain('跟随这段参考视频的运镜')
  })

  it('同样的输入重复挂：结果不变、不重复追加（有槽 / 无槽）', () => {
    for (const archetype of [WITH_SLOT, NO_SLOT]) {
      const first = attach(shot({ meta: { archetype } }))
      expect(computeAttachCameraMove(first, PV, preview).kind).toBe('noop')
      expect((first.prompt ?? '').match(/跟随这段参考视频的运镜|3D-BOX 预演运镜：/g)).toHaveLength(1)
    }
  })

  it('同样的输入重复挂：用户的片排在预演之后也不把预演挪走（顺序稳定）', () => {
    const ordered = shot({ meta: { archetype: OMNI, referenceVideoUrls: [PV, 'nomi://user-clip.mp4'], [CAMERA_MOVE_ATTACHED_URL_KEY]: PV } })
    const once = computeAttachCameraMove(ordered, PV, preview)
    const settled = once.kind === 'patch' ? applied(ordered, once) : ordered
    expect(refs(settled)).toEqual([PV, 'nomi://user-clip.mp4'])
    expect(computeAttachCameraMove(settled, PV, preview).kind).toBe('noop')
  })

  it('旧版写下的字面「@Video1 跟随…」句不被叠加：换片后整句替换成指向新预演的引用', () => {
    const legacy = shot({
      prompt: '两人对话\n@Video1 跟随这段参考视频的运镜（只参考镜头运动，画面内容由角色参考与文字决定）。',
      meta: { archetype: OMNI, referenceVideoUrls: ['nomi://user-clip.mp4', 'nomi://old-preview.mp4'], [CAMERA_MOVE_ATTACHED_URL_KEY]: 'nomi://old-preview.mp4' },
    })
    const next = attach(legacy)
    expect((next.prompt ?? '').match(/跟随这段参考视频的运镜/g)).toHaveLength(1)
    const { prompt, videos } = sent(next)
    expect(videos).toEqual(['nomi://user-clip.mp4', PV])
    expect(prompt).toMatch(/@video2 跟随这段参考视频的运镜/)
  })
})
