import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  read: vi.fn(),
  command: vi.fn(),
}))
const logs = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }))

vi.mock('./productionRunApi', () => ({ productionRunApi: api }))
vi.mock('../../desktop/rendererLog', () => ({ logRendererWarn: logs.warn, logRendererError: logs.error }))

import { ProductionCanvasLandingHost } from './ProductionCanvasLandingHost'
import { emitProductionCanvasSignal } from './productionCanvasSignals'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'

const node = (id: string): GenerationCanvasNode => ({
  id,
  kind: 'image',
  title: id,
  position: { x: 0, y: 0 },
  prompt: id,
  categoryId: 'shots',
  meta: { productionRunId: 'run-a', productionShotId: 'shot-a' },
})

function browserContainer(): { container: HTMLElement; restore: () => void } {
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const document = {
    nodeType: 9,
    documentElement: { namespaceURI: 'http://www.w3.org/1999/xhtml' },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    defaultView: null as unknown,
    activeElement: null as unknown,
  }
  class FakeHTMLElement {}
  class FakeHTMLIFrameElement extends FakeHTMLElement {}
  const window = {
    document,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    localStorage: { getItem: () => null },
    setInterval,
    clearInterval,
    HTMLElement: FakeHTMLElement,
    HTMLIFrameElement: FakeHTMLIFrameElement,
  }
  document.defaultView = window
  const container = {
    nodeType: 1,
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: document,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    firstChild: null,
  } as unknown as HTMLElement
  document.activeElement = container
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', document)
  return { container, restore: () => { vi.stubGlobal('window', previousWindow); vi.stubGlobal('document', previousDocument) } }
}

describe('ProductionCanvasLandingHost project-scoped signal routing', () => {
  let root: Root | undefined
  let restoreBrowser: (() => void) | undefined

  beforeEach(() => {
    api.read.mockResolvedValue({ runId: 'run-a', projectId: 'project-a', revision: 1, status: 'running', jobs: [], gates: [] })
    api.command.mockResolvedValue({ run: {}, events: [] })
    logs.warn.mockReset()
    logs.error.mockReset()
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] }, 'project-a')
    const browser = browserContainer()
    restoreBrowser = browser.restore
    root = createRoot(browser.container)
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
    restoreBrowser?.()
  })

  it('keeps a delayed A report on A while B host drops and logs A signals, including B undo/redo', async () => {
    let resolveCommand!: (value: { run: object; events: unknown[] }) => void
    api.command.mockImplementationOnce(() => new Promise((resolve) => { resolveCommand = resolve }))

    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [node('a-node')], edges: [], groups: [] }, 'project-a')
    await act(async () => {
      root!.render(React.createElement(ProductionCanvasLandingHost, { projectId: 'project-a' }))
      await Promise.resolve()
    })

    useGenerationCanvasStore.getState().deleteNode('a-node')
    await Promise.resolve()
    expect(api.read).toHaveBeenCalledWith('project-a', 'run-a')

    useGenerationCanvasStore.setState({ projectId: 'project-b' })
    await act(async () => {
      root!.render(React.createElement(ProductionCanvasLandingHost, { projectId: 'project-b' }))
      await Promise.resolve()
    })
    emitProductionCanvasSignal({ kind: 'detach', projectId: 'project-a', nodes: [node('foreign')] })
    useGenerationCanvasStore.getState().undo()
    useGenerationCanvasStore.getState().redo()
    await Promise.resolve()

    expect(logs.warn).toHaveBeenCalledWith('production-canvas-signal-project-mismatch', expect.objectContaining({ signalProjectId: 'project-a', hostProjectId: 'project-b' }))
    expect(api.command).toHaveBeenCalledTimes(1)
    expect(api.command.mock.calls[0]?.[0]).toBe('project-a')
    expect(api.command.mock.calls.some((call: unknown[]) => call[0] === 'project-b')).toBe(false)

    resolveCommand({ run: {}, events: [] })
    await act(async () => { await Promise.resolve() })
  })
})
