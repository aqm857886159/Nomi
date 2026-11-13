import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import type { GenerationFeedback } from '../../observability/generationFeedback'
import type { ProductionShotState } from '../../../../electron/shared/productionShotPhase'
import { isPortraitAspect, nodePointerAspect, nodePointerFace, nodePointerGroupVisible, nodePointerLocatable, nodePointerSummary, nodePointerSummaryFacts, nodePointerTitleTails, pointerCenterTier, pointerHoverStack, type PointerCenterTier } from './nodePointerFace'

const node = (patch: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode => ({
  id: 'n1', kind: 'video', title: '纸船出发', categoryId: 'shots', position: { x: 0, y: 0 }, status: 'idle', prompt: '', meta: {}, ...patch,
} as GenerationCanvasNode)

const feedback = (patch: Partial<GenerationFeedback>): GenerationFeedback => ({
  phase: 'generating', message: '生成中 · 已等 12 秒', late: false, active: true, previewLabel: '', ...patch,
})

const ready = { canvasReady: true, feedback: null } as const

describe('nodePointerFace', () => {
  it('says deleted only on the host’s explicit fact, never because the node is merely missing (board D4)', () => {
    expect(nodePointerFace({ ...ready, node: undefined, removed: true })).toEqual({ kind: 'removed' })
    expect(nodePointerFace({ ...ready, node: undefined })).toEqual({ kind: 'unavailable' })
    // 画布还没载入完：节点不在不代表被删。
    expect(nodePointerFace({ node: undefined, canvasReady: false, feedback: null })).toEqual({ kind: 'unavailable' })
    // 撤销回来了：节点又在画布上，以节点为准。
    expect(nodePointerFace({ ...ready, node: node(), removed: true })).toEqual({ kind: 'empty' })
    expect(nodePointerLocatable({ kind: 'removed' })).toBe(false)
    expect(nodePointerLocatable({ kind: 'unavailable' })).toBe(false)
    expect(nodePointerLocatable({ kind: 'empty' })).toBe(true)
  })

  it('follows the node shell layering: running feedback beats a stale result and production labels', () => {
    const running = node({ status: 'running', result: { id: 'r', type: 'image', url: 'nomi-asset://a.png', createdAt: 1 } })
    const face = nodePointerFace({ node: running, canvasReady: true, feedback: feedback({}), productionState: { phase: 'awaiting_confirmation' } })
    expect(face.kind).toBe('generating')
  })

  it('shows the failure the node itself shows (same feedback), not a pointer-only copy', () => {
    const failed = feedback({ phase: 'failed', active: false, message: '服务暂时不可用' })
    expect(nodePointerFace({ node: node({ status: 'error' }), canvasReady: true, feedback: failed })).toEqual({ kind: 'failed', feedback: failed })
  })

  it('mirrors recoverable and local processing instead of falling into an empty card', () => {
    expect(nodePointerFace({ ...ready, node: node({ status: 'recoverable' }) }).kind).toBe('recoverable')
    expect(nodePointerFace({ ...ready, node: node({ meta: { uploadStatus: 'uploading' } }) }).kind).toBe('processing')
  })

  it('shows the result thumbnail through the canvas lightweight preview owner', () => {
    const done = node({ result: { id: 'r', type: 'image', url: 'nomi-asset://a.png', createdAt: 1 } })
    expect(nodePointerFace({ ...ready, node: done, productionState: { phase: 'done' } })).toMatchObject({ kind: 'result', preview: { kind: 'image' } })
  })

  it('carries the whole production state so the corner label can say 第 k/N, and keeps stopped without actions', () => {
    for (const phase of ['awaiting_confirmation', 'not_generated', 'removed'] as const) {
      expect(nodePointerFace({ ...ready, node: node(), productionState: { phase } })).toEqual({ kind: 'production', state: { phase } })
    }
    const queued: ProductionShotState = { phase: 'queued', queueIndex: 1, queueTotal: 3 }
    expect(nodePointerFace({ ...ready, node: node(), productionState: queued })).toEqual({ kind: 'production', state: queued })
    const stopped: ProductionShotState = { phase: 'stopped', stoppedReason: 'user_paused' }
    expect(nodePointerFace({ ...ready, node: node(), productionState: stopped })).toEqual({ kind: 'stopped', state: stopped })
    expect(nodePointerFace({ ...ready, node: node(), productionState: null })).toEqual({ kind: 'empty' })
  })
})

describe('nodePointerAspect', () => {
  it('keeps the true ratio for vertical shots and falls back for broken sizes', () => {
    expect(nodePointerAspect({ width: 9, height: 16 })).toBeCloseTo(0.5625)
    expect(nodePointerAspect({ width: 0, height: 0 })).toBeCloseTo(16 / 9)
  })
})

describe('nodePointerGroupVisible', () => {
  it('folds anything over three into the third tile (board drawing), including four', () => {
    expect(nodePointerGroupVisible(5, 3, false)).toEqual({ shown: 3, hidden: 2 })
    expect(nodePointerGroupVisible(4, 3, false)).toEqual({ shown: 3, hidden: 1 })
    expect(nodePointerGroupVisible(3, 3, false)).toEqual({ shown: 3, hidden: 0 })
    expect(nodePointerGroupVisible(5, 3, true)).toEqual({ shown: 5, hidden: 0 })
  })
})

describe('pointerHoverStack', () => {
  it('the last tile to arrive is the one shown; leaving takes away only the one that left', () => {
    const afterBoth = pointerHoverStack(pointerHoverStack([], 'a', true), 'b', true)
    expect(afterBoth).toEqual(['a', 'b'])
    // 先到的走了，后到的还在；后到的走了，先到的回来。
    expect(pointerHoverStack(afterBoth, 'a', false)).toEqual(['b'])
    expect(pointerHoverStack(afterBoth, 'b', false)).toEqual(['a'])
    expect(pointerHoverStack(pointerHoverStack(afterBoth, 'a', false), 'b', false)).toEqual([])
  })

  it('arriving again moves a tile to the end; nothing changes (same array) when there is nothing to change', () => {
    expect(pointerHoverStack(['a', 'b'], 'a', true)).toEqual(['b', 'a'])
    const same = ['a', 'b']
    expect(pointerHoverStack(same, 'b', true)).toBe(same)
    expect(pointerHoverStack(same, 'c', false)).toBe(same)
  })
})

describe('nodePointerSummary', () => {
  const facts = { model: 'Seedance 2', aspect: '16:9', duration: '4s', resolution: '480p' }
  it('card reads model · ratio · duration from the node', () => {
    expect(nodePointerSummary(facts, 'card')).toEqual(['Seedance 2 · 16:9 · 4s'])
  })
  it('row drops the ratio for landscape but never for portrait', () => {
    expect(nodePointerSummary(facts, 'row')).toEqual(['Seedance 2 · 4s'])
    expect(nodePointerSummary({ ...facts, aspect: '9:16' }, 'row')).toEqual(['Seedance 2 · 9:16 · 4s'])
  })
  it('a single portrait card puts two lines beside the frame: model / ratio · duration · resolution', () => {
    expect(nodePointerSummary({ ...facts, aspect: '9:16', duration: '5s' }, 'side')).toEqual(['Seedance 2', '9:16 · 5s · 480p'])
  })
  it('prints nothing it cannot read (no empty separators)', () => {
    expect(nodePointerSummary({ model: '', aspect: null, duration: null, resolution: null }, 'card')).toEqual([])
    expect(isPortraitAspect('3:4')).toBe(true)
    expect(isPortraitAspect('16:9')).toBe(false)
    expect(isPortraitAspect(null)).toBe(false)
  })
})

describe('nodePointerTitleTails · the part of each tile title that tells it from its siblings (narrow walk 2026-10-25)', () => {
  /** 每一格截中间时整截留下的那一段。 */
  const tails = (titles: string[]): string[] => nodePointerTitleTails(titles).map((at, index) => titles[index]!.slice(at))

  it('a long shared opening: each keeps its differing word, plus the word before when that one is a bare number', () => {
    expect(tails(['S_NARROW_1 纸船 1', 'S_NARROW_1 纸船 2', 'S_NARROW_1 纸船 3'])).toEqual(['纸船 1', '纸船 2', '纸船 3'])
  })

  it('a differing word long enough on its own stands alone', () => {
    expect(tails(['开场 海边远景', '开场 城市夜景'])).toEqual(['海边远景', '城市夜景'])
  })

  it('Chinese with no word boundary at all: two characters of context before the first difference', () => {
    expect(tails(['纸船漂流第一幕', '纸船漂流第二幕'])).toEqual(['流第一幕', '流第二幕'])
  })

  it('the word before would reach the very start: it is not taken (that would be no cut at all)', () => {
    expect(tails(['Shot 1', 'Shot 2'])).toEqual(['1', '2'])
  })

  it('each tile is compared with its closest sibling: two alike keep their tails, the odd one is left whole', () => {
    expect(tails(['海边 远景 1', '海边 远景 2', '城市夜景'])).toEqual(['远景 1', '远景 2', '城市夜景'])
  })

  it('nothing to tell apart, or nothing a cut could tell apart: no cut', () => {
    expect(nodePointerTitleTails(['纸船出发'])).toEqual([0])
    expect(nodePointerTitleTails(['纸船出发', '越过落叶'])).toEqual([0, 0])
    expect(nodePointerTitleTails(['纸船', '纸船'])).toEqual([0, 0])
    expect(nodePointerTitleTails(['纸船', '纸船 2'])).toEqual([0, 0])
    expect(nodePointerTitleTails(['', ''])).toEqual([0, 0])
    expect(nodePointerTitleTails([])).toEqual([])
  })

  it('counts characters, not UTF-16 units: an emoji in the shared opening still cuts at the right place', () => {
    expect(tails(['🎬 开场 1', '🎬 开场 2'])).toEqual(['开场 1', '开场 2'])
  })
})

describe('pointerCenterTier · the middle of a thumbnail holds exactly one thing (SpendCardQ1 card.pointer.status / card.pointer.exclude)', () => {
  const none = { restore: false, located: false, status: false, icon: false } as const
  const has = (...tiers: PointerCenterTier[]) => ({ ...none, ...Object.fromEntries(tiers.map((tier) => [tier, true])) })

  it('picks the first of restore > located > status > icon, whatever else is also there', () => {
    expect(pointerCenterTier(none)).toBeNull()
    expect(pointerCenterTier(has('icon'))).toBe('icon')
    expect(pointerCenterTier(has('status', 'icon'))).toBe('status')
    expect(pointerCenterTier(has('located', 'status', 'icon'))).toBe('located')
    expect(pointerCenterTier(has('restore', 'located', 'status', 'icon'))).toBe('restore')
  })

  it('every one of the 16 combinations yields one winner, and it is the highest-ranked thing present', () => {
    const order: readonly PointerCenterTier[] = ['restore', 'located', 'status', 'icon']
    for (let mask = 0; mask < 16; mask += 1) {
      const present = order.filter((_, bit) => mask & (1 << bit))
      expect(pointerCenterTier(has(...present))).toBe(present[0] ?? null)
    }
  })
})


describe('nodePointerSummaryFacts · shared geometry display', () => {
  it.each(['2560x1440', '2560×1440', '2560*1440', '2560:1440'])('prints %s like the colon pixel family', (size) => {
    const facts = nodePointerSummaryFacts(node({ kind: 'image', meta: { size } }), 'Seedream')
    expect(facts.aspect).toBe('2560:1440')
    expect(nodePointerSummary(facts, 'card')).toEqual(['Seedream · 2560:1440'])
  })
  it('keeps colon pixels, named ratios and key precedence', () => {
    expect(nodePointerSummaryFacts(node({ meta: { ratio: '1280:720' } }), '').aspect).toBe('1280:720')
    expect(nodePointerSummaryFacts(node({ meta: { image_size: 'portrait_4_3' } }), '').aspect).toBe('3:4')
    expect(nodePointerSummaryFacts(node({ meta: { aspect_ratio: '9:16', size: '2560x1440' } }), '').aspect).toBe('9:16')
  })
  it('does not invent geometry for invalid, resolution-only or absent values', () => {
    for (const size of ['2K', 'auto', '0x720', '2560x', 'abcx']) {
      expect(nodePointerSummaryFacts(node({ meta: { size } }), '').aspect).toBeNull()
    }
    expect(nodePointerSummaryFacts(undefined, '').aspect).toBeNull()
  })
})
