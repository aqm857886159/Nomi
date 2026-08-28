import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

import { RpcError } from './dispatcher'
import { assertLocalBearerProjectSessionRoute } from './localProjectSessionTransportPolicy'

describe('local bearer project-session transport policy', () => {
  it('wires the one-shot host canvas read through verified internal authority before legacy dispatch', () => {
    const source = fs.readFileSync(new URL('./host.ts', import.meta.url), 'utf8')
    expect(source).toContain('createInternalCanvasReadVerifiedInvocationFactory({')
    expect(source).toContain('verifyBearer: (bearer) => verifyToken(bearer)')
    expect(source).toContain('createHeadlessCanvasReadExecutionRuntime()')
    expect(source).toContain('adapter.tryExecute(method, {')
  })

  it.each(['canvas.read', 'nomi_session_open'])(
    'rejects %s instead of inventing an MCP principal or accepting a bare project id',
    (method) => {
      expect(() => assertLocalBearerProjectSessionRoute(method)).toThrowError(RpcError)
      try {
        assertLocalBearerProjectSessionRoute(method)
      } catch (error) {
        expect(error).toMatchObject({ httpStatus: 403 })
      }
    },
  )

  it('leaves unrelated local bearer routes unchanged', () => {
    expect(() => assertLocalBearerProjectSessionRoute('ping')).not.toThrow()
  })
})
