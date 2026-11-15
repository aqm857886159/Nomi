import { describe, expect, it } from 'vitest'

import { parseSurfacePortFailure, surfacePortFailureAdvice, surfacePortReplyPayload, settleSurfacePortHandler, SurfacePortWireError, unwrapSurfacePortIpcResponse } from './surfacePortBinding'

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

  it('carries the rejected field paths for capability_input_invalid only, bounded and without control characters', () => {
    const thrown = () => unwrapSurfacePortIpcResponse({ ok: false, error: { code: 'capability_input_invalid', fields: `plan.shots[1].durationSec needs number\n${'x'.repeat(2000)}` } })
    expect(thrown).toThrow(expect.objectContaining({ code: 'capability_input_invalid', fields: expect.stringMatching(/^plan\.shots\[1\]\.durationSec needs number x+$/) }))
    try { thrown() } catch (error) { expect((error as SurfacePortWireError).fields!.length).toBeLessThanOrEqual(600) }
    expect(parseSurfacePortFailure({ code: 'project_binding_stale', fields: 'leak' })).toEqual({ code: 'project_binding_stale' })
    expect(surfacePortFailureAdvice({ code: 'capability_input_invalid', fields: 'shots[1].durationSec needs number' }).message).toContain('shots[1].durationSec')
  })

  it('fails malformed envelopes closed as surface_port_unavailable', () => {
    for (const payload of [null, {}, { ok: true }, { ok: false, error: {} }, { ok: false, error: { code: 42 } }]) {
      expect(() => unwrapSurfacePortIpcResponse(payload)).toThrow(
        new SurfacePortWireError('surface_port_unavailable'),
      )
    }
  })
})

describe('renderer handler wire result', () => {
  it('invokes snapshots synchronously and serializes typed failures before leaving their realm', async () => {
    let captured = false
    const reply = settleSurfacePortHandler(() => { captured = true; return { node: 'a' } })
    expect(captured).toBe(true)
    expect(await reply).toEqual({ ok: true, value: { node: 'a' } })
    expect(await settleSurfacePortHandler(() => { throw new SurfacePortWireError('capability_target_stale') }))
      .toEqual({ ok: false, error: { code: 'capability_target_stale' } })
    expect(await settleSurfacePortHandler(async () => { throw new SurfacePortWireError('capability_receipt_unresolved') }))
      .toEqual({ ok: false, error: { code: 'capability_receipt_unresolved' } })
  })

  it('does not guess an error code from message or expose raw private details', async () => {
    for (const error of [new Error('surface_port_stale'), new Error('/private/provider-token'), { code: 'unknown', message: 'secret' }]) {
      expect(await settleSurfacePortHandler(() => { throw error }))
      .toEqual({ ok: false, error: { code: 'capability_execution_failed' } })
    }
  })
})

it('preserves only declared import rejection reasons through ordinary JSON data', async () => {
  const reply = await settleSurfacePortHandler(() => {
    throw Object.assign(new Error('/private/token'), { code: 'capability_execution_failed', reason: 'no-disk-space' })
  })
  expect(surfacePortReplyPayload(JSON.parse(JSON.stringify(reply)))).toEqual({
    error: { code: 'capability_execution_failed', reason: 'no-disk-space' },
  })
  expect(parseSurfacePortFailure({ code: 'capability_execution_failed', reason: '/private/token' }))
    .toEqual({ code: 'capability_execution_failed' })
  expect(parseSurfacePortFailure({ code: 'capability_cancelled', reason: 'no-disk-space' }))
    .toEqual({ code: 'capability_cancelled' })
  for (const raw of [{}, { value: 1 }, { ok: true }, { ok: false, error: { code: 'private' } }]) {
    expect(surfacePortReplyPayload(raw)).toEqual({ error: { code: 'surface_port_unavailable' } })
  }
})
