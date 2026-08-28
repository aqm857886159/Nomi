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
      'get_media',
      'inspect_media',
      'search_media',
      'inspect_source_range',
      'read_waveform',
      'export_timeline',
      'inspect_export_job',
      'verify_render',
      'cancel_export_job',
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

  it('bounds project media reads and waveform payload size', () => {
    expect(timelineToolDescriptors.search_media.parameters.safeParse({ kinds: ['video'], limit: 100 }).success).toBe(true)
    expect(timelineToolDescriptors.search_media.parameters.safeParse({ kinds: ['document'] }).success).toBe(false)
    expect(timelineToolDescriptors.inspect_source_range.parameters.safeParse({ assetId: 'asset-1', startFrame: 20, endFrame: 10 }).success).toBe(false)
    expect(timelineToolDescriptors.read_waveform.parameters.safeParse({ assetId: 'asset-1', buckets: 257 }).success).toBe(false)
  })

  it('requires revision-bound exports and bounded project job ids', () => {
    expect(timelineToolDescriptors.export_timeline.parameters.safeParse({ expectedRevision: 'revision-1', resolution: '1080p', quality: 'standard' }).success).toBe(true)
    expect(timelineToolDescriptors.export_timeline.parameters.safeParse({ resolution: '1080p' }).success).toBe(false)
    expect(timelineToolDescriptors.export_timeline.parameters.safeParse({ expectedRevision: 'revision-1', aspectRatio: '2:1' }).success).toBe(false)
    expect(timelineToolDescriptors.inspect_export_job.parameters.safeParse({ jobId: '' }).success).toBe(false)
    expect(timelineToolDescriptors.verify_render.parameters.safeParse({ jobId: 'job-1' }).success).toBe(true)
    expect(timelineToolDescriptors.cancel_export_job.parameters.safeParse({ jobId: 'job-1' }).success).toBe(true)
  })
})
