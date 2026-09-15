import { describe, expect, it } from 'vitest'
import { createExtendedLaneTools } from './laneExtendedTools'
import { z } from 'zod'
import { flattenDiscriminatedUnion, ConflictingBranchField } from '../shared/agentCapabilities/flatModelInput'
import { modelToolCapabilityId } from '../shared/agentCapabilities/modelFacingTools'
import { timelineEditPlanModelSchema } from '../shared/agentCapabilities/timelineRead'
import { collectVendorCompatibilityFailures, toPublishedJsonSchema } from '../shared/agentCapabilities/modelVisibleJsonSchema'
import { modelFacingToolSpecs } from '../shared/agentCapabilities/modelFacingToolRegistry'
import { LANE_MODEL_TOOL_CATALOG, LANE_TOOL_BUDGET, LANE_DEFERRED_TOOL_CATALOG, LANE_DEFERRED_TOOL_GROUPS } from './laneToolCatalog'

const preserved = ['propose_edit_plan', 'apply_edit_plan', 'undo_timeline_edit',
  'start_production_run', 'review_production_artifact', 'nomi_generation_plan', 'nomi_generation_status',
  'get_media', 'export_timeline', 'cancel_export_job', 'delete_canvas_nodes']

describe('lane extended domain menu', () => {
  it('retains editing, production and media intents in the shared internal profile', () => {
    expect(modelFacingToolSpecs('internal').map(tool => tool.name)).toEqual(expect.arrayContaining(preserved))
  })
  it('keeps the initial menu inside the unchanged budget', () => {
    expect(LANE_TOOL_BUDGET).toBe(12)
    expect(LANE_MODEL_TOOL_CATALOG.length).toBeLessThan(LANE_TOOL_BUDGET)
  })
})


it('every retained tool belongs to exactly one unlockable group', () => {
  const names = LANE_DEFERRED_TOOL_GROUPS.flatMap(group => group.toolNames)
  expect(new Set(names).size).toBe(names.length)
  expect(names.sort()).toEqual(LANE_DEFERRED_TOOL_CATALOG.map(tool => tool.name).sort())
  expect(names.every(name => !LANE_MODEL_TOOL_CATALOG.some(tool => tool.name === name))).toBe(true)
})

it('production parameter preparation preserves run/artifact identity and revision', () => {
  const spec = LANE_DEFERRED_TOOL_CATALOG.find(tool => tool.name === 'review_production_artifact')!
  const args = { runId: 'run-1', artifactId: 'artifact-1', expectedVersion: 2, decision: 'approved' }
  expect(spec.schema.parse(spec.prepareArguments!(JSON.stringify(args)))).toEqual(args)
})

it('generation read operations have read authority while cancel and reconcile remain writes', () => {
  const status = LANE_DEFERRED_TOOL_CATALOG.find(tool => tool.name === 'nomi_generation_status')!
  expect(modelToolCapabilityId(status, { operation: 'read' })).toBe('generation.run.read')
  expect(modelToolCapabilityId(status, { operation: 'cancel' })).toBe('generation.control')
  expect(modelToolCapabilityId(status, { operation: 'reconcile' })).toBe('generation.control')
  expect(modelToolCapabilityId(status, {})).toBe('generation.control')
})

it('published timeline operations have no const and still enforce their original branch', () => {
  const failures: string[] = []
  collectVendorCompatibilityFailures(toPublishedJsonSchema(timelineEditPlanModelSchema), '', failures)
  expect(failures).toEqual([])
  const plan = { planId: 'plan-1', baseRevision: 'revision-1', summary: 'Edit timeline' }
  expect(timelineEditPlanModelSchema.safeParse({ ...plan, operations: [{ kind: 'move', clipId: 'clip-1', startFrame: 0 }] }).success).toBe(true)
  expect(timelineEditPlanModelSchema.safeParse({ ...plan, operations: [{ kind: 'move', clipId: 'clip-1', action: 'remove', startFrame: 0 }] }).success).toBe(false)
})

it('enum merging is opt-in and never relaxes the source branch constraints', () => {
  const schema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('first'), action: z.enum(['one']) }).strict(),
    z.object({ kind: z.literal('second'), action: z.enum(['two']) }).strict(),
  ])
  expect(() => flattenDiscriminatedUnion(schema, { name: 'test' })).toThrow(ConflictingBranchField)
  const flat = flattenDiscriminatedUnion(schema, { name: 'test', mergeEnumFields: ['action'] })
  expect(flat.safeParse({ kind: 'first', action: 'one' }).success).toBe(true)
  expect(flat.safeParse({ kind: 'first', action: 'two' }).success).toBe(false)
  const conflict = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('first'), action: z.string() }),
    z.object({ kind: z.literal('second'), action: z.number() }),
  ])
  expect(() => flattenDiscriminatedUnion(conflict, { name: 'test', mergeEnumFields: ['action'] })).toThrow(ConflictingBranchField)
})

// 2026-09-14：域端口的失败 message 必须到得了模型。常驻生成面的 owner 会把「为什么不在」说清楚
//（按配置关掉 / 还在起 / 装配抛了），这一层若只转发 code，模型仍只能对用户说「暂时不可用」。
describe('domain failure message reaches the model', () => {
  const signal = new AbortController().signal
  const run = async (decision: { ok: false; code: string; message?: string }) => {
    const tool = createExtendedLaneTools({ execute: async () => decision }).find(candidate => candidate.name === 'nomi_generation_status')!
    return tool.execute({ operation: 'read', operationId: 'run-1' }, { toolCallId: 'call-1', signal }) as Promise<{ ok: boolean; failure?: { code: string; message: string } }>
  }
  it('forwards a message that says more than the code', async () => {
    const result = await run({ ok: false, code: 'generation_surface_unavailable', message: "Nomi's resident generation surface is still starting; retry this step in a moment." })
    expect(result.ok).toBe(false)
    expect(result.failure).toMatchObject({ code: 'generation_surface_unavailable', message: expect.stringMatching(/\(generation_surface_unavailable\)\. Nomi's resident generation surface is still starting/) })
  })
  it('does not repeat a message that is only the code', async () => {
    const result = await run({ ok: false, code: 'capability_unsupported', message: 'capability_unsupported' })
    expect(result.failure?.message).toBe('nomi_generation_status could not complete the requested action (capability_unsupported).')
  })
})
