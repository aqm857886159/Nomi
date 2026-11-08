import fs from 'node:fs'
import path from 'node:path'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { describe, expect, it } from 'vitest'
import {
  allowImageInputFor, brainSamples, chatRowsOf, compareTextList, familyAndGeneration, readableLaneError, renderBrainTable, renderTextListMarkdown, scrubKeyShapes,
} from './_apimartTextChecks.mjs'

describe('familyAndGeneration', () => {
  it.each([
    ['deepseek-v4-pro', 'deepseek', [4]],
    ['deepseek-v4.1-flash', 'deepseek', [4, 1]],
    ['gpt-6.1-terra', 'gpt', [6, 1]],
    ['claude-opus-5-5', 'claude-opus', [5, 5]],
    ['claude-opus-5-5-20261001', 'claude-opus', [5, 5]],
    ['qwen3.8-max', 'qwen', [3, 8]],
    ['qwen3.8-max-0902', 'qwen', [3, 8]],
    ['gemini-3.5-flash', 'gemini', [3, 5]],
  ])('%s → %s %j', (id, family, generation) => {
    expect(familyAndGeneration(id)).toEqual({ family, generation })
  })

  it('an id without any number has no generation to compare', () => {
    expect(familyAndGeneration('deepseek-chat')).toBeNull()
  })
})

describe('compareTextList', () => {
  const declared = [
    { modelKey: 'gemini-4-argon' },
    { modelKey: 'gemini-3.5-flash', meta: { supportsImageInput: true } },
    { modelKey: 'claude-opus-5-5' },
    { modelKey: 'deepseek-v3.1-terminus' },
    { modelKey: 'MiniMax-H3-Context-IR', meta: { promptRefineOnly: true } },
  ]
  const rows = chatRowsOf({ data: [
    { id: 'gemini-4-argon', category: 'chat', capability_tags: ['Text', 'Vision'] },
    { id: 'gemini-4-pro', category: 'chat', capability_tags: ['Text'] },
    { id: 'gemini-3.5-flash', category: 'chat', capability_tags: ['Text'] },
    { id: 'gemini-3.9-ultra', category: 'chat', capability_tags: ['Text'] },
    { id: 'claude-opus-5-5', category: 'chat', capability_tags: ['Text', 'Vision'] },
    { id: 'text-embedding-9', category: 'chat', capability_tags: ['Embedding'] },
    { id: 'deepseek-chat', category: 'chat', capability_tags: ['Text'] },
    { nope: true },
  ] })

  it('keeps only id, category and capability tags from the list', () => {
    expect(rows).toHaveLength(7)
    expect(rows[0]).toEqual({ id: 'gemini-4-argon', category: 'chat', capabilityTags: ['Text', 'Vision'] })
  })

  it('finds what we declare that the list lacks, the newest undeclared generation, and the image facts', () => {
    const result = compareTextList(declared, rows)
    expect(result.declaredButMissing).toEqual([
      { modelKey: 'deepseek-v3.1-terminus', promptRefineOnly: false },
      { modelKey: 'MiniMax-H3-Context-IR', promptRefineOnly: true },
    ])
    // gemini 最新一代是 4：gemini-4-pro 进表，3.9-ultra 不是最新一代不进；embedding 不是文字大脑；deepseek-chat 没有代号。
    expect(result.newestUndeclared).toEqual([{ family: 'gemini', generation: '4', id: 'gemini-4-pro', capabilityTags: ['Text'] }])
    expect(result.noGenerationCount).toBe(1)
    expect(result.imageClaimWithoutVision).toEqual(['gemini-3.5-flash'])
    expect(result.visionNotClaimed).toEqual(['gemini-4-argon', 'claude-opus-5-5'])
    const markdown = renderTextListMarkdown(result, { fetchedAt: '2026-11-07T00:00:00.000Z', origin: 'https://api.apimart.ai', status: 200 })
    expect(markdown).toContain('| deepseek-v3.1-terminus |')
    expect(markdown).toContain('| gemini | 4 | gemini-4-pro | Text |')
    expect(markdown).toContain('在列表里 ≠ 调得通')
  })

  it('matches by modelAlias first, the same yardstick as the startup reconciliation', () => {
    expect(compareTextList([{ modelKey: 'local-name', modelAlias: 'gemini-4-pro' }], rows).declaredButMissing).toEqual([])
  })
})

describe('brain samples and their table', () => {
  it('asks every brain once, then each image candidate once more with a picture; image samples resume by <id>#image', () => {
    expect(brainSamples(['a', 'b'], ['b']).map((sample) => [sample.key, sample.image])).toEqual([['a', false], ['b', false], ['b#image', true]])
  })

  it('renders failures with their reason and keeps table cells intact', () => {
    const table = renderBrainTable([
      { key: 'a', modelKey: 'a', ok: true, httpStatus: [200], requests: 1, textReturned: true, text: '好', usage: { inputTokens: 9, outputTokens: 1, cacheReadTokens: 0 } },
      { key: 'b', modelKey: 'b', ok: false, error: 'HTTP 404 | model_not_found', httpStatus: [404], requests: 1, textReturned: false, text: '' },
    ])
    expect(table).toContain('| a |  | 200 | 1 | 是 | 好 | 9/1/0 | 通 |')
    expect(table).toContain('不通：HTTP 404 / model_not_found')
  })

  it('unpacks the vendor-failure envelope the main process sends over IPC into one readable line', () => {
    const facts = { vendorKey: 'apimart', httpStatus: 404, upstreamMsg: 'model_not_found', upstreamCode: 'model_not_found' }
    const wire = `NOMI_VENDOR_ERR_B64::${Buffer.from(JSON.stringify(facts)).toString('base64')}:: 模型不存在`
    expect(readableLaneError(wire)).toBe('HTTP 404 model_not_found：model_not_found')
    expect(readableLaneError('plain failure sk-abcdefghijklmnop')).toBe('plain failure sk-***')
  })

  it('scrubs key-shaped strings from answers and errors', () => {
    expect(scrubKeyShapes('bad key sk-abcdefghijklmnop and Bearer abcdefghijkl')).toBe('bad key sk-*** and Bearer ***')
  })
})

describe('allowImageInputFor', () => {
  it('marks only the named APIMart rows and refuses a candidate the copy does not have', () => {
    const dir = makeTempDir('nomi-text-checks-')
    try {
      const file = path.join(dir, 'model-catalog.json')
      fs.writeFileSync(file, JSON.stringify({ models: [
        { vendorKey: 'apimart', modelKey: 'a', meta: { keep: 1 } }, { vendorKey: 'apimart', modelKey: 'b' }, { vendorKey: 'other', modelKey: 'a' },
      ] }))
      expect(allowImageInputFor(dir, ['a'])).toEqual(['a'])
      const models = JSON.parse(fs.readFileSync(file, 'utf8')).models
      expect(models[0].meta).toEqual({ keep: 1, supportsImageInput: true })
      expect(models[1].meta).toBeUndefined()
      expect(models[2].meta).toBeUndefined()
      expect(() => allowImageInputFor(dir, ['missing'])).toThrow(/missing/)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})
