import React, { type JSX } from 'react'
import { notifications } from '@mantine/notifications'
import { TOAST_MAX_HEIGHT, TOAST_MIN_BODY_WIDTH } from './toastConstants'

const TOAST_ACTION_ROW_RESERVE = '4rem'

type ToastMessageProps = {
  id: string
  message: React.ReactNode
  actionLabel?: string
  onAction?: () => void
  count?: number
}

export function ToastMessage({ id, message, actionLabel, onAction, count = 1 }: ToastMessageProps): JSX.Element {
  const handleAction = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    notifications.hide(id)
    onAction?.()
  }
  const hasAction = Boolean(actionLabel && onAction)
  const bodyMaxHeight = `calc(${TOAST_MAX_HEIGHT} - 2rem${hasAction ? ` - ${TOAST_ACTION_ROW_RESERVE}` : ''})`
  return (
    <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-2">
      <span className="flex-1 overflow-y-auto break-words text-body-sm text-nomi-ink-80" style={{ minWidth: TOAST_MIN_BODY_WIDTH, maxHeight: bodyMaxHeight }} data-toast-message>{message}{count > 1 ? <span className="ml-1 text-micro text-nomi-ink-40" data-notification-occurrences>{`×${count}`}</span> : null}</span>
      {hasAction ? (
        <button type="button" onClick={handleAction} title={actionLabel} data-toast-action className="max-w-full shrink-0 rounded-nomi-sm bg-nomi-accent-soft px-2 py-1 text-left text-caption font-semibold text-nomi-accent [overflow-wrap:anywhere] hover:bg-nomi-ink-10">
          {actionLabel}
        </button>
      ) : null}
    </span>
  )
}
