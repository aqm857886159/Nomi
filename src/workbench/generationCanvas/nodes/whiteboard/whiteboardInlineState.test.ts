import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { createDefaultWhiteboardState, readWhiteboardEditingState, whiteboardDraftIdentity } from './whiteboardState'
import { whiteboardHasVisibleContent, whiteboardRasterStateKey } from './whiteboardRasterState'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { closeWhiteboard, finishWhiteboard, openWhiteboard, registerWhiteboardFinish, useWhiteboardSession, whiteboardSessionLifetime } from './whiteboardSession'

beforeEach(() => {
  useGenerationCanvasStore.setState({ projectId: 'session-test', nodes: ['first', 'second', 'third', 'old-node', 'next-old-node', 'shared-node-id', 'old-first', 'old-next', 'new-first', 'new-next', 'new-third'].map(id => ({ id, kind: 'whiteboard', title: id, prompt: '', position: { x: 0, y: 0 } } as GenerationCanvasNode)) })
})
afterEach(() => { closeWhiteboard(useWhiteboardSession.getState().nodeId ?? '') })
it('selection and labels do not create another raster version; bounds and transforms do', () => {
  const original = createDefaultWhiteboardState()
  const key = whiteboardRasterStateKey(original)
  expect(whiteboardRasterStateKey({ ...original, activeLayerId: 'different', layers: original.layers.map(layer => ({ ...layer, name: 'renamed' })) })).toBe(key)
  expect(whiteboardRasterStateKey({ ...original, canvasDimensions: { width: 1600, height: 900 } })).not.toBe(key)
  expect(whiteboardRasterStateKey({ ...original, sceneTransforms: { offsets: { 'asset:a': { x: 20, y: 0 } }, assetTransforms: {}, flips: {} } })).not.toBe(key)
})
it('Done leaves a picture only when something was drawn or placed: brush paths, images and non-blank text count, eraser paths and blank text do not', () => {
  const empty = createDefaultWhiteboardState()
  const stroke = { id: 's', layerId: 'l', color: '#000', size: 4, path: 'M0 0L1 1' }
  expect(whiteboardHasVisibleContent(empty)).toBe(false)
  expect(whiteboardHasVisibleContent({ ...empty, strokes: [{ ...stroke, tool: 'eraser' as const }] })).toBe(false)
  expect(whiteboardHasVisibleContent({ ...empty, texts: [{ id: 't', layerId: 'l', x: 0, y: 0, width: 10, height: 10, text: '   ', color: '#000', fontSize: 24 }] as never })).toBe(false)
  expect(whiteboardHasVisibleContent({ ...empty, strokes: [{ ...stroke, tool: 'brush' as const }] })).toBe(true)
  expect(whiteboardHasVisibleContent({ ...empty, texts: [{ id: 't', layerId: 'l', x: 0, y: 0, width: 10, height: 10, text: 'Title', color: '#000', fontSize: 24 }] as never })).toBe(true)
  expect(whiteboardHasVisibleContent({ ...empty, canvasAssets: [{ id: 'a', layerId: 'l', name: 'a', url: 'x', source: 'upload', x: 0, y: 0, width: 1, height: 1 }] as never })).toBe(true)
})
it('projects saved while the annotation tool existed open cleanly and keep the stored feedback untouched', () => {
  const state = createDefaultWhiteboardState()
  const legacy = [{ id: 'note-a', resultId: 'version-a', x: 2, y: 4, text: 'Move the lamp' }]
  const node = { id: 'n', kind: 'image', result: { id: 'version-a', type: 'image', url: 'x' }, meta: { whiteboardState: state, whiteboardResultIdentity: 'version-a', whiteboardAnnotations: legacy } } as unknown as GenerationCanvasNode
  expect(readWhiteboardEditingState(node)).toEqual(state)
  expect(whiteboardDraftIdentity(node)).toBe('version-a')
  expect(whiteboardDraftIdentity({ id: 'board', kind: 'whiteboard' } as GenerationCanvasNode)).toBe('board:board')
  expect(node.meta?.whiteboardAnnotations).toBe(legacy)
})
it('retains the current editor after save failure and serializes switching', async () => {
  await openWhiteboard('first')
  const failed = vi.fn(async () => false)
  const releaseFailed = registerWhiteboardFinish(failed)
  await openWhiteboard('second')
  expect(useWhiteboardSession.getState().nodeId).toBe('first')
  releaseFailed()
  let finish!: (value: boolean) => void
  const release = registerWhiteboardFinish(() => new Promise<boolean>(resolve => { finish = resolve }))
  const pending = openWhiteboard('second')
  await openWhiteboard('third')
  expect(useWhiteboardSession.getState().nodeId).toBe('first')
  finish(true)
  await pending
  expect(useWhiteboardSession.getState().nodeId).toBe('second')
  release()
})

it('does not reopen an old project editor when its asynchronous finish completes after project release', async () => {
  await openWhiteboard('old-node')
  let finish!: (value: boolean) => void
  const release = registerWhiteboardFinish(() => new Promise<boolean>(resolve => { finish = resolve }))
  const pending = openWhiteboard('next-old-node')
  whiteboardSessionLifetime.releaseProject!()
  finish(true)
  await pending
  expect(useWhiteboardSession.getState().nodeId).toBeNull()
  release()
})

it('rejects a version action whose asynchronous board finish crosses project release', async () => {
  await openWhiteboard('shared-node-id')
  let finish!: (value: boolean) => void
  const release = registerWhiteboardFinish(() => new Promise<boolean>(resolve => { finish = resolve }))
  const pending = finishWhiteboard('shared-node-id')
  whiteboardSessionLifetime.releaseProject!()
  finish(true)
  expect(await pending).toBe(false)
  release()
})

it('a released project cannot hold or unlock the next project opening lease', async () => {
  await openWhiteboard('old-first')
  let finishOld!: (value: boolean) => void
  const releaseOld = registerWhiteboardFinish(() => new Promise<boolean>(resolve => { finishOld = resolve }))
  const oldPending = openWhiteboard('old-next')
  whiteboardSessionLifetime.releaseProject!()
  await openWhiteboard('new-first')
  expect(useWhiteboardSession.getState().nodeId).toBe('new-first')
  let finishNew!: (value: boolean) => void
  const releaseNew = registerWhiteboardFinish(() => new Promise<boolean>(resolve => { finishNew = resolve }))
  const newPending = openWhiteboard('new-next')
  finishOld(true)
  await oldPending
  await openWhiteboard('new-third')
  expect(useWhiteboardSession.getState().nodeId).toBe('new-first')
  finishNew(true)
  await newPending
  expect(useWhiteboardSession.getState().nodeId).toBe('new-next')
  releaseOld(); releaseNew()
})
