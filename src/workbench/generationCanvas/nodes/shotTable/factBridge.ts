import { readShotTable, type DeconstructionShotTableDocument } from '../../../../../electron/shared/canvas/shotTable'
import { getDesktopBridge } from '../../../../desktop/bridge'
import { getActiveWorkbenchProjectId } from '../../../project/workbenchProjectSession'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { withCanvasGestureContext } from '../../events/canvasGestureContext'
import { pushUndoSnapshot, getUndoJournalGeneration } from '../../events/canvasUndoJournal'
import { interruptPendingCanvasWrite, whenCanvasWriteBoundarySettled } from '../../events/canvasWriteBoundary'
import { resolveNodeVisualSize } from '../nodeSizing'
import { readNodeDeconstruction } from '../deconstructionTypes'
import { createDeconstructionShotTable, deconstructionResultToShotTable } from './shotTableFacts'
import i18n from '../../../../i18n'

async function writeTable(
  tableNodeId: string,
  canWrite: () => boolean,
  update: (current: DeconstructionShotTableDocument) => DeconstructionShotTableDocument | undefined,
  userEdit = false,
): Promise<boolean> {
  await whenCanvasWriteBoundarySettled()
  if (!canWrite()) return false
  const store = useGenerationCanvasStore.getState()
  const node = store.nodes.find((entry) => entry.id === tableNodeId)
  const current = readShotTable(node?.meta)
  if (!node || current?.source.kind !== 'deconstruction' || !('columns' in current)) return false
  const next = update(current)
  if (!next) return false
  if (userEdit) pushUndoSnapshot()
  store.updateNode(tableNodeId, { meta: { ...node.meta, shotTable: next } }, { history: false })
  return true
}

/** One source, one view. Reopening legacy evidence migrates it without calling the model again. */
export function ensureDeconstructionShotTable(sourceNodeId: string): string | undefined {
  const store = useGenerationCanvasStore.getState()
  const existing = store.nodes.find((node) => {
    const table = readShotTable(node.meta)
    return node.kind === 'shot_table' && table?.source.kind === 'deconstruction' && table.source.sourceNodeId === sourceNodeId
  })
  if (existing) { store.selectNodes([existing.id]); return existing.id }
  const source = store.nodes.find((node) => node.id === sourceNodeId)
  if (!source) return undefined
  let table = createDeconstructionShotTable(sourceNodeId, source.title)
  const legacy = readNodeDeconstruction(source.meta)
  if (legacy) table = deconstructionResultToShotTable(table, legacy)
  interruptPendingCanvasWrite()
  pushUndoSnapshot()
  return withCanvasGestureContext({ source: 'user', txnId: `shot-table-${sourceNodeId}-${Date.now()}`, suppressUndoBarriers: true }, () => {
    const node = store.addNode({
      kind: 'shot_table', title: source.title, categoryId: source.categoryId,
      position: { x: source.position.x + resolveNodeVisualSize(source).width + 80, y: source.position.y },
      meta: { shotTable: table },
    })
    store.connectNodes(sourceNodeId, node.id)
    store.selectNodes([node.id])
    return node.id
  })
}

/** The returned promise owns the engine call; progress never advances on timers. */
export async function deconstructToShotTable(sourceNodeId: string, projectId = getActiveWorkbenchProjectId()): Promise<string | undefined> {
  const generation = getUndoJournalGeneration()
  const canWrite = () => getUndoJournalGeneration() === generation && getActiveWorkbenchProjectId() === projectId
  const id = ensureDeconstructionShotTable(sourceNodeId)
  if (!id) return undefined
  const store = useGenerationCanvasStore.getState()
  const source = store.nodes.find((node) => node.id === sourceNodeId)
  const table = readShotTable(store.nodes.find((node) => node.id === id)?.meta)
  if (!source || !table || table.source.kind !== 'deconstruction' || !('columns' in table)) return id
  if (table.source.status === 'running' || table.source.status === 'ready') return id
  const deconstruct = getDesktopBridge()?.video?.deconstruct
  if (!deconstruct || !projectId || !source.result?.url) {
    await writeTable(id, canWrite, current => ({ ...current, source: { ...current.source, status: 'failed', errorMessage: i18n.t('generationCommon.node.deconstruct.desktopOnly') } }))
    return id
  }
  const started = await writeTable(id, canWrite, current => current.source.status === 'running' || current.source.status === 'ready'
    ? undefined : { ...current, source: { ...current.source, status: 'running', errorMessage: undefined }, updatedAt: new Date().toISOString() })
  if (!started || !canWrite()) return id
  const requestId = crypto.randomUUID()
  const unsubscribe = getDesktopBridge()?.video?.onDeconstructionProgress?.((event) => {
    if (event.requestId !== requestId || event.projectId !== projectId || !canWrite()) return
    void writeTable(id, canWrite, current => ({ ...current, source: { ...current.source, phase: event.phase } }))
  })
  try {
    const result = await deconstruct({
      videoUrl: source.result.url, projectId, requestId,
      customColumns: table.columns.filter((column) => column.kind === 'custom').map((column) => ({ name: column.columnId, hint: column.hint || column.labelKey })),
    })
    // A completion from a departed project must never write into its successor.
    if (!canWrite()) return id
    await writeTable(id, canWrite, current => deconstructionResultToShotTable(current, result))
  } catch (error) {
    if (!canWrite()) return id
    await writeTable(id, canWrite, current => ({ ...current, source: { ...current.source, status: 'failed', errorMessage: error instanceof Error ? error.message : String(error) } }))
  } finally {
    unsubscribe?.()
  }
  return id
}


/** Retry one failed analysis while preserving measured evidence, custom edits and selection on every other row. */
export async function retryShot(tableNodeId: string, rowId: string): Promise<void> {
  const projectId = getActiveWorkbenchProjectId()
  const generation = getUndoJournalGeneration()
  const canvas = useGenerationCanvasStore.getState()
  const table = readShotTable(canvas.nodes.find(node => node.id === tableNodeId)?.meta)
  if (!table || table.source.kind !== 'deconstruction' || !('rows' in table) || !table.rows || !projectId) return
  const row = table.rows.find(item => item.rowId === rowId)
  const source = canvas.nodes.find(node => node.id === table.source.sourceNodeId)
  const deconstruct = getDesktopBridge()?.video?.deconstruct
  if (!row || !source?.result?.url || !deconstruct) return
  const result = await deconstruct({ videoUrl: source.result.url, projectId, shotIndexes: [row.order],
    customColumns: table.columns.filter(column => column.kind === 'custom').map(column => ({ name: column.columnId, hint: column.hint || column.labelKey })),
  })
  if (getUndoJournalGeneration() !== generation || getActiveWorkbenchProjectId() !== projectId) return
  await writeTable(tableNodeId, () => getUndoJournalGeneration() === generation && getActiveWorkbenchProjectId() === projectId, latest => {
    const fresh = deconstructionResultToShotTable(latest, result).rows.find(item => item.rowId === rowId)
    if (!fresh) return undefined
    const rows = latest.rows.map(item => item.rowId !== rowId ? item : {
      ...fresh, rowId: item.rowId, order: item.order, startSeconds: item.startSeconds, endSeconds: item.endSeconds,
      durationSeconds: item.durationSeconds, keyframeRef: item.keyframeRef ?? fresh.keyframeRef,
    })
    return { ...latest, rows, source: { ...latest.source, failedShotIndexes: rows.filter(item => item.visionFailed).map(item => item.order) },
      revision: latest.revision + 1, updatedAt: new Date().toISOString() }
  }, true)
}
