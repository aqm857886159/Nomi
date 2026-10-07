import type { DirectorCard } from '../cardSchema'
import { adapt, mutateOracle, type AdaptedProject } from '../adapters'

export const BAIT_MUTATIONS = ['reverse-direction', 'missing-shot', 'out-of-frame', 'no-action'] as const
export type BaitMutation = (typeof BAIT_MUTATIONS)[number]

export type BaitCase = { id: string; card: DirectorCard; promptCard: DirectorCard; mutation: BaitMutation | 'prompt-mismatch'; adapted: AdaptedProject; expectedLow: boolean }

export async function buildBaits(cards: DirectorCard[]): Promise<BaitCase[]> {
  const out: BaitCase[] = []
  // One complete mutation set per batch is enough to test the gate; repeating every
  // mutation for every card multiplies rendering cost without adding detection power.
  for (const card of cards.slice(0, 1)) {
    const base = await adapt(card.prompt, card, 'oracle')
    for (const mutation of BAIT_MUTATIONS) {
      out.push({ id: `${card.id}-${mutation}`, card, promptCard: card, mutation, adapted: { ...base, project: mutateOracle(base.project, mutation) }, expectedLow: true })
    }
  }
  if (cards.length > 1) {
    const a = await adapt(cards[0].prompt, cards[0], 'oracle')
    out.push({ id: `${cards[0].id}-prompt-mismatch`, card: cards[0], promptCard: cards[1], mutation: 'prompt-mismatch', adapted: a, expectedLow: true })
  }
  return out
}
