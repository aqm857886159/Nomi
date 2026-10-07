import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { adaptS1Plan } from './s1Adapter'
import { directorPlannerPrompt } from '../../src/workbench/generationCanvas/nodes/director/model/plan/directorPlanner'
import { S1_ORACLE_PLANS } from './s1OraclePlans'
import { findActionEntry, PLANNER_ACTION_IDS } from '../../src/workbench/generationCanvas/nodes/director/model/actionLibrary'

const cardIds = (JSON.parse(readFileSync(new URL('./cards/all.json', import.meta.url), 'utf8')) as Array<{ id: string }>).map(
  (card) => card.id,
)
const oracleShotIds = Object.values(S1_ORACLE_PLANS).flatMap((plan) => plan.shots.map((shot) => shot.id))

function quotedJsonId(id: string): RegExp {
  return new RegExp(`"id":"${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`)
}

describe('S1 eval adapter', () => {
  it('returns a playable project and stable actor map for a hand-written plan', () => {
    const result = adaptS1Plan(S1_ORACLE_PLANS['courtyard-standoff']); expect('project' in result).toBe(true); if ('project' in result) expect(result.project.scenes[0].timelineTrackOrder.length).toBe(4)
  })
  it('keeps the planner prompt schema-first and coordinate-free', () => {
    const text = directorPlannerPrompt('a person waits at a gate')
    expect(text).toContain('Director Plan v2')
    expect(text).toContain('Never emit xyz coordinates')
    expect(text).toContain('over_shoulder')
    for (const cardId of cardIds) expect(text).not.toContain(cardId)
    for (const shotId of oracleShotIds) expect(text).not.toMatch(quotedJsonId(shotId))
  })

  it('动作词表从动作库生成：列出的每个 id 都在库里，旧 Mixamo id 不再出现', () => {
    const text = directorPlannerPrompt('a person waits at a gate')
    const listed = text.match(/action ids are ([^.]+)\./)?.[1].split('|') ?? []
    expect(listed).toEqual([...PLANNER_ACTION_IDS])
    expect(listed.length).toBeGreaterThanOrEqual(12)
    expect(listed.length).toBeLessThanOrEqual(16)
    for (const id of listed) expect(findActionEntry(id), id).toBeDefined()
    for (const legacy of ['standing_idle', 'standard_walk', 'kneeling_idle', 'male_sitting_pose']) expect(text).not.toContain(legacy)
  })
})
