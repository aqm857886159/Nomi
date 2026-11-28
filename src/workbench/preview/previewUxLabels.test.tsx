import React from 'react'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { enPreviewSource, zhPreviewSource } from '../../i18n/locales/previewSource'
import { enTimelineEditor, zhTimelineEditor } from '../../i18n/locales/timelineEditor'
import { enTimelinePreview, zhTimelinePreview } from '../../i18n/locales/timelinePreview'
import type { TimelineState } from '../timeline/timelineTypes'
import { PanelRail } from './PanelRail'
import PreviewInspector from './inspector/PreviewInspector'

const mockState = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'zh',
  previewAspectRatio: '16:9' as const,
  previewAspect: { ratio: '16:9' as const, source: 'default' as const },
  selectedTimelineClipIds: ['clip-video'] as string[],
  selectedTextClipId: null as string | null,
  exportResolution: '1080p' as const,
  exportQuality: 'standard' as const,
  setPreviewAspectRatio: vi.fn(),
  setTimelineClipFraming: vi.fn(),
  setTimelineClipAudio: vi.fn(),
  setExportResolution: vi.fn(),
  setExportQuality: vi.fn(),
  setTimelineTransition: vi.fn(),
}))

function lookupTranslation(key: string): string {
  const root = mockState.locale === 'en' ? { timelinePreview: enTimelinePreview } : { timelinePreview: zhTimelinePreview }
  let current: unknown = root
  for (const part of key.split('.')) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part]
    } else {
      return key
    }
  }
  return typeof current === 'string' ? current : key
}

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => lookupTranslation(key), i18n: { language: mockState.locale } }),
}))

vi.mock('../workbenchStore', () => ({
  useWorkbenchStore: Object.assign((select: (snapshot: typeof mockState) => unknown) => select(mockState), {
    getState: () => mockState,
    subscribe: () => () => {},
  }),
}))

const SAMPLE_TIMELINE: TimelineState = {
  version: 1,
  fps: 30,
  scale: 1,
  playheadFrame: 0,
  tracks: [
    {
      id: 'videoTrack',
      type: 'video',
      label: 'video',
      clips: [
        {
          id: 'clip-video',
          type: 'video',
          sourceNodeId: 'node-1',
          label: 'Shot 1',
          startFrame: 0,
          endFrame: 120,
          frameCount: 180,
          offsetStartFrame: 0,
          offsetEndFrame: 0,
          audio: { gainDb: -6, muted: false, fadeInFrames: 15, fadeOutFrames: 30 },
        },
      ],
    },
  ],
  textClips: [],
  transitions: [],
}

function renderInspector(collapsed: boolean, locale: 'en' | 'zh' = 'en'): string {
  mockState.locale = locale
  return renderToStaticMarkup(
    <MantineProvider>
      <PreviewInspector timeline={SAMPLE_TIMELINE} collapsed={collapsed} onExpand={() => {}} onCollapse={() => {}} />
    </MantineProvider>,
  )
}

describe('preview and timeline copy', () => {
  it('points to both paths for adding a shot', () => {
    expect(zhTimelinePreview.emptyHint).toMatch(/点左侧镜头.*拖入轨道/)
    expect(enTimelinePreview.emptyHint).toMatch(/Click a shot on the left .* drag onto a track/)
  })

  it('gives the collapsed clip library a distinct label and fits Latin text upright', () => {
    expect(zhPreviewSource.railLabel).toBe('片库')
    expect(enPreviewSource.railLabel).toBe('Clips')
    const rail = renderToStaticMarkup(<PanelRail icon={null} label={enPreviewSource.railLabel} title={enPreviewSource.expand} horizontalLabel onClick={() => {}} />)
    expect(rail).toContain('>Clips</span>')
    expect(rail).not.toContain('vertical-rl')
  })

  it('defaults PanelRail to upright horizontal text even when horizontalLabel is omitted', () => {
    const rail = renderToStaticMarkup(<PanelRail icon={null} label="Props" title="Expand panel" onClick={() => {}} />)
    expect(rail).toContain('>Props</span>')
    expect(rail).not.toContain('vertical-rl')
  })

  it('gives the collapsed inspector upright short labels and keeps full expand aria-labels', () => {
    expect(zhTimelinePreview.previewInspector.railLabel).toBe('属性')
    expect(enTimelinePreview.previewInspector.railLabel).toBe('Props')
    const enRail = renderInspector(true, 'en')
    expect(enRail).toContain(`>${enTimelinePreview.previewInspector.railLabel}</span>`)
    expect(enRail).toContain(`aria-label="${enTimelinePreview.previewInspector.expand}"`)
    expect(enRail).toContain(`title="${enTimelinePreview.previewInspector.expand}"`)
    expect(enRail).not.toContain('vertical-rl')
    const zhRail = renderInspector(true, 'zh')
    expect(zhRail).toContain(`>${zhTimelinePreview.previewInspector.railLabel}</span>`)
    expect(zhRail).toContain(`aria-label="${zhTimelinePreview.previewInspector.expand}"`)
    expect(zhRail).not.toContain('vertical-rl')
  })

  it('uses clear Chinese framing copy instead of the mistranslated fit label', () => {
    expect(zhTimelinePreview.previewInspector.fit).toMatch(/^画面.*填充$/)
    expect(zhTimelinePreview.previewInspector.fit).toHaveLength(4)
    expect(zhTimelinePreview.previewInspector.fit).not.toContain('分段')
    expect(enTimelinePreview.previewInspector.fit).toBe('Fit')
    const zhExpanded = renderInspector(false, 'zh')
    expect(zhExpanded).toContain(zhTimelinePreview.previewInspector.fit)
    expect(zhExpanded).not.toContain('画面分段')
  })

  it('renders clip framing and audio controls with design system primitives and zero bare native inputs', () => {
    const html = renderInspector(false, 'en')
    const copy = enTimelinePreview.previewInspector
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain(`aria-label="${copy.fit}"`)
    expect(html).toContain('mantine-Switch-root')
    expect(html).toContain(`aria-label="${copy.muted}"`)
    expect(html).toContain('mantine-NumberInput-root')
    expect(html).toContain(`aria-label="${copy.volumeDbInput}"`)
    expect(html).toContain(`aria-label="${copy.fadeIn}"`)
    expect(html).toContain(`aria-label="${copy.fadeOut}"`)
    expect(html).not.toMatch(/<input\b[^>]*type="number"/)
    expect(html).not.toMatch(/<label\b[^>]*>(?:(?!<\/label>).)*<label\b/s)
  })

  it('uses parallel track labels in both languages', () => {
    const labels = (locale: typeof enTimelineEditor | typeof zhTimelineEditor) => [
      locale.track.railImageLabel, locale.track.railVideoLabel, locale.textTrack.title,
      locale.track.railAudioLabel, locale.secondary.caption,
    ]
    expect(labels(zhTimelineEditor)).toEqual(['图片', '视频', '文字', '配乐', '字幕'])
    expect(labels(enTimelineEditor)).toEqual(['Images', 'Videos', 'Text', 'Music', 'Subtitles'])
  })
})
