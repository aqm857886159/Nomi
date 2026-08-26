import { afterEach, describe, expect, it, vi } from 'vitest'
import { isReactFlowCanvasEnabled } from './generationCanvasEngineFlag'

describe('isReactFlowCanvasEnabled', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('is enabled by default in a non-browser environment', () => {
    expect(isReactFlowCanvasEnabled()).toBe(true)
  })

  it('enables the renderer from the Vite environment flag', () => {
    vi.stubEnv('VITE_GENERATION_CANVAS_ENGINE', 'react-flow')
    expect(isReactFlowCanvasEnabled()).toBe(true)
  })

  it('supports the localStorage override without requiring a real DOM', () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: vi.fn(() => 'react-flow') },
    })
    expect(isReactFlowCanvasEnabled()).toBe(true)
  })

  it('falls back to React Flow when localStorage is unavailable or throws', () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: vi.fn(() => { throw new Error('blocked') }) },
    })
    expect(isReactFlowCanvasEnabled()).toBe(true)
  })

  it('allows an explicit legacy fallback', () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: vi.fn(() => 'legacy') },
    })
    expect(isReactFlowCanvasEnabled()).toBe(false)
  })
})
