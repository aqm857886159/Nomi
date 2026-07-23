import { describe, expect, it } from 'vitest'
import { isStandardPanoramaDimensions } from './panoramaImport'

describe('isStandardPanoramaDimensions', () => {
  it('accepts standard 2:1 equirectangular sizes', () => {
    expect(isStandardPanoramaDimensions({ width: 2048, height: 1024 })).toBe(true)
    expect(isStandardPanoramaDimensions({ width: 4096, height: 2048 })).toBe(true)
    expect(isStandardPanoramaDimensions({ width: 2000, height: 1000 })).toBe(true)
  })

  it('accepts within ±3% tolerance only', () => {
    expect(isStandardPanoramaDimensions({ width: 2020, height: 1000 })).toBe(true)
    expect(isStandardPanoramaDimensions({ width: 2040, height: 1000 })).toBe(false)
  })

  it('flags common AI-generated non-2:1 outputs (imported with warning, not rejected)', () => {
    expect(isStandardPanoramaDimensions({ width: 2210, height: 1000 })).toBe(false)
    expect(isStandardPanoramaDimensions({ width: 1920, height: 1080 })).toBe(false)
  })

  it('rejects degenerate dimensions', () => {
    expect(isStandardPanoramaDimensions({ width: 100, height: 0 })).toBe(false)
  })
})
