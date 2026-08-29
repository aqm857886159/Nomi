import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { handleCapabilityApply } from './capabilityApplyHandler'

describe('retired renderer production generation bridge', () => {
  it('rejects the old operation even when it carries no canonical binding', async () => {
    await expect(handleCapabilityApply('production.generate-node', {
      nodeId: 'node-1',
      maxAttemptsPerJob: 2,
    })).rejects.toThrow()
  })

  it('has no spend-grant or local provider dispatch implementation', () => {
    const source = readFileSync(new URL('./capabilityApplyHandler.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('production.generate-node')
    expect(source).not.toContain('mintSpendGrant')
    expect(source).not.toContain('runGenerationNode')
  })
})
