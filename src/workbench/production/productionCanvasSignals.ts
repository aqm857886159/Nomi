import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { recordProductionCanvasSignal } from '../generationCanvas/events/canvasUndoJournal'
import { logRendererError } from '../../desktop/rendererLog'

export type ProductionCanvasSignal =
  | Readonly<{ kind: 'detach'; projectId: string | null; nodes: readonly GenerationCanvasNode[] }>
  | Readonly<{ kind: 'reattach'; projectId: string | null; nodes: readonly GenerationCanvasNode[] }>

type SignalSink = (signal: ProductionCanvasSignal) => void
type BoundSignal = ProductionCanvasSignal & Readonly<{ projectId: string }>

const sinks = new Set<SignalSink>()
const pendingSignals: Array<Readonly<{ kind: ProductionCanvasSignal['kind']; nodes: readonly GenerationCanvasNode[] }>> = []

function dispatch(signal: ProductionCanvasSignal): void {
  recordProductionCanvasSignal(signal)
  for (const sink of sinks) sink(signal)
}

function productionNodes(nodes: readonly GenerationCanvasNode[]): GenerationCanvasNode[] {
  return nodes.filter((node) => {
    const meta = node.meta as Record<string, unknown> | undefined
    return typeof meta?.productionRunId === 'string' && meta.productionRunId.trim().length > 0
  })
}

export function subscribeProductionCanvasSignals(sink: SignalSink): () => void {
  sinks.add(sink)
  return () => sinks.delete(sink)
}

export function emitProductionCanvasSignal(signal: ProductionCanvasSignal): void {
  const nodes = productionNodes(signal.nodes)
  if (nodes.length === 0) return
  const normalized = nodes.length === signal.nodes.length ? signal : { ...signal, nodes }
  if (!normalized.projectId) {
    pendingSignals.push({ kind: normalized.kind, nodes: normalized.nodes.map((node) => structuredClone(node)) })
    logRendererError('production-canvas-signal-project-unavailable', undefined, {
      kind: normalized.kind,
      nodeCount: normalized.nodes.length,
      pendingCount: pendingSignals.length,
    })
    return
  }
  dispatch(normalized)
}

/** Bind identity in the same canvas-load transaction that installs the nodes. */
export function bindProductionCanvasSignalProject(projectId: string | null): void {
  if (!projectId) return
  while (pendingSignals.length) {
    const pending = pendingSignals.shift()!
    dispatch({ kind: pending.kind, projectId, nodes: pending.nodes })
  }
}

export function routeProductionCanvasSignal(
  signal: ProductionCanvasSignal,
  projectId: string,
  onMatch: (signal: BoundSignal) => void,
  onMismatch: (signal: ProductionCanvasSignal, hostProjectId: string) => void,
): void {
  if (signal.projectId !== projectId) {
    onMismatch(signal, projectId)
    return
  }
  onMatch(signal as BoundSignal)
}
