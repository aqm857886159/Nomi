import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DirectorCard } from '../cardSchema'
import { preregister } from './preregister'

const card = { id: 'police-chase', prompt: 'A chase' } as DirectorCard

describe('preregistration timestamp ownership', () => {
  it('replaces a model Invalid datetime with the runner ISO timestamp before hashing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'director-preregister-test-'))
    const outFile = path.join(dir, 'expectation.json')
    const result = await preregister(card, outFile, {
      now: () => new Date('2026-10-04T12:34:56.000Z'),
      runCodex: async () =>
        JSON.stringify({
          cardId: 'police-chase',
          prompt: 'A chase',
          frozenAt: 'Invalid datetime',
          expectedSegments: [
            { timecode: '0-1', whoWhere: 'chaser', action: 'runs', framing: 'wide', camera: 'tracking', cut: 'none' },
          ],
        }),
    })
    expect(result.error).toBeUndefined()
    expect(result.value?.frozenAt).toBe('2026-10-04T12:34:56.000Z')
    expect(result.value?.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.parse(await fs.readFile(outFile, 'utf8')).frozenAt).toBe('2026-10-04T12:34:56.000Z')
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('records a blocked error when the preregistration runner exceeds its timeout', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'director-preregister-timeout-'))
    const outFile = path.join(dir, 'expectation.json')
    const result = await preregister(card, outFile, {
      timeoutMs: 5,
      runCodex: () => new Promise<string>(() => undefined),
    })
    expect(result.value).toBeUndefined()
    expect(result.error).toContain('timed out')
    expect(JSON.parse(await fs.readFile(outFile, 'utf8')).status).toBe('unverified')
    await fs.rm(dir, { recursive: true, force: true })
  })
})
