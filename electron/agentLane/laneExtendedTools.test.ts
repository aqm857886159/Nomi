import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { flattenDiscriminatedUnion, ConflictingBranchField } from '../shared/agentCapabilities/flatModelInput'
import { modelToolCapabilityId } from '../shared/agentCapabilities/modelFacingTools'
import { timelineEditPlanModelSchema } from '../shared/agentCapabilities/timelineRead'
import { collectVendorCompatibilityFailures, toPublishedJsonSchema } from '../shared/agentCapabilities/modelVisibleJsonSchema'
import { modelFacingToolSpecs } from '../shared/agentCapabilities/modelFacingToolRegistry'
import { LANE_MODEL_TOOL_CATALOG, LANE_TOOL_BUDGET, LANE_DEFERRED_TOOL_CATALOG, LANE_DEFERRED_TOOL_GROUPS } from './laneToolCatalog'

const preserved = ['edit_timeline', 'undo', 'export_video',
  'make_artifact', 'stage_shot', 'draft_shots', 'check_job',
  'look_at_media', 'cancel_job', 'delete_from_canvas']

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
  const spec = LANE_DEFERRED_TOOL_CATALOG.find(tool => tool.name === 'draft_shots')!
  const args = { shots: [{ prompt: 'Fixture shot', taskKind: 'text_to_image' }] }
  expect(spec.schema.parse(spec.prepareArguments!(JSON.stringify(args)))).toEqual(args)
})

it('generation read operations have read authority while cancel and reconcile remain writes', () => {
  const status = LANE_MODEL_TOOL_CATALOG.find(tool => tool.name === 'check_job')!
  expect(modelToolCapabilityId(status, {})).toBe('generation.run.read')
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
