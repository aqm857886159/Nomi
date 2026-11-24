import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notifications, notificationsStore } from '@mantine/notifications'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../project/projectSessionTestHarness'
import { reportPreviewExportFailure, reportPreviewExportSuccess } from './previewExportFeedback'
const state = vi.hoisted(() => ({ workspaceMode: 'preview' }))
vi.mock('../workbenchStore', () => ({ useWorkbenchStore: { getState: () => state } }))

const input = () => ({ projectId: 'original', message: 'Disk full; free space and export again', actionLabel: 'Tasks', hostConnected: true, present: vi.fn() })

describe('preview export failure ownership', () => {
  let projectSession: ProjectSessionTestHarness
  beforeEach(async () => { notifications.clean(); projectSession = createProjectSessionTestHarness(); await projectSession.open('original'); state.workspaceMode = 'preview' })
  afterEach(() => { notifications.clean(); vi.unstubAllGlobals(); projectSession.dispose() })
  it('keeps five failures at the visible preview without a global notice', () => {
    const failure = input()
    for (let index = 0; index < 5; index += 1) reportPreviewExportFailure(failure)
    expect(failure.present).toHaveBeenLastCalledWith({ projectId: 'original', message: failure.message })
    expect(notificationsStore.getState().notifications).toHaveLength(0)
  })
  it.each(['other-project', 'other-workspace', 'unmounted-preview'])('keeps the originating project when the user leaves: %s', async (scenario) => {
    const failure = input()
    if (scenario === 'other-project') await projectSession.open('other')
    if (scenario === 'other-workspace') state.workspaceMode = 'generation'
    if (scenario === 'unmounted-preview') failure.hostConnected = false
    reportPreviewExportFailure(failure)
    expect(failure.present).not.toHaveBeenCalled()
    const notice = notificationsStore.getState().notifications[0]
    expect(notice.id).toBe('export:original')
    expect((notice.message as React.ReactElement<{ message: string }>).props.message).toBe(failure.message)
    expect(notificationsStore.getState().notifications).toHaveLength(1)
  })
  it('coalesces repeated export failures by original project without hiding the latest reason', async () => {
    await projectSession.open('other')
    for (let index = 0; index < 5; index += 1) reportPreviewExportFailure({ ...input(), message: `Failure ${index}` })
    const notices = notificationsStore.getState().notifications
    expect(notices).toHaveLength(1)
    expect(notices[0]['data-notification-count']).toBe(5)
    expect((notices[0].message as React.ReactElement<{ message: string }>).props.message).toBe('Failure 4')
  })
  it('background action requests guarded navigation to the original project, not the currently open one', async () => {
    await projectSession.open('other')
    const dispatchEvent = vi.fn((event: CustomEvent) => {
      expect(event.type).toBe('nomi-reveal-notification')
      expect(event.detail).toMatchObject({ projectId: 'original', workspaceMode: 'preview', taskCenter: true })
      event.preventDefault()
      event.detail.resolve(true)
      return false
    })
    vi.stubGlobal('window', { dispatchEvent })
    reportPreviewExportFailure(input())
    const notice = notificationsStore.getState().notifications[0]
    const message = notice.message as React.ReactElement<{ onAction: () => void }>
    message.props.onAction()
    expect(dispatchEvent).toHaveBeenCalledOnce()
  })
})

describe('successful preview export', () => {
  afterEach(() => { notifications.clean(); vi.unstubAllGlobals() })

  it('reveals the saved file in its original project only after the toast action', () => {
    const showInFolder = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('window', { nomiDesktop: { exports: { showInFolder } } })
    reportPreviewExportSuccess({ projectId: 'original', relativePath: 'exports/final.mp4', message: 'MP4 exported', actionLabel: 'Show file' })
    expect(showInFolder).not.toHaveBeenCalled()
    const notice = notificationsStore.getState().notifications[0]
    const message = notice.message as React.ReactElement<{ message: string; actionLabel: string; onAction: () => void }>
    expect(message.props).toMatchObject({ message: 'MP4 exported', actionLabel: 'Show file' })
    message.props.onAction()
    expect(showInFolder).toHaveBeenCalledExactlyOnceWith({ projectId: 'original', relativePath: 'exports/final.mp4' })
  })
})
