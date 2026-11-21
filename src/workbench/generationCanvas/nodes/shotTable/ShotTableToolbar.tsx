import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconColumns3, IconMinus, IconPlus } from '@tabler/icons-react'
import type { WorkbenchMenuNode } from '../../../../design/menu'
import type { DeconstructionShotTableDocument } from '../../../../../electron/shared/canvas/shotTable'
import { FloatingToolbarShell, ToolbarIconButton } from '../NodeFloatingToolbar'
import { ToolbarActionMenu } from '../ToolbarActionMenu'
import { editShotTableFacts } from './shotTableActions'
import type { ShotTableRowHeight } from './shotTableRowMetrics'

const ROW_HEIGHTS: readonly ShotTableRowHeight[] = ['compact', 'standard', 'large']

/** 行高三档：行高与关键帧（16:9）尺寸（紧凑 44 · 标准 58 · 大图 92，见 docs/plan/2026-10-18-shot-table-node.md 图 4）。 */
const ROW_HEIGHT_LABEL = { compact: 'shotTable.node.rowHeight.compact', standard: 'shotTable.node.rowHeight.standard', large: 'shotTable.node.rowHeight.large' } as const

/**
 * 拆解表的上方浮条（2026-10-18 拆解前选模型 图 1）：选中才出、以节点为中心。
 * 外壳 / 按钮 / 下拉全部用节点浮条那一套（`FloatingToolbarShell` / `ToolbarActionMenu` / `ToolbarIconButton`），不另写一份。
 * 全屏、导出与复制在第二批（复制拆解表 = 同一参考片两张表，`ensureDeconstructionShotTable` 只认第一张，语义要先定）（docs/design/boards/2026-10-18/ShotTableNode.board.json 记为 missing），这里不放一颗点不动的按钮。
 */
export function ShotTableToolbar({ nodeId, table }: { nodeId: string; table: DeconstructionShotTableDocument }): JSX.Element {
  const { t } = useTranslation()
  const rowHeight = table.view.rowHeight ?? 'standard'
  const stepRowHeight = (delta: -1 | 1) => {
    const next = ROW_HEIGHTS[Math.min(ROW_HEIGHTS.length - 1, Math.max(0, ROW_HEIGHTS.indexOf(rowHeight) + delta))]
    if (next === rowHeight) return
    editShotTableFacts(nodeId, (current) => ({ ...current, view: { ...current.view, rowHeight: next } }))
  }
  const columnItems = React.useMemo<WorkbenchMenuNode[]>(() => table.columns.slice().sort((a, b) => a.order - b.order).map((column) => ({
    kind: 'checkbox',
    id: `column-${column.columnId}`,
    label: column.kind === 'custom' ? column.labelKey : t(`shotTable.facts.${column.columnId}`),
    checked: column.visible,
    closeOnSelect: false,
    onCheckedChange: (visible: boolean) => {
      editShotTableFacts(nodeId, (current) => ({ ...current, columns: current.columns.map((item) => item.columnId === column.columnId ? { ...item, visible } : item) }))
    },
  })), [nodeId, t, table.columns])
  return (
    <FloatingToolbarShell ariaLabel={t('shotTable.node.toolbar')} nodeId={nodeId}>
      <ToolbarActionMenu
        id="shot-table-columns"
        icon={<IconColumns3 size={16} stroke={1.6} />}
        label={t('shotTable.node.columns')}
        menuLabel={t('shotTable.node.columns')}
        items={columnItems}
      />
      <span className="inline-flex items-center" data-shot-table-row-height={rowHeight}>
        <ToolbarIconButton icon={<IconMinus size={16} stroke={1.6} />} ariaLabel={t('shotTable.node.rowShorter')} title={t('shotTable.node.rowShorter')} disabled={rowHeight === 'compact'} onClick={() => { stepRowHeight(-1) }} />
        <span className="min-w-9 text-center text-caption text-nomi-ink-80">{t(ROW_HEIGHT_LABEL[rowHeight])}</span>
        <ToolbarIconButton icon={<IconPlus size={16} stroke={1.6} />} ariaLabel={t('shotTable.node.rowTaller')} title={t('shotTable.node.rowTaller')} disabled={rowHeight === 'large'} onClick={() => { stepRowHeight(1) }} />
      </span>
    </FloatingToolbarShell>
  )
}
