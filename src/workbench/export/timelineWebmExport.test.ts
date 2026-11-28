// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TimelineClip, TimelineState, TimelineTransition } from '../timeline/timelineTypes'
import { drawTimelineFrame, exportTimelineToWebm } from './timelineWebmExport'

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

describe('exportTimelineToWebm cancellation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('stops MediaRecorder immediately on AbortSignal without auto-downloading partial WebM', async () => {
    let stopHandler: (() => void) | null = null
    const stopSpy = vi.fn(() => { stopHandler?.() })
    const stopTrackSpy = vi.fn()
    class FakeMediaRecorder {
      static isTypeSupported = () => true
      state: 'inactive' | 'recording' = 'inactive'
      mimeType = 'video/webm'
      ondataavailable: ((e: { data: Blob }) => void) | null = null
      onerror: (() => void) | null = null
      set onstop(cb: (() => void) | null) { stopHandler = cb }
      start() { this.state = 'recording' }
      stop() {
        this.state = 'inactive'
        stopSpy()
      }
    }
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    const fakeContext = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: 'center',
      textBaseline: 'middle',
      globalAlpha: 1,
      clearRect: () => undefined,
      fillRect: () => undefined,
      fillText: () => undefined,
      measureText: () => ({ width: 20 }),
      beginPath: () => undefined,
      roundRect: () => undefined,
      moveTo: () => undefined,
      arcTo: () => undefined,
      closePath: () => undefined,
      fill: () => undefined,
      stroke: () => undefined,
      save: () => undefined,
      restore: () => undefined,
      drawImage: () => undefined,
    }
    const createElementOrig = document.createElement.bind(document)
    const anchorClickSpy = vi.fn()
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName === 'canvas') {
        const canvas = createElementOrig('canvas')
        Object.defineProperty(canvas, 'getContext', { value: () => fakeContext })
        Object.defineProperty(canvas, 'captureStream', { value: () => ({ getTracks: () => [{ stop: stopTrackSpy }] }) })
        return canvas
      }
      if (tagName === 'a') {
        const a = createElementOrig('a')
        a.click = anchorClickSpy
        return a
      }
      return createElementOrig(tagName)
    }) as typeof document.createElement)

    const textOnlyTimeline: TimelineState = {
      version: 1,
      fps: 10,
      scale: 1,
      playheadFrame: 0,
      tracks: [],
      textClips: [{ id: 't1', text: 'Hello', style: 'caption', startFrame: 0, endFrame: 50 }],
      transitions: [],
    }
    const controller = new AbortController()
    let seenFrames = 0
    const exportPromise = exportTimelineToWebm({
      timeline: textOnlyTimeline,
      aspectRatio: '16:9',
      autoDownload: true,
      signal: controller.signal,
      onProgress: (p) => {
        if (p.status === 'recording') {
          seenFrames += 1
          if (seenFrames >= 2) controller.abort()
        }
      },
    })

    await expect(exportPromise).rejects.toMatchObject({ name: 'ExportCancelledError' })
    expect(stopSpy).toHaveBeenCalledTimes(1)
    expect(stopTrackSpy).toHaveBeenCalledTimes(1)
    expect(anchorClickSpy).not.toHaveBeenCalled()
  })
})
