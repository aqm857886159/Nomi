import { type JSX, type ReactNode } from 'react'
import { cn } from '../utils/cn'
import { WorkbenchButton } from './actions'

/**
 * 决定栏（UI-R01 / R02 / R04 / R26，设计系统 §1.9）：对话框、卡片、行内编辑底部那一排「决定」。
 *
 * 一处写死的约定，调用方不再各画一版：
 *   · 顺序固定：**取消（文字）在左、主动作在最右**（Apple / Material 同向；你 10-06 / 10-07 拍板不跟微软）；
 *   · 取消只叫「取消」（调用方传 `cancelLabel` 才允许带宾语，如「取消录制」）；
 *   · 主动作写**具体动词**（调用方传 `primaryLabel`，不给默认值——没有「确认」兜底）；
 *   · **主动作里没有 ✓**（✓ 只表示状态）；
 *   · 两颗按钮至少 `h-7`（28px），高于 WCAG 2.5.8 的 24px 底线；
 *   · 破坏性主动作（`tone="danger"`）用危险色，但**不**设成默认聚焦（调用方自己别 autoFocus 它）。
 *
 * `leading` 放最左、与决定隔开（删除 / 恢复默认这类「不是决定」的动作住这里，固定最左，不夹在取消和主动作之间）。
 */
export type DecisionBarProps = {
  primaryLabel: ReactNode
  onPrimary: () => void
  /** 缺省 = 没有取消（只有 alert 一类的单按钮）。 */
  cancelLabel?: ReactNode
  onCancel?: () => void
  primaryDisabled?: boolean
  primaryLoading?: boolean
  cancelDisabled?: boolean
  /** danger = 破坏性主动作（危险色）。 */
  tone?: 'default' | 'danger'
  /** 危险色的具体样式由调用方给（confirmDialog 有自己的 token 色），不给就用 workbench-danger。 */
  dangerClassName?: string
  size?: 'sm' | 'md'
  /** 最左、与决定隔开。 */
  leading?: ReactNode
  /** 行内用：和输入框同一行（不换行、不撑满），两颗按钮靠 shrink-0 保持不被压扁。 */
  inline?: boolean
  className?: string
  /** 走查 / 测试锚点（原样落在两颗按钮上）。 */
  primaryProps?: Record<`data-${string}`, string | undefined>
  cancelProps?: Record<`data-${string}`, string | undefined>
  primaryClassName?: string
}

export function DecisionBar({
  primaryLabel,
  onPrimary,
  cancelLabel,
  onCancel,
  primaryDisabled,
  primaryLoading,
  cancelDisabled,
  tone = 'default',
  dangerClassName,
  size = 'sm',
  leading,
  inline,
  className,
  primaryProps,
  cancelProps,
  primaryClassName,
}: DecisionBarProps): JSX.Element {
  return (
    <div className={cn('flex items-center gap-2', inline ? 'shrink-0' : 'flex-wrap', className)} data-decision-bar="true">
      {leading ? <div className="flex items-center gap-2">{leading}</div> : null}
      {inline ? null : <span className="min-w-0 flex-1" aria-hidden="true" />}
      {cancelLabel !== undefined ? (
        <WorkbenchButton size={size} onClick={onCancel} disabled={cancelDisabled} className="shrink-0" {...cancelProps}>
          {cancelLabel}
        </WorkbenchButton>
      ) : null}
      <WorkbenchButton
        size={size}
        variant="primary"
        onClick={onPrimary}
        disabled={primaryDisabled}
        loading={primaryLoading}
        className={cn(
          'shrink-0',
          tone === 'danger' && (dangerClassName ?? 'bg-workbench-danger hover:bg-workbench-danger'),
          primaryClassName,
        )}
        {...primaryProps}
      >
        {primaryLabel}
      </WorkbenchButton>
    </div>
  )
}
