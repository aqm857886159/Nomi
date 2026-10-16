import { expect, it, vi } from 'vitest'
import { buildV4ModelRows } from './agentPanelV4ModelRows'
import type { AgentPanelV4Data } from './useAgentPanelV4Data'

it('places reasoning below chat and forwards only a supported idle choice', () => {
  const select = vi.fn()
  const base = { models: [], generationModels: [], vendors: {}, orderedVendorKeys: [], selectedModel: undefined, modelLabel: 'Sol', selectModel: vi.fn(), generationDefaults: {}, setGenerationDefault: vi.fn() }
  const data = { ...base, reasoning: { levels: ['low', 'high'] as const, level: 'high' as const, disabled: false, select } } satisfies Pick<AgentPanelV4Data, keyof typeof base | 'reasoning'>
  const t = (key: string) => key
  const rows = buildV4ModelRows(data, t)
  expect(rows[1]?.slot).toBe('agentPanelV4.reasoningLevel')
  expect(rows[1]?.selectedValue).toBe('high')
  rows[1]?.onChange?.('low')
  rows[1]?.onChange?.('max')
  expect(select).toHaveBeenCalledExactlyOnceWith('low')
  buildV4ModelRows({ ...data, reasoning: { ...data.reasoning, disabled: true } }, t)[1]?.onChange?.('high')
  expect(select).toHaveBeenCalledTimes(1)
  expect(buildV4ModelRows(base, t).map(row => row.slot)).not.toContain('agentPanelV4.reasoningLevel')
})
