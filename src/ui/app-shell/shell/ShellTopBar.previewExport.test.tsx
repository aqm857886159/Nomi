import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultTimeline } from '../../../workbench/timeline/timelineMath'
import type { TimelineState } from '../../../workbench/timeline/timelineTypes'
import { ShellTopBar } from './ShellTopBar'

vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('../../../workbench/taskCenter/TaskCenterButton', () => ({ TaskCenterButton: () => null }))
vi.mock('../../../workbench/preview/EditingLayoutMenu', () => ({ default: () => null }))

const state = vi.hoisted(() => ({
  timeline: { version: 1, fps: 30, scale: 1, playheadFrame: 0, tracks: [], textClips: [] } as TimelineState,
  exportResolution: '1080p',
}))
vi.mock('../../../workbench/workbenchStore', () => ({
  useWorkbenchStore: Object.assign((select: (snapshot: typeof state) => unknown) => select(state), {
    getState: () => state,
    subscribe: () => () => {},
  }),
}))

function exportMarkup() {
  const html = renderToStaticMarkup(<ShellTopBar workspaceMode="preview" />)
  return html.match(/<button\b[^>]*data-shell-export="true"[^>]*>/)?.[0]
}

describe('top-bar MP4 export availability', () => {
  beforeEach(() => { state.timeline = createDefaultTimeline() })

  it('disables native click on an empty timeline', () => {
    const button = exportMarkup()
    expect(button).toContain('disabled=""')
    expect(button).toContain('aria-label="timelinePreview.exportMp4"')
  })

  it('enables export for text-only content with positive duration', () => {
    state.timeline.textClips.push({ id: 'title', text: 'Title', style: 'title', startFrame: 0, endFrame: 30 })
    const button = exportMarkup()
    expect(button).toContain('aria-label="timelinePreview.exportMp4"')
    expect(button).not.toContain(' disabled=""')
  })
})
