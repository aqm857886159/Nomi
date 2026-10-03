import { describe, expect, it } from 'vitest'
import { adaptS1Plan } from './s1Adapter'
import { directorPlannerPrompt } from '../../src/workbench/generationCanvas/nodes/director/model/plan/directorPlanner'
import { S1_ORACLE_PLANS } from './s1OraclePlans'

describe('S1 eval adapter', () => {
  it('returns a playable project and stable actor map for a hand-written plan', () => {
    const result = adaptS1Plan(S1_ORACLE_PLANS['courtyard-standoff']); expect('project' in result).toBe(true); if ('project' in result) expect(result.project.scenes[0].timelineTrackOrder.length).toBe(4)
  })
  it('keeps the planner prompt schema-first and coordinate-free', () => {
    const text = directorPlannerPrompt('a person waits at a gate'); expect(text).toContain('Director Plan v2'); expect(text).toContain('Never emit xyz coordinates'); expect(text).toContain('over-shoulder')
  })
})
