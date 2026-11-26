import { afterEach, describe, expect, it, vi } from 'vitest'
import { reducedMotionQuery } from '../../../design/motion'
import { readProcessMotionCapability, shouldReduceProcessMotion } from './processMotionCapability'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useReducedProcessMotion } from './useReducedProcessMotion'

afterEach(() => vi.unstubAllGlobals())

function mockContext(context: unknown) {
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) })
}

describe('process motion renderer admission', () => {
  it.each([false, true])('releases a probe context even when renderer reading fails=%s', (fails) => {
    const loseContext = vi.fn()
    mockContext({
      getExtension: (name: string) => name === 'WEBGL_lose_context' ? { loseContext } : { UNMASKED_RENDERER_WEBGL: 0x9246 },
      getParameter: () => { if (fails) throw new Error('read failed'); return 'Apple M2' },
    })
    expect(readProcessMotionCapability().renderer).toBe(fails ? null : 'Apple M2')
    expect(loseContext).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('reads the live preference %s in a standalone browser realm', reduced => {
    vi.stubGlobal('window', { matchMedia: (query: string) => ({ matches: reduced && query === '(prefers-reduced-motion: reduce)' }) })
    const loseContext = vi.fn()
    mockContext({ getExtension: (name: string) => name === 'WEBGL_lose_context' ? { loseContext } : null })
    const serializedReader = new Function(`return (${readProcessMotionCapability.toString()})()`) as () => ReturnType<typeof readProcessMotionCapability>
    expect(serializedReader()).toEqual({ renderer: '', prefersReducedMotion: reduced })
    expect(loseContext).toHaveBeenCalledTimes(1)
  })

  it('reads the live media query without allocating a renderer probe', () => {
    const query = { matches: true }
    const createElement = vi.fn()
    vi.stubGlobal('window', { matchMedia: () => query })
    vi.stubGlobal('document', { createElement })
    expect(reducedMotionQuery()).toBe(query)
    expect(createElement).not.toHaveBeenCalled()
  })

  it('keeps a valid capability if the browser cannot release the temporary context', () => {
    mockContext({
      getExtension: (name: string) => {
        if (name === 'WEBGL_lose_context') throw new Error('extension unavailable')
        return { UNMASKED_RENDERER_WEBGL: 0x9246 }
      },
      getParameter: () => 'Hardware renderer',
    })
    expect(readProcessMotionCapability().renderer).toBe('Hardware renderer')
  })

  it('caches unavailable WebGL per document without repeated failing probes', () => {
    const getContext = vi.fn(() => null)
    vi.stubGlobal('document', { createElement: () => ({ getContext }) })
    function Consumer() { return React.createElement('span', null, String(useReducedProcessMotion())) }
    for (let index = 0; index < 3; index++) expect(renderToStaticMarkup(React.createElement(Consumer))).toContain('true')
    expect(getContext).toHaveBeenCalledTimes(1)
    vi.stubGlobal('document', { createElement: () => ({ getContext }) })
    renderToStaticMarkup(React.createElement(Consumer))
    expect(getContext).toHaveBeenCalledTimes(2)
  })

  it('shares renderer discovery across mounted consumers while reading the current preference', () => {
    const getContext = vi.fn(() => ({ getExtension: () => null }))
    let reduced = false
    vi.stubGlobal('document', { createElement: () => ({ getContext }) })
    vi.stubGlobal('window', { matchMedia: () => ({ matches: reduced }) })
    function Consumer() { return React.createElement('span', null, String(useReducedProcessMotion())) }
    expect(renderToStaticMarkup(React.createElement(React.Fragment, null,
      ...Array.from({ length: 8 }, (_, key) => React.createElement(Consumer, { key }))))).toContain('false')
    reduced = true
    expect(renderToStaticMarkup(React.createElement(Consumer))).toContain('true')
    expect(getContext).toHaveBeenCalledTimes(1)
  })
  it.each([
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device ...))', true],
    ['llvmpipe (LLVM 15.0.7, 256 bits)', true],
    ['Apple M2', false],
  ])('classifies %s without starting an effect', (renderer, reduced) => {
    mockContext({
      getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 0x9246 }),
      getParameter: () => renderer,
    } as unknown as WebGLRenderingContext)
    expect(shouldReduceProcessMotion(readProcessMotionCapability())).toBe(reduced)
  })

  it('uses the static surface when no WebGL context exists', () => {
    mockContext(null)
    expect(shouldReduceProcessMotion(readProcessMotionCapability())).toBe(true)
  })

  it('uses the static surface when context creation throws', () => {
    vi.stubGlobal('document', { createElement: () => { throw new Error('context unavailable') } })
    expect(shouldReduceProcessMotion(readProcessMotionCapability())).toBe(true)
  })
})

// Accessibility preference and renderer are independent inputs at the shared boundary.
describe('pure process motion policy', () => {
  it.each([
    ['SwiftShader', false, true], ['llvmpipe', false, true], ['Software Rasterizer', false, true],
    [null, false, true], ['Apple M2', false, false], ['Apple M2', true, true], ['', false, false],
  ] as const)('renderer=%s reducedPreference=%s', (renderer, prefersReducedMotion, expected) => {
    expect(shouldReduceProcessMotion({ renderer, prefersReducedMotion })).toBe(expected)
  })
})
