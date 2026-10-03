import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { parseDirectorCard } from './cardSchema'
import { mutateOracle, oracleForCard } from './adapters'
import { scoreCard, type LayerScores } from './scorer'
/** Layers these tests compare are constrained by their cards; a null here means the card changed. */
const layerOf = (scores: LayerScores, key: 'L1' | 'L2' | 'L3' | 'L4'): number => {
  const value = scores[key]
  if (value === null) throw new Error(`${key} unexpectedly unconstrained`)
  return value
}
const cards = JSON.parse(fs.readFileSync(new URL('./cards/all.json', import.meta.url), 'utf8')) as unknown[]
const card = (id: string) => parseDirectorCard(cards.find((c: any) => c.id === id))
const score = (id: string, mutation?: Parameters<typeof mutateOracle>[1]) => {
  const c = card(id),
    a = oracleForCard(c)
  return mutation ? scoreCard(c, mutateOracle(a.project, mutation)).scores : scoreCard(c, a.project, a.actorMap).scores
}
describe('director scorer directionality', () => {
  it('scores every oracle card above the acceptance target', () => {
    for (const raw of cards) {
      const c = parseDirectorCard(raw),
        a = oracleForCard(c),
        s = scoreCard(c, a.project, a.actorMap)
      expect(s.total, `${c.id}: ${s.reasons.join('; ')}`).toBeGreaterThanOrEqual(0.85)
    }
  })
  it('drops L2 for two T1 cards when the subject leaves frame', () => {
    for (const id of ['t1-05-orbit', 't1-06-follow']) {
      const good = score(id),
        bad = score(id, 'out-of-frame')
      expect(layerOf(good, 'L2') - layerOf(bad, 'L2'), id).toBeGreaterThanOrEqual(0.2)
    }
  })
  it('drops L1/L2 for two T2 cards when a shot is removed', () => {
    for (const id of ['t2-kitchen', 't2-train']) {
      const good = score(id),
        bad = score(id, 'missing-shot')
      expect(layerOf(good, 'L1') - layerOf(bad, 'L1'), id).toBeGreaterThanOrEqual(0.2)
    }
  })
  it('drops L1/L2 for two T3 cards when a shot is removed', () => {
    for (const id of ['t3-storm', 't3-market']) {
      const good = score(id),
        bad = score(id, 'missing-shot')
      expect(layerOf(good, 'L1') - layerOf(bad, 'L1'), id).toBeGreaterThanOrEqual(0.2)
    }
  })
  it('drops L2 when orbit and pan direction are reversed', () => {
    for (const id of ['t1-05-orbit', 't1-03-pan']) {
      const good = score(id),
        bad = score(id, 'reverse-direction')
      expect(layerOf(good, 'L2') - layerOf(bad, 'L2'), id).toBeGreaterThanOrEqual(0.2)
    }
  })
  it('covers benchmark mutations: orbit, out-of-frame, axis, action and unmatched actor', () => {
    const perfume = card('perfume-orbit'),
      pa = oracleForCard(perfume),
      ps = scoreCard(perfume, pa.project, pa.actorMap)
    expect(
      layerOf(ps.scores, 'L2') -
        layerOf(scoreCard(perfume, mutateOracle(pa.project, 'half-orbit'), pa.actorMap).scores, 'L2'),
    ).toBeGreaterThanOrEqual(0.2)
    expect(
      layerOf(ps.scores, 'L2') -
        layerOf(scoreCard(perfume, mutateOracle(pa.project, 'out-of-frame'), pa.actorMap).scores, 'L2'),
    ).toBeGreaterThanOrEqual(0.2)
    const courtyard = card('courtyard-standoff'),
      ca = oracleForCard(courtyard),
      cs = scoreCard(courtyard, ca.project, ca.actorMap)
    expect(
      layerOf(cs.scores, 'L3') -
        layerOf(scoreCard(courtyard, mutateOracle(ca.project, 'no-sidestep'), ca.actorMap).scores, 'L3'),
    ).toBeGreaterThanOrEqual(0.2)
    expect(
      layerOf(cs.scores, 'L3') -
        layerOf(scoreCard(courtyard, mutateOracle(ca.project, 'no-action'), ca.actorMap).scores, 'L3'),
    ).toBeGreaterThanOrEqual(0.2)
    expect(layerOf(scoreCard(courtyard, mutateOracle(ca.project, 'unmatched-actor')).scores, 'L3')).toBeLessThan(
      layerOf(cs.scores, 'L3'),
    )
    const chase = card('police-chase'),
      cha = oracleForCard(chase),
      chs = scoreCard(chase, cha.project, cha.actorMap)
    expect(
      chs.scores.L0 - scoreCard(chase, mutateOracle(cha.project, 'axis-cross'), cha.actorMap).scores.L0,
    ).toBeGreaterThanOrEqual(0)
  })
  it('leaves unconstrained layers out of the total instead of granting them full marks', () => {
    const orbit = card('t1-05-orbit')
    expect(orbit.blocking).toHaveLength(0)
    const a = oracleForCard(orbit),
      s = scoreCard(orbit, a.project, a.actorMap)
    expect(s.scores.L3).toBeNull()
    // A wrong project must not climb back toward 1 on the layers the card never asked about.
    const bad = scoreCard(orbit, mutateOracle(a.project, 'out-of-frame'), a.actorMap)
    expect(bad.total).toBeLessThan(s.total - 0.2)
  })
  it('zeroes the total when the L0 validity gate fails', () => {
    const c = card('courtyard-standoff'),
      a = oracleForCard(c)
    const sunk = JSON.parse(JSON.stringify(a.project))
    const woman = sunk.scenes[0].objects.find((o: any) => o.id === 'woman')
    woman.position.y = -3
    if (woman.motionTrajectory) for (const w of woman.motionTrajectory) w.y = -3
    const s = scoreCard(c, sunk, a.actorMap)
    expect(s.scores.L0).toBe(0)
    expect(s.total).toBe(0)
  })
  it('fails closed when a card introduces an unconfigured action verb', () => {
    const c = card('courtyard-standoff')
    const a = oracleForCard(c)
    const bad = { ...c, blocking: [{ actor: 'woman', verb: 'teleport_actor', window: [0, 1] }] as any }
    expect(() => scoreCard(bad, a.project, a.actorMap)).toThrow(/no scoring predicate/)
  })
})
