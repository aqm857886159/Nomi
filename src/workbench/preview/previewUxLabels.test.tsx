import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { enPreviewSource, zhPreviewSource } from '../../i18n/locales/previewSource'
import { enTimelineEditor, zhTimelineEditor } from '../../i18n/locales/timelineEditor'
import { enTimelinePreview, zhTimelinePreview } from '../../i18n/locales/timelinePreview'
import { PanelRail } from './PanelRail'

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

  it('uses parallel track labels in both languages', () => {
    const labels = (locale: typeof enTimelineEditor | typeof zhTimelineEditor) => [
      locale.track.railImageLabel, locale.track.railVideoLabel, locale.textTrack.title,
      locale.track.railAudioLabel, locale.secondary.caption,
    ]
    expect(labels(zhTimelineEditor)).toEqual(['图片', '视频', '文字', '配乐', '字幕'])
    expect(labels(enTimelineEditor)).toEqual(['Images', 'Videos', 'Text', 'Music', 'Subtitles'])
  })
})
