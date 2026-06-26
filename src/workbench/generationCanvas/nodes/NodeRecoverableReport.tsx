import React from 'react'
import { IconClockSearch, IconRefresh } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { WorkbenchButton } from '../../../design'

/**
 * 可找回态（recoverable）—— 节点正文内联面板。
 *
 * 异步任务轮询超时但**上游可能仍在跑/已出片**：刻意不进红色错误桶（那会误导用户以为白花了钱），
 * 而是中性提示 + 「重新拉取结果」一键找回（query 非 generate，不扣费、不弹确认）。
 * 续查所需的 vendor/modelKey/kind/taskId 都在节点上（taskId 已落盘），主进程无状态重建查询，
 * 故重启 App 后这个按钮照样能把片子拉回来。视觉与 NodeErrorReport 同骨架（铺满正文），但用中性纸底。
 */
export function NodeRecoverableReport({
  onRecover,
  onDismiss,
}: {
  onRecover?: () => void
  onDismiss?: () => void
}): JSX.Element {
  const [pending, setPending] = React.useState(false)

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
      aria-label="任务可能已在上游完成，可重新拉取结果"
      className={cn(
        'absolute inset-0 z-[5] flex flex-col rounded-nomi p-4',
        // 不透明纸底盖住棋盘格占位；细描边用中性 line（非 danger）——一眼是「等待中/可找回」不是「失败」。
        'bg-nomi-paper border border-nomi-line',
      )}
    >
      <div className="flex items-start gap-2">
        <IconClockSearch size={16} stroke={1.6} className="mt-[1px] shrink-0 text-nomi-ink-60" />
        <span className="select-text cursor-text text-body font-bold leading-snug text-nomi-ink">
          任务可能已在上游完成
        </span>
      </div>
      <p className="mt-2 select-text cursor-text text-caption leading-relaxed text-nomi-ink-60">
        等待已超上限，但上游可能仍出了片。点下面直接拉回，不用去服务商后台下载。
      </p>

      <div className="min-h-0 flex-1" />

      <div className="flex items-center gap-2">
        {onRecover ? (
          <WorkbenchButton
            onClick={handleRecover}
            disabled={pending}
            aria-label="重新拉取结果"
            className="bg-nomi-ink text-nomi-paper border-0 hover:bg-nomi-accent disabled:opacity-50"
          >
            <IconRefresh size={13} stroke={1.6} className={cn(pending && 'animate-spin')} />
            {pending ? '正在拉取…' : '重新拉取结果'}
          </WorkbenchButton>
        ) : null}
        <div className="min-w-0 flex-1" />
        {onDismiss ? (
          <button
            type="button"
            onClick={handleDismiss}
            className="text-caption text-nomi-ink-40 hover:text-nomi-ink"
          >
            标记为失败
          </button>
        ) : null}
      </div>
    </div>
  )
}
