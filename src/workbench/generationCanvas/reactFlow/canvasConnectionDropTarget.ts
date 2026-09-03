export type CanvasDropPoint = Pick<MouseEvent, 'clientX' | 'clientY'>

export type CanvasDropTarget = {
  id: string
  rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>
}

export function collectCanvasDropTargets(
  root: ParentNode | null,
  selector: string,
  idAttribute: 'data-node-id' | 'data-group-id',
  allowedIds: ReadonlySet<string>,
): CanvasDropTarget[] {
  return Array.from(root?.querySelectorAll<HTMLElement>(selector) ?? []).flatMap((element) => {
    const id = element.getAttribute(idAttribute)
    return id && allowedIds.has(id) ? [{ id, rect: element.getBoundingClientRect() }] : []
  })
}

/**
 * Resolve a body drop from rendered geometry. React Flow's hidden 1px target
 * handles and document hit-testing are not reliable when a card is near a
 * viewport edge, while its rendered DOM rect remains authoritative.
 */
export function resolveCanvasDropTarget(
  point: CanvasDropPoint,
  excludedId: string,
  targets: readonly CanvasDropTarget[],
): string | null {
  const target = targets.find(({ id, rect }) =>
    id !== excludedId &&
    point.clientX >= rect.left &&
    point.clientX <= rect.right &&
    point.clientY >= rect.top &&
    point.clientY <= rect.bottom,
  )
  return target?.id ?? null
}
