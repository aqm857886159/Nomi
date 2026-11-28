import { describe, expect, it } from 'vitest'
import type { ModelOption } from '../../../config/models'
import {
  deriveGenerationDefaultMediaKind,
  deriveGenerationDefaultTaskKind,
  nodeHasImageReference,
  resolveDefaultModelOption,
} from './defaultNodeModelSelection'

const option = (value: string, vendor: string, modelKey?: string): ModelOption =>
  ({ value, vendor, modelKey, label: value } as ModelOption)

describe('deriveGenerationDefaultTaskKind & MediaKind', () => {
  it('splits each media kind by whether the card already has a reference', () => {
    const at = (isImageLike: boolean, isVideoLike: boolean, hasImageReference: boolean) =>
      deriveGenerationDefaultTaskKind({ isImageLike, isVideoLike, hasImageReference })

    expect(at(true, false, false)).toBe('text_to_image')
    expect(at(true, false, true)).toBe('image_edit')
    expect(at(false, true, false)).toBe('text_to_video')
    expect(at(false, true, true)).toBe('image_to_video')

    expect(deriveGenerationDefaultMediaKind({ isImageLike: true, isVideoLike: false })).toBe('image')
    expect(deriveGenerationDefaultMediaKind({ isImageLike: false, isVideoLike: true })).toBe('video')
    expect(deriveGenerationDefaultMediaKind({ isImageLike: false, isVideoLike: false })).toBeNull()
  })

  it('judges video before image — a video card that also takes images is not image editing', () => {
    expect(deriveGenerationDefaultTaskKind({ isImageLike: true, isVideoLike: true, hasImageReference: true }))
      .toBe('image_to_video')
  })

  it('returns null for cards outside the four kinds', () => {
    expect(deriveGenerationDefaultTaskKind({ isImageLike: false, isVideoLike: false, hasImageReference: false }))
      .toBeNull()
  })
})

describe('resolveDefaultModelOption', () => {
  const options = [
    option('seedream-4.0', 'kie', 'seedream-4.0'),
    option('seedream-4.0-apimart', 'apimart', 'seedream-4.0'),
  ]

  it('matches both text_to_image and image_edit against the unified image preference on vendor+model', () => {
    const defaults = { image: { vendorKey: 'apimart', modelKey: 'seedream-4.0' } }
    expect(resolveDefaultModelOption(options, defaults, 'text_to_image')?.value).toBe('seedream-4.0-apimart')
    expect(resolveDefaultModelOption(options, defaults, 'image_edit')?.value).toBe('seedream-4.0-apimart')
  })

  it('falls through when the preferred model is unavailable for the active mode (e.g. t2i-only model on edit)', () => {
    expect(resolveDefaultModelOption(
      options,
      { image: { vendorKey: 'apimart', modelKey: 'z-image-turbo' } },
      'image_edit',
    )).toBeUndefined()
  })

  it('falls through when nothing is configured for that kind', () => {
    expect(resolveDefaultModelOption(options, {}, 'text_to_image')).toBeUndefined()
    expect(resolveDefaultModelOption(options, {}, null)).toBeUndefined()
  })

  it('uses value as the model segment when the option carries no modelKey', () => {
    const picked = resolveDefaultModelOption(
      [option('local-workflow', 'comfyui-local')],
      { video: { vendorKey: 'comfyui-local', modelKey: 'local-workflow' } },
      'text_to_video',
    )
    expect(picked?.value).toBe('local-workflow')
  })
})

describe('nodeHasImageReference', () => {
  it('sees references from every slot the canvas actually uses', () => {
    expect(nodeHasImageReference({ referenceImages: ['a.png'] })).toBe(true)
    expect(nodeHasImageReference({ referenceImageUrls: ['b.png'] })).toBe(true)
    expect(nodeHasImageReference({ upstreamResultUrls: ['c.png'] })).toBe(true)
    expect(nodeHasImageReference({ firstFrameUrl: 'd.png' })).toBe(true)
  })

  it('treats empty and blank entries as no reference', () => {
    expect(nodeHasImageReference({})).toBe(false)
    expect(nodeHasImageReference(null)).toBe(false)
    expect(nodeHasImageReference({ referenceImages: [] })).toBe(false)
    expect(nodeHasImageReference({ referenceImages: ['   '] })).toBe(false)
    expect(nodeHasImageReference({ firstFrameUrl: '  ' })).toBe(false)
  })
})
