// Off-canvas node subscription boundary (2026-09-01 · suspect #1 remediation).
//
// WHY THIS EXISTS
// Dragging a node calls `moveNode` which does `node.position = position` under
// immer. immer swaps the top-level `nodes` array reference every mousemove (and
// the one moved node's object reference), keeping every other node structurally
// shared. Any component that subscribes to the whole `state.nodes` array
// therefore re-renders on *every* drag tick — even side-panel views (category
// tree, asset pool, task center, onboarding, preview panels) that read node
// identity / category / status / media but never node *position*. The
// 2026-09-01 eval-v2 dev-leg baseline measured 584 wasted off-canvas re-renders
// for a single image-node drag (docs: tests/ux/perf-results/canvas-eval-v2-baseline.md).
//
// THE INVARIANT THIS BOUNDARY OWNS
// "A high-frequency transient value (live drag position) must not broadcast into
// React re-renders of consumers that do not depend on it." This is the same
// class as the 2026-06 drag battle (transient values leaking into the render
// path). The earliest shared boundary is the store selector layer: expose ONE
// derived projection of `nodes` whose reference is stable across position-only
// churn, and route every off-canvas ("cares which nodes exist / their category /
// status / media", not "where they are") consumer through it. Position-only
// mutations then produce an === projection → Zustand's Object.is bails the
// subscription → zero off-canvas re-render.
//
// HOW STABILITY IS ACHIEVED
// We memoize on the input `nodes` array reference (so repeated reads within one
// store version are free), and across store versions we reuse the previous
// projected node object whenever a node's non-position signature is unchanged.
// When only positions changed, every per-node signature matches → every element
// reference is reused → the whole array reference is reused → consumers see the
// same array and do not re-render. Positions still reconcile normally: any real
// field change (title/status/result/category/shotIndex/…) recomputes that
// entry, and drag-stop's persist path re-runs consumers with settled data.
//
// SCOPE / NON-GOALS
// This does NOT change the store's real `nodes` (the canvas renderer, adapters,
// and every position-dependent path keep reading `state.nodes` unchanged). It is
// a read-only derived view for position-agnostic off-canvas consumers only.

import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { GenerationCanvasState } from './canvasStoreTypes'

/**
 * Per-node signature over every field EXCEPT `position`. Two nodes with equal
 * signatures are interchangeable for any consumer that ignores position, so the
 * previous projected object can be reused (keeping its reference stable).
 *
 * Object-valued fields (result/history/progress/runs/meta/…) are compared by
 * reference: immer's structural sharing guarantees an unchanged sub-object keeps
 * its reference, and a real edit swaps it. Reference identity is therefore an
 * exact, allocation-free change signal for them — we deliberately do NOT deep
 * compare (that would defeat the purpose and cost O(payload) per tick).
 *
 * COLLISION-FREEDOM. The fields are joined with a single space. Every field
 * always contributes one slot (empties become ''), so the separator count is
 * fixed and independent of content. The only free-text fields that can *contain*
 * a space — `title` and `prompt` — are `JSON.stringify`'d so any interior space
 * (or quote) is escaped and quoted; a distinct field state therefore always
 * yields a distinct signature. (An earlier revision used a raw NUL separator for
 * the same guarantee, but that made the whole file a binary blob to git/ripgrep;
 * quoting the two free-text fields is the pure-text equivalent.)
 */
function signatureOf(node: GenerationCanvasNode): string {
  // Primitive display/identity fields are inlined; object fields contribute a
  // stable tag derived from their reference identity via the shared tagger.
  return [
    node.id,
    node.kind,
    node.typeId ?? '',
    // Free text (may contain spaces) → quote so the space separator stays unambiguous.
    JSON.stringify(node.title ?? ''),
    node.status ?? '',
    node.error ?? '',
    node.categoryId ?? '',
    node.groupId ?? '',
    node.locked ? '1' : '0',
    node.derivedFrom ?? '',
    node.regeneratedFrom ?? '',
    node.shotIndex ?? '',
    node.renderKind ?? '',
    JSON.stringify(node.prompt ?? ''),
    // Object-identity tags (unchanged reference ⇒ unchanged tag).
    refTag(node.result),
    refTag(node.history),
    refTag(node.progress),
    refTag(node.runs),
    refTag(node.references),
    refTag(node.meta),
    refTag(node.size),
    refTag(node.pluginState),
    refTag(node.contentJson),
  ].join(' ')
}

// Stable per-reference tag: the same object reference always maps to the same
// tag string; a different reference (i.e. a real immer edit) maps to a new one.
// A WeakMap keeps this allocation-free and GC-friendly (no leak across projects).
const refTags = new WeakMap<object, number>()
let nextRefTagId = 1
function refTag(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'object') return String(value)
  let tag = refTags.get(value as object)
  if (tag === undefined) {
    tag = nextRefTagId++
    refTags.set(value as object, tag)
  }
  return `#${tag}`
}

type ProjectionCache = {
  /** The `state.nodes` array reference this projection was derived from. */
  sourceRef: readonly GenerationCanvasNode[] | null
  /** The reference-stable projected array handed to consumers. */
  projected: readonly GenerationCanvasNode[]
  /** Per-node id → { signature, node } of the last projection, for reuse. */
  byId: Map<string, { signature: string; node: GenerationCanvasNode }>
}

// One cache per store singleton. The store is a module-level singleton, so a
// single module-level cache is correct and shared across all consumers (they all
// observe the same store version at a time). Kept out of the store state so no
// action has to maintain it and it never enters persistence/undo.
const cache: ProjectionCache = { sourceRef: null, projected: [], byId: new Map() }

/**
 * Reference-stable projection of `state.nodes` that ignores live position churn.
 *
 * Use this (not `state.nodes`) from any off-canvas consumer that reads node
 * identity/category/status/media but not live position. During a drag the
 * returned reference does not change, so the consumer does not re-render.
 */
export function selectStableCanvasNodes(
  state: Pick<GenerationCanvasState, 'nodes'>,
): readonly GenerationCanvasNode[] {
  const nodes = state.nodes
  // Fast path: same source array reference as last time → nothing changed.
  if (cache.sourceRef === nodes) return cache.projected

  const nextById = new Map<string, { signature: string; node: GenerationCanvasNode }>()
  const next: GenerationCanvasNode[] = new Array(nodes.length)
  let identical = nodes.length === cache.projected.length

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    const signature = signatureOf(node)
    const previous = cache.byId.get(node.id)
    // Reuse the previous projected object iff the non-position signature matches.
    // This is what makes a position-only mutation yield === elements (and, when
    // every element matches at the same index, an === array below).
    const projectedNode = previous && previous.signature === signature ? previous.node : node
    next[index] = projectedNode
    nextById.set(node.id, { signature, node: projectedNode })
    if (identical && (projectedNode !== cache.projected[index])) identical = false
  }

  // If every element reference and order matched, keep the whole previous array
  // reference so `Object.is` bails every subscriber. Otherwise publish the new
  // array but still with maximal per-element reference reuse.
  const projected = identical ? cache.projected : next
  cache.sourceRef = nodes
  cache.projected = projected
  cache.byId = nextById
  return projected
}

/** Test-only: reset the module cache so cases don't leak reuse state into each other. */
export function __resetStableCanvasNodesCacheForTests(): void {
  cache.sourceRef = null
  cache.projected = []
  cache.byId = new Map()
}

/**
 * Reference-stable Array.filter (suspect #4 · first amplification gate).
 *
 * The canvas derives its per-category node list with `allNodes.filter(...)`.
 * `allNodes` (the raw store array) swaps reference on every drag tick, so a
 * plain `useMemo([allNodes])` re-runs and allocates a NEW array each tick, which
 * re-triggers the whole downstream projection chain (collapsed groups →
 * projected edges → flow nodes) even when the filtered result is element-wise
 * identical (e.g. the moved node is in another category, or the store change
 * touched something outside this view). This keeps the PREVIOUS array reference
 * whenever the freshly filtered result has the same elements in the same order,
 * so an unrelated store churn stops here instead of cascading.
 *
 * Note: when a node *in* the filtered set changes (incl. its position under a
 * drag), immer gives it a new object reference, so `previous` is correctly
 * discarded and the new array flows on — position updates are never dropped.
 */
// Mutable array in/out on purpose: the canvas derives its per-category `nodes`
// with this and threads it through many hooks typed as mutable `GenerationCanvasNode[]`.
// Returning `readonly` would force a wide, out-of-scope retype of the canvas
// subtree; the array is treated as read-only by callers regardless.
export function filterNodesStable(
  previous: GenerationCanvasNode[],
  source: readonly GenerationCanvasNode[],
  predicate: (node: GenerationCanvasNode) => boolean,
): GenerationCanvasNode[] {
  const next: GenerationCanvasNode[] = []
  for (const node of source) {
    if (predicate(node)) next.push(node)
  }
  if (next.length !== previous.length) return next
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== previous[index]) return next
  }
  return previous
}
