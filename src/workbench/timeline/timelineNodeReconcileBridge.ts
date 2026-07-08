type DeletedNodeReconciler = (nodeIds: readonly string[]) => void

let deletedNodeReconciler: DeletedNodeReconciler | null = null

export function registerTimelineDeletedNodeReconciler(reconciler: DeletedNodeReconciler): void {
  deletedNodeReconciler = reconciler
}

export function reconcileTimelineForDeletedCanvasNodes(nodeIds: readonly string[]): void {
  deletedNodeReconciler?.(nodeIds)
}
