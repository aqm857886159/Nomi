// Reference-stable category node derivation for the generation canvas
// (2026-09-01 drag battle · suspect #4 amplification gate + #5 minimap freeze).
//
// Extracted from GenerationCanvasReactFlow so the shell stays under the
// file-size gate; the behavior is byte-for-byte what lived inline. It owns two
// reference-stability tricks that keep an unrelated store churn (e.g. a drag in
// another category, or a field change outside this view) from cascading through
// the canvas projection chain and from repainting the minimap every tick.
import React from 'react'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { filterNodesStable } from '../store/canvasNodeProjection'

export type StableCategoryNodes = {
  /**
   * The active category's nodes, with a reference-stable identity: when the
   * member set and order are unchanged (an unrelated store churn), the previous
   * array reference is returned so the downstream projection chain (collapsed
   * groups → edges → flow nodes) bails instead of re-deriving. A real change in
   * this category — including a drag moving a node's position, which immer gives
   * a new object reference — publishes a fresh array, so positions never drop.
   */
  nodes: GenerationCanvasNode[]
  /**
   * The nodes reference handed to the minimap. While a node drag is active it is
   * frozen to the last pre-drag value so the minimap (an O(n)/tick painter) does
   * not repaint every frame; on drag end it snaps back to the live `nodes`. All
   * other chrome keeps reading the live `nodes`.
   */
  minimapNodes: GenerationCanvasNode[]
}

/**
 * @param allNodes    the whole store `nodes` array (swaps reference every tick)
 * @param activeCategoryId which category the canvas is showing
 * @param nodeDragActive whether a node drag is in progress (freezes the minimap)
 */
export function useStableCategoryNodes(
  allNodes: readonly GenerationCanvasNode[],
  activeCategoryId: string,
  nodeDragActive: boolean,
): StableCategoryNodes {
  // #4 reference-stable filter — keep the previous array when this category's
  // membership/order is unchanged so an unrelated churn stops cascading here.
  const categoryNodesRef = React.useRef<GenerationCanvasNode[]>([])
  const nodes = React.useMemo(() => {
    const filtered = filterNodesStable(
      categoryNodesRef.current,
      allNodes,
      (node) => (node.categoryId || 'shots') === activeCategoryId,
    )
    categoryNodesRef.current = filtered
    return filtered
  }, [activeCategoryId, allNodes])

  // #5 minimap freeze source — lock the last non-drag `nodes` reference during a
  // drag; snap back to live on release.
  const frozenMinimapNodesRef = React.useRef<GenerationCanvasNode[]>(nodes)
  if (!nodeDragActive) frozenMinimapNodesRef.current = nodes
  const minimapNodes = nodeDragActive ? frozenMinimapNodesRef.current : nodes

  return { nodes, minimapNodes }
}
