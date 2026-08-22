import { describe, expect, it } from 'vitest'

import { RpcError } from './dispatcher'
import { rpcErrorFromPayload, rpcErrorWirePayload, RpcTransportError } from './mcpRpcError'

describe('structured local RPC errors', () => {
  it('keeps policy fields when decoding an object error payload', () => {
    const error = rpcErrorFromPayload({
      ok: false,
      error: {
        message: 'generation.single-shot phase_not_ready',
        code: 'phase_not_ready', nextAction: 'finish P0', phase: 'schema_only', capability: 'start',
      },
    }, 403)
    expect(error).toBeInstanceOf(RpcTransportError)
    expect(error).toMatchObject({
      message: 'generation.single-shot phase_not_ready', code: 'phase_not_ready', errorCode: 'phase_not_ready',
      nextAction: 'finish P0', phase: 'schema_only', capability: 'start',
    })
  })

  it('keeps ordinary legacy string errors as plain Errors', () => {
    const error = rpcErrorFromPayload({ ok: false, error: '未知方法: nope' }, 404)
    expect(error).not.toBeInstanceOf(RpcTransportError)
    expect(error).toMatchObject({ message: '未知方法: nope' })
  })

  it('serializes policy RpcErrors with typed recovery details and ordinary errors as strings', () => {
    const policyError = new RpcError('generation.single-shot phase_not_ready', 403, {
      code: 'phase_not_ready', nextAction: 'finish P0', phase: 'schema_only', capability: 'start',
    })
    expect(rpcErrorWirePayload(policyError)).toEqual({
      message: 'generation.single-shot phase_not_ready', code: 'phase_not_ready',
      nextAction: 'finish P0', phase: 'schema_only', capability: 'start',
    })
    expect(rpcErrorWirePayload(new Error('legacy failure'))).toBe('legacy failure')
    expect(rpcErrorWirePayload(new RpcError('bad request', 400))).toBe('bad request')
  })
})
