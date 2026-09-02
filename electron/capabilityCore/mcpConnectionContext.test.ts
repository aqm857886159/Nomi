import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  assertVerifiedMcpConnectionContext,
  bindMcpConnectionContext,
  getMcpConnectionAttestation,
  McpConnectionAuthenticationError,
  createMcpConnectionContext,
} from './mcpConnectionContext'
import {
  CAPABILITY_DIR_ENV,
  ensureToken,
  signMcpClient,
} from './security'

const tempRoots: string[] = []

afterEach(() => {
  delete process.env[CAPABILITY_DIR_ENV]
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function installClientProof(client: 'claude' | 'codex' | 'cursor') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-connection-'))
  tempRoots.push(root)
  process.env[CAPABILITY_DIR_ENV] = root
  ensureToken()
  return signMcpClient(client)!
}

describe('McpConnectionContext', () => {
  it('derives the principal only from a verified client proof and generates transport-owned identity', () => {
    const proof = installClientProof('codex')
    const secret = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

    const context = createMcpConnectionContext({
      client: 'codex',
      proof,
      randomSecret: () => secret,
    })

    expect(context).toMatchObject({
      authenticatedClient: 'codex',
      principal: 'mcp:codex',
    })
    expect(context.sessionId).toMatch(/^mcp-session:[A-Za-z0-9_-]{43}$/)
    expect(context.connectionNonce).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(context.sessionId).not.toContain(secret)
    expect(context.connectionNonce).not.toContain(secret)
    expect(getMcpConnectionAttestation(context)).toBe(secret)
    expect(JSON.stringify(context)).not.toContain(secret)
    expect(() => assertVerifiedMcpConnectionContext(context)).not.toThrow()
    expect(() => assertVerifiedMcpConnectionContext(Object.freeze({ ...context })))
      .toThrow(McpConnectionAuthenticationError)
    expect(() => getMcpConnectionAttestation(Object.freeze({ ...context })))
      .toThrow(McpConnectionAuthenticationError)
    expect(Object.isFrozen(context)).toBe(true)
  })

  it('rejects a self-declared client, a foreign proof, and malformed generated identity', () => {
    const proof = installClientProof('claude')

    expect(() => createMcpConnectionContext({ client: 'codex', proof }))
      .toThrow(McpConnectionAuthenticationError)
    expect(() => createMcpConnectionContext({ client: 'claude', proof: `${proof}x` }))
      .toThrow(McpConnectionAuthenticationError)
    expect(() => createMcpConnectionContext({ client: 'claude', proof, randomSecret: () => '' }))
      .toThrow(McpConnectionAuthenticationError)
  })

  it('rebinds derived session identity only from a fresh proof and transport attestation', () => {
    const proof = installClientProof('codex')
    const secret = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    const original = createMcpConnectionContext({
      client: 'codex',
      proof,
      randomSecret: () => secret,
    })
    const context = bindMcpConnectionContext({
      client: 'codex',
      proof,
      connectionAttestation: secret,
    })

    expect(context).toEqual(original)
    expect(() => assertVerifiedMcpConnectionContext(original)).not.toThrow()
    expect(() => assertVerifiedMcpConnectionContext(context)).not.toThrow()
    expect(() => assertVerifiedMcpConnectionContext(structuredClone(context)))
      .toThrow(McpConnectionAuthenticationError)
    expect(() => getMcpConnectionAttestation(context)).toThrow(McpConnectionAuthenticationError)
    expect(() => bindMcpConnectionContext({
      client: 'claude',
      proof,
      connectionAttestation: secret,
    })).toThrow(McpConnectionAuthenticationError)
    expect(() => bindMcpConnectionContext({
      client: 'codex',
      proof,
      connectionAttestation: '',
    })).toThrow(McpConnectionAuthenticationError)
  })
})
