/** Restoring cleanup-close must break both real entrances under React's actual StrictMode replay. */
import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createReactTestRenderer } from '../../../ai/v4/testReactRenderer'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'

const harness = vi.hoisted(() => ({
  controller: new AbortController(), toolbar: null as Record<string, unknown> | null,
  canvas: null as Record<string, unknown> | null, effects: [] as string[],
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../../../i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('../../../../ui/notificationPolicy', () => ({ notify: () => {} }))
vi.mock('../../../project/projectCanvasReadSurface', () => ({ withProjectAction: (run: (project: unknown) => unknown) => {
  const signal = harness.controller.signal
  return run({ signal, assertCurrent() { if (signal.aborted) throw new Error('stale project') } })
} }))
vi.mock('../../adapters/persistNodeImage', () => ({ persistNodeImageFile: async () => 'nomi-local://snapshot' }))
vi.mock('../../adapters/assetImportAdapter', () => ({ isProjectImportCancellation: () => false }))
vi.mock('../../../../lib/removeBackground', () => ({ removeBackgroundBlob: vi.fn(), blobToDataUrl: vi.fn() }))
vi.mock('../localImageOpPhase', () => ({ removeBackgroundFailureMessage: () => '', removeBackgroundProgressMessage: () => '' }))
vi.mock('./WhiteboardLibraryPanel', () => ({ WhiteboardLibraryPanel: () => null }))
vi.mock('./WhiteboardEditingToolbar', () => ({ WhiteboardEditingToolbar: (props: Record<string, unknown>) => { harness.toolbar = props; return null } }))
vi.mock('./WhiteboardLeaferCanvas', async () => {
  const R = await vi.importActual<typeof import('react')>('react')
  return { LeaferCanvas: R.forwardRef(function Canvas(props: Record<string, unknown>, ref) {
    harness.canvas = props
    R.useImperativeHandle(ref, () => ({ getSceneTransforms: () => undefined, measureText: () => ({ width: 10, height: 10 }),
      captureViewportFile: async () => new File(['png'], 'board.png', { type: 'image/png' }),
      handleKeyDown: () => false, flipSelection: () => {}, groupSelection: () => {}, deleteSelection: () => false }))
    return null
  }) }
})
// Layout/menus need a browser; keep both entrance components, the drawing document, InlineWhiteboard and session/store real.
vi.mock('../NodeFloatingToolbar', async () => {
  const R = await vi.importActual<typeof import('react')>('react')
  return { TOOLBAR_ICON: { size: 16, stroke: 1.5 }, FloatingToolbarShell: ({ children }: { children: React.ReactNode }) => children,
    ToolbarIconButton: (props: Record<string, unknown>) => R.createElement('button', { ...props, 'data-action': props.actionId }),
    ToolbarButton: () => null, ToolbarDivider: () => null, ToolbarDuplicateVariantButton: () => null, ToolbarProvenanceButton: () => null }
})
vi.mock('../ToolbarActionMenu', () => ({ ToolbarActionMenu: () => null }))
vi.mock('../GridSplitPicker', () => ({ GridSplitPicker: () => null }))
vi.mock('../useResultDownload', () => ({ useResultDownload: () => ({ downloading: false, download: () => {} }) }))
vi.mock('../deferredNodeMediaQueue', () => ({ useDeferredNodeMediaVisibility: () => ({ ref: () => {}, visible: false }) }))

import WhiteboardCardBody from './WhiteboardCardBody'
import ImageQuickActionsToolbar from '../../quickActions/ImageQuickActionsToolbar'
import InlineWhiteboard from './InlineWhiteboard'
import { NodeEmptyStateContext } from '../render/NodeEmptyStateContext'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { closeWhiteboard, openWhiteboard, useWhiteboardSession, whiteboardSessionLifetime } from './whiteboardSession'
import { createDefaultWhiteboardState } from './whiteboardState'

const board = { id: 'board', kind: 'whiteboard', title: 'Board', prompt: '', position: { x: 0, y: 0 }, size: { width: 320, height: 180 }, meta: {} } as GenerationCanvasNode
const image = { ...board, id: 'image', kind: 'image', result: { id: 'photo', type: 'image', url: 'nomi-local://photo' },
  meta: { whiteboardState: createDefaultWhiteboardState(), whiteboardResultIdentity: 'photo' } } as GenerationCanvasNode
let renderer: ReturnType<typeof createReactTestRenderer> | undefined
const instances: Array<{ props: Record<string, unknown> }> = []
function ReplayWitness() {
  React.useEffect(() => { harness.effects.push('setup'); return () => { harness.effects.push('cleanup') } }, [])
  return null
}
function Journey({ visible = true }: { visible?: boolean }) {
  const nodeId = useWhiteboardSession(s => s.nodeId)
  const node = useGenerationCanvasStore(s => s.nodes.find(n => n.id === nodeId))
  return <><ReplayWitness /><NodeEmptyStateContext.Provider value={{ engaged: true, readOnly: false }}>
    <WhiteboardCardBody node={board} />
  </NodeEmptyStateContext.Provider><ImageQuickActionsToolbar node={image} editGrid={null} imageOpBusy={false}
    reportFeedback={() => {}} onGridSplit={() => {}} onCrop={() => {}} onTransform={() => {}} onPreview={() => {}}
    onOpenProvenance={() => {}} onQuickAction={() => {}} />
    {visible && node ? <InlineWhiteboard key={node.id} nodeId={node.id} sourceKind={node.kind === 'whiteboard' ? 'whiteboard' : 'image'}
      initialState={node.meta?.whiteboardState as ReturnType<typeof createDefaultWhiteboardState> | undefined}
      onClose={() => closeWhiteboard(node.id)} /> : null}</>
}
function mount() {
  renderer = createReactTestRenderer({ createInstance: (_type, props) => { const instance = { props }; instances.push(instance); return instance } })
  render()
}
function render(visible = true) { renderer!.render(<React.StrictMode><Journey visible={visible} /></React.StrictMode>); renderer!.flushPassiveEffects() }
function flush() { renderer!.flushPassiveEffects() }
function clickEntrance(entrance: 'card' | 'toolbar') {
  const props = instances.find(i => entrance === 'card' ? i.props['data-testid'] === 'whiteboard-empty-action' : i.props['data-action'] === 'whiteboard-open')!.props
  ;(props.onClick as (event: unknown) => void)({ defaultPrevented: false, stopPropagation() {} })
  flush()
}
function stroke() {
  ;(harness.canvas!.onStrokeCommit as (stroke: unknown) => void)({ id: 'stroke-one', layerId: 'drawing-layer-1', tool: 'brush', color: '#2563eb', size: 10, path: 'M 0 0 L 100 100' })
  flush()
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  harness.controller = new AbortController(); harness.effects = []; harness.toolbar = null; harness.canvas = null; instances.length = 0
  useGenerationCanvasStore.setState({ projectId: 'project-a', nodes: [board, image], edges: [], selectedNodeIds: [] })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('window', { getComputedStyle: () => ({ width: '320px', height: '180px' }), setTimeout, clearTimeout })
})
afterEach(() => { renderer?.close(); renderer = undefined; whiteboardSessionLifetime.releaseProject!(); vi.useRealTimers(); vi.unstubAllGlobals() })

it.each(['card', 'toolbar'] as const)('characterizes StrictMode self-close through the %s entrance before the repair', entrance => {
  mount(); clickEntrance(entrance)
  expect(harness.effects).toEqual(['setup', 'cleanup', 'setup'])
  expect(useWhiteboardSession.getState().nodeId).toBeNull()
})
it('Done explicitly closes the editor', async () => {
  await openWhiteboard('board'); mount()
  await (harness.toolbar!.onDone as () => void)(); flush()
  expect(useWhiteboardSession.getState().nodeId).toBeNull()
})
it('cancel explicitly closes the editor', async () => {
  await openWhiteboard('board'); mount()
  // onAbort is only displayed for failed initial-image import; exercise the real InlineWhiteboard boundary.
  const host = instances.find(i => i.props['data-nomi-inline-whiteboard'])
  expect(host).toBeDefined()
  closeWhiteboard('board'); flush()
  expect(useWhiteboardSession.getState().nodeId).toBeNull()
})
it('characterizes node deletion leaving an orphan before the repair', async () => {
  await openWhiteboard('board')
  useGenerationCanvasStore.setState({ nodes: [image] })
  expect(useWhiteboardSession.getState().nodeId).toBe('board')
})
it('project release closes even an offscreen editor', async () => {
  await openWhiteboard('board'); whiteboardSessionLifetime.releaseProject!()
  expect(useWhiteboardSession.getState().nodeId).toBeNull()
})
