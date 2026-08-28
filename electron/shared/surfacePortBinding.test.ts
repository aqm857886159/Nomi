import { describe, expect, it } from 'vitest'

import { SurfacePortWireError, unwrapSurfacePortIpcResponse } from './surfacePortBinding'

describe('Surface IPC wire envelope', () => {
  it('returns a successful payload without trusting Electron Error serialization', () => {
    expect(unwrapSurfacePortIpcResponse({ ok: true, value: { id: 'binding' } })).toEqual({ id: 'binding' })
  })

  it('reconstructs the typed code from an explicit error envelope without leaking raw details', () => {
    expect(() => unwrapSurfacePortIpcResponse({
      ok: false,
      error: { code: 'project_binding_stale', ignoredRawDetail: '/private/project/path' },
    })).toThrow(expect.objectContaining({
      name: 'SurfacePortWireError',
      code: 'project_binding_stale',
      message: 'project_binding_stale',
    }))
  })

  it('fails malformed envelopes closed as surface_port_unavailable', () => {
    for (const payload of [null, {}, { ok: true }, { ok: false, error: {} }, { ok: false, error: { code: 42 } }]) {
      expect(() => unwrapSurfacePortIpcResponse(payload)).toThrow(
        new SurfacePortWireError('surface_port_unavailable'),
      )
    }
  })
})
