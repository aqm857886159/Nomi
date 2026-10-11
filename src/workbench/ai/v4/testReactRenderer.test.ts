import React, { act } from 'react'
import { expect, it, vi } from 'vitest'
import { createReactTestRenderer } from './testReactRenderer'

it('supports synchronous commits while a lazy component is unresolved', () => {
  const created: Array<{ props: Record<string, unknown> }> = []
  const Pending = React.lazy(() => new Promise<{ default: React.ComponentType }>(() => {}))
  const renderer = createReactTestRenderer({ createInstance: (_type, props) => {
    const node = { props }; created.push(node); return node
  } })
  try {
    renderer.render(React.createElement(React.Suspense, {
      fallback: React.createElement('span', { 'data-state': 'loading' }),
    }, React.createElement(Pending)))
    expect(created.some((node) => node.props['data-state'] === 'loading')).toBe(true)
  } finally {
    renderer.close()
  }
})

it('commits a cold Suspense fallback and reveals the resolved component', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const created: Array<{ props: Record<string, unknown>; hidden?: boolean }> = []
  let resolve!: (value: { default: React.ComponentType }) => void
  const Deferred = React.lazy(() => new Promise<{ default: React.ComponentType }>((done) => { resolve = done }))
  const renderer = createReactTestRenderer({ createInstance: (_type, props) => {
    const node = { props }; created.push(node); return node
  } })
  try {
    await act(async () => renderer.render(React.createElement(React.Suspense, {
      fallback: React.createElement('span', { 'data-state': 'loading' }),
    }, React.createElement(Deferred))))
    expect(created.some((node) => node.props['data-state'] === 'loading' && !node.hidden)).toBe(true)
    expect(created.some((node) => node.props['data-state'] === 'ready')).toBe(false)
    await act(async () => resolve({ default: () => React.createElement('span', { 'data-state': 'ready' }) }))
    expect(created.some((node) => node.props['data-state'] === 'ready' && !node.hidden)).toBe(true)
  } finally {
    await act(async () => renderer.close())
    vi.unstubAllGlobals()
  }
})

it('hides mounted content during suspension and restores the same host after resolution', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const created: Array<{ props: Record<string, unknown>; hidden?: boolean }> = []
  let pending = false
  let resolve!: () => void
  const dependency = new Promise<void>((done) => { resolve = done })
  function Content() {
    if (pending) throw dependency
    return React.createElement('span', { 'data-state': 'content' })
  }
  const tree = () => React.createElement(React.Suspense, {
    fallback: React.createElement('span', { 'data-state': 'loading' }),
  }, React.createElement(Content))
  const renderer = createReactTestRenderer({ createInstance: (_type, props) => {
    const node = { props }; created.push(node); return node
  } })
  try {
    await act(async () => renderer.render(tree()))
    const content = created.find((node) => node.props['data-state'] === 'content')!
    expect(content).toBeDefined()
    pending = true
    await act(async () => renderer.render(tree()))
    expect(content.hidden).toBe(true)
    pending = false
    await act(async () => resolve())
    expect(content.hidden).toBe(false)
    expect(created.filter((node) => node.props['data-state'] === 'content')).toEqual([content])
  } finally {
    await act(async () => renderer.close())
    vi.unstubAllGlobals()
  }
})
