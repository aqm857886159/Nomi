import React from 'react'
import { cn } from '../../../utils/cn'
import { IconCoin } from '@tabler/icons-react'
import { WorkbenchButton } from '../../../design'
import { useSpendConfirmStore } from './spendConfirm'

// 付费生成确认对话框（单一收口，挂一次于工作区根）。极简：标题 + 一句人话 + 取消/确认。
// 轻确认（用户直发）多一个「本会话不再提示」；agent 受理不带 light = 每次必确认。
export function SpendConfirmDialog() {
  const pending = useSpendConfirmStore((state) => state.pending)
  const resolvePending = useSpendConfirmStore((state) => state.resolvePending)
  const [suppress, setSuppress] = React.useState(false)
  React.useEffect(() => {
    if (!pending) setSuppress(false)
  }, [pending])
  if (!pending) return null

  return (
    <div
      className={cn('absolute inset-0 z-50 flex items-center justify-center bg-nomi-ink/20 pointer-events-auto')}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) resolvePending(false)
      }}
    >
      <div className={cn('w-[360px] max-w-[88%] rounded-nomi-lg border border-nomi-line bg-nomi-paper p-4 shadow-nomi-md')}>
        <div className={cn('flex items-center gap-2 mb-2')}>
          <IconCoin size={18} className={cn('shrink-0 text-nomi-accent')} aria-hidden />
          <span className={cn('text-title font-medium text-nomi-ink')}>{pending.title}</span>
        </div>
        <p className={cn('text-body-sm text-nomi-ink-80 leading-relaxed mb-4')}>{pending.message}</p>
        {pending.light ? (
          <label className={cn('flex items-center gap-2 mb-4 cursor-pointer select-none text-caption text-nomi-ink-60')}>
            <input type="checkbox" checked={suppress} onChange={(event) => setSuppress(event.target.checked)} />
            本次会话不再提示
          </label>
        ) : null}
        <div className={cn('flex items-center justify-end gap-2')}>
          <WorkbenchButton className={cn('h-8 px-4 cursor-pointer')} onClick={() => resolvePending(false)}>
            取消
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
