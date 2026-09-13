// Per-node reads that used to scan the whole table (2026-09-12 · S3 remediation).
//
// WHY THIS EXISTS
// `BaseGenerationNode` is mounted once per canvas node. Four of its Zustand
// selectors read the *entire* `state.nodes` array on every invocation:
// three `state.nodes.find/.some` lookups for the `derivedFrom` source card, and
// `canRunGenerationNode(node, { nodes: state.nodes, edges: state.edges })` for
// the generate button. A Zustand selector re-runs on every render of its owner,
// so during a select-all drag — where React Flow re-renders all N node
// instances every frame — the canvas pays N × O(N + E) per frame. The
// 2026-09-12 scale study measured the consequence directly: `drag-nodes-all`
// collapses from 96.5 fps at 60 nodes to 12.4 fps at 300 nodes (p95 251 ms,
// 251 long tasks), while the same gesture on a single node stays flat across
// the same three scales. The row is flat, the column collapses — that is the
// signature of O(N²), and this file is where it is paid.
// (docs/research/2026-09-12-canvas-perf-at-scale/README.md §2.5① and §5 S3.)
//
// THE INVARIANT THIS BOUNDARY OWNS
// "A value that is the same for every reader must be computed once per store
// version, not once per reader." React Flow's own performance guidance says the
// same thing and names the ❌ pattern explicitly — `useStore((s) => s.nodes)`
// followed by a scan — and prescribes decoupling the derived datum from the
// nodes array so "components only re-render when their specific data changes"
// (https://reactflow.dev/learn/advanced-use/performance).
//
// WHY A MEMO KEYED ON (nodes, edges) RATHER THAN A STORE FIELD
// The store is wrapped in immer + a write boundary; a derived field would have
// to be re-written by every action (or by a subscription that writes back into
// the store, producing a second notification round per tick). A module-level
// memo keyed on the two source array references is the same single-owner
// derivation with none of that: immer swaps `nodes`/`edges` on any real edit, so
// reference equality is an exact, allocation-free staleness signal. This is the
// idiom already used by `canvasNodeProjection.ts` in this directory.
//
// WHY `canRun` IS LAZY
// `canRunGenerationNode` resolves the node's archetype and walks the edge list;
// computing it eagerly for all N nodes would move the O(N²) from "per render
// round" to "per store write". Filling the map on demand keeps each node's
// answer computed at most once per store version — during a drag the store is
// not written at all (the React Flow kernel holds the draft), so the whole map
// survives the gesture and every frame after the first is O(1) per node.

import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { GenerationCanvasState } from './canvasStoreTypes'
import { canRunGenerationNode } from '../runner/generationRunController'

type GraphSlice = Pick<GenerationCanvasState, 'nodes' | 'edges'>

type GenerationIndex = {
  /** The `state.nodes` array reference this index was derived from. */
  nodesRef: GenerationCanvasState['nodes'] | null
  /** The `state.edges` array reference this index was derived from. */
  edgesRef: GenerationCanvasState['edges'] | null
  /** id → node, so a per-node lookup is O(1) instead of a full-table `.find`. */
  byId: Map<string, GenerationCanvasNode>
  /** id → "can this node generate", filled lazily (see header). */
  canRun: Map<string, boolean>
}

// One index per store singleton, for the same reason `canvasNodeProjection`
// keeps one cache: the store is a module-level singleton and every consumer
// observes the same store version at a time. Kept out of store state so no
// action has to maintain it and it never enters persistence/undo.
const index: GenerationIndex = { nodesRef: null, edgesRef: null, byId: new Map(), canRun: new Map() }

function refresh(state: GraphSlice): GenerationIndex {
  if (index.nodesRef === state.nodes && index.edgesRef === state.edges) return index
  index.nodesRef = state.nodes
  index.edgesRef = state.edges
  index.byId = new Map(state.nodes.map((node) => [node.id, node]))
  index.canRun = new Map()
  return index
}

/** O(1) replacement for `state.nodes.find((n) => n.id === id)` in per-node selectors. */
export function selectCanvasNodeById(
  state: GraphSlice,
  id: string | undefined | null,
): GenerationCanvasNode | undefined {
  if (!id) return undefined
  return refresh(state).byId.get(id)
}

/** O(1) replacement for `state.nodes.some((n) => n.id === id)` in per-node selectors. */
export function selectCanvasNodeExists(state: GraphSlice, id: string | undefined | null): boolean {
  if (!id) return false
  return refresh(state).byId.has(id)
}

/**
 * "Can this node generate right now" — the same answer `canRunGenerationNode`
 * gives, computed at most once per node per store version instead of once per
 * render of every node card.
 *
 * Nodes not present in the store cannot generate; there is deliberately no
 * fallback that recomputes from a caller-supplied node object, because such a
 * fallback would silently restore the O(N) scan for exactly the case (a stale
 * card) where the answer is meaningless anyway.
 */
export function selectCanvasNodeCanRun(state: GraphSlice, id: string | undefined | null): boolean {
  if (!id) return false
  const current = refresh(state)
  const cached = current.canRun.get(id)
  if (cached !== undefined) return cached
  const node = current.byId.get(id)
  const value = node ? canRunGenerationNode(node, { nodes: state.nodes, edges: state.edges }) : false
  current.canRun.set(id, value)
  return value
}
