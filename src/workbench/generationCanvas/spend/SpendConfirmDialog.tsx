import React from 'react'
import { cn } from '../../../utils/cn'
import { IconCoin, IconRobot } from '@tabler/icons-react'
import { WorkbenchButton } from '../../../design'
import { useSpendConfirmStore } from './spendConfirm'

// 付费生成确认对话框（单一收口，挂一次于工作区根）。极简：标题 + 一句人话 + 取消/确认。
// 三种来源共用这一个对话框（不另造并行卡，P1）：
// - 用户直发（light）：多一个「本会话不再提示」。
// - agent 受理（不 light）：每次必确认。
// - 外部 AI 助手（MCP，source='agent'）：换机器人图标 + 明细行 + 倒计时（到点自动按未确认返回，不死等）。
export function SpendConfirmDialog() {
  const pending = useSpendConfirmStore((state) => state.pending)
  const resolvePending = useSpendConfirmStore((state) => state.resolvePending)
  const [suppress, setSuppress] = React.useState(false)
  const [remainingMs, setRemainingMs] = React.useState(0)

  React.useEffect(() => {
    if (!pending) setSuppress(false)
  }, [pending])

  // 倒计时：设了 countdownMs 才跑。每 200ms 收敛，到点自动按「未确认」返回（不死等——外部调用方那头在等）。
  React.useEffect(() => {
    if (!pending?.countdownMs) {
      setRemainingMs(0)
      return
    }
    const total = pending.countdownMs
    const startedAt = Date.now()
    setRemainingMs(total)
    const tick = window.setInterval(() => {
      const left = total - (Date.now() - startedAt)
      if (left <= 0) {
        window.clearInterval(tick)
        resolvePending(false)
      } else {
        setRemainingMs(left)
      }
    }, 200)
    return () => window.clearInterval(tick)
  }, [pending, resolvePending])

  if (!pending) return null

  const isAgent = pending.source === 'agent'
  const Icon = isAgent ? IconRobot : IconCoin
  const countdownTotal = pending.countdownMs || 0
  const remainingSec = countdownTotal ? Math.ceil(remainingMs / 1000) : 0
  const remainingPct = countdownTotal ? Math.max(0, Math.min(100, (remainingMs / countdownTotal) * 100)) : 0

  return (
    <div
      // 全屏固定模态：付费确认是全局阻断性动作，要盖住整窗（含顶栏/侧栏），任意视图（库/studio）都能弹。
      // 之前 absolute 只盖画布层 → 只在 studio 可见，是「外部生成到非当前项目静默黑洞」的放大器之一。
      className={cn('fixed inset-0 z-[3500] flex items-center justify-center bg-nomi-ink/20 pointer-events-auto')}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) resolvePending(false)
      }}
    >
      <div className={cn('w-[380px] max-w-[88%] rounded-nomi-lg border border-nomi-line bg-nomi-paper p-4 shadow-nomi-md')}>
        <div className={cn('flex items-center gap-2.5 mb-2')}>
          <span
            className={cn(
              'shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-nomi',
              isAgent ? 'bg-nomi-ink text-nomi-paper' : 'bg-nomi-accent-soft text-nomi-accent',
            )}
          >
            <Icon size={18} aria-hidden />
          </span>
          <div className={cn('min-w-0')}>
            <p className={cn('text-title font-medium text-nomi-ink truncate')}>{pending.title}</p>
            {isAgent ? <p className={cn('text-micro text-nomi-ink-60')}>经 AI 助手（MCP）驱动 · 需你确认花费</p> : null}
          </div>
        </div>

        <p className={cn('text-body-sm text-nomi-ink-80 leading-relaxed mb-3')}>{pending.message}</p>

        {pending.details?.length ? (
          <div className={cn('mb-3 rounded-nomi-sm border border-nomi-line-soft divide-y divide-nomi-line-soft')}>
            {pending.details.map((row) => (
              <div key={row.label} className={cn('flex items-center justify-between gap-3 px-2.5 py-1.5')}>
                <span className={cn('text-caption text-nomi-ink-60 shrink-0')}>{row.label}</span>
                <span className={cn('text-caption text-nomi-ink-80 font-medium text-right truncate')}>{row.value}</span>
              </div>
            ))}
          </div>
        ) : null}

        {countdownTotal ? (
          <div className={cn('flex items-center gap-2 mb-3')}>
            <div className={cn('flex-1 h-1 rounded-full bg-nomi-ink-05 overflow-hidden')}>
              <div
                className={cn('h-full rounded-full', remainingSec <= 10 ? 'bg-nomi-accent' : 'bg-nomi-ink-30')}
                style={{ width: `${remainingPct}%` }}
              />
            </div>
            <span className={cn('text-micro text-nomi-ink-60 tabular-nums shrink-0 w-[88px] text-right')}>{remainingSec}s 后自动忽略</span>
          </div>
        ) : null}

        {pending.light ? (
          <label className={cn('flex items-center gap-2 mb-4 cursor-pointer select-none text-caption text-nomi-ink-60')}>
            <input type="checkbox" checked={suppress} onChange={(event) => setSuppress(event.target.checked)} />
            本次会话不再提示
          </label>
        ) : null}

        <div className={cn('flex items-center justify-end gap-2')}>
          <WorkbenchButton className={cn('h-8 px-4 cursor-pointer')} onClick={() => resolvePending(false)}>
            {isAgent ? '忽略' : '取消'}
          </WorkbenchButton>
          <WorkbenchButton
            className={cn('h-8 px-4 cursor-pointer bg-nomi-ink text-nomi-paper border-nomi-ink hover:bg-nomi-accent hover:text-nomi-paper')}
            onClick={() => resolvePending(true, suppress)}
          >
            {pending.confirmLabel || '确认生成'}
          </WorkbenchButton>
        </div>
      </div>
    </div>
  )
}
