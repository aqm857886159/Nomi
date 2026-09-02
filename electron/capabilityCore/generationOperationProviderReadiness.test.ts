import { describe, expect, it } from 'vitest'

import {
  generationOperationProviderRequirements,
  hasGenerationOperationProviderReadiness,
  missingGenerationOperationProviders,
} from './generationOperationProviderReadiness'

function candidate(providerId: string) {
  return {
    candidateId: providerId,
    revision: 1,
    moduleId: 'generation.single-shot',
    providerId,
    modelId: `${providerId}-model`,
    mode: 'text-to-video',
    prompt: 'shot',
    parameters: {},
    references: [],
  }
}

describe('generation operation provider readiness', () => {
  it('derives all included shot providers instead of trusting the first anchor contract', () => {
    const operation = {
      contract: { providerId: 'image-anchor-provider' },
      shots: [
        {
          shotId: 'anchor-1',
          role: 'anchor' as const,
          candidate: candidate('image-anchor-provider'),
          contract: { providerId: 'image-anchor-provider' },
        },
        {
          shotId: 'shot-1',
          role: 'shot' as const,
          candidate: candidate('video-provider-a'),
          contract: { providerId: 'video-provider-a' },
        },
        {
          shotId: 'shot-2',
          role: 'shot' as const,
          candidate: candidate('video-provider-b'),
          contract: { providerId: 'video-provider-b' },
        },
      ],
    }

    expect(generationOperationProviderRequirements(operation)).toEqual({
      providerIds: ['image-anchor-provider', 'video-provider-a', 'video-provider-b'],
      unresolvedShotIds: [],
    })
    expect(missingGenerationOperationProviders(operation, [
      { providerId: 'image-anchor-provider' },
      { providerId: 'video-provider-a' },
    ])).toEqual(['video-provider-b'])
    expect(hasGenerationOperationProviderReadiness(operation, [
      { providerId: 'image-anchor-provider' },
      { providerId: 'video-provider-a' },
    ])).toBe(false)
    expect(hasGenerationOperationProviderReadiness(operation, [
      { providerId: 'image-anchor-provider' },
      { providerId: 'video-provider-a' },
      { providerId: 'video-provider-b' },
    ])).toBe(true)
  })

  it('does not require excluded shots and keeps the legacy single-shot fallback', () => {
    const multiShot = {
      contract: { providerId: 'video-provider' },
      shots: [
        { shotId: 'included', candidate: candidate('video-provider') },
        { shotId: 'excluded', included: false, candidate: candidate('disabled-provider') },
      ],
    }
    expect(generationOperationProviderRequirements(multiShot).providerIds).toEqual(['video-provider'])
    expect(missingGenerationOperationProviders(multiShot, [{ providerId: 'video-provider' }])).toEqual([])

    const singleShot = { contract: { providerId: 'legacy-provider' } }
    expect(generationOperationProviderRequirements(singleShot)).toEqual({
      providerIds: ['legacy-provider'],
      unresolvedShotIds: [],
    })
  })

  it('adds durable job provider identities for restart recovery', () => {
    const operation = {
      contract: { providerId: 'image-anchor-provider' },
      shots: [{ shotId: 'anchor-1', role: 'anchor' as const, candidate: candidate('image-anchor-provider') }],
    }
    expect(generationOperationProviderRequirements(operation, ['video-provider'])).toEqual({
      providerIds: ['image-anchor-provider', 'video-provider'],
      unresolvedShotIds: [],
    })
    expect(missingGenerationOperationProviders(operation, [
      { providerId: 'image-anchor-provider' },
    ], ['video-provider'])).toEqual(['video-provider'])
  })

  it('fails closed when an included shot has no provider identity', () => {
    const operation = {
      contract: { providerId: 'video-provider' },
      shots: [
        { shotId: 'shot-missing', candidate: { ...candidate(''), providerId: '' } },
      ],
    }
    expect(missingGenerationOperationProviders(operation, [{ providerId: 'video-provider' }])).toEqual(['shot:shot-missing'])
    expect(hasGenerationOperationProviderReadiness(operation, [{ providerId: 'video-provider' }])).toBe(false)
  })
})
