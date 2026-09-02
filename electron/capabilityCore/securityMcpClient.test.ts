import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  CAPABILITY_DIR_ENV,
  ensureCapabilitySigningKey,
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

  it('signs and verifies an arbitrary valid custom client key (泛化)', () => {
    // 方案 A：任意形状合法的 key（内置 + 自定义 profile）都能被 Nomi 签名并验证。
    const proof = signMcpClient('workbuddy')
    expect(proof).toBeTruthy()
    expect(verifyMcpClient('workbuddy', proof)).toBe('workbuddy')
    expect(resolveMcpOrigin('workbuddy', proof)).toBe('workbuddy')
    // proof 仍绑定到签名时的 key，不能跨 key 冒用。
    expect(verifyMcpClient('cursor', proof)).toBeNull()
  })

  it('rejects malformed custom client keys', () => {
    // 非法形状（含大写/空格/特殊字符）不签名，恒 external。
    expect(signMcpClient('Work Buddy')).toBeNull()
    expect(signMcpClient('')).toBeNull()
    expect(resolveMcpOrigin('Work Buddy', 'whatever')).toBe('external')
  })
})

describe('app-owned signing keys', () => {
  it('persists separate opaque keys without reusing the bearer token', () => {
    const leaseKey = ensureCapabilitySigningKey('project-lease')
    const receiptKey = ensureCapabilitySigningKey('approval-receipt')
    expect(leaseKey).toHaveLength(32)
    expect(receiptKey).toHaveLength(32)
    expect(leaseKey.equals(receiptKey)).toBe(false)
    expect(ensureCapabilitySigningKey('project-lease')).toEqual(leaseKey)
    expect(fs.readFileSync(path.join(root, 'keys', 'project-lease.key'))).toEqual(leaseKey)
  })
})
