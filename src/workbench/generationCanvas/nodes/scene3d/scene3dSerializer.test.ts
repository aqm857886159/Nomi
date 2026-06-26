import { describe, expect, it } from 'vitest'
import { normalizeScene3DState } from './scene3dSerializer'

describe('normalizeScene3DState', () => {
  it('preserves panorama environment fields', () => {
    const state = normalizeScene3DState({
      environment: {
        panoramaUrl: 'nomi-local://asset/project/assets/upload/panorama.jpg',
        panoramaFileName: 'panorama.jpg',
        panoramaRotation: 1.25,
      },
    })

    expect(state.environment.panoramaUrl).toBe('nomi-local://asset/project/assets/upload/panorama.jpg')
    expect(state.environment.panoramaFileName).toBe('panorama.jpg')
    expect(state.environment.panoramaRotation).toBe(1.25)
  })

  it('drops unsupported panorama urls and defaults rotation', () => {
    const state = normalizeScene3DState({
      environment: {
        panoramaUrl: 'file:///Users/me/secret.jpg',
        panoramaRotation: Number.NaN,
      },
    })

    expect(state.environment.panoramaUrl).toBeUndefined()
    expect(state.environment.panoramaRotation).toBe(0)
  })
})
