import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconClockSearch, IconRefresh } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { WorkbenchButton } from '../../../design'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { recoverableCopyKeys } from '../model/recoverableCopy'
import { classifyGenerationError } from '../runner/generationRunController'
import { NODE_SCROLL_REGION_CLASS_NAME } from './nodeScrollRegionClassName'
import { CopyDetailsButton, ProviderMessageNote, TechnicalDetailsBlock, TechnicalDetailsToggle } from './NodeFailureDetails'

/**
 * 可找回态（recoverable）—— 节点正文内联面板。
 *
 * 异步任务轮询超时但**上游可能仍在跑/已出片**：刻意不进红色错误桶（那会误导用户以为白花了钱），
 * 而是中性提示 + 「重新拉取结果」一键找回（query 非 generate，不扣费、不弹确认）。
 * 续查所需的 vendor/modelKey/kind/taskId 都在节点上（taskId 已落盘），主进程无状态重建查询，
 * 故重启 App 后这个按钮照样能把片子拉回来。视觉与 NodeErrorReport 同骨架（铺满正文），但用中性纸底。
 *
 * 最后一次取回失败的原话（node.error）照失败卡的样子给出来：服务商原话 + 复制详情 + 技术详情（#1213）。
 * 以前这里只有固定文案，HTTP 503「无可用渠道」/ 404 / 出站被拦这些各有下一步的原因全被吞掉，
 * 用户点「重新拉取」撞同一堵墙也不知道为什么。三件套与失败卡共用一份实现（NodeFailureDetails）。
 */
export function NodeRecoverableReport({
  node,
  onRecover,
  onDismiss,
}: {
  node: Pick<GenerationCanvasNode, 'runs' | 'error'>
  onRecover?: () => void
  onDismiss?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const copy = recoverableCopyKeys(node)
  const [pending, setPending] = React.useState(false)
  const [showRaw, setShowRaw] = React.useState(false)
  const lastFailure = typeof node.error === 'string' && node.error.trim() ? node.error : ''
  const report = React.useMemo(() => (lastFailure ? classifyGenerationError(lastFailure) : null), [lastFailure])

  const handleRecover = React.useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      if (pending) return
      setPending(true)
      onRecover?.()
    },
    [onRecover, pending],
  )

  const handleDismiss = React.useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      onDismiss?.()
    },
    [onDismiss],
  )

  return (
    <div
      role="status"
      aria-label={t(copy.aria)}
      className={cn(
        'absolute inset-0 z-[5] flex flex-col rounded-nomi p-4',
        // 不透明纸底盖住棋盘格占位；细描边用中性 line（非 danger）——一眼是「等待中/可找回」不是「失败」。
        'bg-nomi-paper border border-nomi-line',
      )}
    >
      <div className="flex items-start gap-2">
        <IconClockSearch size={16} stroke={1.6} className="mt-[1px] shrink-0 text-nomi-ink-60" />
        <span className="select-text cursor-text text-body font-bold leading-snug text-nomi-ink">
          {t(copy.title)}
        </span>
      </div>
      <p className="mt-2 select-text cursor-text text-caption leading-relaxed text-nomi-ink-60">
        {t(copy.description)}
      </p>

      <div className={cn(NODE_SCROLL_REGION_CLASS_NAME, 'min-h-0 flex-1 overflow-y-auto')}>
        {report?.providerMessage ? <ProviderMessageNote text={report.providerMessage} /> : null}
      </div>

      {report && showRaw ? <TechnicalDetailsBlock raw={report.raw} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {onRecover ? (
          <WorkbenchButton
            onClick={handleRecover}
            disabled={pending}
            aria-label={t('generationCommon.production.runAction.retry-retrieval')}
            className="bg-nomi-ink text-nomi-paper border-0 hover:bg-nomi-accent disabled:opacity-50"
          >
            <IconRefresh size={13} stroke={1.6} className={cn(pending && 'animate-spin')} />
            {pending ? t('generationCommon.recoverable.recovering') : t('generationCommon.production.runAction.retry-retrieval')}
          </WorkbenchButton>
        ) : null}
        {report ? <CopyDetailsButton raw={report.raw} /> : null}
        <div className="min-w-0 flex-1" />
        {report ? <TechnicalDetailsToggle open={showRaw} onToggle={() => setShowRaw((value) => !value)} /> : null}
        {onDismiss ? (
          <button type="button" onClick={handleDismiss} className="shrink-0 whitespace-nowrap text-caption text-nomi-ink-40 hover:text-nomi-ink">
            {t('generationCommon.recoverable.dismiss')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
