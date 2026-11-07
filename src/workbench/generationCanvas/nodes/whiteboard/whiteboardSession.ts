import { create } from 'zustand'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { declareStoreLifetime } from '../../../project/storeLifetime'

/** One active whiteboard, owned by the node rather than its selection-only toolbar. */
export const useWhiteboardSession = create<{ nodeId: string | null }>(() => ({ nodeId: null }))

let finishCurrent: (() => Promise<boolean>) | null = null
let opening: { generation: number } | null = null
let projectGeneration = 0
let unwatchCanvas: (() => void) | null = null

function releaseSession(): void {
  projectGeneration += 1
  opening = null
  finishCurrent = null
  unwatchCanvas?.()
  unwatchCanvas = null
  useWhiteboardSession.setState({ nodeId: null })
}

/** The document owns invalidation, including while the editor is virtualized away. */
function watchSessionNode(nodeId: string, projectId: string | null): void {
  unwatchCanvas?.()
  unwatchCanvas = useGenerationCanvasStore.subscribe((state, previous) => {
    if (state.projectId === previous.projectId && state.nodes === previous.nodes) return
    if (state.projectId !== projectId || !state.nodes.some(node => node.id === nodeId)) releaseSession()
  })
}
export const whiteboardSessionLifetime = declareStoreLifetime({
  store: 'useWhiteboardSession', fields: { nodeId: 'project' },
  releaseProject: releaseSession,
})

export function registerWhiteboardFinish(finish: () => Promise<boolean>): () => void {
  finishCurrent = finish
  return () => { if (finishCurrent === finish) finishCurrent = null }
}

/** Version actions share the same finish transaction as switching editors. */
export async function finishWhiteboard(nodeId: string): Promise<boolean> {
  if (useWhiteboardSession.getState().nodeId !== nodeId) return true
  const generation = projectGeneration
  const finished = finishCurrent ? await finishCurrent() : false
  return finished && generation === projectGeneration
}

export async function openWhiteboard(nodeId: string): Promise<void> {
  if (opening || useWhiteboardSession.getState().nodeId === nodeId) return
  const generation = projectGeneration
  const projectId = useGenerationCanvasStore.getState().projectId
  const lease = { generation }
  opening = lease
  try {
    if (finishCurrent && !await finishCurrent()) return
    const canvas = useGenerationCanvasStore.getState()
    if (generation === projectGeneration && canvas.projectId === projectId && canvas.nodes.some(node => node.id === nodeId)) {
      watchSessionNode(nodeId, projectId)
      useWhiteboardSession.setState({ nodeId })
    }
  } finally { if (opening === lease) opening = null }
}

export function closeWhiteboard(nodeId: string): void {
  if (useWhiteboardSession.getState().nodeId !== nodeId) return
  unwatchCanvas?.()
  unwatchCanvas = null
  finishCurrent = null
  useWhiteboardSession.setState({ nodeId: null })
}
