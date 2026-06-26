/**
 * 「可接入」分组的折叠外壳（模型设置面板 · 方案2 分组折叠，见
 * docs/plan/2026-06-25-model-onboarding-connected-available-split.md）。
 *
 * 保留原分组（接入生成模型 / 有即梦会员？/ 接入编程助手）当组头，只多一层折叠 + 数量徽：
 * 接好的人各组默认收起（不被打扰），没接的新用户首组默认展开（那一刻就是来接模型的）。
 * 组头沿用原 section header 的字号字色（text-micro / ink-40），只加 chevron + 数量——
 * 视觉上仍是"原来的拆法"，不另立新样式语言（P1）。
 */
import React from 'react'
import { IconChevronDown } from '@tabler/icons-react'
import { cn } from '../../utils/cn'

type AvailableGroupProps = {
  title: string
  /** 该组未接入项数；>0 时显示「· N」数量徽，0 不显（如生成模型全已接、只剩添加按钮）。 */
  count?: number
  defaultExpanded?: boolean
  children: React.ReactNode
}

export function AvailableGroup({
  title,
  count,
  defaultExpanded = false,
  children,
}: AvailableGroupProps): JSX.Element {
  const [expanded, setExpanded] = React.useState(defaultExpanded)
  const bodyId = React.useId()

  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 w-full text-left px-0.5 py-1.5 group"
      >
        <span className="text-micro font-semibold text-nomi-ink-40">{title}</span>
        {count != null && count > 0 ? (
          <span className="text-micro text-nomi-ink-30">· {count}</span>
        ) : null}
        <span className="flex-1" />
        <IconChevronDown
          size={15}
          stroke={1.8}
          className={cn(
            'shrink-0 text-nomi-ink-30 transition-transform duration-150 group-hover:text-nomi-ink-40',
            expanded && 'rotate-180',
          )}
        />
      </button>
      {expanded ? (
        <div id={bodyId} className="flex flex-col gap-2 pt-0.5">
          {children}
        </div>
      ) : null}
    </div>
  )
}
