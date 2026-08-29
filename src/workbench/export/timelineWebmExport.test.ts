import { describe, expect, it } from 'vitest'
import type { TimelineClip, TimelineState, TimelineTransition } from '../timeline/timelineTypes'
import { drawTimelineFrame } from './timelineWebmExport'

type DrawRecord = { source: string; alpha: number }

function clip(id: string, startFrame: number, endFrame: number): TimelineClip {
  return {
    id,
    type: 'image',
    sourceNodeId: `node-${id}`,
    label: id,
    startFrame,
    endFrame,
    frameCount: endFrame - startFrame,
    offsetStartFrame: 0,
    offsetEndFrame: endFrame - startFrame,
    url: `asset://${id}`,
  }
}

function timeline(transition: TimelineTransition): TimelineState {
  return {
    version: 1,
    fps: 30,
    scale: 1,
    playheadFrame: 0,
    tracks: [
      { id: 'imageTrack', type: 'image', label: 'Image', clips: [clip('a', 0, 30), clip('b', 30, 60)] },
      { id: 'videoTrack', type: 'video', label: 'Video', clips: [] },
      { id: 'audioTrack', type: 'audio', label: 'Audio', clips: [] },
    ],
    textClips: [],
    transitions: [transition],
  }
}

function renderFrame(state: TimelineState, frame: number): { fills: string[]; draws: DrawRecord[] } {
  const fills: string[] = []
  const draws: DrawRecord[] = []
  const context = {
    fillStyle: '',
    globalAlpha: 1,
    clearRect: () => undefined,
    fillRect(this: { fillStyle: string }) {
      fills.push(String(this.fillStyle))
    },
    save: () => undefined,
    restore: () => undefined,
    drawImage(this: { globalAlpha: number }, source: { id: string }) {
      draws.push({ source: source.id, alpha: this.globalAlpha })
    },
  } as unknown as CanvasRenderingContext2D
  const image = (id: string) => ({ id, naturalWidth: 1920, naturalHeight: 1080 }) as unknown as HTMLImageElement

  drawTimelineFrame({
    context,
    timeline: state,
    frame,
    size: { width: 320, height: 180 },
    background: '#ffffff',
    assets: {
      images: new Map([
        ['asset://a', image('a')],
        ['asset://b', image('b')],
      ]),
      videos: new Map(),
    },
  })

  return { fills, draws }
}

describe('drawTimelineFrame transition parity', () => {
  it('composites the held outgoing frame and incoming frame for dissolve', () => {
    const rendered = renderFrame(timeline({ fromClipId: 'a', toClipId: 'b', type: 'dissolve', durationFrames: 10 }), 35)

    expect(rendered.fills).toEqual(['#ffffff', '#ffffff'])
    expect(rendered.draws).toEqual([
      { source: 'a', alpha: 1 },
      { source: 'b', alpha: 0.5 },
    ])
  })

  it('renders the black midpoint for fade-through-black', () => {
    const rendered = renderFrame(timeline({ fromClipId: 'a', toClipId: 'b', type: 'fade', durationFrames: 10 }), 35)

    expect(rendered.fills).toEqual(['#ffffff', '#000000'])
    expect(rendered.draws).toEqual([])
  })

  it('keeps unsupported authored transitions as hard cuts', () => {
    const rendered = renderFrame(
      timeline({ fromClipId: 'a', toClipId: 'b', type: 'match_cut', durationFrames: 10 }),
      35,
    )

    expect(rendered.fills).toEqual(['#ffffff'])
    expect(rendered.draws).toEqual([{ source: 'b', alpha: 1 }])
  })
})
