import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-handoff-'))
process.env.NOMI_CAPABILITY_DIR = root

import { acknowledgeIntegrationHandoff, enqueueIntegrationHandoff, listIntegrationHandoffs, retireIntegrationHandoffs } from './handoffQueue'

describe('integration handoff queue', () => {
  it('persists safe metadata and is idempotent by requestId', () => {
    const input = {
      requestId: 'request-1', target: 'credential' as const, sessionId: 'session-1', revision: 2,
      ownerClientId: 'codex' as const, display: { name: 'Banana', origin: 'https://api.example', authType: 'bearer' },
    }
    const first = enqueueIntegrationHandoff(input)
    const second = enqueueIntegrationHandoff({ ...input, display: { name: 'changed' } })
    expect(second).toEqual(first)
    expect(listIntegrationHandoffs()).toEqual([first])
    expect(JSON.stringify(listIntegrationHandoffs())).not.toContain('authorization')
  })

  it('acknowledges exactly one entry and rejects unsafe fields', () => {
    expect(() => enqueueIntegrationHandoff({
      requestId: 'request-2', target: 'connection', sessionId: 'session-2', revision: 1, ownerClientId: 'codex',
      display: { origin: 'https://api.example/key?secret=bad' },
    })).toThrow(/origin/)
    enqueueIntegrationHandoff({
      requestId: 'request-2', target: 'connection' as const, sessionId: 'session-2', revision: 1, ownerClientId: 'codex',
      display: { origin: 'https://api.example' },
    })
    enqueueIntegrationHandoff({
      requestId: 'request-2', target: 'connection' as const, sessionId: 'session-2', revision: 1, ownerClientId: 'codex',
      display: { origin: 'https://api.example' },
    })
    expect(acknowledgeIntegrationHandoff('request-2')).toBe(true)
    expect(acknowledgeIntegrationHandoff('request-2')).toBe(false)
    expect(() => enqueueIntegrationHandoff({
      requestId: 'request-3', target: 'bad' as never, sessionId: 'session-3', revision: 1, ownerClientId: 'codex',
    })).toThrow(/target/)
  })

  it('retires one session/target pair and leaves every other request queued', () => {
    const base = { revision: 1, ownerClientId: 'codex' as const }
    enqueueIntegrationHandoff({ ...base, requestId: 'retire-cred-a', target: 'credential', sessionId: 'retire-session' })
    enqueueIntegrationHandoff({ ...base, requestId: 'retire-cred-b', target: 'credential', sessionId: 'retire-session' })
    enqueueIntegrationHandoff({ ...base, requestId: 'retire-verify', target: 'verification', sessionId: 'retire-session' })
    enqueueIntegrationHandoff({ ...base, requestId: 'retire-other', target: 'credential', sessionId: 'other-session' })
    expect(retireIntegrationHandoffs('retire-session', 'credential')).toBe(2)
    const remaining = listIntegrationHandoffs().map((entry) => entry.requestId)
    expect(remaining).toContain('retire-verify')
    expect(remaining).toContain('retire-other')
    expect(remaining).not.toContain('retire-cred-a')
    expect(remaining).not.toContain('retire-cred-b')
    // Retiring an already-empty pair is a no-op, not an error: both credential routes may resolve.
    expect(retireIntegrationHandoffs('retire-session', 'credential')).toBe(0)
    expect(() => retireIntegrationHandoffs('not a valid id!', 'credential')).toThrow(/sessionId/)
  })
})
