// 节点下方那一行（板 docs/design/boards/2026-11-26-sample-mode/：sample.below-row 及其各态）。
// 只在当前这一版是样片时出现：左边有效期小标，右边「出高清 · 价」（过期换「重拍样片 · 价」，在路上写「高清生成中」），
// 出高清没成时下面多一行原因。高清版、普通视频、老项目节点读不出样片事实 → 这一行不存在。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertCircle, IconClock } from '../../../../vendor/tablerIcons'
import { ICON_TIERS } from '../../../../design'
import { TEXT_BUTTON_PRESS } from '../../../../design/motion'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../../../design/tooltip'
import { cn } from '../../../../utils/cn'
import { sampleFinalResolution } from '../../../../../electron/shared/videoCapabilities/sampleMode'
import { classifyGenerationError } from '../../../observability/classifyError'
import { useGenerationFeedbackClockValue } from '../../../observability/useGenerationFeedback'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { sampleExpiry, sampleRowOf, type SampleExpiry, type SampleFacts, type SampleRowFacts } from '../../model/sampleFacts'
import { confirmAndRunNode } from '../../runner/generationRunController'
import { useSampleFinalCost, useSendCost, type SendCost } from '../../spend/useSendCost'
import { SendCostAmount } from '../../spend/SendCostAmount'
import { useComposerGraph } from '../composerGraphSnapshot'
import { startGenerationFromComposer } from '../composerRun'
import { NODE_BELOW_ROW_GAP } from '../nodeSizing'
import { useNodeOutsideRowsHidden } from '../nodeOutsideRows'

type NodeSampleRowProps = {
  node: GenerationCanvasNode
  onFeedback: (message: string) => void
  /** 列表详情里：放在内容流里（和大预览同宽、居中），不钉在节点下沿。不给 = 画布节点下沿。 */
  flowWidth?: number
  /** 只读画布：只说还剩多久，不摆要花钱的按钮。 */
  readOnly?: boolean
  /** 画布宿主：这一行占了节点下方多高（画布单位，含和节点之间的缝）；生成框据此往下让。没有这一行 = 0。 */
  onSpace?: (space: number) => void
}

export function NodeSampleRow({ node, onFeedback, flowWidth, readOnly = false, onSpace }: NodeSampleRowProps): JSX.Element | null {
  const facts = React.useMemo(() => sampleRowOf(node), [node])
  return facts ? <SampleRowBody node={node} facts={facts} onFeedback={onFeedback} flowWidth={flowWidth} readOnly={readOnly} onSpace={onSpace} /> : null
}

function SampleRowBody({ node, facts, onFeedback, flowWidth, readOnly, onSpace }: NodeSampleRowProps & { facts: SampleRowFacts }): JSX.Element {
  const inFlow = flowWidth !== undefined
  const { t } = useTranslation()
  const { sample, run } = facts
  const spec = sample.archetype.sampleOf.spec
  const resolution = sampleFinalResolution(spec)
  // 每秒按同一格时钟算一次，只在小标要换字 / 换色时重渲。
  const expiryKey = useGenerationFeedbackClockValue((now) => JSON.stringify(sampleExpiry(sample.createdAt, spec.ttlHours, now)))
  const expiry = React.useMemo(() => JSON.parse(expiryKey) as SampleExpiry | null, [expiryKey])
  const expired = expiry?.kind === 'expired'
  const hidden = useNodeOutsideRowsHidden() && !inFlow
  const busy = node.status === 'queued' || node.status === 'running'
  // 重拍样片照节点现在的设置发：节点已经换成别的模型时，这颗按钮不是「重拍样片」，不画（发新的走生成框）。
  const onSampleRow = (node.meta?.archetype as { id?: unknown } | undefined)?.id === sample.archetype.id
  const rowRef = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    const element = rowRef.current
    if (!onSpace || !element) return
    const report = () => onSpace(NODE_BELOW_ROW_GAP + element.offsetHeight)
    report()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(report)
    observer?.observe(element)
    return () => { observer?.disconnect(); onSpace(0) }
  }, [onSpace])

  const state = run?.phase === 'active' ? 'final-active' : expired ? 'expired' : run?.phase === 'failed' ? 'final-failed' : 'ready'
  return (
    <div
      ref={rowRef}
      data-sample-row=""
      data-sample-state={state}
      className={cn('flex flex-col gap-2', inFlow ? 'mx-auto mt-2 w-full' : 'absolute inset-x-0 z-[4]')}
      style={inFlow ? { maxWidth: flowWidth } : { top: `calc(100% + ${NODE_BELOW_ROW_GAP}px)`, visibility: hidden ? 'hidden' : undefined }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex min-h-7 min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1.5">
        <ExpiryChip expiry={expiry} ttlHours={spec.ttlHours} />
        {run?.phase === 'active' ? (
          <span data-sample-final-progress="" role="status" className="inline-flex items-center gap-1.5 whitespace-nowrap pr-1 text-caption leading-4 text-nomi-ink-60">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-nomi-accent" />
            {t('generationCommon.sample.finalInFlight')}
          </span>
        ) : readOnly ? null : expired ? (
          onSampleRow ? <RedraftButton node={node} onFeedback={onFeedback} /> : null
        ) : (
          <MakeFinalButton node={node} sample={sample} resolution={resolution} disabled={busy} onFeedback={onFeedback} />
        )}
      </div>
      {run?.phase === 'failed' && !expired ? (
        <p data-sample-final-failure="" role="status" className="m-0 flex gap-1.5 text-caption leading-[18px] text-nomi-danger-ink">
          <IconAlertCircle size={ICON_TIERS.corner.size} stroke={ICON_TIERS.corner.stroke} className="mt-0.5 shrink-0" aria-hidden />
          <span className="min-w-0 [overflow-wrap:anywhere]">{t('generationCommon.sample.failed', { reason: failureReason(run.error) })}</span>
        </p>
      ) : null}
    </div>
  )
}

/** 失败目录按种类给的那句原因（和失败卡、任务中心同一个入口），去掉句末标点再嵌进「出高清没成：…。」。 */
function failureReason(error: string): string {
  return classifyGenerationError(error).reason.replace(/[。.!！]+$/u, '')
}

function ExpiryChip({ expiry, ttlHours }: { expiry: SampleExpiry | null; ttlHours: number | undefined }): JSX.Element {
  const { t } = useTranslation()
  const label = !expiry
    ? t('generationCommon.sample.badge')
    : expiry.kind === 'expired'
      ? t('generationCommon.sample.expiry.expired')
      : t(`generationCommon.sample.expiry.${expiry.kind}`, { count: expiry.count })
  const tooltip = !expiry
    ? null
    : expiry.kind === 'expired'
      ? t('generationCommon.sample.tooltip.expired', { ttl: ttlText(ttlHours ?? 0, t) })
      : t(`generationCommon.sample.tooltip.${expiry.kind}`, { count: expiry.count })
  const chip = (
    <span
      data-sample-expiry={expiry?.kind ?? 'none'}
      data-sample-expiry-warning={expiry?.warning ? 'true' : undefined}
      tabIndex={tooltip ? 0 : undefined}
      className={cn(
        'mr-auto inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-pill px-2 text-caption leading-4 outline-none',
        'hover:ring-1 hover:ring-inset hover:ring-nomi-ink-40 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-nomi-ink-40',
        expiry?.kind === 'expired'
          ? 'bg-nomi-ink-05 text-nomi-ink-60'
          : expiry?.warning
            ? 'bg-nomi-warning-soft text-nomi-warning-ink ring-1 ring-inset ring-nomi-warning-edge'
            : 'bg-nomi-ink-10 text-nomi-ink-80',
      )}
    >
      <IconClock size={ICON_TIERS.corner.size} stroke={ICON_TIERS.corner.stroke} aria-hidden />
      {label}
    </span>
  )
  if (!tooltip) return chip
  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip delayDuration={120}>
        <TooltipTrigger asChild>{chip}</TooltipTrigger>
        <TooltipContent data-sample-expiry-hover="">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function ttlText(hours: number, t: ReturnType<typeof useTranslation>['t']): string {
  return hours % 24 === 0
    ? t('generationCommon.sample.tooltip.ttlDays', { count: hours / 24 })
    : t('generationCommon.sample.tooltip.ttlHours', { count: hours })
}

const ROW_BUTTON_CLASS = cn(
  'inline-flex h-7 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-pill border-0 bg-nomi-paper px-3',
  'text-caption font-semibold leading-4 text-nomi-ink shadow-nomi-sm ring-1 ring-inset ring-nomi-line',
  'hover:enabled:ring-nomi-ink-40 focus-visible:outline-2 focus-visible:outline-nomi-ink focus-visible:outline-offset-2',
  'disabled:cursor-not-allowed disabled:opacity-50',
  TEXT_BUTTON_PRESS,
  'transition-[box-shadow,transform] duration-nomi-micro ease-nomi-out',
)

/** 钮上的价：和发送键同一个单位（积分带硬币、货币只写 ≈ 数）；估不出 / 忙着 = 不印数、不印 0。 */
function RowButton({ label, ariaLabel, cost, disabled, onClick, ...attrs }: {
  label: string
  ariaLabel: string
  cost: SendCost
  disabled?: boolean
  onClick: () => void
} & Record<`data-${string}`, string>): JSX.Element {
  const button = (
    <button
      type="button"
      className={ROW_BUTTON_CLASS}
      aria-label={ariaLabel}
      aria-description={cost.description}
      disabled={disabled}
      onClick={(event) => { event.stopPropagation(); onClick() }}
      {...attrs}
    >
      {label}
      {cost.credits !== undefined ? (
        <span data-sample-cost="credits" data-sample-cost-unit={cost.unit ?? 'credits'} className="inline-flex items-center gap-[3px] tabular-nums text-nomi-ink-60">
          <SendCostAmount text={cost.credits} unit={cost.unit} />
        </span>
      ) : null}
    </button>
  )
  // 悬停：有数时说动作全名；估不出时说发送键那一句（「暂时估不出这次用量」）。
  const hover = cost.credits === undefined && cost.description ? cost.description : ariaLabel
  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip delayDuration={120}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent data-sample-button-hover="">{hover}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function MakeFinalButton({ node, sample, resolution, disabled, onFeedback }: {
  node: GenerationCanvasNode
  sample: SampleFacts
  resolution: string
  disabled: boolean
  onFeedback: (message: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const cost = useSampleFinalCost(sample, resolution, { idle: !disabled })
  // 第一次按下就发；这条样片已出过高清 → 控制器先弹「再出高清」确认（取消什么都不发）。
  const makeFinal = async () => {
    try { await confirmAndRunNode(node.id, { initiator: 'user', sampleFinal: { draftTaskId: sample.draftTaskId, resolution } }) }
    catch (error) { onFeedback(error instanceof Error ? error.message : t('generationCommon.batchPlan.authorizationFailed')) }
  }
  return (
    <RowButton
      data-sample-make-final=""
      label={t('generationCommon.sample.makeFinal')}
      ariaLabel={t('generationCommon.sample.makeFinalAria', { resolution })}
      cost={cost}
      disabled={disabled}
      onClick={() => { void makeFinal() }}
    />
  )
}

/** 过期后：按节点现在的设置再出一条样片（和生成框 ↑ 同一个口），钮上印样片价。 */
function RedraftButton({ node, onFeedback }: { node: GenerationCanvasNode; onFeedback: (message: string) => void }): JSX.Element {
  const { t } = useTranslation()
  const graph = useComposerGraph(node.id)
  const busy = node.status === 'queued' || node.status === 'running'
  const cost = useSendCost(node, graph, { idle: !busy })
  const redraft = async () => {
    try { await startGenerationFromComposer(node, true) }
    catch (error) { onFeedback(error instanceof Error ? error.message : t('generationCommon.batchPlan.authorizationFailed')) }
  }
  return (
    <RowButton
      data-sample-redraft=""
      label={t('generationCommon.sample.redraft')}
      ariaLabel={t('generationCommon.sample.redraft')}
      cost={cost}
      disabled={busy}
      onClick={() => { void redraft() }}
    />
  )
}
