import { describe, expect, it } from 'vitest'
import type { DedupedModel } from './modelIdentity'
import { modelIdentityIcon, providerIdentityIcon } from './modelProviderIdentity'

function model(archetypeId?: string, label = 'Custom Model'): DedupedModel {
  return {
    canonicalId: label.toLowerCase().replaceAll(' ', '-'),
    label,
    recognized: Boolean(archetypeId),
    providers: [{
      vendor: 'custom-provider',
      modelKey: 'custom-model',
      option: {
        value: 'custom-provider:custom-model',
        label,
        modelKey: 'custom-model',
        vendor: 'custom-provider',
        ...(archetypeId ? { meta: { archetypeId } } : {}),
      },
    }],
  }
}

describe('providerIdentityIcon', () => {
  it('uses the bundled brand asset for a known provider', () => {
    expect(providerIdentityIcon('apimart')).toMatchObject({
      kind: 'provider',
      fallback: 'A',
      src: expect.stringContaining('apimart.png'),
    })
  })

  it('uses a stable glyph without inventing a remote favicon for a custom provider', () => {
    expect(providerIdentityIcon('my-private-gateway')).toEqual({ kind: 'provider', fallback: 'M' })
    expect(providerIdentityIcon()).toEqual({ kind: 'provider' })
  })
})

describe('modelIdentityIcon', () => {
  it('uses curated model-brand assets only for certified archetypes', () => {
    expect(modelIdentityIcon(model('seedream-5-pro'))).toMatchObject({
      kind: 'model',
      fallback: 'D',
      src: expect.stringContaining('doubao.png'),
    })
    expect(modelIdentityIcon(model('modelscope-image'))).toMatchObject({
      kind: 'model',
      fallback: 'M',
      src: expect.stringContaining('modelscope.png'),
    })
    expect(modelIdentityIcon(model('minimax-speech-2.8'))).toMatchObject({
      kind: 'model',
      fallback: 'M',
      src: expect.stringContaining('minimax.png'),
    })
    expect(modelIdentityIcon(model('eleven-music-v2'))).toMatchObject({
      kind: 'model',
      fallback: 'E',
      src: expect.stringContaining('elevenlabs.png'),
    })
    expect(modelIdentityIcon(model('meshy-7'))).toMatchObject({
      kind: 'model',
      fallback: 'M',
      src: expect.stringContaining('meshy.png'),
    })
  })

  it('does not guess a brand from an unknown custom model name', () => {
    expect(modelIdentityIcon(model(undefined, 'Seedream lookalike'))).toEqual({ kind: 'model' })
  })
})
