import { describe, expect, it } from 'vitest'
import { canConfigureModelRequestScript } from './modelRequestScriptAvailability'

describe('model request script availability', () => {
  it('allows an existing non-ComfyUI model without requiring a connection base URL', () => {
    expect(canConfigureModelRequestScript({ vendorKey: 'future-sdk' })).toBe(true)
  })

  it('keeps ComfyUI models on their dedicated workflow runtime', () => {
    expect(canConfigureModelRequestScript({ vendorKey: 'comfyui-local' })).toBe(false)
    expect(canConfigureModelRequestScript({ vendorKey: 'comfyui-local-studio' })).toBe(false)
  })
})
