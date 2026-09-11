import type { ShotTableColumn } from '../../../../../electron/shared/canvas/shotTable'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../../utils/cn'
import { WorkbenchButton } from '../../../../design'
import type { ShotTableRowView } from './selectShotTableRows'
import { NODE_SCROLL_REGION_CLASS_NAME } from '../nodeScrollRegionClassName'

type Props = {
  rows: readonly ShotTableRowView[]
  compact: boolean
  selectedIds: readonly string[]
  factColumns?: readonly ShotTableColumn[]
  onSelect?: (id: string) => void
  onOpen?: (id: string) => void
  onEditCell?: (rowId: string, columnId: string, value: string) => void
  onColumnMenu?: (column: ShotTableColumn, point: { x: number; y: number }) => void
  onRetry?: (rowId: string) => void
}
export function ShotTableGrid({ rows, compact, selectedIds, onSelect, onOpen, factColumns, onEditCell, onColumnMenu, onRetry }: Props): JSX.Element {
  const { t } = useTranslation()
  const facts = factColumns?.filter(column => column.visible).slice().sort((a, b) => a.order - b.order)
  const leading = compact ? ['index', 'thumbnail'] as const : ['index', 'thumbnail', 'duration'] as const
  return <div className={cn(NODE_SCROLL_REGION_CLASS_NAME, 'min-h-0 flex-1 overflow-auto')} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <table style={{ minWidth: facts && !compact ? 1100 : undefined }} className="w-full table-fixed border-collapse text-left text-body-sm text-nomi-ink">
      <colgroup>
        <col style={{ width: 28 }} />{leading.map(column => <col key={column} style={{ width: column === 'index' ? 40 : column === 'duration' ? 92 : 60 }} />)}
        {!compact && (facts ? facts.map(column => <col key={column.columnId} style={{ width: column.columnId === 'visual' ? 220 : 112 }} />) : <><col /><col style={{ width: 160 }} /></>)}
        <col style={{ width: 112 }} />
      </colgroup>
      <thead className="sticky top-0 z-10 bg-nomi-bg text-micro text-nomi-ink-60"><tr>
        <th aria-label={t('common.select')} />{leading.map(column => <th key={column} className="px-2 py-2 font-medium">{t(`shotTable.columns.${column}`)}</th>)}
        {!compact && (facts ? facts.map(column => <th key={column.columnId} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onColumnMenu?.(column, { x: event.clientX, y: event.clientY }) }} className="px-2 py-2 font-medium">{column.kind === 'custom' ? column.labelKey : t(`shotTable.facts.${column.columnId}`)}</th>) : <><th className="px-2 py-2 font-medium">{t('shotTable.columns.visual')}</th><th className="px-2 py-2 font-medium">{t('shotTable.columns.references')}</th></>)}
        <th className="px-2 py-2 font-medium">{t('shotTable.columns.status')}</th>
      </tr></thead>
      <tbody>{rows.map(row => <tr key={row.id} data-shot-table-row={row.id} tabIndex={onOpen ? 0 : undefined}
        className={cn('h-8 border-t border-nomi-line-soft hover:bg-nomi-ink-05', selectedIds.includes(row.id) && 'bg-nomi-accent-soft')}
        onDoubleClick={event => { event.stopPropagation(); onOpen?.(row.id) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onOpen?.(row.id) } }}>
        <td className="px-2"><input type="checkbox" checked={selectedIds.includes(row.id)} disabled={!onSelect} aria-label={t('shotTable.select', { index: row.index })} onChange={() => onSelect?.(row.id)} onDoubleClick={event => event.stopPropagation()} className="accent-nomi-accent" /></td>
        <td className="px-2 font-mono text-micro text-nomi-ink-60">{String(row.index).padStart(2, '0')}</td>
        <td className="px-2">{row.thumbnail ? <img src={row.thumbnail} alt="" className="h-6 w-10 rounded-nomi-sm object-cover" /> : <div className="h-6 w-10 rounded-nomi-sm bg-nomi-ink-05" />}</td>
        {!compact && <><td className="px-2 font-mono text-micro">{row.start != null && row.end != null ? t('shotTable.timeRange', { start: row.start, end: row.end }) : t('shotTable.duration', { duration: row.duration })}</td>
          {facts ? facts.map(column => <td key={column.columnId} className="px-2" onDoubleClick={event => { event.stopPropagation(); onEditCell?.(row.id, column.columnId, row.cells?.[column.columnId] ?? '') }}><span className="block truncate" title={row.cells?.[column.columnId]}>{row.visionFailed && !row.cells?.[column.columnId] ? t('shotTable.unread') : row.cells?.[column.columnId] || '—'}</span></td>) : <><td className="px-2"><span className="block truncate" title={row.prompt}>{row.prompt}</span></td>
          <td className="px-2"><div className="flex gap-1 overflow-hidden">{row.references?.kind === 'cells' ? row.references.cells.map(cell => <span key={cell.key} className={cn('shrink-0 rounded-full border px-1.5 py-0.5 text-micro', cell.bindings.length ? 'border-nomi-accent/30 bg-nomi-accent-soft text-nomi-accent' : 'border-dashed border-nomi-line text-nomi-ink-40')}>{cell.label}</span>) : <span className="truncate text-micro text-nomi-ink-40">{t(row.references?.kind === 'none-accepted' ? 'shotTable.noReferences' : 'shotTable.unknownReferences')}</span>}</div></td></>}
        </>}
        <td className="px-2 text-micro"><span className={cn('inline-flex items-center gap-1.5', row.exec?.status === 'failed' || row.visionFailed ? 'text-nomi-danger' : row.exec?.status === 'generating' ? 'text-nomi-accent' : 'text-nomi-ink-60')}><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />{row.exec ? t(`shotTable.status.${row.exec.status}`) : row.visionFailed ? t('shotTable.unread') : '—'}{row.exec?.progressPercent != null ? ` ${row.exec.progressPercent}%` : ''}</span>
          {row.visionFailed && onRetry && <WorkbenchButton size="sm" variant="default" onClick={() => onRetry(row.id)}>{t('shotTable.retry')}</WorkbenchButton>}
        </td>
      </tr>)}</tbody>
    </table>
  </div>
}
