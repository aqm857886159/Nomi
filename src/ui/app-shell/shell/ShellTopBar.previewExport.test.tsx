// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
import { enTimelinePreview, zhTimelinePreview } from '../../../i18n/locales/timelinePreview'
import { createDefaultTimeline } from '../../../workbench/timeline/timelineMath'
import type { TimelineState } from '../../../workbench/timeline/timelineTypes'
import {
  PREVIEW_EXPORT_IDLE,
  publishPreviewExportState,
  registerPreviewExportCancelHandler,
  resetPreviewExportState,
} from '../../../workbench/preview/previewExportRequest'
import TimelinePreview from '../../../workbench/preview/TimelinePreview'
import { ShellTopBar } from './ShellTopBar'

let currentLocale: 'en' | 'zh-CN' = 'en'
let useRealTranslations = false

function lookupPreviewCopy(key: string, options?: Record<string, unknown>): string {
  if (!useRealTranslations) return key
  const table = currentLocale === 'zh-CN' ? zhTimelinePreview : enTimelinePreview
  const prefix = 'timelinePreview.'
  if (!key.startsWith(prefix)) return key
  const segments = key.slice(prefix.length).split('.')
  let cursor: unknown = table
  for (const seg of segments) {
    cursor = (cursor as Record<string, unknown> | undefined)?.[seg]
  }
  if (typeof cursor !== 'string') return key
  return cursor.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => String(options?.[token] ?? ''))
}

vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => lookupPreviewCopy(key, options),
    i18n: { language: currentLocale },
  }),
}))
vi.mock('../../../workbench/taskCenter/TaskCenterButton', () => ({ TaskCenterButton: () => null }))
vi.mock('../../../workbench/preview/EditingLayoutMenu', () => ({ default: () => null }))

const exportTimelineToMp4Mock = vi.fn()
const reportPreviewExportSuccessMock = vi.fn()
const reportPreviewExportFailureMock = vi.fn()

vi.mock('../../../workbench/export/exportApi', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../workbench/export/exportApi')>()
  return {
    ...actual,
    exportTimelineToMp4: (...args: unknown[]) => exportTimelineToMp4Mock(...args),
  }
})

vi.mock('../../../workbench/preview/previewExportFeedback', () => ({
  reportPreviewExportSuccess: (...args: unknown[]) => reportPreviewExportSuccessMock(...args),
  reportPreviewExportFailure: (...args: unknown[]) => reportPreviewExportFailureMock(...args),
}))

vi.mock('../../../workbench/project/projectCanvasReadSurface', () => ({
  isProjectOpen: () => true,
  withProjectAction: (fn: (project: { binding: { projectId: string } }) => unknown) => fn({ binding: { projectId: 'proj-ux-b1' } }),
}))

const state = vi.hoisted(() => ({
  timeline: { version: 1, fps: 30, scale: 1, playheadFrame: 0, tracks: [], textClips: [] } as TimelineState,
  exportResolution: '1080p' as '1080p' | '720p',
  exportQuality: 'standard' as const,
  selectedTextClipId: '',
  selectedTimelineClipIds: [] as string[],
  timelinePlaying: false,
  addTimelineTextClip: () => 'txt-1',
  updateTimelineTextClip: () => undefined,
  updateTimelineTextClipTransform: () => undefined,
  selectTimelineTextClip: () => undefined,
  setTimelineClipFraming: () => undefined,
  setTimelineSelection: () => undefined,
  setTimelinePlaying: () => undefined,
  setTimelinePlayhead: () => undefined,
}))
vi.mock('../../../workbench/workbenchStore', () => ({
  useWorkbenchStore: Object.assign((select: (snapshot: typeof state) => unknown) => select(state), {
    getState: () => state,
    subscribe: () => () => {},
  }),
}))

function exportMarkup() {
  const container = document.createElement('div')
  const root = createRoot(container)
  act(() => {
    root.render(<ShellTopBar workspaceMode="preview" />)
  })
  const html = container.innerHTML
  const button = container.querySelector('[data-shell-export]')?.outerHTML
  act(() => {
    root.unmount()
  })
  return { html, button }
}

describe('top-bar MP4 export availability, resolution display, and in-place cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentLocale = 'en'
    useRealTranslations = false
    state.timeline = createDefaultTimeline()
    state.exportResolution = '1080p'
    resetPreviewExportState()
  })

  afterEach(() => {
    resetPreviewExportState()
  })

  it('disables native click on an empty timeline', () => {
    const { button } = exportMarkup()
    expect(button).toContain('disabled=""')
    expect(button).toContain('aria-label="timelinePreview.exportMp4"')
  })

  it('enables export for text-only content with positive duration', () => {
    state.timeline.textClips.push({ id: 'title', text: 'Title', style: 'title', startFrame: 0, endFrame: 30 })
    const { button } = exportMarkup()
    expect(button).toContain('aria-label="timelinePreview.exportMp4"')
    expect(button).not.toContain(' disabled=""')
  })

  it('displays dynamic resolution (1080p / 720p) in idle pill text while preserving exact aria-label in zh-CN and en', () => {
    useRealTranslations = true
    state.timeline.textClips.push({ id: 'title', text: 'Title', style: 'title', startFrame: 0, endFrame: 30 })

    currentLocale = 'zh-CN'
    expect(exportMarkup().button).toContain('aria-label="导出 MP4"')
    expect(exportMarkup().button).toContain('导出 MP4 · 1080p')

    state.exportResolution = '720p'
    expect(exportMarkup().button).toContain('aria-label="导出 MP4"')
    expect(exportMarkup().button).toContain('导出 MP4 · 720p')

    currentLocale = 'en'
    state.exportResolution = '1080p'
    expect(exportMarkup().button).toContain('aria-label="Export MP4"')
    expect(exportMarkup().button).toContain('Export MP4 · 1080p')
  })

  it('flips the single pill in-place to clickable Exporting N% · Cancel when busy and disables during cancelling', () => {
    useRealTranslations = true
    state.timeline.textClips.push({ id: 'title', text: 'Title', style: 'title', startFrame: 0, endFrame: 30 })

    currentLocale = 'zh-CN'
    publishPreviewExportState({ status: 'converting', progress: 0.42 })
    const zhBusy = exportMarkup()
    expect(zhBusy.html.match(/data-shell-export="true"/g)).toHaveLength(1)
    expect(zhBusy.button).not.toContain('disabled=""')
    expect(zhBusy.button).toContain('导出中 42% · 取消')
    expect(zhBusy.button).toContain('animate-spin')
    expect(zhBusy.button).toContain('aria-label="正在导出（转码封装 · 42%）· 点击取消导出"')

    currentLocale = 'en'
    const enBusy = exportMarkup()
    expect(enBusy.button).not.toContain('disabled=""')
    expect(enBusy.button).toContain('Exporting 42% · Cancel')
    expect(enBusy.button).toContain('aria-label="Exporting (Encoding · 42%) · Click to cancel"')

    publishPreviewExportState({ status: 'converting', progress: 0.42, cancelling: true })
    const cancellingMarkup = exportMarkup()
    expect(cancellingMarkup.button).toContain('disabled=""')
    expect(cancellingMarkup.button).toContain(enTimelinePreview.exportCancelling)
  })

  it('routes busy pill click to cancel handler without re-requesting export, recovers cleanly to idle, and allows re-export', async () => {
    useRealTranslations = true
    currentLocale = 'zh-CN'
    state.timeline.textClips.push({ id: 'title', text: 'Title', style: 'title', startFrame: 0, endFrame: 30 })

    let exportRun = 0
    let settleCancelFromMain!: () => void
    exportTimelineToMp4Mock.mockImplementation((options: {
      signal?: AbortSignal
      onProgress?: (p: { status: 'preparing' | 'recording' | 'converting' | 'done'; ratio: number }) => void
    }) => {
      exportRun += 1
      if (exportRun === 1) {
        options.onProgress?.({ status: 'converting', ratio: 0.42 })
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            settleCancelFromMain = () => {
              const cancelledError = new Error('Export cancelled')
              cancelledError.name = 'ExportCancelledError'
              reject(cancelledError)
            }
          }, { once: true })
        })
      }
      options.onProgress?.({ status: 'done', ratio: 1 })
      return Promise.resolve({
        absolutePath: '/out/final.mp4',
        relativePath: 'exports/final.mp4',
        size: 512,
      })
    })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(
          <>
            <ShellTopBar workspaceMode="preview" />
            <TimelinePreview
              activeClips={[]}
              aspectRatio="16:9"
              fps={30}
              playheadFrame={0}
              timeline={state.timeline}
            />
          </>,
        )
      })

      const getBtn = () => container.querySelector<HTMLButtonElement>('[data-shell-export]')!
      expect(getBtn().textContent).toContain('导出 MP4 · 1080p')
      expect(getBtn().disabled).toBe(false)

      // 1. Click to start export -> flips to clickable "导出中 42% · 取消"
      await act(async () => {
        getBtn().click()
      })
      expect(exportTimelineToMp4Mock).toHaveBeenCalledTimes(1)
      expect(getBtn().getAttribute('data-export-busy')).toBe('true')
      expect(getBtn().disabled).toBe(false)
      expect(getBtn().textContent).toContain('导出中 42% · 取消')

      // 2. Click the busy pill -> enters cancelling (disabled against double-click), aborts signal
      const extraCancelSpy = vi.fn()
      const unsubExtra = registerPreviewExportCancelHandler(extraCancelSpy)
      await act(async () => {
        getBtn().click()
      })
      unsubExtra()
      expect(extraCancelSpy).toHaveBeenCalledTimes(1)
      expect(exportTimelineToMp4Mock).toHaveBeenCalledTimes(1)
      expect(getBtn().disabled).toBe(true)
      expect(getBtn().textContent).toContain(zhTimelinePreview.exportCancelling)

      // Second click while cancelling is blocked by disabled
      await act(async () => {
        getBtn().click()
      })
      expect(exportTimelineToMp4Mock).toHaveBeenCalledTimes(1)

      // 3. Main process finishes cleanup -> settles back to PREVIEW_EXPORT_IDLE with zero error banner/toast
      await act(async () => {
        settleCancelFromMain()
      })
      expect(getBtn().getAttribute('data-export-busy')).toBe('false')
      expect(getBtn().disabled).toBe(false)
      expect(getBtn().textContent).toContain('导出 MP4 · 1080p')
      expect(container.querySelector('[data-preview-export-error]')).toBeNull()
      expect(reportPreviewExportFailureMock).not.toHaveBeenCalled()
      expect(reportPreviewExportSuccessMock).not.toHaveBeenCalled()

      // 4. Click again to start second export -> succeeds cleanly!
      await act(async () => {
        getBtn().click()
      })
      expect(exportTimelineToMp4Mock).toHaveBeenCalledTimes(2)
      expect(getBtn().getAttribute('data-export-busy')).toBe('false')
      expect(reportPreviewExportSuccessMock).toHaveBeenCalledTimes(1)
      expect(reportPreviewExportFailureMock).not.toHaveBeenCalled()
      expect(PREVIEW_EXPORT_IDLE.status).toBe('idle')
    } finally {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    }
  })
})
