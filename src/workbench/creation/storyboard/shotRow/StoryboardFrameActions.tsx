import { generationFailureActions } from '../../../observability/generationFailureActions'
import { narrateErrorActionLabel } from '../../../observability/narrate'
import type { GenerationCanvasNode } from '../../../generationCanvas/model/generationCanvasTypes'
import { productionMetaOf } from '../../../generationCanvas/model/productionMeta'
import { withProjectAction } from '../../../project/projectCanvasReadSurface'
import { revealNotificationTarget } from '../../../../ui/notificationPolicy'
import { confirmAndRunNode } from '../../../generationCanvas/runner/generationRunController'
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconLayersSubtract,
  IconRefresh,
} from '../../../../vendor/tablerIcons'
import { cn } from '../../../../utils/cn'
import type { ShotRowExec } from '../exec/storyboardRowStatus'
import type { ShotVariant } from './shotVariants'

/**
 * 画面格**下方**的常驻动作条（合同 v6 §2.3/§2.4）。
 *
 * v5 把这些按钮做成半透明浮层压在缩略图上、悬停才现——设计系统 §1.5.3 点名的反例
 * （常驻遮挡内容），而且"要先把鼠标放上去才知道能做什么"。v6 把它移到图下方常驻：
 * 媒体框下面本来就是空白区，不需要靠遮住画面来省这点空间。
 *
 * 「变体 ×N」是本条里唯一的新入口（§2.9）：点重生成不再顶掉画面格，而是往抽屉里追加一版，
 * 这里的计数 +1；计数值挂在 DOM 上（`data-storyboard-variants`），走查才证得出"画面格没变、计数变了"。
 */

type Props = {
  actionBusy?: boolean
  exec: ShotRowExec
  variants: readonly ShotVariant[]
  /**
   * 这一次产出的 `@tag`（§2.10）。它住在**图下方**而不是图上：9:16 的画面格只有 76px 宽，
   * 贴在图上会和时长角标抢同一条底边，被截成「@…」——而这个字符串正是用户要照着在别的镜里
   * 打出来的东西，看不全等于没有。
   */
  outputTag?: string | undefined
  onRegenerate?: (() => void) | undefined
  /**
   * 可找回态的**免费**动作：续查上游结果（query 不是 generate，不铸付费令牌）。
   * 它和 `onGenerate`/`onRegenerate` 是两回事——那两条都会重新扣费，绝不能拿来当"重试"顶替它。
   */
  onRecover?: (() => void) | undefined
  onOpenVariants?: (() => void) | undefined
  onGenerate?: (() => void) | undefined
}

/** 动作条按钮：26×26 常驻小图标钮（合同 §6.3 `.acts button`）。 */
function ActButton({
  label,
  onClick,
  tone = 'quiet',
  disabled,
  children,
}: {
  label: string
  disabled?: boolean
  onClick?: (() => void) | undefined
  tone?: 'quiet' | 'danger'
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'size-6 grid place-items-center rounded-nomi-sm border border-transparent text-micro',
        tone === 'danger'
          ? 'text-workbench-danger hover:bg-workbench-danger-soft'
          : 'text-nomi-ink-60 hover:bg-nomi-ink-10 hover:text-nomi-ink-80',
      )}
    >
      {children}
    </button>
  )
}

export default function StoryboardFrameActions({
  exec,
  actionBusy = false,
  variants,
  outputTag,
  onRegenerate,
  onOpenVariants,
  onGenerate,
}: Props): JSX.Element | null {
  const { t } = useTranslation()
  // 「重试」按下去要重新扣一次费，所以它比别的钮更不该让人点第二下：
  // 2026-09-11 用户实测——点了之后这颗钮没有任何变化，和没点着长得一样。
  // 忙态既是回执也是闸（`disabled`），和旁边那颗免费的「重新拉取结果」同一副长相。
  const hasResult = Boolean(exec.resultUrl) && (exec.status === 'done' || exec.status === 'locked')
  const failed = exec.status === 'failed'
  const recoverable = exec.status === 'recoverable'
  if (!hasResult && !failed && !recoverable && variants.length === 0) return null
  const locked = exec.status === 'locked'

  return (
    <div className="mt-1 flex flex-col gap-0.5" data-storyboard-actbar="true">
    {/* 五件动作要在 136px 的列宽里排成一行（4 枚 24px 图标钮 + 一枚带计数的变体钮 ≈ 132px）。
        给了 gap 就会挤到第二行——第二行会让"这镜做完没有"的竖向节奏错开，正是 v6 要修的那种噪音。 */}
    <div className="flex items-center">
      {failed && generationFailureActions(exec.errorMessage ?? '').primary !== 'release-regenerate' ? <StoryboardFailureActions message={exec.errorMessage} node={exec.failedNode} busy={actionBusy} onRetry={onGenerate} /> : null}
      {hasResult && !locked ? (
        <ActButton label={t('storyboardEditor.frame.regenerate')} onClick={onRegenerate} disabled={actionBusy}>
          <IconRefresh size={14} stroke={1.8} />
        </ActButton>
      ) : null}
      {variants.length > 0 ? (
        <button
          type="button"
          onClick={onOpenVariants}
          title={t('storyboardEditor.variants.openHint')}
          aria-label={t('storyboardEditor.variants.open', { count: variants.length })}
          data-storyboard-variants={variants.length}
          className="inline-flex h-6 items-center gap-0.5 rounded-nomi-sm px-1 text-micro text-nomi-ink-60 hover:bg-nomi-ink-10 hover:text-nomi-ink-80"
        >
          <IconLayersSubtract size={14} stroke={1.8} />
          <span className="tabular-nums">{variants.length}</span>
        </button>
      ) : null}
    </div>
    {outputTag ? (
      <span
        className="max-w-[136px] truncate text-micro text-nomi-ink-40"
        data-storyboard-output-tag={outputTag}
        title={t('storyboardEditor.row.outputTagHint', { tag: outputTag })}
      >
        @{outputTag}
      </span>
    ) : null}
    </div>
  )
}

export function StoryboardFailureActions({ message, node, busy = false, onRetry, onRecover }: {
  message?: string | null
  node?: GenerationCanvasNode | null
  busy?: boolean
  onRetry?: (() => void) | undefined
  onRecover?: (() => void) | undefined
}) {
  const { t } = useTranslation()
  const [recovering, setRecovering] = React.useState(false)
  const runId = productionMetaOf({ meta: node?.meta })?.runId
  const waiting = node?.status === 'recoverable'
  const decision = generationFailureActions(waiting ? 'node_generation_in_flight' : message ?? '', { ...node?.runs?.[0], productionRunId: runId })
  const viewTask = () => {
    withProjectAction((project) => { void revealNotificationTarget({ projectId: project.binding.projectId, ...(runId ? { runId } : {}), taskCenter: true }) })
  }
  const canRelease = Boolean(node && (decision.primary === 'release-regenerate' || decision.secondary === 'release-regenerate'))
  return <div className="flex min-w-0 max-w-full flex-col items-center gap-1" data-storyboard-failure-actions>
    {waiting && onRecover ? <button type="button" onClick={() => { if (recovering) return; setRecovering(true); onRecover() }} disabled={recovering}
      data-storyboard-recover="true" className="inline-flex min-h-6 max-w-full items-center justify-center gap-1 rounded-nomi-sm border-0 bg-nomi-ink px-2 text-micro leading-tight text-nomi-paper hover:bg-nomi-accent disabled:opacity-50">
      <IconRefresh size={12} stroke={1.6} className={cn(recovering && 'animate-spin')} />
      {t(recovering ? 'storyboardEditor.frame.recoverableRefetching' : 'generationCommon.production.runAction.retry-retrieval')}
    </button> : null}
    {decision.canRetry && onRetry ? <button type="button" onClick={onRetry} disabled={busy}
      aria-busy={busy} data-storyboard-retry-state={busy ? 'busy' : 'idle'}
      title={t('storyboardEditor.frame.retryHint')} aria-label={t('storyboardEditor.frame.retryHint')}
      className="min-h-6 max-w-full rounded-nomi-sm border border-workbench-danger px-1 text-micro leading-tight text-workbench-danger disabled:opacity-50">
      {busy ? t('storyboardEditor.frame.generating') : t('storyboardEditor.frame.retry')}
    </button> : <>
      {canRelease && node ? <button type="button" onClick={() => { void confirmAndRunNode(node.id, { initiator: 'user', resend: true }) }}
        className={cn('inline-flex min-h-6 max-w-full items-center justify-center gap-1 rounded-nomi-sm px-2 text-micro leading-tight', waiting ? 'border border-nomi-line bg-nomi-paper text-nomi-ink hover:border-nomi-ink-30' : 'border-0 bg-nomi-ink text-nomi-paper hover:bg-nomi-accent')}>
        {!waiting ? <IconRefresh size={12} stroke={1.6} /> : null}{t('generationCommon.observability.action.releaseRegenerate.main')}
      </button> : null}
      <button type="button" onClick={viewTask} className="min-h-6 max-w-full text-micro leading-tight text-nomi-ink-60">
        {canRelease ? t('generationCommon.observability.action.reconcile.main') : narrateErrorActionLabel('view-task', 'primary')}
      </button>
    </>}
  </div>
}
