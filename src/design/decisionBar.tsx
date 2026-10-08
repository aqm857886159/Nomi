import { type JSX, type ReactNode } from 'react'
import { cn } from '../utils/cn'
import { WorkbenchButton } from './actions'

/**
 * 决定栏（UI-R01 / R02 / R04 / R26，设计系统 §1.9）：对话框、卡片、行内编辑底部那一排「决定」。
 *
 * 一处写死的约定，调用方不再各画一版：
 *   · 顺序固定：**取消（文字）在左、主动作在最右**（Apple / Material 同向；用户 10-06 / 10-07 拍板不跟微软）；
 *   · 取消只叫「取消」（调用方传 `cancelLabel` 才允许带宾语，如「取消录制」）；
 *   · 主动作写**具体动词**（调用方传 `primaryLabel`，不给默认值——没有「确认」兜底）；
 *   · **主动作里没有 ✓**（✓ 只表示状态）；
 *   · 两颗按钮至少 `h-7`（28px），高于 WCAG 2.5.8 的 24px 底线；
 *   · 破坏性主动作（`tone="danger"`）用危险色，但**不**设成默认聚焦（调用方自己别 autoFocus 它）。
 *
 * `leading` 放最左、与决定隔开（删除 / 恢复默认这类「不是决定」的动作住这里，固定最左，不夹在取消和主动作之间）。
 * `middle` 放取消和主动作之间的次动作（如「保存草稿」「去掉这段」）。
 *
 * **换行规则（窄位 / 英文长标签不许破坏「主动作最右」）**：取消 + middle + 主动作是**一个不拆的整组**（`shrink-0`），
 * 放不下时整组掉到下一行并**靠右**——主动作永远在最后一行最右，不会被裁、也不会掉到左下。
 * 行内用法（`inline`，和输入框同一行）：父行写 `flex-wrap`、输入框写 `min-w-[10rem] flex-[1_1_10rem]`，
 * 本组件自带 `grow justify-end`：同一行放得下就靠右占剩余宽度，放不下整组换到下一行、整行右对齐。
 * 调用方不要为窄位逐处特判。
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
  /** 取消和主动作之间的次动作。 */
  middle?: ReactNode
  /** 行内用：和输入框同一行（见上方换行规则）。 */
  inline?: boolean
  className?: string
  /** 走查 / 测试锚点（原样落在两颗按钮上）。 */
  primaryProps?: Record<`data-${string}`, string | undefined>
  cancelProps?: Record<`data-${string}`, string | undefined>
  primaryClassName?: string
  /** 主动作被禁用时给用户看的原因（禁用的 button 自己不触发 title，所以包一层）。 */
  primaryHint?: string
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
  middle,
  inline,
  className,
  primaryProps,
  cancelProps,
  primaryClassName,
  primaryHint,
}: DecisionBarProps): JSX.Element {
  return (
    <div
      className={cn('flex flex-wrap items-center justify-end gap-x-2 gap-y-2', inline && 'min-w-0 grow', className)}
      data-decision-bar="true"
    >
      {leading ? <div className="flex min-w-0 grow items-center gap-2">{leading}</div> : null}
      <div className="flex shrink-0 items-center gap-2" data-decision-group="true">
        {cancelLabel !== undefined ? (
          <WorkbenchButton size={size} onClick={onCancel} disabled={cancelDisabled} className="shrink-0" {...cancelProps}>
            {cancelLabel}
          </WorkbenchButton>
        ) : null}
        {middle}
        <span title={primaryHint} className="contents">
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
        </span>
      </div>
    </div>
  )
}
