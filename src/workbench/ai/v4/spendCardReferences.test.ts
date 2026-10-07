import { describe, expect, it } from 'vitest'
import { pendingReferenceInputs, referenceInputsFromNode } from './spendCardReferences'
import { placeReferenceInputs } from '../../generationCanvas/model/referenceInputSlots'
import { candidatePatchFromNode } from './spendCardDraft'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import type { PendingSpendShot } from '../../../desktop/productionRunBridgeTypes'
function fixture(modeId: string): { node: GenerationCanvasNode; shot: PendingSpendShot } {
  return { node: { id: 'n', kind: 'video', title: 'fixture', position: { x: 0, y: 0 }, prompt: 'fixture', meta: { modelKey: 'seedance-2', modelVendor: 'fixture', archetype: { id: 'seedance-2', modeId } } },
    shot: { shotId: 's', index: 1, prompt: 'fixture', modelId: 'seedance-2', providerId: 'fixture', kind: 'video', modeId, parameters: {}, price: { known: true, amount: 0 } } }
}
describe('existing canonical references drive candidate preview slots', () => {
  it('preserves canonical identity for first and last frame edits', () => {
    const { node, shot } = fixture('firstlast')
    const referencedShot = { ...shot, references: [
      { assetId: 'first', contentHash: 'one', version: 1, kind: 'image', role: 'first_frame', url: 'nomi-local://asset/p/first.png' },
      { assetId: 'last', contentHash: 'two', version: 2, kind: 'image', role: 'last_frame', url: 'nomi-local://asset/p/last.png' },
    ] } satisfies PendingSpendShot
    const displayed = placeReferenceInputs(node, pendingReferenceInputs(referencedShot))
    expect(displayed.meta).toMatchObject({ firstFrameUrl: 'nomi-local://asset/p/first.png', lastFrameUrl: 'nomi-local://asset/p/last.png' })
    expect(referenceInputsFromNode(displayed, referencedShot)).toEqual(pendingReferenceInputs(referencedShot))
    expect(candidatePatchFromNode(displayed, referencedShot)).toBeUndefined()
  })
  it('keeps image/video/audio slot identities and original order on unrelated text changes', () => {
    const { node, shot } = fixture('omni')
    const referencedShot = { ...shot, references: [
      { assetId: 'audio', contentHash: 'a', version: 1, kind: 'audio', role: 'audio', url: 'nomi-local://asset/p/audio.mp3' },
      { assetId: 'image', contentHash: 'i', version: 2, kind: 'image', role: 'character', url: 'nomi-local://asset/p/image.png' },
      { assetId: 'video', contentHash: 'v', version: 3, kind: 'video', role: 'reference', url: 'nomi-local://asset/p/video.mp4' },
    ] } satisfies PendingSpendShot
    const displayed = placeReferenceInputs(node, pendingReferenceInputs(referencedShot))
    expect(displayed.meta).toMatchObject({ referenceImageUrls: ['nomi-local://asset/p/image.png'], referenceVideoUrls: ['nomi-local://asset/p/video.mp4'], referenceAudioUrls: ['nomi-local://asset/p/audio.mp3'] })
    expect(candidatePatchFromNode({ ...displayed, prompt: 'changed' }, referencedShot)).toEqual({ prompt: 'changed' })
  })
})

it('keeps unsupported first-frame references inactive instead of converting them to generic images', () => {
  const { node, shot } = fixture('omni')
  const referenced: PendingSpendShot = { ...shot, references: [{ assetId: 'f', contentHash: 'h', version: 1, kind: 'image', role: 'first_frame', url: 'nomi-local://asset/frame.png' }] }
  const displayed = placeReferenceInputs(node, pendingReferenceInputs(referenced))
  expect(displayed.meta?.referenceImageUrls ?? []).toEqual([])
  const changed = { ...displayed, meta: { ...displayed.meta, referenceImageUrls: ['nomi-local://asset/new.png'] } }
  expect(referenceInputsFromNode(changed, referenced)).toContainEqual(pendingReferenceInputs(referenced)[0])
})

it('3D-BOX preview mp4 reference: with the asset-derived kind it fills the video slot; without kind it was an image tile (the broken-image card)', () => {
  const { node, shot } = fixture('omni')
  const base = { assetId: 'pre', contentHash: 'h', version: 1, url: 'nomi-local://asset/p/preview.mp4' }
  const withKind = placeReferenceInputs(node, pendingReferenceInputs({ ...shot, references: [{ ...base, kind: 'video' }] }))
  expect(withKind.meta).toMatchObject({ referenceVideoUrls: ['nomi-local://asset/p/preview.mp4'] })
  expect(withKind.meta?.referenceImageUrls ?? []).toEqual([])
  const noKind = placeReferenceInputs(node, pendingReferenceInputs({ ...shot, references: [base] }))
  expect(noKind.meta).toMatchObject({ referenceImageUrls: ['nomi-local://asset/p/preview.mp4'] })
})
