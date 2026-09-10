import { describe, test, expect } from 'vitest'
import { projectAgentRuntimeModels } from './agent-runtime-fixture.mjs'
import { argsFor, cases } from '../../docs/fixes/storyboard-reliability/cases.mjs'
import { repoRoot } from './_launchApp.mjs'

describe('storyboard reliability uses the real catalog projection', () => {
  test('both tiers use canonical parameters for two supplier identities', async () => {
    for (const vendorKey of ['apimart', 'kie']) {
      const entries = await projectAgentRuntimeModels(repoRoot, [{
        vendorKey, modelKey: 'gpt-image-2', kind: 'image', enabled: true,
        labelZh: 'GPT Image 2', meta: { archetypeId: 'gpt-image-2' },
      }])
      for (const [id, tier] of [[4, '1K'], [9, '2K']]) {
        const shot = argsFor(cases.find(c => c.id === id), entries).shots[0]
        expect(shot.params).toEqual({ resolution: tier })
        expect(shot.modelVendor).toBe(vendorKey)
        expect(shot.modeId).toBe('t2i')
      }
    }
  }, 30000)
  test('missing catalog or unsupported tier fails before submitting a fabricated write', () => {
    expect(() => argsFor(cases[3], [])).toThrow()
    expect(() => argsFor(cases[8], [{ modelKey: 'gpt-image-2', defaultModeId: 't2i', modes: [{ modeId: 't2i', params: [] }] }])).toThrow()
  })
})
