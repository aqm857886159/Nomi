// @vitest-environment jsdom
import fs from 'node:fs'
import path from 'node:path'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import type { ModelOption } from '../../../config/models'
import { useWorkbenchStore } from '../../workbenchStore'
import { reconcileModeSwitchParams } from '../../generationCanvas/agent/plannedNodeMeta'
import type { PlanShot } from '../../generationCanvas/agent/storyboardPlan'
import type { PlanShotPatch } from '../../generationCanvas/agent/storyboardPlanEdits'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import { GENERATION_NODE_KINDS } from '../../generationCanvas/model/generationNodeKinds'
import { createGenerationNode } from '../../generationCanvas/model/graphOps'
import { NodeStageHostContext } from '../../generationCanvas/nodes/nodeStageHostContext'
import ImageCropGridActionBar from '../../generationCanvas/nodes/render/ImageCropGridActionBar'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import {
  cancelCanvasPickMode,
  enterCanvasPickMode,
  isCanvasPickModeActive,
  isCanvasPickReturningToList,
  pickCanvasNode,
} from '../../generationCanvas/store/canvasPickMode'
import { useGenerationViewStore } from './generationViewStore'
import { deriveGenerationList } from './generationListModel'
import { GenerationListDetail } from './GenerationListDetail'
import { GenerationListView } from './GenerationListView'
import ShotComposerBar from '../../creation/storyboard/shotRow/ShotComposerBar'
import { NODE_SURFACE_CONTRACTS } from '../../generationCanvas/nodes/nodeSurfaceContract'
import { switchNodeMainVersion } from '../../generationCanvas/nodes/versionCards/switchNodeMainVersion'
import type { NodeImageEditing } from '../../generationCanvas/nodes/useNodeImageEditing'
import type { ModelParameterControl } from '../../../../electron/shared/videoCapabilities/types'

type CapturedSelect = {
  ariaLabel?: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}

const capturedSelects: CapturedSelect[] = []

vi.mock('../../../design', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../design')>()
  return {
    ...actual,
    NomiSelect: (props: CapturedSelect) => {
      capturedSelects.push(props)
      return React.createElement('div', { 'data-nomi-select': props.ariaLabel ?? '' })
    },
  }
})

async function renderUi(element: React.ReactNode): Promise<string> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  try {
    await act(async () => {
      root.render(React.createElement(MantineProvider, { env: 'test' }, element))
    })
    return container.innerHTML
  } finally {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  }
}

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
}

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
  capturedSelects.length = 0
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
  useGenerationViewStore.setState({ view: 'list', inspectorKey: null })
  cancelCanvasPickMode()
})

describe('Three Generation Surfaces Parity — Goal Contract', () => {
  it('1a. GenerationListParts deletes fake TextPreview & 48-bar AudioStrip, and GenerationListDetail mounts real editable text + real audio/transcript + recoverable dual actions + media toolbars outside ReactFlowProvider', async () => {
    const partsSource = fs.readFileSync(path.join(__dirname, 'GenerationListParts.tsx'), 'utf8')
    expect(partsSource).not.toContain('function TextPreview')
    expect(partsSource).not.toContain('function AudioStrip')
    expect(partsSource).not.toContain('length: 48')

    // 1) Text node in list detail renders real TextDocumentNode shell (not 4-line static clamp)
    const textNode: GenerationCanvasNode = {
      ...createGenerationNode({ id: 'text-1', kind: 'text', title: '分镜梗概' }),
      contentJson: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一场：雨夜便利店门口的对视。' }] }],
      },
    }
    // 2) Audio node with playable URL renders real <audio> + play button + progress slider
    const audioNode: GenerationCanvasNode = {
      ...createGenerationNode({ id: 'audio-1', kind: 'audio', title: '旁白配音' }),
      status: 'success',
      result: { id: 'res-a1', type: 'audio', url: 'https://fixture.invalid/voice.wav', createdAt: 1 },
      meta: { durationSec: 12 },
    }
    // 3) Audio transcript node renders transcript text + copy + SRT subtitle generation button
    const transcriptNode: GenerationCanvasNode = {
      ...createGenerationNode({ id: 'audio-srt', kind: 'audio', title: '对白转写' }),
      status: 'success',
      result: { id: 'res-t1', type: 'text', text: '听见脚步声了吗？就在门外。', createdAt: 2 },
    }
    // 4) Recoverable node renders both retry-retrieval (primary) and release-regenerate (secondary)
    const recoverableNode: GenerationCanvasNode = {
      ...createGenerationNode({ id: 'rec-1', kind: 'video', title: '慢镜头' }),
      status: 'recoverable',
      runs: [{ id: 'run-1', taskId: 'provider-task-9', status: 'running', startedAt: 1, updatedAt: 2 }],
    }
    // 5) Generated image node renders inline stage toolbar (add-to-timeline, duplicateVariant, batch-finalize toggle) on 600px coaxial stage without ReactFlowProvider
    const imageNode: GenerationCanvasNode = {
      ...createGenerationNode({ id: 'img-1', kind: 'image', title: '主视觉' }),
      status: 'success',
      result: { id: 'res-i1', type: 'image', url: 'https://fixture.invalid/shot.png', createdAt: 3 },
      meta: { aspect_ratio: '9:16', imageWidth: 1080, imageHeight: 1920 },
    }

    const nodes = [textNode, audioNode, transcriptNode, recoverableNode, imageNode]
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes, edges: [], groups: [], selectedNodeIds: [] })
    const listModel = deriveGenerationList({
      nodes,
      edges: [],
      groups: [],
      designsByDocumentId: {},
      imageModelOptions: [],
      videoModelOptions: [],
    })
    const cardOf = (id: string) => listModel.sections[0]!.cards.find((card) => card.nodeId === id)!

    const textHtml = await renderUi(React.createElement(GenerationListDetail, { card: cardOf('text-1'), onBack: () => {} }))
    expect(textHtml).toContain(i18n.t('generationCommon.textDocument.label'))
    expect(textHtml).not.toContain('line-clamp-4')

    const audioHtml = await renderUi(React.createElement(GenerationListDetail, { card: cardOf('audio-1'), onBack: () => {} }))
    expect(audioHtml).toContain('<audio')
    expect(audioHtml).toContain(`aria-label="${i18n.t('generationCommon.audio.play')}"`)
    expect(audioHtml).toContain(`aria-label="${i18n.t('generationCommon.audio.progress')}"`)

    const transcriptHtml = await renderUi(React.createElement(GenerationListDetail, { card: cardOf('audio-srt'), onBack: () => {} }))
    expect(transcriptHtml).toContain('听见脚步声了吗？就在门外。')
    expect(transcriptHtml).toContain(i18n.t('generationCommon.audio.copy'))
    expect(transcriptHtml).toContain(i18n.t('generationCommon.audio.generateSubtitle'))

    const recoverableHtml = await renderUi(React.createElement(GenerationListDetail, { card: cardOf('rec-1'), onBack: () => {} }))
    expect(recoverableHtml).toContain(i18n.t('generationCommon.production.runAction.retry-retrieval'))
    expect(recoverableHtml).toContain(i18n.t('generationCommon.observability.action.releaseRegenerate.main'))

    const imageHtml = await renderUi(React.createElement(GenerationListDetail, { card: cardOf('img-1'), onBack: () => {} }))
    expect(imageHtml).toContain('data-toolbar-action="add-to-timeline"')
    expect(imageHtml).toContain('data-toolbar-action="toggle-frozen"')
    expect(imageHtml).toContain(i18n.t('generationCommon.node.duplicateVariant'))
    expect(imageHtml).toContain('max-w-[600px]')
  })

  it('1b. GenerationListView exposes direct node creation and file import in both empty and populated grid states', async () => {
    const emptyHtml = await renderUi(React.createElement(GenerationListView))
    expect(emptyHtml).toContain('data-list-layout="empty"')
    expect(emptyHtml).toContain('data-add-intent="image"')
    expect(emptyHtml).toContain('data-add-intent="text"')
    expect(emptyHtml).toContain('data-add-intent="import-file"')

    const shotNode = createGenerationNode({ id: 'grid-shot-1', kind: 'image', title: '镜 1' })
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [shotNode], edges: [], groups: [], selectedNodeIds: [] })
    const gridHtml = await renderUi(React.createElement(GenerationListView))
    expect(gridHtml).toContain('data-list-layout="grid"')
    expect(gridHtml).toContain('data-list-create-bar')
    expect(gridHtml).toContain('data-add-intent="image"')
    expect(gridHtml).toContain('data-add-intent="import-file"')
  })

  it('2a. switchNodeMainVersion is the single shared command for switching versions (backfills media dimensions and leaves 1 write door to setNodeMainResult)', async () => {
    const detailSource = fs.readFileSync(path.join(__dirname, 'GenerationListDetail.tsx'), 'utf8')
    const hostSource = fs.readFileSync(
      path.join(__dirname, '../../generationCanvas/nodes/versionCards/NodeVersionCardsHost.tsx'),
      'utf8',
    )
    expect(detailSource).not.toContain('setNodeMainResult(')
    expect(hostSource).not.toContain('setNodeMainResult(')

    const v2 = { id: 'v2', type: 'image' as const, url: 'https://fixture.invalid/v2.png', width: 1920, height: 1080, versionNo: 2, createdAt: 20 }
    const v1 = { id: 'v1', type: 'image' as const, url: 'https://fixture.invalid/v1.png', width: 1080, height: 1920, versionNo: 1, createdAt: 10 }
    const node: GenerationCanvasNode = {
      ...createGenerationNode({ id: 'ver-node', kind: 'image' }),
      status: 'success',
      result: v2,
      history: [v2, v1],
      meta: { imageWidth: 1920, imageHeight: 1080, imageAspectRatio: 1920 / 1080 },
    }
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [node], edges: [], groups: [], selectedNodeIds: [] })

    const switched = await switchNodeMainVersion('ver-node', 'v1')
    expect(switched).toBe(true)
    const updated = useGenerationCanvasStore.getState().nodes.find((item) => item.id === 'ver-node')!
    expect(updated.result?.id).toBe('v1')
    expect(updated.meta?.imageWidth).toBe(1080)
    expect(updated.meta?.imageHeight).toBe(1920)
  })

  it('2b. enterCanvasPickMode from list view temporarily switches to canvas, survives list unmount, and restores list + inspectorKey on pick or cancel', () => {
    useGenerationViewStore.setState({ view: 'list', inspectorKey: 'shot-target' })
    const pickedIds: string[] = []
    let cancelled = 0

    const dispose = enterCanvasPickMode({
      eligible: (id) => id === 'ref-source',
      onPick: (id) => pickedIds.push(id),
      onCancel: () => { cancelled += 1 },
    })

    // Immediately switches to visible canvas for picking, while remembering list return state
    expect(useGenerationViewStore.getState().view).toBe('canvas')
    expect(isCanvasPickModeActive()).toBe(true)
    expect(isCanvasPickReturningToList()).toBe(true)

    // Calling the returned unmount cleanup closure during list->canvas unmount keeps the active pick alive!
    dispose()
    expect(isCanvasPickModeActive()).toBe(true)

    // Picking an eligible node completes the pick AND returns to list view with original inspectorKey
    expect(pickCanvasNode('ref-source')).toBe(true)
    expect(pickedIds).toEqual(['ref-source'])
    expect(useGenerationViewStore.getState()).toMatchObject({ view: 'list', inspectorKey: 'shot-target' })
    expect(isCanvasPickReturningToList()).toBe(false)

    // Pressing Esc / cancelling from canvas ALSO returns to list view with original inspectorKey
    enterCanvasPickMode({
      eligible: () => true,
      onPick: () => {},
      onCancel: () => { cancelled += 1 },
    })
    expect(useGenerationViewStore.getState().view).toBe('canvas')
    expect(cancelCanvasPickMode()).toBe(true)
    expect(cancelled).toBe(1)
    expect(useGenerationViewStore.getState()).toMatchObject({ view: 'list', inspectorKey: 'shot-target' })
  })

  it('3a. ShotComposerBar mode switch preserves compatible parameters and drops unknown ones via resolveModelParams instead of wiping params: undefined', async () => {
    const gptImage: ModelOption = {
      value: 'gpt-image-2',
      label: 'GPT Image 2',
      vendor: 'apimart',
      modelKey: 'gpt-image-2',
      kind: 'image',
    } as ModelOption
    const shot: PlanShot = {
      index: 1,
      shotId: 's-1',
      shotKind: 'image',
      durationSec: 3,
      anchorIds: [],
      prompt: '雨夜霓虹街角',
      modelKey: 'gpt-image-2',
      modelVendor: 'apimart',
      modeId: 'i2i',
      params: { resolution: '2K', aspect_ratio: '9:16', stale_mode_only_param: 'drop-me' },
    }
    const patches: PlanShotPatch[] = []
    await renderUi(
      React.createElement(ShotComposerBar, {
        shot,
        modelOptions: [gptImage],
        aspect: '16:9',
        onChangeAspect: () => {},
        onUpdate: (patch) => patches.push(patch),
      }),
    )
    const modeSelect = capturedSelects.find(
      (select) => select.ariaLabel === i18n.t('generationCommon.modeMenu.heading'),
    )
    expect(modeSelect).toBeDefined()
    modeSelect!.onChange('t2i')
    expect(patches).toHaveLength(1)
    expect(patches[0]!.modeId).toBe('t2i')
    expect(patches[0]!.params).toEqual({ resolution: '2K', aspect_ratio: '9:16' })
  })

  it('3b. Exhaustive NODE_SURFACE_CONTRACTS covers every GenerationNodeKind and canvas-only kinds render explicit pointer stage in list-detail', async () => {
    expect(Object.keys(NODE_SURFACE_CONTRACTS).sort()).toEqual([...GENERATION_NODE_KINDS].sort())

    const directorNode = createGenerationNode({ id: 'dir-1', kind: 'director', title: 'fixture-director-stage' })
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [directorNode], edges: [], groups: [], selectedNodeIds: [] })
    const html = await renderUi(
      React.createElement(GenerationListDetail, {
        card: {
          key: 'dir-1',
          nodeId: 'dir-1',
          variant: 'tool',
          storyboardShotNumber: null,
          storyboardScope: null,
          title: 'fixture-director-stage',
          status: null,
          referenceNodeIds: [],
        },
        onBack: () => {},
      }),
    )
    expect(html).toContain('data-node-stage-canvas-only="director"')
    expect(html).toContain(i18n.t('generationList.openInCanvas'))
  })

  it('4a. [B1/B2] ImageCropGridActionBar renders inline in list-detail (never clipped off-viewport) and TextDocumentNode uses flex-col containment for focused formatting toolbar', async () => {
    const fakeEditing: NodeImageEditing = {
      editGrid: { rows: 1, cols: 1 },
      draft: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      imageOpBusy: false,
      openEdit: () => {},
      cancelEdit: () => {},
      reportDraft: () => {},
      handleEditConfirm: async () => {},
      handleImageTransform: async () => {},
      handleRemoveBackground: async () => {},
    }

    const detailBarHtml = await renderUi(
      React.createElement(
        NodeStageHostContext.Provider,
        { value: 'list-detail' },
        React.createElement(ImageCropGridActionBar, { editing: fakeEditing }),
      ),
    )
    expect(detailBarHtml).toContain('data-crop-grid-action-bar="list-detail"')
    expect(detailBarHtml).toContain('mt-2 flex w-full justify-center')
    expect(detailBarHtml).not.toContain('top-[calc(100%+8px)]')

    const canvasBarHtml = await renderUi(
      React.createElement(
        NodeStageHostContext.Provider,
        { value: 'canvas' },
        React.createElement(ImageCropGridActionBar, { editing: fakeEditing }),
      ),
    )
    expect(canvasBarHtml).toContain('data-crop-grid-action-bar="canvas"')
    expect(canvasBarHtml).toContain('top-[calc(100%+8px)]')

    // B2 structural guard: TextDocumentNode wraps inline formatting bar + body card in flex-col with min-h-0 flex-1
    const textDocSource = fs.readFileSync(
      path.join(__dirname, '../../generationCanvas/nodes/render/TextDocumentNode.tsx'),
      'utf8',
    )
    expect(textDocSource).toContain('className="relative flex h-full w-full flex-col"')
    expect(textDocSource).toContain('className="flex min-h-0 w-full flex-1 flex-col overflow-hidden')
  })

  it('4b. [B3] Switching cards in DetailRail remounts GenerationListDetail by nodeId so audio/editing local state never leaks across nodes', async () => {
    const audioA: GenerationCanvasNode = {
      ...createGenerationNode({ id: 'audio-a', kind: 'audio', title: '旁白 A' }),
      status: 'success',
      result: { id: 'res-a', type: 'audio', url: 'https://fixture.invalid/a.wav', createdAt: 1 },
      meta: { durationSec: 10 },
    }
    const audioB: GenerationCanvasNode = {
      ...createGenerationNode({ id: 'audio-b', kind: 'audio', title: '旁白 B' }),
      status: 'success',
      result: { id: 'res-b', type: 'audio', url: 'https://fixture.invalid/b.wav', createdAt: 2 },
      meta: { durationSec: 20 },
    }
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [audioA, audioB], edges: [], groups: [], selectedNodeIds: [] })
    useGenerationViewStore.setState({ view: 'list', inspectorKey: 'audio-a' })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(React.createElement(MantineProvider, { env: 'test' }, React.createElement(GenerationListView)))
      })
      const audioElA = container.querySelector('audio')
      expect(audioElA).not.toBeNull()
      expect(audioElA?.getAttribute('src')).toBe('https://fixture.invalid/a.wav')

      // Switch to audio-b via store (simulating clicking another card in DetailRail)
      await act(async () => {
        useGenerationViewStore.setState({ view: 'list', inspectorKey: 'audio-b' })
      })
      const audioElB = container.querySelector('audio')
      expect(audioElB).not.toBeNull()
      expect(audioElB?.getAttribute('src')).toBe('https://fixture.invalid/b.wav')
      // Previous <audio> DOM node must be unmounted and replaced with a fresh instance (zero cross-node local state leak)
      expect(audioElB).not.toBe(audioElA)
      expect(audioElA?.isConnected).toBe(false)
    } finally {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    }
  })

  it('4c. [N1/N2/N3] reconcileModeSwitchParams rejects unsupported aspect_ratio, canvasPickMode scopes unmount grace & external exits, and switchNodeMainVersion guards stale async races', async () => {
    // N1: unsupported aspect_ratio on a non-aspect_ratio ratio control (size) must NOT be resurrected
    const sizeControls: ModelParameterControl[] = [
      {
        key: 'size',
        label: 'Size',
        type: 'select',
        defaultValue: '1024:1024',
        options: [
          { value: '1024:1024', label: '1:1' },
          { value: '720:1280', label: '9:16' },
        ],
      },
    ]
    const droppedOnly = reconcileModeSwitchParams(sizeControls, { aspect_ratio: '21:9' })
    expect(droppedOnly?.aspect_ratio).toBeUndefined()

    const fallbackFromInvalidSize = reconcileModeSwitchParams(sizeControls, { aspect_ratio: '21:9', size: '999:999' })
    expect(fallbackFromInvalidSize?.aspect_ratio).toBeUndefined()
    expect(fallbackFromInvalidSize?.size).toBe('1024:1024')

    const validResult = reconcileModeSwitchParams(sizeControls, { aspect_ratio: '9:16' })
    expect(validResult).toEqual({ aspect_ratio: '9:16' })

    // N2a: one-shot list unmount grace only absorbs the first unmount cleanup; a second dispose cancels
    useGenerationViewStore.setState({ view: 'list', inspectorKey: 'shot-1' })
    const disposeScoped = enterCanvasPickMode({ eligible: () => true, onPick: () => {} })
    disposeScoped()
    expect(isCanvasPickModeActive()).toBe(true)
    disposeScoped()
    expect(isCanvasPickModeActive()).toBe(false)

    // N2b: resident caller (e.g. ProjectAgentResidentShell) cancels immediately on first dispose even when launched from list
    useGenerationViewStore.setState({ view: 'list', inspectorKey: 'shot-1' })
    const disposeResident = enterCanvasPickMode({ resident: true, eligible: () => true, onPick: () => {} })
    expect(useGenerationViewStore.getState().view).toBe('canvas')
    disposeResident()
    expect(isCanvasPickModeActive()).toBe(false)

    // N2c: manually navigating back to list or leaving generation workspace cancels active pick without trapping view
    let externalCancels = 0
    useGenerationViewStore.setState({ view: 'list', inspectorKey: 'shot-1' })
    enterCanvasPickMode({ eligible: () => true, onPick: () => {}, onCancel: () => { externalCancels += 1 } })
    useGenerationViewStore.getState().setView('list')
    expect(isCanvasPickModeActive()).toBe(false)
    expect(externalCancels).toBe(1)

    useGenerationViewStore.setState({ view: 'canvas', inspectorKey: null })
    useWorkbenchStore.getState().setWorkspaceMode('generation')
    enterCanvasPickMode({ eligible: () => true, onPick: () => {}, onCancel: () => { externalCancels += 1 } })
    useWorkbenchStore.getState().setWorkspaceMode('creation')
    expect(isCanvasPickModeActive()).toBe(false)
    expect(externalCancels).toBe(2)

    // N3: stale slower switchNodeMainVersion request cannot overwrite a newer faster switch on the same node
    const v3 = { id: 'v3', type: 'image' as const, url: 'https://fixture.invalid/v3.png', width: 1024, height: 1024, versionNo: 3, createdAt: 30 }
    const v2 = { id: 'v2', type: 'image' as const, url: 'https://fixture.invalid/v2.png', width: 1920, height: 1080, versionNo: 2, createdAt: 20 }
    const v1 = { id: 'v1', type: 'image' as const, url: 'https://fixture.invalid/v1.png', width: 1080, height: 1920, versionNo: 1, createdAt: 10 }
    const raceNode: GenerationCanvasNode = {
      ...createGenerationNode({ id: 'race-node', kind: 'image' }),
      status: 'success',
      result: v3,
      history: [v3, v2, v1],
    }
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [raceNode], edges: [], groups: [], selectedNodeIds: [] })
    const p1 = switchNodeMainVersion('race-node', 'v1')
    const p2 = switchNodeMainVersion('race-node', 'v2')
    const [ok1, ok2] = await Promise.all([p1, p2])
    expect(ok1).toBe(false)
    expect(ok2).toBe(true)
    expect(useGenerationCanvasStore.getState().nodes.find((item) => item.id === 'race-node')?.result?.id).toBe('v2')
  })
})
