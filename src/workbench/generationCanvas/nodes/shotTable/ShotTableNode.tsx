import React from 'react'
import { useStore } from '@xyflow/react'
import { selectFlowZoom, shotTableDensityForZoom } from '../../reactFlow/canvasViewportScale'
import { useGenerationFlowNodeManagedDrag } from '../../reactFlow/generationFlowNodeContext'
import { useTranslation } from 'react-i18next'
import { IconTable } from '@tabler/icons-react'
import { WorkbenchButton, WorkbenchMenu, promptDialog } from '../../../../design'
import { useModelOptionsState } from '../../../../config/useModelOptions'
import { cn } from '../../../../utils/cn'
import { useWorkbenchStore } from '../../../workbenchStore'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { readShotTable, type ShotTableColumn } from '../../../../../electron/shared/canvas/shotTable'
import { selectShotTableRows } from './selectShotTableRows'
import { openShotTableRow } from '../../../creation/storyboard/openShotTableRow'
import { editShotTableFacts, generateSelectedTableRows } from './shotTableActions'
import { deconstructToShotTable, retryShot } from './factBridge'
import { ShotTableGrid } from './ShotTableGrid'

type NodeProps = { node: unknown; selected: boolean; readOnly?: boolean }
export default function ShotTableNode(props: NodeProps): JSX.Element {
  const managed = useGenerationFlowNodeManagedDrag()
  return managed ? <FlowShotTable {...props} /> : <ShotTableContent {...props} />
}
function FlowShotTable(props: NodeProps): JSX.Element {
  const density = useStore(state => shotTableDensityForZoom(selectFlowZoom(state)))
  return <ShotTableContent {...props} flowDensity={density} />
}
function ShotTableContent({ node: rawNode, selected, readOnly = false, flowDensity }: NodeProps & { flowDensity?: 'full' | 'compact' | 'card' }): JSX.Element {
  const node = rawNode as GenerationCanvasNode
  const { t } = useTranslation()
  const table = React.useMemo(() => readShotTable(node.meta), [node.meta])
  const designs = useWorkbenchStore(state => state.storyboardDesignsByDocumentId)
  const nodes = useGenerationCanvasStore(state => state.nodes)
  // 画布外的宿主（设计实验室样张）没有视口，也就没有缩放——按 1 档算。
  // 画布内的档位由 FlowShotTable 从 React Flow 的 transform 订阅（唯一真相）。
  const zoomDensity = shotTableDensityForZoom(1)
  const imageModelOptions = useModelOptionsState('image').options
  const videoModelOptions = useModelOptionsState('video').options
  const rows = React.useMemo(() => table ? selectShotTableRows({ table, designs, nodes, imageModelOptions, videoModelOptions }) : [], [table, designs, nodes, imageModelOptions, videoModelOptions])
  const source = table?.source
  const design = source?.kind === 'storyboard' ? designs[source.documentId]?.find(candidate => candidate.id === source.designId) : undefined
  const density = table?.view.density === 'auto' ? flowDensity ?? zoomDensity : table?.view.density ?? zoomDensity
  const [columnMenu, setColumnMenu] = React.useState<{ column: ShotTableColumn; point: { x: number; y: number } } | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const facts = table && 'columns' in table ? table : undefined
  const sourceAvailable = source?.kind === 'deconstruction' && nodes.some(candidate => candidate.id === source.sourceNodeId && candidate.result?.url)
  const selectedIds = (table?.view.selectedRowIds ?? []).filter(id => rows.some(row => row.id === id))
  const openRow = (id?: string) => {
    if (source?.kind !== 'storyboard' || !design) return
    if (!rows.length) {
      const store = useWorkbenchStore.getState()
      store.setActiveStoryboardId(source.designId, source.documentId)
      store.setWorkspaceMode('creation')
      return
    }
    openShotTableRow(source, id ?? rows[0]?.id ?? '')
  }
  const selectRow = (id: string) => {
    const latest = useGenerationCanvasStore.getState().nodes.find(candidate => candidate.id === node.id)
    const current = readShotTable(latest?.meta)
    if (!current || readOnly) return
    const ids = current.view.selectedRowIds
    useGenerationCanvasStore.getState().updateNode(node.id, { meta: { ...latest?.meta, shotTable: { ...current, view: { ...current.view, selectedRowIds: ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id] }, revision: current.revision + 1, updatedAt: new Date().toISOString() } } })
  }
  const addColumn = async () => {
    const name = await promptDialog({ title: t('shotTable.addColumn') })
    if (!name?.trim()) return
    editShotTableFacts(node.id, current => ({ ...current, columns: [...current.columns, { columnId: crypto.randomUUID(), kind: 'custom', labelKey: name.trim(), hint: name.trim(), order: Math.max(-1, ...current.columns.map(column => column.order)) + 1, visible: true }] }))
  }
  const editCell = async (rowId: string, columnId: string, initialValue: string) => {
    const value = await promptDialog({ title: t('shotTable.editCell'), initialValue })
    if (value === null) return
    editShotTableFacts(node.id, current => ({ ...current, rows: current.rows.map(row => row.rowId === rowId ? { ...row, cells: { ...row.cells, [columnId]: value } } : row) }))
  }
  const generate = async () => {
    setBusy(true); setError(null)
    try { await generateSelectedTableRows(node.id, imageModelOptions, videoModelOptions) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <article data-node-id={node.id} data-kind="shot_table" data-testid="shot-table-node" data-density={density}
    className={cn('generation-canvas-v2-node flex h-full w-full flex-col overflow-hidden rounded-nomi border bg-nomi-paper text-nomi-ink shadow-nomi-md', selected ? 'border-nomi-accent' : 'border-nomi-line')}
    onDoubleClick={() => openRow()}>
    <header className="flex h-10 shrink-0 cursor-grab items-center gap-2 border-b border-nomi-line-soft px-3">
      <IconTable size={16} stroke={1.5} className="shrink-0 text-nomi-ink-60" />
      <span className="min-w-0 truncate text-body-sm font-medium">{design?.title ?? node.title ?? t('shotTable.title')}</span>
      <span className="shrink-0 text-micro text-nomi-ink-40">{t('shotTable.count', { count: rows.length })}</span>
      <span className="shrink-0 font-mono text-micro text-nomi-ink-40">{t('shotTable.duration', { duration: rows.reduce((sum, row) => sum + row.duration, 0) })}</span>
    </header>
    {density === 'card' ? <div className="flex min-h-0 flex-1 items-center justify-center gap-2 p-3"><IconTable size={24} stroke={1.5} /><span className="text-body-sm">{t('shotTable.count', { count: rows.length })}</span></div> : rows.length ? <ShotTableGrid rows={rows} compact={density === 'compact'} selectedIds={selectedIds} onSelect={readOnly ? undefined : selectRow} onRetry={readOnly || busy || !sourceAvailable ? undefined : rowId => { setBusy(true); void retryShot(node.id, rowId).catch(cause => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setBusy(false)) }} factColumns={facts?.columns} onColumnMenu={readOnly ? undefined : (column, point) => { if (column.kind === 'custom') setColumnMenu({ column, point }) }} onEditCell={readOnly ? undefined : (rowId, columnId, value) => { void editCell(rowId, columnId, value) }} onOpen={source?.kind === 'storyboard' ? openRow : undefined} /> : <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-body-sm text-nomi-ink-60">{facts?.source.status === 'running' ? t(facts.source.phase === 0 ? 'generationCommon.node.deconstruct.phaseCuts' : facts.source.phase === 1 ? 'generationCommon.node.deconstruct.phaseVision' : facts.source.phase === 2 ? 'generationCommon.node.deconstruct.phaseDialogue' : 'shotTable.running') : facts?.source.errorMessage || t(facts ? 'shotTable.factsEmpty' : design ? 'shotTable.empty' : 'shotTable.sourceMissing')}</div>}
    {columnMenu && <WorkbenchMenu open point={columnMenu.point} onOpenChange={open => { if (!open) setColumnMenu(null) }} items={[
      { id: 'rename-column', label: t('shotTable.renameColumn'), onSelect: () => { const column = columnMenu.column; void promptDialog({ title: t('shotTable.renameColumn'), initialValue: column.labelKey }).then(name => { if (name?.trim()) editShotTableFacts(node.id, current => ({ ...current, columns: current.columns.map(item => item.columnId === column.columnId ? { ...item, labelKey: name.trim() } : item) })) }) } },
      { id: 'remove-column', label: t('shotTable.removeColumn'), danger: true, onSelect: () => { const id = columnMenu.column.columnId; editShotTableFacts(node.id, current => ({ ...current, columns: current.columns.filter(item => item.columnId !== id), rows: current.rows.map(row => ({ ...row, cells: Object.fromEntries(Object.entries(row.cells).filter(([key]) => key !== id)) })) })) } },
    ]} />}
    {error && <div role="alert" className="px-3 text-micro text-nomi-danger">{error}</div>}
    {density !== 'card' && <footer className="nodrag generation-canvas-react-flow__no-pan flex h-10 shrink-0 items-center gap-2 border-t border-nomi-line-soft px-3" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
      <span className="text-micro text-nomi-ink-40" title={t('shotTable.viewOnly')}>{t('shotTable.selected', { count: selectedIds.length })}</span>
      {facts && !readOnly && <WorkbenchButton size="sm" variant="default" disabled={facts.source.status === 'running'} onClick={() => { void addColumn() }}>{t('shotTable.addColumn')}</WorkbenchButton>}
      {facts && (facts.source.status === 'failed' || facts.source.status === 'idle') && !readOnly && <WorkbenchButton size="sm" variant="default" disabled={!sourceAvailable} title={!sourceAvailable ? t('shotTable.sourceVideoMissing') : undefined} onClick={() => { void deconstructToShotTable(facts.source.sourceNodeId).catch(cause => setError(cause instanceof Error ? cause.message : String(cause))) }}>{t('shotTable.retry')}</WorkbenchButton>}
      {!readOnly && selectedIds.length > 0 && <WorkbenchButton size="sm" variant="primary" loading={busy} onClick={() => { void generate() }}>{t('shotTable.generate', { count: selectedIds.length })}</WorkbenchButton>}
      {design && <WorkbenchButton size="sm" variant="default" onClick={() => openRow(selectedIds[0])}>{t(!rows.length ? 'shotTable.openScript' : selectedIds.length ? 'shotTable.openSelected' : 'shotTable.open')}</WorkbenchButton>}
    </footer>}
  </article>
}
