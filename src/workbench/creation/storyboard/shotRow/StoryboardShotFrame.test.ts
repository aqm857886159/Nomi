import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode } from '../../../generationCanvas/model/generationCanvasTypes'
import type { PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import { deriveShotRowExec, type ShotRowStatus } from '../exec/storyboardRowStatus'
import StoryboardShotFrame from './StoryboardShotFrame'

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}))
// The tested boundary is the real frame's decoder selection. Actual decoder lifecycle
// is covered by deferredNodeMediaQueue; browser decoding is checked in the Electron walk.
vi.mock('../../../../design/media', () => ({
  NomiImage: ({ src }: { src: string }) => React.createElement('img', { src, alt: '' }),
}))
vi.mock('../../../generationCanvas/nodes/DeferredNodeMedia', () => ({
  DeferredNodeVideo: ({ src, ...props }: React.VideoHTMLAttributes<HTMLVideoElement>) => React.createElement('video', { src, ...props }),
}))

const shot: PlanShot = { index: 1, shotId: 'shot-1', durationSec: 5, anchorIds: [], prompt: 'fixture' }
const videoUrl = 'nomi-local://asset/projects/fixture/assets/shot-1.mp4'
function frame(input: { type: 'image' | 'video'; url: string; thumbnailUrl?: string; status?: ShotRowStatus }): string {
  const node: GenerationCanvasNode = {
    id: 'node-1', kind: 'video', title: '', position: { x: 0, y: 0 }, status: 'success',
    meta: { storyboardDesignId: 'design-1', shotId: 'shot-1' },
    result: { id: 'result-1', type: input.type, url: input.url, thumbnailUrl: input.thumbnailUrl, createdAt: 1 },
  }
  const exec = deriveShotRowExec({ plan: { title: 'fixture', anchors: [], shots: [shot] }, shot, designId: 'design-1', nodes: [node], mode: null })
  if (input.status) exec.status = input.status
  return renderToStaticMarkup(React.createElement(StoryboardShotFrame, { shot, exec, aspect: '16:9', box: { width: 136, height: 77 } }))
}

describe('storyboard frame media decoder boundary', () => {
  it('gate-r2: completed persisted MP4 without thumbnail uses the managed video decoder', () => {
    const html = frame({ type: 'video', url: videoUrl })
    expect(html).toContain('<video')
    expect(html).toContain(`src="${videoUrl}"`)
    expect(html).not.toContain('<img')
    expect(html).toContain('preload="auto"')
    expect(html).not.toContain('autoPlay')
  })

  it.each(['done', 'locked', 'generating', 'failed'] as const)('%s never sends an existing video result to an image decoder', (status) => {
    const html = frame({ type: 'video', url: 'https://media.example.test/opaque-result', status })
    expect(html).toContain('<video')
    expect(html).not.toContain('<img')
  })

  it.each(['done', 'locked', 'generating', 'failed'] as const)('%s preserves thumbnail-first image decoding', (status) => {
    const html = frame({ type: 'video', url: videoUrl, thumbnailUrl: 'nomi-local://asset/thumbnail.jpg', status })
    expect(html).toContain('<img src="nomi-local://asset/thumbnail.jpg"')
    expect(html).not.toContain('<video')
    expect(html).not.toContain(videoUrl)
  })

  it('uses result media type even when the planned node kind is video', () => {
    const html = frame({ type: 'image', url: 'nomi-local://asset/frame.png' })
    expect(html).toContain('<img src="nomi-local://asset/frame.png"')
    expect(html).not.toContain('<video')
  })
})
