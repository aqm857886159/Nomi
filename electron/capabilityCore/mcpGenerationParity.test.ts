import { describe, expect, it, vi } from 'vitest'
import { generationCandidateSchema, generationPlanInputSchema } from '../shared/agentCapabilities/generationPlanSchemas'
import { MCP_GENERATION_TOOL_CATALOG } from './mcpGenerationToolCatalog'
import { validateToolArguments } from './mcpArgValidation'
import { toPublishedJsonSchema } from '../shared/agentCapabilities/modelVisibleJsonSchema'

import { createPiGenerationTransportAdapter } from './generationTransportAdapters'
import { draftShotFromPlan } from './mcpGenerationMultiShot'
import type { ProjectLeaseV2 } from './projectLease'

const tool = MCP_GENERATION_TOOL_CATALOG.find(tool => tool.name === 'nomi_operation_plan')!

describe('MCP generation draft schema parity', () => {
  it('accepts lane prompt-only shots and preserves nested JSON parameters', () => {
    const shot = { prompt: 'A sunrise', taskKind: 'text_to_image', modelId: 'from-context', mode: 'from-context',
      parameters: { nested: { list: [null, true, 3, 'value', { child: [] }] } },
      references: [{ assetId: 'asset-1', contentHash: 'hash-1', version: 1, kind: 'image', role: 'reference' }],
    }
    expect(generationPlanInputSchema.safeParse({ operation: 'create', shots: [shot] }).success).toBe(true)
    const args = { leaseHandle: 'lease', projectId: 'project', shots: [shot] }
    expect(validateToolArguments(tool.name, tool.inputSchema, args)).toBeNull()
    expect(tool.build(args)).toMatchObject({ shots: [shot] })
  })

  it('derives every create and patch property from the canonical lane generation owner', () => {
    const create = toPublishedJsonSchema(generationPlanInputSchema.options[1].omit({ operation: true }))
    const properties = tool.inputSchema.properties as Record<string, unknown>
    expect(properties).toMatchObject(create.properties as Record<string, unknown>)
    expect(properties.patch).toMatchObject({ type: 'object', additionalProperties: false })
    expect(validateToolArguments(tool.name, tool.inputSchema, { leaseHandle: 'lease', operationId: 'op', patch: { parameters: { nested: [null, { x: true }] } } })).toBeNull()
  })

  it('exposes typed candidate/reference/patch fields and rejects malformed metadata', () => {
    for (const args of [
      { candidate: { candidateId: 'one', revision: 'bad' } },
      { references: [{ assetId: 'a', contentHash: 'h', version: 'bad' }] },
      { operationId: 'op', patch: { references: [{ assetId: 'a', contentHash: 'h', version: 'bad' }] } },
    ]) expect(validateToolArguments(tool.name, tool.inputSchema, { leaseHandle: 'lease', ...args })).not.toBeNull()
  })

  it('routes prompt-only shots from both surfaces to the same existing candidate rejection', async () => {
    const shot = { prompt: 'A sunrise' }
    const parsers = {
      record: (value: unknown) => value as Record<string, unknown>,
      candidateFrom: (value: unknown) => generationCandidateSchema.parse(value),
    }
    const binding = { projectId: 'project', immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1 }
    const planning = vi.fn(async ({ params }: { params: Record<string, unknown> }) =>
      draftShotFromPlan((params.shots as unknown[])[0], 0, parsers))
    const adapter = createPiGenerationTransportAdapter(binding, {
      planning, leaseFor: () => ({ ...binding } as ProjectLeaseV2),
    })
    try {
      const laneResult = await adapter.tryExecute({ toolCallId: 'parity', toolName: 'nomi_generation_plan',
        args: { operation: 'create', shots: [shot] } }, new AbortController().signal)
      const external = tool.build({ leaseHandle: 'lease', projectId: binding.projectId, shots: [shot] })
      expect(planning).toHaveBeenCalledWith(expect.objectContaining({ capability: 'create', params: expect.objectContaining({ shots: external.shots }) }))
      expect(laneResult).toMatchObject({ ok: false, code: 'generation_execution_failed' })
      expect(() => draftShotFromPlan((external.shots as unknown[])[0], 0, parsers)).toThrow(laneResult && !laneResult.ok ? laneResult.message : 'Expected shared failure')
    } finally { adapter.dispose() }
  })

})
