import React from 'react'
import type { NotificationData } from '@mantine/notifications'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const notificationMocks = vi.hoisted(() => ({
  show: vi.fn(),
  update: vi.fn(),
  hide: vi.fn(),
}))

vi.mock('@mantine/notifications', () => ({ notifications: notificationMocks }))

import { buildToastNotification, useToastStore } from './toast'

type ToastMessageProps = {
  id: string
  message: React.ReactNode
  actionLabel?: string
  onAction?: () => void
}

function renderToastMessage(notification: NotificationData): React.ReactElement<{ children: React.ReactNode }> {
  const element = notification.message as React.ReactElement<ToastMessageProps>
  const Component = element.type as (props: ToastMessageProps) => React.ReactElement<{ children: React.ReactNode }>
  return Component(element.props)
}

describe('Nomi toast contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses short semantic lifetimes and no close button for passive feedback', () => {
    expect(buildToastNotification({ id: 'success', message: 'done', type: 'success' })).toMatchObject({
      autoClose: 2600,
      withCloseButton: false,
    })
    expect(buildToastNotification({ id: 'info', message: 'noted', type: 'info' })).toMatchObject({
      autoClose: 3000,
      withCloseButton: false,
    })
    expect(buildToastNotification({ id: 'error', message: 'failed', type: 'error' })).toMatchObject({
      autoClose: 6000,
      withCloseButton: true,
    })
  })

  it('renders an explicit action button that closes before invoking the action', () => {
    const onAction = vi.fn()
    const notification = buildToastNotification({
      id: 'retry',
      message: 'failed',
      type: 'error',
      actionLabel: 'retry',
      onAction,
    })
    const rendered = renderToastMessage(notification)
    const action = React.Children.toArray(rendered.props.children).find(
      (child): child is React.ReactElement<{ onClick: (event: { stopPropagation: () => void }) => void }> =>
        React.isValidElement(child) && child.type === 'button',
    )

    expect(action).toBeDefined()
    expect(notification.autoClose).toBe(8000)
    const stopPropagation = vi.fn()
    action?.props.onClick({ stopPropagation })
    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(notificationMocks.hide).toHaveBeenCalledWith('retry')
    expect(onAction).toHaveBeenCalledOnce()
    expect(notificationMocks.hide.mock.invocationCallOrder[0]).toBeLessThan(onAction.mock.invocationCallOrder[0])
  })

  it('updates a stable id and uses idempotent show to cover its first appearance', () => {
    useToastStore.getState().push({ id: 'canvas-batch-run', message: 'starting', ttl: false })
    useToastStore.getState().push({ id: 'canvas-batch-run', message: 'still starting', ttl: false })

    expect(notificationMocks.update).toHaveBeenCalledTimes(2)
    expect(notificationMocks.show).toHaveBeenCalledTimes(2)
    expect(notificationMocks.update.mock.calls[0][0]).toMatchObject({ id: 'canvas-batch-run', autoClose: false })
    expect(notificationMocks.show.mock.calls[0][0]).toMatchObject({ id: 'canvas-batch-run', autoClose: false })
    expect(notificationMocks.update.mock.calls[1][0]).toMatchObject({ id: 'canvas-batch-run', autoClose: false })
    expect(notificationMocks.show.mock.calls[1][0]).toMatchObject({ id: 'canvas-batch-run', autoClose: false })
    expect(notificationMocks.update.mock.invocationCallOrder[0]).toBeLessThan(notificationMocks.show.mock.invocationCallOrder[0])
  })
})
