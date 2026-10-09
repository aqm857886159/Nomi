import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => ({ 'generationCommon.shotConversion.firstFrame': '首帧图', 'generationCommon.shotConversion.video': '视频' } as Record<string, string>)[key] ?? key }) }))
import { ShotPreviewOverlays } from './ConvertShotToVideoButton'

describe('shot role label shared by full and lightweight nodes', () => {
  it('distinguishes first frame and video, and carries no shot number (the number only comes from the storyboard)', () => {
    const frame = renderToStaticMarkup(React.createElement(ShotPreviewOverlays, { shotRole: 'first_frame' }))
    const video = renderToStaticMarkup(React.createElement(ShotPreviewOverlays, { shotRole: 'video' }))
    expect(frame).toContain('首帧图')
    expect(video).toContain('视频')
    for (const html of [frame, video]) expect(html).not.toContain('镜头')
  })
  it('renders nothing for a node without a role', () => {
    expect(renderToStaticMarkup(React.createElement(ShotPreviewOverlays, { shotRole: 'image' }))).toBe('')
  })
})
