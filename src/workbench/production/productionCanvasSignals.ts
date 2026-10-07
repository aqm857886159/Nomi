import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'

export type ProductionCanvasSignal =
  | Readonly<{ kind: 'detach'; nodes: readonly GenerationCanvasNode[] }>
  | Readonly<{ kind: 'reattach'; nodes: readonly GenerationCanvasNode[] }>

type SignalSink = (signal: ProductionCanvasSignal) => void

const sinks = new Set<SignalSink>()

export function subscribeProductionCanvasSignals(sink: SignalSink): () => void {
  sinks.add(sink)
  return () => sinks.delete(sink)
}

export function emitProductionCanvasSignal(signal: ProductionCanvasSignal): void {
  if (signal.nodes.length === 0) return
  for (const sink of sinks) sink(signal)
}
