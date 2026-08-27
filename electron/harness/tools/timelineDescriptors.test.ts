import { describe, expect, it } from 'vitest'
import { timelineEditPlanSchema, timelineToolDescriptors, timelineToolNames } from './timelineDescriptors'

describe('timeline Agent tool descriptors', () => {
  it('exposes the control-plane tools', () => {
    expect(timelineToolNames).toEqual([
      'read_timeline',
      'inspect_timeline_range',
      'propose_edit_plan',
      'apply_edit_plan',
      'undo_timeline_edit',
    ])
  })

  it('accepts the P0 operation vocabulary and rejects empty plans', () => {
    const valid = timelineEditPlanSchema.safeParse({
      planId: 'p1', baseRevision: 'deadbeef', summary: 'trim intro',
      operations: [{ kind: 'trim', clipId: 'clip-a', edge: 'right', deltaFrame: -3 }],
    })
    expect(valid.success).toBe(true)
    expect(timelineEditPlanSchema.safeParse({ planId: 'p1', baseRevision: 'deadbeef', summary: 'empty', operations: [] }).success).toBe(false)
  })

  it('requires the Agent undo token and expected revision', () => {
    const schema = timelineToolDescriptors.undo_timeline_edit.parameters
    expect(schema.safeParse({ reason: 'undo it' }).success).toBe(false)
    expect(schema.safeParse({ undoToken: 'timeline-undo:p1:deadbeef', expectedRevision: 'deadbeef' }).success).toBe(true)
  })
})
