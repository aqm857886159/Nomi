import { describe, expect, it } from 'vitest'
import { buildProfileHttpRequest, validateProfileRequestBeforeSpend } from './profileHttpRequest'
import type { Model, Vendor } from './types'
import type { TaskRequest } from '../runtime'

function input(vendorKey: string, extras: Record<string, unknown> = {}) {
  return {
    vendor: { key: vendorKey, baseUrlHint: 'https://example.invalid', authType: 'bearer' } as Vendor,
    model: { modelKey: 'MiniMax-H3-Regeneration', vendorKey, labelZh: 'H3', kind: 'video', enabled: true } as Model,
    apiKey: 'fixture-only',
    request: { kind: 'text_to_video', prompt: '', extras } as TaskRequest,
    operation: { method: 'POST' as const, path: '/v2/video_regeneration', body: {
      model: 'MiniMax-H3', resolution: '2K', source_task_id: '{{request.params.source_task_id}}',
    } },
  }
}
describe('source task preflight applies to persisted mappings without transforms', () => {
  it.each(['minimax', 'apimart'])('rejects missing source before spend on %s', async vendor => {
    await expect(validateProfileRequestBeforeSpend(input(vendor))).rejects.toThrow()
    await expect(validateProfileRequestBeforeSpend(input(vendor, { source_task_id: '   ' }))).rejects.toThrow()
  })
  it('retains the exact official request shape', async () => {
    const value = input('minimax', { source_task_id: 'source-task' })
    await expect(validateProfileRequestBeforeSpend(value)).resolves.toBeUndefined()
    expect(buildProfileHttpRequest(value).body).toEqual({ model: 'MiniMax-H3', source_task_id: 'source-task', resolution: '2K' })
  })
  it('does not let stale mode selection or a mapping dropping the ID bypass preflight', async () => {
    await expect(validateProfileRequestBeforeSpend(input('minimax', { archetype: { modeId: 'stale' } }))).rejects.toThrow()
    const value = input('minimax', { source_task_id: 'source-task' })
    value.operation.body.source_task_id = ''
    await expect(validateProfileRequestBeforeSpend(value)).rejects.toThrow()
  })
  it('does not impose source-task requirements on ordinary generation', async () => {
    const value = input('minimax'); value.model.modelKey = 'MiniMax-H3'
    await expect(validateProfileRequestBeforeSpend(value)).resolves.toBeUndefined()
  })
})
