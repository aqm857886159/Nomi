// Class-level test for the off-canvas node subscription boundary (R21 · suspect
// #1/#4 remediation). Proves the invariant the boundary owns:
//
//   "A high-frequency transient value (live drag position) must not broadcast
//    into React re-renders of consumers that do not depend on it."
//
// Concretely: a position-only store mutation (exactly what `moveNode` does on
// every drag mousemove) MUST leave the derived projection reference-identical so
// Zustand's Object.is bails the subscription; any real field change (title /
// status / category / result / …) MUST produce a fresh reference so the change
// still propagates. We drive the REAL store's `moveNode`/`updateNode` so the
// test tracks the production write path, not a hand-rolled immer stand-in.

import { beforeEach, describe, expect, it } from 'vitest'
import { useGenerationCanvasStore } from './generationCanvasStore'
import {
  __resetStableCanvasNodesCacheForTests,
  filterNodesStable,
  selectStableCanvasNodes,
} from './canvasNodeProjection'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

function node(id: string, overrides: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode {
  return {
    id,
    kind: 'image',
    title: id,
    position: { x: 10, y: 20 },
    prompt: `${id} prompt`,
    categoryId: 'shots',
    ...overrides,
  }
}

function seed(nodes: GenerationCanvasNode[]): void {
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes, edges: [], groups: [] })
}

function project(): readonly GenerationCanvasNode[] {
  return selectStableCanvasNodes(useGenerationCanvasStore.getState())
}

describe('selectStableCanvasNodes — off-canvas subscription boundary', () => {
  beforeEach(() => {
    __resetStableCanvasNodesCacheForTests()
    seed([node('a'), node('b', { position: { x: 300, y: 0 } }), node('c', { position: { x: 0, y: 300 } })])
  })

  it('returns an identical reference across a position-only mutation (drag tick)', () => {
    const before = project()
    // Exactly the per-mousemove write the drag path performs.
    useGenerationCanvasStore.getState().moveNode('b', { x: 301, y: 1 }, { persist: false, emit: false })
    const after = project()

    // The store's real nodes array DID change reference (immer swap)…
    expect(useGenerationCanvasStore.getState().nodes).not.toBe(before)
    // …but the off-canvas projection is reference-stable → subscribers don't re-render.
    expect(after).toBe(before)
  })

  it('stays reference-stable across many consecutive drag ticks', () => {
    const before = project()
    for (let index = 0; index < 60; index += 1) {
      useGenerationCanvasStore.getState().moveNode('b', { x: 300 + index, y: index }, { persist: false, emit: false })
      expect(project()).toBe(before)
    }
  })

  it('publishes a new array but reuses every UNMOVED node object across a real move', () => {
    const before = project()
    const beforeById = new Map(before.map((entry) => [entry.id, entry]))
    // A committed move (persist) still only changes position → projection stays stable,
    // because the projection ignores position by construction.
    useGenerationCanvasStore.getState().moveNode('a', { x: 999, y: 999 }, { persist: false, emit: false })
    const after = project()
    expect(after).toBe(before)
    // And every element (including the moved node) keeps its projected reference,
    // since none of their non-position fields changed.
    for (const entry of after) expect(entry).toBe(beforeById.get(entry.id))
  })

  it('produces a NEW reference and a NEW entry when a non-position field changes', () => {
    const before = project()
    const beforeA = before.find((entry) => entry.id === 'a')
    useGenerationCanvasStore.getState().updateNode('a', { title: 'renamed' }, { persist: false, emit: false })
    const after = project()

    // Array reference changed → subscribers re-render (they must see the new title).
    expect(after).not.toBe(before)
    // The changed node got a fresh projected object…
    const afterA = after.find((entry) => entry.id === 'a')
    expect(afterA).not.toBe(beforeA)
    expect(afterA?.title).toBe('renamed')
    // …while untouched nodes kept their references (maximal reuse).
    const beforeB = before.find((entry) => entry.id === 'b')
    const afterB = after.find((entry) => entry.id === 'b')
    expect(afterB).toBe(beforeB)
  })

  it('reacts to status changes (task center / onboarding depend on this)', () => {
    const before = project()
    useGenerationCanvasStore.getState().updateNode('a', { status: 'success' }, { persist: false, emit: false })
    const after = project()
    expect(after).not.toBe(before)
    expect(after.find((entry) => entry.id === 'a')?.status).toBe('success')
  })

  it('reacts to result changes (asset pool / preview depend on this)', () => {
    const before = project()
    useGenerationCanvasStore
      .getState()
      .updateNode('a', { result: { id: 'r-a', createdAt: 0, type: 'image', url: 'nomi-local://x.png' } }, { persist: false, emit: false })
    const after = project()
    expect(after).not.toBe(before)
    expect(after.find((entry) => entry.id === 'a')?.result?.url).toBe('nomi-local://x.png')
  })

  it('reacts to add / remove (membership changes must propagate)', () => {
    const before = project()
    useGenerationCanvasStore.getState().addNode({ kind: 'image', categoryId: 'shots', position: { x: 5, y: 5 } })
    const afterAdd = project()
    expect(afterAdd).not.toBe(before)
    expect(afterAdd.length).toBe(before.length + 1)
  })

  // F2 root-cause guard: the signature now joins fields with a plain SPACE (the
  // file used a raw NUL separator, which made it a binary blob to git/ripgrep).
  // Space stays collision-free only because the free-text fields (title/prompt)
  // are JSON-quoted — so a rename that merely REDISTRIBUTES spaces between title
  // and prompt (a "…a b c…" ⇄ "…a b c…" hazard under a naive raw-space join if the
  // two ever sat adjacent) is still detected. Locks the quoting against a future
  // field-reorder that would put two space-capable fields side by side.
  it('a title⇄prompt space redistribution is detected as a change (quoting holds)', () => {
    seed([node('a', { title: 'shot a', prompt: 'b' })])
    const before = project()
    useGenerationCanvasStore.getState().updateNode('a', { title: 'shot', prompt: 'a b' }, { persist: false, emit: false })
    const after = project()
    expect(after).not.toBe(before)
    const entry = after.find((candidate) => candidate.id === 'a')
    expect(entry?.title).toBe('shot')
    expect(entry?.prompt).toBe('a b')
  })

  // And a title containing a double-quote must not corrupt the signature (JSON
  // escaping): renaming to/from such a value still registers cleanly.
  it('a title containing a double-quote is handled (JSON escaping)', () => {
    seed([node('a', { title: 'plain' })])
    const before = project()
    useGenerationCanvasStore.getState().updateNode('a', { title: 'say "hi"' }, { persist: false, emit: false })
    const after = project()
    expect(after).not.toBe(before)
    expect(after.find((candidate) => candidate.id === 'a')?.title).toBe('say "hi"')
  })
})

// F3 · Full-field parameterization: EVERY field that participates in the
// projection signature must, when changed, yield a fresh projected reference
// (so its off-canvas consumer re-renders), while a position-only change must
// keep the reference (so drag ticks don't). The original suite spot-checked
// title/status/result; this closes the gap for prompt/references/history/
// progress/runs/meta/size/pluginState/contentJson and the remaining primitives.
describe('selectStableCanvasNodes — every signature field is a change signal (F3)', () => {
  type FieldCase = { name: string; patch: Partial<GenerationCanvasNode> }
  // `base` seeds the field with a value distinct from each case's patch so the
  // patch is always a real change. Object fields must be swapped for a NEW
  // reference (immer would keep an unchanged ref → not a change) — the patches
  // below all pass fresh objects.
  const base: Partial<GenerationCanvasNode> = {
    kind: 'image',
    typeId: 'base-type',
    title: 'base-title',
    status: 'idle',
    error: 'base-error',
    categoryId: 'shots',
    groupId: 'g-base',
    locked: false,
    derivedFrom: 'src-a',
    regeneratedFrom: 'src-b',
    shotIndex: 1,
    renderKind: 'shot-frame',
    prompt: 'base-prompt',
    references: ['ref-1'],
    result: { id: 'r0', type: 'image', url: 'nomi-local://0.png', createdAt: 0 },
    history: [{ id: 'h0', type: 'image', url: 'nomi-local://h0.png', createdAt: 0 }],
    progress: { updatedAt: 0, percent: 0 },
    runs: [{ id: 'run0', status: 'queued', startedAt: 0, updatedAt: 0 }],
    meta: { seed: 1 },
    size: { width: 200, height: 200 },
    pluginState: { pluginId: 'p', pluginVersion: '1', typeId: 't', schemaVersion: 1, state: { a: 1 } },
    contentJson: { type: 'doc', content: [] },
  }

  const cases: FieldCase[] = [
    { name: 'kind', patch: { kind: 'video' } },
    { name: 'typeId', patch: { typeId: 'other-type' } },
    { name: 'title', patch: { title: 'renamed' } },
    { name: 'status', patch: { status: 'success' } },
    { name: 'error', patch: { error: 'boom' } },
    { name: 'categoryId', patch: { categoryId: 'characters' } },
    { name: 'groupId', patch: { groupId: 'g-2' } },
    { name: 'locked', patch: { locked: true } },
    { name: 'derivedFrom', patch: { derivedFrom: 'src-z' } },
    { name: 'regeneratedFrom', patch: { regeneratedFrom: 'src-z' } },
    { name: 'shotIndex', patch: { shotIndex: 9 } },
    { name: 'renderKind', patch: { renderKind: 'character-card' } },
    { name: 'prompt', patch: { prompt: 'new-prompt' } },
    { name: 'references', patch: { references: ['ref-2', 'ref-3'] } },
    { name: 'result', patch: { result: { id: 'r1', type: 'image', url: 'nomi-local://1.png', createdAt: 1 } } },
    { name: 'history', patch: { history: [{ id: 'h1', type: 'image', url: 'nomi-local://h1.png', createdAt: 1 }] } },
    { name: 'progress', patch: { progress: { updatedAt: 1, percent: 42 } } },
    { name: 'runs', patch: { runs: [{ id: 'run1', status: 'running', startedAt: 1, updatedAt: 1 }] } },
    { name: 'meta', patch: { meta: { seed: 2 } } },
    { name: 'size', patch: { size: { width: 320, height: 240 } } },
    { name: 'pluginState', patch: { pluginState: { pluginId: 'p', pluginVersion: '2', typeId: 't', schemaVersion: 1, state: { a: 2 } } } },
    { name: 'contentJson', patch: { contentJson: { type: 'doc', content: [{ type: 'paragraph' }] } } },
  ]

  it.each(cases)('a change to `$name` yields a fresh projected reference', ({ patch }) => {
    __resetStableCanvasNodesCacheForTests()
    seed([node('a', base), node('b', { ...base, position: { x: 999, y: 999 } })])
    const before = project()
    const beforeA = before.find((entry) => entry.id === 'a')
    const beforeB = before.find((entry) => entry.id === 'b')

    useGenerationCanvasStore.getState().updateNode('a', patch, { persist: false, emit: false })
    const after = project()

    // The array + the edited node's entry are fresh (subscribers see the change)…
    expect(after).not.toBe(before)
    expect(after.find((entry) => entry.id === 'a')).not.toBe(beforeA)
    // …while the untouched sibling keeps its reference (maximal reuse).
    expect(after.find((entry) => entry.id === 'b')).toBe(beforeB)
  })

  it('a position-only change to ANY of those seeded nodes keeps the reference', () => {
    __resetStableCanvasNodesCacheForTests()
    seed([node('a', base), node('b', { ...base, position: { x: 999, y: 999 } })])
    const before = project()
    useGenerationCanvasStore.getState().moveNode('a', { x: -50, y: -60 }, { persist: false, emit: false })
    expect(project()).toBe(before)
  })
})

describe('filterNodesStable — suspect #4 amplification gate', () => {
  const a = node('a')
  const b = node('b', { categoryId: 'characters' })
  const c = node('c')

  it('returns the previous reference when the filtered result is element-wise identical', () => {
    const previous = filterNodesStable([], [a, b, c], (n) => n.categoryId === 'shots')
    expect(previous).toEqual([a, c])
    // New source array, same membership/order for this category → previous reference kept.
    const next = filterNodesStable(previous, [a, b, c], (n) => n.categoryId === 'shots')
    expect(next).toBe(previous)
  })

  it('publishes a new array when a member reference changes (e.g. that node was edited/dragged)', () => {
    const previous = filterNodesStable([], [a, b, c], (n) => n.categoryId === 'shots')
    const aMoved = { ...a, position: { x: 500, y: 500 } }
    const next = filterNodesStable(previous, [aMoved, b, c], (n) => n.categoryId === 'shots')
    expect(next).not.toBe(previous)
    expect(next[0]).toBe(aMoved)
  })

  it('publishes a new array when membership changes (a member is removed)', () => {
    const previous = filterNodesStable([], [a, b, c], (n) => n.categoryId === 'shots')
    expect(previous).toEqual([a, c])
    // Remove `a`, which IS in the filtered ('shots') set → the set shrinks.
    const next = filterNodesStable(previous, [b, c], (n) => n.categoryId === 'shots')
    expect(next).not.toBe(previous)
    expect(next).toEqual([c])
  })

  it('keeps the previous reference when a NON-member is removed (set unchanged)', () => {
    const previous = filterNodesStable([], [a, b, c], (n) => n.categoryId === 'shots')
    // Remove `b`, which is NOT in the 'shots' set → filtered result is identical.
    const next = filterNodesStable(previous, [a, c], (n) => n.categoryId === 'shots')
    expect(next).toBe(previous)
  })
})
