import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import i18n from '../../../i18n'
import { ImageQuickActionsToolbarHost } from './ImageQuickActionsToolbarHost'
vi.mock('./useQuickActionHost', () => ({ useQuickActionHost: () => ({ onQuickAction: vi.fn() }) }))

const first = vi.hoisted(() => ({ props: null as null | { disabled: boolean; label: string; onClick: () => void } }))
vi.mock('../nodes/NodeFloatingToolbar', async (original) => ({
  ...await original<typeof import('../nodes/NodeFloatingToolbar')>(),
  FloatingToolbarShell: ({ children }: { children: React.ReactNode }) => {
    const button = React.Children.toArray(children)[0]
    first.props = React.isValidElement(button) ? button.props as typeof first.props : null
    return null
  },
}))

it('first toolbar button prepares one selected video and first frame in a single undo step', () => {
  const state = () => useGenerationCanvasStore.getState()
  const node = { id: 'still', kind: 'image' as const, title: 'Lighthouse', position: { x: 100, y: 100 },
    result: { id: 'r', type: 'image' as const, url: 'nomi-local://still.png', createdAt: 1 } }
  state().restoreSnapshot({ nodes: [node], edges: [], groups: [] })
  const before = state().readDocumentSnapshot()
  renderToStaticMarkup(<ImageQuickActionsToolbarHost node={node} editGrid={null} imageOpBusy={false}
    reportFeedback={vi.fn()} onGridSplit={vi.fn()} onCrop={vi.fn()} onTransform={vi.fn()}
    onPreview={vi.fn()} onOpenProvenance={vi.fn()} />)
  expect(first.props?.label).toBe(i18n.t('creationAi.selection.video'))
  expect(first.props?.disabled).toBe(false)
  first.props!.onClick()
  const [video] = state().selectedNodeIds
  expect(state().nodes.find(n => n.id === video)).toMatchObject({ kind: 'video', status: 'idle' })
  expect(state().edges).toEqual([expect.objectContaining({ source: node.id, target: video, mode: 'first_frame' })])
  state().undo()
  expect(state().readDocumentSnapshot()).toEqual(before)
})

it.each(['queued', 'running', 'editing'] as const)('disables video creation while %s', status => {
  const node = { id: 'still', kind: 'image' as const, title: '', position: { x: 0, y: 0 },
    status: status === 'editing' ? 'success' as const : status,
    result: { id: 'r', type: 'image' as const, url: 'nomi-local://still.png', createdAt: 1 } }
  renderToStaticMarkup(<ImageQuickActionsToolbarHost node={node} editGrid={null} imageOpBusy={status === 'editing'}
    reportFeedback={vi.fn()} onGridSplit={vi.fn()} onCrop={vi.fn()} onTransform={vi.fn()}
    onPreview={vi.fn()} onOpenProvenance={vi.fn()} />)
  expect(first.props?.disabled).toBe(true)
})
