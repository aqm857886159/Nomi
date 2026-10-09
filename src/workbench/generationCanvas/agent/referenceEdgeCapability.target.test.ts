// 左「+」= 给这张卡加输入：判据以**本卡为目标**算（bug ②：以前拿本卡当源算，视频卡把图片 / 文字灰掉）。
// 连线总闸 validateReferenceEdge 读同一个种类事实：不收输入的种类（素材 / 文本……）新建连线一律拒。
import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeKind } from '../model/generationCanvasTypes'
import {
  connectionCreateVerdictsForSource,
  connectionCreateVerdictsForTarget,
  validateReferenceEdge,
} from './referenceEdgeCapability'

const KINDS = ['image', 'video', 'audio', 'text'] as const

function node(id: string, kind: GenerationNodeKind, meta: Record<string, unknown> = {}, result?: GenerationCanvasNode['result']): GenerationCanvasNode {
  return { id, kind, title: id, position: { x: 0, y: 0 }, categoryId: 'shots', meta, ...(result ? { result } : {}) }
}
const okKinds = (verdicts: readonly { kind: string; ok: boolean }[]) => verdicts.filter((verdict) => verdict.ok).map((verdict) => verdict.kind)

describe('connectionCreateVerdictsForTarget (left 「+」)', () => {
  it('a video card takes images and text — its main inputs (bug ②)', () => {
    const video = node('v', 'video')
    expect(okKinds(connectionCreateVerdictsForTarget(video, KINDS))).toEqual(['image', 'video', 'audio', 'text'])
    // 旧判据（以本卡为源）正是灰掉图片 / 文字的那一份——两份判据必须不同。
    expect(connectionCreateVerdictsForSource(video, ['image', 'text']).map((verdict) => verdict.ok)).not.toEqual([true, true])
  })

  it('a video card with a chosen model is judged against that model', () => {
    const video = node('v', 'video', { archetype: { id: 'seedance-2', modeId: 't2v' } })
    expect(okKinds(connectionCreateVerdictsForTarget(video, KINDS))).toEqual(['image', 'video', 'audio', 'text'])
  })

  it('an image card takes images and text; video / audio are greyed with the kind-level reason', () => {
    const verdicts = connectionCreateVerdictsForTarget(node('i', 'image'), KINDS)
    expect(okKinds(verdicts)).toEqual(['image', 'text'])
    expect(verdicts.find((verdict) => verdict.kind === 'video')).toMatchObject({ ok: false, reason: 'no_model_accepts', asset: 'video' })
  })

  it('an image card whose model does not take video says so (model-level reason)', () => {
    const verdicts = connectionCreateVerdictsForTarget(node('i', 'image', { archetype: { id: 'gpt-image-2', modeId: 't2i' } }), KINDS)
    expect(verdicts.find((verdict) => verdict.kind === 'video')).toMatchObject({ ok: false, reason: 'model_rejects', asset: 'video' })
  })

  it('a clip card takes images and videos only', () => {
    const verdicts = connectionCreateVerdictsForTarget(node('c', 'clip'), KINDS)
    expect(okKinds(verdicts)).toEqual(['image', 'video'])
    expect(verdicts.find((verdict) => verdict.kind === 'text')).toMatchObject({ ok: false, reason: 'not_accepted' })
  })

  it('a card that takes no input accepts nothing', () => {
    expect(okKinds(connectionCreateVerdictsForTarget(node('a', 'asset'), KINDS))).toEqual([])
  })

  // 2026-10-09 用户拍板：文本卡有左环，收文字和图（不收视频 / 声音：运行时只把图片送给模型）。
  it('a text card takes images and text; video / audio are greyed with the kind-level reason', () => {
    const verdicts = connectionCreateVerdictsForTarget(node('t', 'text'), KINDS)
    expect(okKinds(verdicts)).toEqual(['image', 'text'])
    expect(verdicts.find((verdict) => verdict.kind === 'video')).toMatchObject({ ok: false, reason: 'not_accepted' })
    expect(verdicts.find((verdict) => verdict.kind === 'audio')).toMatchObject({ ok: false, reason: 'not_accepted' })
  })
})

describe('validateReferenceEdge rejects input into kinds that take none', () => {
  const image = node('src', 'image', {}, { id: 'r', type: 'image', url: 'nomi-local://a.png', createdAt: 1 })
  it('a text target takes an image and text, not video or audio', () => {
    expect(validateReferenceEdge(image, node('t', 'text'), 'reference')).toEqual({ ok: true })
    expect(validateReferenceEdge(node('src2', 'text'), node('t', 'text'), 'reference')).toEqual({ ok: true })
    const video = node('v', 'video', {}, { id: 'rv', type: 'video', url: 'nomi-local://a.mp4', createdAt: 1 })
    expect(validateReferenceEdge(video, node('t', 'text'), 'reference')).toEqual({ ok: false, reason: 'unsupported_reference' })
  })
  it.each(['asset', 'panorama', 'whiteboard', 'shot', 'output', 'shot_table', 'agent-artifact'] as const)('image → %s is rejected', (kind) => {
    expect(validateReferenceEdge(image, node('t', kind), 'reference')).toEqual({ ok: false, reason: 'target_takes_no_input' })
  })

  it('a clip takes video / image, not text or audio', () => {
    const clip = node('c', 'clip')
    expect(validateReferenceEdge(node('v', 'video'), clip, 'reference')).toEqual({ ok: true })
    expect(validateReferenceEdge(image, clip, 'reference')).toEqual({ ok: true })
    expect(validateReferenceEdge(node('t', 'text'), clip, 'reference').ok).toBe(false)
    expect(validateReferenceEdge(node('a', 'audio'), clip, 'reference').ok).toBe(false)
  })

  it('keeps the meaningful edges: text → image prompt context, image → video, image → director', () => {
    expect(validateReferenceEdge(node('t', 'text'), node('i', 'image'), 'reference')).toEqual({ ok: true })
    expect(validateReferenceEdge(image, node('v', 'video'), 'first_frame')).toEqual({ ok: true })
    expect(validateReferenceEdge(image, node('d', 'director'), 'reference')).toEqual({ ok: true })
  })
})
