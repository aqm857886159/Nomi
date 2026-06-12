// 破坏性操作确认原语（审计 A7 根治）。
// 此前全仓 11 处 window.confirm/alert/prompt：视觉脱离设计系统、Playwright 驱动
// 自动 dismiss 导致删除链路永远测不到、Electron 下原生弹窗在 macOS 有焦点丢失史。
// promise 风格 API（confirmDialog/alertDialog/promptDialog）在 confirmDialogStore.ts，
// 谁写不可逆操作都走这里——原生三件套从此禁用（设计系统 §3.5）。
import React from 'react'
import { DesignModal } from './overlays'
import { WorkbenchButton } from './actions'
import { cn } from '../utils/cn'
import { bindConfirmDialogHost, type DialogRequest } from './confirmDialogStore'

/**
 * 全局宿主：App 根部挂一次（与 ToastHost 同级）。多请求按序排队逐个展示。
 * zIndex 高于模型设置浮卡（4000）——确认可能从浮卡内部发起。
 */
export function ConfirmDialogHost(): JSX.Element {
  const [active, setActive] = React.useState<DialogRequest | null>(null)
  const [inputValue, setInputValue] = React.useState('')
  const pendingRef = React.useRef<DialogRequest[]>([])

  React.useEffect(() => {
    const dispatch = (request: DialogRequest): void => {
      setActive((current) => {
        if (!current) return request
        pendingRef.current.push(request)
        return current
      })
    }
    const backlog = bindConfirmDialogHost(dispatch)
    backlog.forEach(dispatch)
    return () => {
      bindConfirmDialogHost(null)
    }
  }, [])

  React.useEffect(() => {
    setInputValue(active?.kind === 'prompt' ? (active.initialValue ?? '') : '')
  }, [active])

  const settle = (value: boolean | string | null): void => {
    active?.resolve(value)
    setActive(pendingRef.current.shift() ?? null)
  }

  const cancelValue = active?.kind === 'prompt' ? null : false

  return (
    <DesignModal
      opened={Boolean(active)}
      onClose={() => settle(cancelValue)}
      title={active?.title ?? ''}
      centered
      size='sm'
      zIndex={5000}
      data-confirm-dialog={active ? active.kind : undefined}
    >
      <div className={cn('flex flex-col gap-3')}>
        {active?.message ? (
          <p className={cn('m-0 text-caption text-nomi-ink-80 whitespace-pre-line')}>{active.message}</p>
        ) : null}
        {active?.kind === 'prompt' ? (
          <input
            autoFocus
            value={inputValue}
            placeholder={active.placeholder}
            data-confirm-dialog-input='true'
            className={cn(
              'h-8 px-2 rounded-nomi-sm border border-nomi-line bg-nomi-paper',
              'text-caption text-nomi-ink outline-none focus:border-nomi-ink-40',
            )}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') settle(inputValue)
            }}
          />
        ) : null}
        <div className={cn('flex items-center justify-end gap-2')}>
          {active?.kind !== 'alert' ? (
            <WorkbenchButton
              className={cn(
                'h-7 px-3 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-nomi-ink-80 text-caption cursor-pointer hover:bg-nomi-ink-05',
              )}
              data-confirm-dialog-cancel='true'
              onClick={() => settle(cancelValue)}
            >
              {active?.cancelLabel ?? '取消'}
            </WorkbenchButton>
          ) : null}
          <WorkbenchButton
            className={cn(
              'h-7 px-3 rounded-nomi-sm border-0 text-caption cursor-pointer',
              active?.danger
                ? 'bg-[var(--nomi-snap-tag)] text-nomi-paper hover:opacity-90'
                : 'bg-nomi-ink text-nomi-paper hover:bg-nomi-accent',
            )}
            data-confirm-dialog-confirm='true'
            onClick={() => settle(active?.kind === 'prompt' ? inputValue : true)}
          >
            {active?.confirmLabel ?? (active?.kind === 'alert' ? '知道了' : '确认')}
          </WorkbenchButton>
        </div>
      </div>
    </DesignModal>
  )
}
