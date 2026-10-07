import fs from 'node:fs/promises'
import path from 'node:path'

export type JudgeRecord = {
  cardId: string
  scheme: string
  repeat?: number
  bait?: boolean
  mutation?: string
  score?: number
  judgements?: Record<string, number>
  pairwiseWinner?: string
  crossCheck?: { checked: number; consistent: number; consistency: number | null; disagreements: unknown[] }
  durationMs?: number
  error?: string
  fast?: boolean
}

export type PositionProbe = {
  cardId: string
  forward?: 'left' | 'right' | 'tie' | 'unclear'
  reverse?: 'left' | 'right' | 'tie' | 'unclear'
}

export function summarizePositionProbe(probes: PositionProbe[]): {
  total: number
  comparable: number
  samePosition: number
  rate: number | null
  flagged: boolean
} {
  const comparable = probes.filter(
    (probe) =>
      (probe.forward === 'left' || probe.forward === 'right') &&
      (probe.reverse === 'left' || probe.reverse === 'right'),
  )
  const samePosition = comparable.filter((probe) => probe.forward === probe.reverse).length
  const rate = comparable.length ? samePosition / comparable.length : null
  return {
    total: probes.length,
    comparable: comparable.length,
    samePosition,
    rate,
    flagged: rate !== null && rate >= 0.5,
  }
}

export async function writeReport(
  outDir: string,
  records: JudgeRecord[],
  meta: Record<string, unknown>,
): Promise<void> {
  const normal = records.filter((record) => !record.bait)
  const baits = records.filter((record) => record.bait)
  const baitDetected = baits.filter((record) => (record.score ?? 5) <= 2).length
  const baitRate = baits.length ? baitDetected / baits.length : null
  const cross = records.flatMap((record) => (record.crossCheck ? [record.crossCheck] : []))
  const checked = cross.reduce((sum, item) => sum + item.checked, 0)
  const consistent = cross.reduce((sum, item) => sum + item.consistent, 0)
  const calls = (meta.calls && typeof meta.calls === 'object' ? meta.calls : {}) as {
    retries?: number
    blocked?: number
  }
  const lines = [
    baitRate !== null && baitRate < 0.9
      ? 'INVALID BATCH: bait detection below 90%; visual conclusions are void.'
      : 'Batch status: provisional (calibration required).',
    '',
    '# Director L5 blind visual judge report',
    '',
    '- Calibration: **uncalibrated**; scores are discovery evidence only and cannot establish scheme superiority.',
    `- Bait detection: ${baitDetected}/${baits.length || 0} (${baitRate === null ? 'unverified' : `${(baitRate * 100).toFixed(1)}%`}).`,
    `- Measurement cross-check: ${checked ? `${consistent}/${checked} (${((consistent / checked) * 100).toFixed(1)}%)` : 'unverified (no measurable claims returned)'}.`,
    `- Review records: ${records.length}; priority-fast review receipts: ${records.filter((record) => record.fast).length}/${records.filter((record) => record.fast !== undefined).length || 0}.`,
    `- JSON schema retries: ${calls.retries ?? 0}; blocked responses: ${calls.blocked ?? 0}.`,
    '',
    '| Card | Scheme | Bait | Score | Pairwise | Cross-check | Status |',
    '|---|---|---:|---:|---|---|---|',
  ]
  for (const record of records)
    lines.push(
      `| ${record.cardId} | ${record.scheme} | ${record.bait ? 'yes' : 'no'} | ${record.score ?? 'unverified'} | ${record.pairwiseWinner ?? 'unverified'} | ${record.crossCheck?.consistency == null ? 'unverified' : `${(record.crossCheck.consistency * 100).toFixed(1)}%`} | ${record.error ? `blocked: ${record.error}` : 'ok'} |`,
    )
  const groups = new Map<string, number[]>()
  for (const record of normal)
    if (record.score != null)
      groups.set(`${record.cardId}:${record.scheme}`, [
        ...(groups.get(`${record.cardId}:${record.scheme}`) ?? []),
        record.score,
      ])
  lines.push(
    '',
    '## Repeats and pairwise summary',
    '',
    '| Card | Scheme | n | Mean | SD | Stability |',
    '|---|---|---:|---:|---:|---|',
  )
  for (const [key, scores] of groups) {
    const [cardId, scheme] = key.split(':')
    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length
    const sd = Math.sqrt(scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / scores.length)
    lines.push(
      `| ${cardId} | ${scheme} | ${scores.length} | ${mean.toFixed(2)} | ${sd.toFixed(2)} | ${sd >= 1 ? 'unstable' : 'stable'} |`,
    )
  }
  const pairwise = [
    ...new Map(
      normal.filter((record) => record.pairwiseWinner).map((record) => [record.cardId, record.pairwiseWinner]),
    ).entries(),
  ]
  const pairwiseCounts = pairwise.reduce<Record<string, number>>((counts, [, winner]) => {
    counts[winner!] = (counts[winner!] ?? 0) + 1
    return counts
  }, {})
  const pairwiseTotal = pairwise.length
  lines.push(
    '',
    `Pairwise receipts by card: ${pairwiseTotal ? pairwise.map(([card, winner]) => `${card}=${winner}`).join(', ') : 'unverified'}.`,
    `Pairwise win rate: ${
      pairwiseTotal
        ? Object.entries(pairwiseCounts)
            .map(
              ([winner, count]) =>
                `${winner} ${count}/${pairwiseTotal} (${((count / pairwiseTotal) * 100).toFixed(1)}%)`,
            )
            .join('; ')
        : 'unverified'
    }.`,
    '',
    '## Raw metadata',
    '',
    '```json',
    JSON.stringify(meta, null, 2),
    '```',
    '',
    '## Reliability notes',
    '',
    '- Each normal review is repeated the requested number of times with randomized frame order. Standard deviation >= 1 is marked unstable and excluded from superiority conclusions.',
    '- Contact sheets and the five worst segments are retained beside this report for human eye review.',
    '- A calibration page is supplied, but no calibration receipt is assumed until a user exports scores and the rank correlation is computed.',
  )
  const positionProbe = (
    meta.positionProbe && typeof meta.positionProbe === 'object' ? meta.positionProbe : []
  ) as PositionProbe[]
  const positionSummary = summarizePositionProbe(positionProbe)
  lines.splice(
    8,
    0,
    `- Position preference probe: ${positionSummary.rate === null ? 'unverified' : `${positionSummary.samePosition}/${positionSummary.comparable} (${(positionSummary.rate * 100).toFixed(1)}%)${positionSummary.flagged ? ' **RED: position bias threshold reached**' : ''}`}.`,
  )
  await fs.writeFile(path.join(outDir, 'report.md'), lines.join('\n') + '\n')
  await fs.writeFile(
    path.join(outDir, 'results.json'),
    JSON.stringify(
      {
        meta,
        records,
        baitRate,
        positionProbe: positionSummary,
        crossCheck: { checked, consistent, consistency: checked ? consistent / checked : null },
      },
      null,
      2,
    ) + '\n',
  )
}
