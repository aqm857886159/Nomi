import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { mapPairwiseWinner, pairwiseOnce, reviewOnce } from './review'
import type { DirectorCard } from '../cardSchema'
import type { Preregistration } from './schema'

const card = { id: 'card', prompt: 'prompt' } as DirectorCard
const preregistration = {
  cardId: 'card',
  prompt: 'prompt',
  expectedSegments: [
    { timecode: '0-1', whoWhere: 'subject', action: 'action', framing: 'wide', camera: 'static', cut: 'none' },
  ],
  frozenAt: '2026-10-04T00:00:00.000Z',
  sha256: 'a'.repeat(64),
} as Preregistration

describe('blind pairwise display mapping', () => {
  it('maps a forced reversed order left choice to the scheme displayed on the left', () => {
    expect(mapPairwiseWinner('left', ['right', 'left'], 'oracle', 's0-pr960-raw')).toBe('s0-pr960-raw')
  })

  it('retries a schema-invalid review once and returns the corrected value', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'director-review-test-'))
    const image = path.join(dir, 'frame.png')
    await fs.writeFile(image, 'fixture')
    const prompts: string[] = []
    let call = 0
    const result = await reviewOnce(card, preregistration, [image], dir, {
      runCodex: async (_args, prompt) => {
        prompts.push(prompt)
        call += 1
        return call === 1
          ? '{"review":{"userScore":9}}'
          : '{"review":{"segments":[{"timecode":"0-1","expectation":"subject","judgement":"seen","evidence":"visible"}],"userScore":4,"leastLike":[{"timecode":"0-1","problem":"none"}],"rationale":"visible"}}'
      },
    })
    expect(result.value?.review.userScore).toBe(4)
    expect(result.retries).toBe(1)
    expect(result.blocked).toBe(false)
    expect(prompts[1]).toContain('Schema error')
    expect(prompts[1]).toContain('userScore')
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('blocks after the single schema retry is also invalid', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'director-review-test-'))
    const image = path.join(dir, 'frame.png')
    await fs.writeFile(image, 'fixture')
    const result = await reviewOnce(card, preregistration, [image], dir, {
      runCodex: async () => '{"review":{"userScore":9}}',
    })
    expect(result.value).toBeUndefined()
    expect(result.retries).toBe(1)
    expect(result.blocked).toBe(true)
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('marks a timed out review as blocked and records elapsed time', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'director-review-timeout-test-'))
    const image = path.join(dir, 'frame.png')
    await fs.writeFile(image, 'fixture')
    const result = await reviewOnce(card, preregistration, [image], dir, {
      timeoutMs: 5,
      runCodex: async () => new Promise(() => undefined),
    })
    expect(result.blocked).toBe(true)
    expect(result.error).toMatch(/timed out after 5ms/)
    expect(result.durationMs).toBeGreaterThanOrEqual(5)
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('exposes display position and maps reversed pairwise order to the right scheme', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'director-pair-test-'))
    const left = path.join(dir, 'left.png')
    const right = path.join(dir, 'right.png')
    await fs.writeFile(left, 'fixture')
    await fs.writeFile(right, 'fixture')
    const result = await pairwiseOnce(card, preregistration, left, right, 'oracle', 's0-pr960-raw', dir, {
      displayOrder: 'reverse',
      runCodex: async () => '{"cardId":"card","leftLabel":"left","rightLabel":"right","winner":"left","why":"visible"}',
    })
    expect(result.displayWinner).toBe('left')
    expect(result.value?.winner).toBe('s0-pr960-raw')
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('retries malformed pairwise JSON once with the schema error', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'director-pair-test-'))
    const left = path.join(dir, 'left.png')
    const right = path.join(dir, 'right.png')
    await fs.writeFile(left, 'fixture')
    await fs.writeFile(right, 'fixture')
    const prompts: string[] = []
    let call = 0
    const result = await pairwiseOnce(card, preregistration, left, right, 'oracle', 's0-pr960-raw', dir, {
      displayOrder: 'forward',
      runCodex: async (_args, prompt) => {
        prompts.push(prompt)
        call += 1
        return call === 1
          ? '{"cardId":"card","leftLabel":"left","rightLabel":"right","winner":"left"}'
          : '{"cardId":"card","leftLabel":"left","rightLabel":"right","winner":"left","why":"visible"}'
      },
    })
    expect(result.value?.winner).toBe('oracle')
    expect(result.retries).toBe(1)
    expect(prompts[1]).toContain('Schema error')
    expect(prompts[1]).toContain('why')
    await fs.rm(dir, { recursive: true, force: true })
  })
})
