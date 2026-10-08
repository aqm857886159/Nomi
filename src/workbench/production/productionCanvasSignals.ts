import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { recordProductionCanvasSignal } from '../generationCanvas/events/canvasUndoJournal'

export type ProductionCanvasSignal =
  | Readonly<{ kind: 'detach'; projectId: string; nodes: readonly GenerationCanvasNode[] }>
  | Readonly<{ kind: 'reattach'; projectId: string; nodes: readonly GenerationCanvasNode[] }>

type SignalSink = (signal: ProductionCanvasSignal) => void

const sinks = new Set<SignalSink>()

export function subscribeProductionCanvasSignals(sink: SignalSink): () => void {
  sinks.add(sink)
  return () => sinks.delete(sink)
}

export function emitProductionCanvasSignal(signal: ProductionCanvasSignal): void {
  if (signal.nodes.length === 0) return
  recordProductionCanvasSignal(signal)
  for (const sink of sinks) sink(signal)
}

export function routeProductionCanvasSignal(
  signal: ProductionCanvasSignal,
  projectId: string,
  onMatch: SignalSink,
  onMismatch: (signal: ProductionCanvasSignal, hostProjectId: string) => void,
): void {
  if (signal.projectId !== projectId) {
    onMismatch(signal, projectId)
    return
  }
  onMatch(signal)
}
