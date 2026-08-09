import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  CAPABILITY_DIR_ENV,
  ensureToken,
  resolveMcpOrigin,
  signMcpClient,
  verifyMcpClient,
} from './security'

let root = ''

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-client-proof-'))
  process.env[CAPABILITY_DIR_ENV] = root
  ensureToken()
})

afterEach(() => {
  delete process.env[CAPABILITY_DIR_ENV]
  fs.rmSync(root, { recursive: true, force: true })
})

describe('signed MCP client identity', () => {
  it('binds a proof to exactly one Nomi-installed client', () => {
    const proof = signMcpClient('cursor')
    expect(proof).toBeTruthy()
    expect(verifyMcpClient('cursor', proof)).toBe('cursor')
    expect(verifyMcpClient('codex', proof)).toBeNull()
    expect(verifyMcpClient('claude', proof)).toBeNull()
  })

  it('keeps self-declared, missing, and tampered identities external', () => {
    const proof = signMcpClient('cursor')!
    const tampered = `${proof.slice(0, -1)}${proof.endsWith('A') ? 'B' : 'A'}`
    expect(resolveMcpOrigin('cursor', undefined)).toBe('external')
    expect(resolveMcpOrigin('cursor', tampered)).toBe('external')
    expect(resolveMcpOrigin('evil-client', proof)).toBe('external')
  })
})
