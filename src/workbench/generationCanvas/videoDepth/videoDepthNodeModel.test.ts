import { describe, expect, it } from 'vitest'
import { formatVideoDepthEta, formatVideoDepthMegabytes, videoDepthProgressView } from './videoDepthNodeModel'
import { initialVideoDepthRunState, nextVideoDepthRunState } from '../../../../electron/shared/canvas/videoDepthRun'

describe('videoDepthProgressView', () => {
  it('reports no percent at all when there is nothing measured yet', () => {
    expect(videoDepthProgressView(initialVideoDepthRunState('j'))).toEqual({ phase: 'idle' })
  })

  it('turns byte progress into a percent during the download phase', () => {
    const state = nextVideoDepthRunState(
      nextVideoDepthRunState(initialVideoDepthRunState('j'), { kind: 'enter', phase: 'downloading' }),
      { kind: 'bytes', doneBytes: 25, totalBytes: 100 },
    )
    expect(videoDepthProgressView(state)).toEqual({ phase: 'downloading', percent: 25 })
  })

  it('carries the eta through only when the run actually measured one', () => {
    const running = nextVideoDepthRunState(initialVideoDepthRunState('j'), { kind: 'enter', phase: 'processing' })
    const measured = nextVideoDepthRunState(running, { kind: 'frames', doneFrames: 5, totalFrames: 20, etaSeconds: 90 })
    const unmeasured = nextVideoDepthRunState(running, { kind: 'frames', doneFrames: 1, totalFrames: 20, etaSeconds: null })
    expect(videoDepthProgressView(measured).etaSeconds).toBe(90)
    expect(videoDepthProgressView(unmeasured).etaSeconds).toBeUndefined()
  })
})

describe('formatVideoDepthEta', () => {
  it('formats as m:ss and never shows a negative countdown', () => {
    expect(formatVideoDepthEta(9)).toBe('0:09')
    expect(formatVideoDepthEta(125)).toBe('2:05')
    expect(formatVideoDepthEta(-3)).toBe('0:00')
  })
})

describe('formatVideoDepthMegabytes', () => {
  it('rounds to whole megabytes — a decimal in a 28px progress bar is noise', () => {
    expect(formatVideoDepthMegabytes(49_642_442)).toBe('47 MB')
    expect(formatVideoDepthMegabytes(0)).toBe('0 MB')
  })
})
