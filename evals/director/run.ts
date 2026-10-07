import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDirectorCard, type DirectorCard } from './cardSchema'
import { adapt, type Scheme } from './adapters'
import { scoreCard, type CardScore } from './scorer'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const elapsedMs = (start: number) => Math.round((performance.now() - start) * 10) / 10
async function loadCards(filter?: string): Promise<DirectorCard[]> {
  const raw = JSON.parse(await fs.readFile(path.join(root, 'cards/all.json'), 'utf8')) as unknown[]
  const cards = raw.map(parseDirectorCard)
  return filter ? cards.filter((c) => c.id.includes(filter) || c.tier === filter) : cards
}
/** `—` = the card does not constrain this layer (left out of the total). */
const layer = (value: number | null) => (value === null ? '—' : value.toFixed(2))
function report(scheme: Scheme, scores: CardScore[]): string {
  const avg = (subset: CardScore[], key: keyof CardScore['scores']) => {
    const values = subset
      .map((score) => score.scores[key])
      .filter((value): value is number => typeof value === 'number')
    return values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(3) : 'unverified'
  }
  const averageTotal = (subset: CardScore[]) =>
    (subset.reduce((sum, score) => sum + score.total, 0) / Math.max(1, subset.length)).toFixed(3)
  const lines = [
    `# Director 3D-BOX report: ${scheme}`,
    '',
    `Cards: ${scores.length}`,
    `Average total (L0-L4 and P normalized; L5 unverified): ${averageTotal(scores)}`,
    '',
    '| Card | Tier | Status | L0 | L1 | L2 | L3 | L4 | P | Correspondence | Total | Reasons |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|',
  ]
  for (const score of scores)
    lines.push(
      `| ${score.cardId} | ${score.tier ?? '-'} | ${score.status ?? 'ok'} | ${score.scores.L0.toFixed(2)} | ${layer(score.scores.L1)} | ${layer(score.scores.L2)} | ${layer(score.scores.L3)} | ${layer(score.scores.L4)} | ${layer(score.scores.P)} | ${(score.correspondenceRate * 100).toFixed(1)}% | ${score.total.toFixed(3)} | ${score.reasons.join('; ').replaceAll('|', '/')} |`,
    )
  lines.push(
    '',
    '## Summary',
    '',
    `- L0: ${avg(scores, 'L0')}`,
    `- L1: ${avg(scores, 'L1')}`,
    `- L2 motion + framing: ${avg(scores, 'L2')}`,
    `- L3 blocking: ${avg(scores, 'L3')}`,
    `- L4 scene: ${avg(scores, 'L4')}`,
    `- P physical (6 criteria, s1 schemes only): ${avg(scores, 'P')}`,
    `- Correspondence rate: ${((scores.reduce((sum, score) => sum + score.correspondenceRate, 0) / Math.max(1, scores.length)) * 100).toFixed(1)}%`,
    '- L5 overall: unverified (no visual model run)',
  )
  const capabilityGaps = [
    ...new Set(
      scores.flatMap((score) =>
        score.reasons.filter(
          (reason) => reason.includes('能力缺口') || reason.includes('缺少演员') || reason.includes('场景缺少'),
        ),
      ),
    ),
  ]
  lines.push(
    '',
    '## Capability gaps',
    '',
    ...(capabilityGaps.length ? capabilityGaps.map((gap) => `- ${gap}`) : ['- none observed']),
  )
  for (const tier of ['benchmark', 'T1', 'T2', 'T3']) {
    const subset = scores.filter((score) => score.tier === tier)
    if (subset.length) lines.push(`- ${tier} total mean: ${averageTotal(subset)} (${subset.length} cards)`)
  }
  return lines.join('\n')
}

function adapterErrorScore(card: DirectorCard, error: unknown): CardScore {
  const message = error instanceof Error ? error.message : String(error)
  return {
    cardId: card.id,
    tier: card.tier,
    status: 'adapter_error',
    scores: { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0, P: null, L5: 'unverified' },
    total: 0,
    reasons: [`adapter_error: ${message}`],
    measurements: { fps: 30, duration: card.duration?.total ?? 0, frames: [], cuts: [] },
    correspondenceRate: 0,
  }
}

async function main() {
  const scheme = (arg('--scheme') ?? 'oracle') as Scheme
  if (!['oracle', 's0-pr960-raw', 's0-pr960-ideal', 's1', 's1-oracle-plan'].includes(scheme))
    throw new Error(`unknown scheme: ${scheme}`)
  const filter = arg('--cards')
  const cards = await loadCards(filter)
  const idealIds = new Set(['police-chase', 'perfume-orbit', 'courtyard-standoff'])
  if (scheme === 's0-pr960-ideal' && filter && cards.some((c) => !idealIds.has(c.id)))
    throw new Error(
      `s0-pr960-ideal only accepts police-chase, perfume-orbit, courtyard-standoff; filter ${filter} selected another card`,
    )
  const selected = scheme === 's0-pr960-ideal' ? cards.filter((c) => idealIds.has(c.id)) : cards
  const scores: CardScore[] = []
  const metadata: Record<string, unknown> = {}
  for (const card of selected) {
    const started = performance.now()
    try {
      const adapted = await adapt(card.prompt, card, scheme)
      scores.push(scoreCard(card, adapted.project, adapted.actorMap, adapted.anchors, adapted.spatial))
      metadata[card.id] = { elapsedMs: elapsedMs(started), ...adapted.metadata }
    } catch (error) {
      scores.push(adapterErrorScore(card, error))
      const planner =
        error && typeof error === 'object' && 'planner' in error ? (error as { planner?: unknown }).planner : undefined
      metadata[card.id] = { elapsedMs: elapsedMs(started), planner }
    }
  }
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14)
  const out = path.resolve(root, '../runs', `director-${stamp}-${scheme}`)
  await fs.mkdir(out, { recursive: true })
  await fs.writeFile(
    path.join(out, 'scores.json'),
    JSON.stringify({ scheme, generatedAt: new Date().toISOString(), scores, metadata }, null, 2),
  )
  await fs.writeFile(path.join(out, 'report.md'), report(scheme, scores))
  console.log(
    JSON.stringify(
      {
        scheme,
        cards: scores.length,
        out,
        total: scores.reduce((a, b) => a + b.total, 0) / Math.max(1, scores.length),
        adapterErrors: scores.filter((score) => score.status === 'adapter_error').length,
      },
      null,
      2,
    ),
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
