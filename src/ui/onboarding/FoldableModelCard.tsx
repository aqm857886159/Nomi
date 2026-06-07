/**
 * 折叠摘要卡外壳（模型接入面板方案 A）。
 *
 * 一套折叠语言，预置供应商卡 / 「其他模型」卡共用（P1 单一来源，P4 通用）：
 * 默认折成一行（logo + 名/副标题 + 状态胶囊 + chevron），点 header 就地展开 body。
 * 样张：docs/design/mockups/onboarding-panel-A.html；规范：docs/plan/2026-06-07-onboarding-panel-redesign.md §5.1
 */
import React from 'react'
import { IconChevronDown } from '@tabler/icons-react'
import { cn } from '../../utils/cn'

type FoldableModelCardProps = {
  /** logo 内容：字形（如 'A'）、Tabler 图标或 <img> brand logo。 */
  glyph: React.ReactNode
  /** logo 色调：ink=深底白字 / soft=浅底灰字 / logo=白底带边框留白（承载图片 logo）。 */
  glyphTone?: 'ink' | 'soft' | 'logo'
  name: string
  subtitle: string
  status: 'ok' | 'todo'
  /** 状态胶囊文案；缺省按 status：ok→已连通 / todo→待接入。 */
  statusLabel?: string
  defaultExpanded?: boolean
  children: React.ReactNode
}

export function FoldableModelCard({
  glyph,
  glyphTone = 'ink',
  name,
  subtitle,
  status,
  statusLabel,
  defaultExpanded = false,
  children,
}: FoldableModelCardProps): JSX.Element {
  const [expanded, setExpanded] = React.useState(defaultExpanded)
  const bodyId = React.useId()

  return (
    <div className="border border-nomi-line rounded-nomi bg-nomi-paper overflow-hidden">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          'flex items-center gap-3 p-3 w-full text-left',
          'hover:bg-nomi-ink-05',
          expanded && 'bg-nomi-ink-05',
        )}
      >
        <span
          className={cn(
            'w-7 h-7 rounded-nomi-sm grid place-items-center shrink-0 overflow-hidden text-body-sm font-semibold',
            glyphTone === 'logo' && 'bg-nomi-paper border border-nomi-line p-0.5',
            glyphTone === 'soft' && 'bg-nomi-ink-05 text-nomi-ink-60',
            glyphTone === 'ink' && 'bg-nomi-ink text-nomi-paper',
          )}
          aria-hidden
        >
          {glyph}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-body-sm font-semibold text-nomi-ink truncate">{name}</span>
          <span className="block text-caption text-nomi-ink-40 truncate">{subtitle}</span>
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full text-micro font-semibold shrink-0',
            status === 'ok'
              ? 'bg-[var(--workbench-success-soft)] text-[var(--workbench-success-ink)]'
              : 'bg-nomi-ink-10 text-nomi-ink-60',
          )}
        >
          <span className={cn('w-1.5 h-1.5 rounded-full', status === 'ok' ? 'bg-workbench-success' : 'bg-nomi-ink-30')} />
          {statusLabel ?? (status === 'ok' ? '已连通' : '待接入')}
        </span>
        <IconChevronDown
          size={16}
          stroke={1.8}
          className={cn('shrink-0 text-nomi-ink-40 transition-transform duration-150', expanded && 'rotate-180')}
        />
      </button>
      {expanded ? (
        <div id={bodyId} className="border-t border-nomi-line-soft p-3 flex flex-col gap-3">
          {children}
        </div>
      ) : null}
    </div>
  )
}
