import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { parseDirectorCard } from './cardSchema'
import { scorerConfig } from './scorer'
const cards = JSON.parse(fs.readFileSync(new URL('./cards/all.json', import.meta.url), 'utf8')) as unknown[]
describe('director card integrity', () => {
  it('has closed actor, timeline and scoring vocabularies', () => {
    for (const raw of cards) {
      const card = parseDirectorCard(raw)
      const actors = new Set(card.actors.map((a) => a.id))
      for (const shot of card.shots)
        for (const id of [...(shot.subject ? [shot.subject.split('.')[0]] : []), ...(shot.subjects ?? [])])
          expect(actors.has(id), `${card.id}: missing actor ${id}`).toBe(true)
      for (const action of card.blocking)
        expect(actors.has(action.actor), `${card.id}: missing blocking actor ${action.actor}`).toBe(true)
      if (card.tier === 'T1')
        for (const actor of card.actors)
          for (const alias of actor.aliases)
            expect(
              alias === actor.id || card.prompt.toLowerCase().includes(alias.toLowerCase()),
              `${card.id}: unrelated actor alias ${alias}`,
            ).toBe(true)
      const windows = card.shots.map((s) => s.t).filter((t): t is [number, number] => !!t)
      for (let i = 1; i < windows.length; i++)
        expect(windows[i][0], `${card.id}: overlapping windows`).toBeGreaterThanOrEqual(windows[i - 1][1])
      if (card.duration?.total)
        for (const [a, b] of windows) {
          expect(a).toBeGreaterThanOrEqual(0)
          expect(b).toBeLessThanOrEqual(card.duration.total)
        }
      for (const shot of card.shots)
        if (shot.move) expect(scorerConfig.motionRules, `${card.id}: unknown move ${shot.move}`).toContain(shot.move)
      for (const action of card.blocking)
        expect(scorerConfig.actionRules, `${card.id}: unknown verb ${action.verb}`).toContain(action.verb)
      if (card.tier === 'T3') {
        expect(card.actors.length, `${card.id}: T3 needs actors`).toBeGreaterThanOrEqual(1)
        expect(card.scene.required.length, `${card.id}: T3 needs scene`).toBeGreaterThan(0)
        expect(card.coverageRequired.length, `${card.id}: T3 needs coverage`).toBeGreaterThan(0)
        expect(card.moveAnyOf?.length, `${card.id}: T3 needs a movement family`).toBeGreaterThan(0)
        expect(
          card.shots.some((s) => s.t),
          `${card.id}: T3 must not fix shot windows`,
        ).toBe(false)
      }
    }
  })
  it('keeps at least 30% of each tier measurable by direction/amplitude/time', () => {
    for (const tier of ['T1', 'T2', 'T3'] as const) {
      const group = cards.map(parseDirectorCard).filter((c) => c.tier === tier)
      const measured = group.filter(
        (c) =>
          c.shots.some((s) => s.t || s.direction || s.sweepDeg !== undefined) ||
          (c.tier === 'T3' && c.coverageRequired.length > 0 && (c.moveAnyOf?.length ?? 0) > 0),
      ).length
      expect(measured / group.length, tier).toBeGreaterThanOrEqual(0.3)
    }
  })
})
