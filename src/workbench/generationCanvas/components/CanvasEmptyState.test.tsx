// 空画布：「+ 新建图片」换成一排任务卡，种类 = 左缘工具条常驻那几样（同一张意图表，不新增种类）。
import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CANVAS_MENU_PREFERENCE_SETTINGS } from '../../../../electron/shared/contracts/canvasMenuPreference'
import { createReactTestRenderer } from '../../ai/v4/testReactRenderer'
import { GenerationCanvasReactFlowOverlays } from '../reactFlow/GenerationCanvasReactFlowOverlays'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useCanvasMenuPreferenceStore } from '../store/canvasMenuPreferenceStore'
import { CanvasEmptyState } from './CanvasEmptyState'
import { canvasResidentAddIntents, resolveCanvasCreationSurface } from './canvasToolbarModel'

vi.mock('react-i18next', () => ({ initReactI18next: { type: '3rdParty', init: () => {} }, useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('./SelectionPromptSaveController', () => ({ SelectionPromptSaveController: () => null }))
vi.mock('../../../design/tooltip', () => {
  const pass = ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children)
  return { TooltipProvider: pass, Tooltip: pass, TooltipTrigger: pass, TooltipContent: () => null }
})

afterEach(() => {
  vi.restoreAllMocks()
  useCanvasMenuPreferenceStore.setState({ preference: DEFAULT_CANVAS_MENU_PREFERENCE_SETTINGS })
})

const html = (readOnly = false) =>
  renderToStaticMarkup(
    React.createElement(CanvasEmptyState, {
      activeCategoryId: 'shots',
      getInsertionPosition: () => ({ x: 0, y: 0 }),
      ...(readOnly ? { readOnly: true } : {}),
    } as React.ComponentProps<typeof CanvasEmptyState>),
  )

describe('empty canvas task cards & toolbar exclusivity', () => {
  it('lists exactly the resident toolbar intents in toolbar order and exposes matching data-node-kind attributes', () => {
    const out = html()
    const intents = canvasResidentAddIntents()
    const shown = [...out.matchAll(/data-add-intent="([^"]+)"/g)].map((match) => match[1])
    expect(shown).toEqual(intents.map((intent) => intent.id))
    const kinds = [...out.matchAll(/data-node-kind="([^"]+)"/g)].map((match) => match[1])
    expect(kinds).toEqual(intents.flatMap((intent) => (intent.kind ? [intent.kind] : [])))
  })

  it('ends with a 「更多」 tile that opens the same menu as the toolbar 「+」, and says files can be dropped in', () => {
    const out = html()
    expect(out).toContain('data-canvas-add-more="true"')
    expect(out).toContain('aria-haspopup="menu"')
    expect(out).toContain('generationCommon.canvas.empty.dropHint')
  })

  it('hides interactive starter tiles and drop hint when canvas is readOnly', () => {
    const out = html(true)
    expect(out).toContain('generationCommon.canvas.empty.title')
    expect(out).not.toContain('data-empty-canvas-tasks="true"')
    expect(out).not.toContain('generationCommon.canvas.empty.dropHint')
  })

  it('enforces strict mutual exclusion between empty-canvas starter tiles and bottom CanvasToolbar', () => {
    expect(resolveCanvasCreationSurface({ readOnly: false, nodeCount: 0 })).toBe('empty-starter')
    expect(resolveCanvasCreationSurface({ readOnly: false, nodeCount: 1 })).toBe('toolbar')
    expect(resolveCanvasCreationSurface({ readOnly: false, nodeCount: 12 })).toBe('toolbar')
    expect(resolveCanvasCreationSurface({ readOnly: true, nodeCount: 0 })).toBe('none')
    expect(resolveCanvasCreationSurface({ readOnly: true, nodeCount: 3 })).toBe('none')

    const stageSource = fs.readFileSync(new URL('../reactFlow/GenerationCanvasReactFlow.tsx', import.meta.url), 'utf8')
    const overlaysSource = fs.readFileSync(new URL('../reactFlow/GenerationCanvasReactFlowOverlays.tsx', import.meta.url), 'utf8')
    expect(stageSource).not.toContain('CanvasToolbar')
    expect(overlaysSource).toContain("resolveCanvasCreationSurface({ readOnly, nodeCount: nodes.length }) === 'toolbar'")
    expect(overlaysSource).toContain('readOnly={readOnly}')
  })

  it('no longer shows the instruction sentence or the single 「+ 新建」 button', () => {
    const out = html()
    expect(out).not.toContain('generationCommon.canvas.empty.description')
    expect(out).not.toContain('generationCommon.canvas.empty.create')
  })

  it('loads persisted canvasMenuPreference on 0-node empty canvas without re-fetching on 0→1 node transition or in readOnly mode', async () => {
    const toolbarSource = fs.readFileSync(new URL('./CanvasToolbar.tsx', import.meta.url), 'utf8')
    expect(toolbarSource).not.toContain('.getState().load()')

    const customOrder = ['video', 'image', 'audio', 'text', 'import-file'] as const
    const loadSpy = vi.spyOn(useCanvasMenuPreferenceStore.getState(), 'load').mockImplementation(async () => {
      useCanvasMenuPreferenceStore.setState({
        preference: {
          schemaVersion: 1,
          hiddenIntentIds: ['clip'],
          orderedIntentIds: [...customOrder],
        },
      })
    })

    const baseOverlayProps: React.ComponentProps<typeof GenerationCanvasReactFlowOverlays> = {
      readOnly: false,
      activeCategoryId: 'shots',
      nodes: [],
      allNodes: [],
      screenshotOverlay: null,
      contextNodeMenu: null,
      connectionCreateMenu: null,
      onCloseConnectionCreateMenu: () => undefined,
      onAddInputFromAssets: () => undefined,
      onAddInputPickOnCanvas: () => undefined,
      assetInputPicker: null,
      onCloseAssetInputPicker: () => undefined,
      getInsertionPosition: () => ({ x: 0, y: 0 }),
      onNodeContextAction: () => undefined,
      onCloseContextNodeMenu: () => undefined,
      onAddContextNode: () => undefined,
      onImportContextFiles: () => undefined,
      onAddConnectedNode: () => undefined,
      hasBatchPlanPreview: false,
      zoom: 1,
      zoomPercent: 100,
      offset: { x: 0, y: 0 },
      stageSize: { width: 1000, height: 800 },
      minimapVisible: false,
      onToggleMinimap: () => undefined,
      onJumpToCanvasPoint: () => undefined,
      onFitView: () => undefined,
      onResetView: () => undefined,
      onTidy: () => undefined,
      onZoomTo: () => undefined,
      frameMenu: null,
      onFrameMenuAction: () => undefined,
      frameToolArmed: false,
      onToggleFrameTool: () => undefined,
      arrivalHint: null,
      onGoToArrivals: () => undefined,
    }

    let createdAddIntents: string[] = []
    const makeHostRenderer = () => createReactTestRenderer({
      createInstance: (type, props) => {
        if (typeof props['data-add-intent'] === 'string') {
          createdAddIntents.push(props['data-add-intent'])
        }
        return { type, props, closest: () => null }
      },
    })

    // 1) readOnly=true on 0-node canvas skips preference loading
    const readOnlyRenderer = makeHostRenderer()
    try {
      readOnlyRenderer.render(React.createElement(GenerationCanvasReactFlowOverlays, { ...baseOverlayProps, readOnly: true }))
      readOnlyRenderer.flushPassiveEffects()
      expect(loadSpy).not.toHaveBeenCalled()
    } finally {
      readOnlyRenderer.close()
    }

    // 2) readOnly=false on 0-node empty canvas immediately triggers load() once, and 0→1 transition does not re-fetch
    const renderer = makeHostRenderer()
    try {
      renderer.render(React.createElement(GenerationCanvasReactFlowOverlays, baseOverlayProps))
      createdAddIntents = []
      renderer.flushPassiveEffects()
      await Promise.resolve()
      renderer.flushPassiveEffects()
      expect(loadSpy).toHaveBeenCalledTimes(1)
      expect(useCanvasMenuPreferenceStore.getState().preference).toEqual({
        schemaVersion: 1,
        hiddenIntentIds: ['clip'],
        orderedIntentIds: [...customOrder],
      })

      // Fresh client mount of CanvasEmptyState reflects the loaded custom order & hidden intents
      createdAddIntents = []
      const emptyProbe = makeHostRenderer()
      try {
        emptyProbe.render(React.createElement(CanvasEmptyState, {
          activeCategoryId: 'shots',
          getInsertionPosition: () => ({ x: 0, y: 0 }),
        }))
        expect(createdAddIntents).toEqual([...customOrder])
      } finally {
        emptyProbe.close()
      }

      // Transition 0 -> 1 node mounts CanvasToolbar immediately with the loaded preference and zero second load()
      const firstNode = {
        id: 'node-1',
        kind: 'image',
        title: 'Shot 1',
        prompt: '',
        categoryId: 'shots',
        references: [],
        runs: [],
        status: 'idle',
        position: { x: 100, y: 100 },
        size: { width: 320, height: 180 },
      } as unknown as GenerationCanvasNode
      createdAddIntents = []
      renderer.render(React.createElement(GenerationCanvasReactFlowOverlays, { ...baseOverlayProps, nodes: [firstNode], allNodes: [firstNode] }))
      renderer.flushPassiveEffects()
      expect(loadSpy).toHaveBeenCalledTimes(1)
      expect(createdAddIntents).toEqual([...customOrder])
    } finally {
      renderer.close()
    }
  })
})
