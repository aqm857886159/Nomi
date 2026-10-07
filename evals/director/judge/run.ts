import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { adapt, type Scheme } from '../adapters'
import { parseDirectorCard, type DirectorCard } from '../cardSchema'
import { bindCardEntities } from '../binding'
import { buildBaits } from './bait'
import { crossCheck } from './crossCheck'
import { preregister } from './preregister'
import { renderProject, type RenderedVideo } from './render'
import { summarizePositionProbe, writeReport, type JudgeRecord, type PositionProbe } from './report'
import { reviewOnce, pairwiseOnce } from './review'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const has = (name: string): boolean => process.argv.includes(name)

async function cards(filter?: string): Promise<DirectorCard[]> {
  const all = JSON.parse(await fs.readFile(path.join(root, 'cards/all.json'), 'utf8')) as unknown[]
  const parsed = all.map(parseDirectorCard)
  if (!filter)
    return [
      ...parsed.filter((card) => card.tier === 'benchmark').slice(0, 3),
      ...parsed.filter((card) => card.tier === 'T1' || card.tier === 'T2').slice(0, 6),
    ]
  const requested = new Set(
    filter
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )
  return parsed.filter((card) => requested.has(card.id) || requested.has(card.tier))
}

function runDir(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14)
  return path.resolve(root, '../runs', `director-judge-${stamp}`)
}

async function main(): Promise<void> {
  const schemes = (arg('--schemes') ?? 'oracle,s0-pr960-raw')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean) as Scheme[]
  const selectedCards = await cards(arg('--cards'))
  const repeats = Math.max(1, Number(arg('--repeats') ?? 3))
  const outDir = runDir()
  await fs.mkdir(outDir, { recursive: true })
  const records: JudgeRecord[] = []
  const videos = new Map<string, RenderedVideo>()
  const calibrationVideos: RenderedVideo[] = []
  const calls = {
    preregistration: 0,
    review: 0,
    pairwise: 0,
    fast: 0,
    retries: 0,
    blocked: 0,
    durations: [] as Array<{ kind: string; cardId: string; scheme?: string; repeat?: number; durationMs: number }>,
  }
  const positionProbes: PositionProbe[] = []
  const renderChecks: Array<Record<string, unknown>> = []
  const prereg = new Map<string, Awaited<ReturnType<typeof preregister>>['value']>()
  for (const card of selectedCards) {
    const registrationPath = path.join(outDir, `${card.id}-expectation.json`)
    calls.preregistration += 1
    const registration = await preregister(card, registrationPath)
    if (registration.value) prereg.set(card.id, registration.value)
    if (!registration.value) {
      records.push({ cardId: card.id, scheme: 'all', error: `preregistration failed: ${registration.error}` })
      continue
    }
    for (const scheme of schemes) {
      const key = `${card.id}:${scheme}`
      try {
        const adapted = await adapt(card.prompt, card, scheme)
        const binding = bindCardEntities(
          card,
          adapted.project.scenes.find((scene) => scene.id === adapted.project.activeSceneId) ??
            adapted.project.scenes[0],
        )
        const rendered = await renderProject(adapted.project, path.join(outDir, 'media'), key, {
          subjectIds: new Set(Object.values(binding.actorMap).filter((id): id is string => Boolean(id))),
        })
        videos.set(key, rendered)
        calibrationVideos.push(rendered)
        renderChecks.push({
          cardId: card.id,
          scheme,
          readbackMismatches: rendered.readbackMismatches,
          measurementSideGaps: rendered.measurementSideGaps,
          unanimatedCharacterIds: rendered.unanimatedCharacterIds,
        })
        if (rendered.readbackMismatches.length) {
          records.push({
            cardId: card.id,
            scheme,
            error: `render readback mismatch: ${JSON.stringify(rendered.readbackMismatches)}`,
          })
          continue
        }
        for (let repeat = 0; repeat < repeats; repeat += 1) {
          const review = await reviewOnce(card, registration.value, [rendered.contactSheet])
          calls.review += 1
          calls.durations.push({ kind: 'review', cardId: card.id, scheme, repeat, durationMs: review.durationMs })
          calls.retries += review.retries
          if (review.blocked) calls.blocked += 1
          if (review.fast) calls.fast += 1
          if (review.value) {
            const check = crossCheck(card, adapted, review.value.review)
            records.push({
              cardId: card.id,
              scheme,
              repeat,
              score: review.value.review.userScore,
              judgements: Object.fromEntries(
                review.value.review.segments.map((segment) => [
                  segment.timecode,
                  segment.judgement === 'seen' ? 1 : segment.judgement === 'partial' ? 0.5 : 0,
                ]),
              ),
              crossCheck: check,
              fast: review.fast,
              durationMs: review.durationMs,
            })
          } else
            records.push({
              cardId: card.id,
              scheme,
              repeat,
              error: review.error,
              fast: review.fast,
              durationMs: review.durationMs,
            })
        }
      } catch (error) {
        records.push({ cardId: card.id, scheme, error: error instanceof Error ? error.message : String(error) })
      }
    }
    const leftVideo = videos.get(`${card.id}:${schemes[0]}`)
    const rightVideo = videos.get(`${card.id}:${schemes[1]}`)
    const validVideo = (video: RenderedVideo | undefined): video is RenderedVideo =>
      Boolean(video && video.readbackMismatches.length === 0)
    if (schemes.length >= 2 && validVideo(leftVideo) && validVideo(rightVideo)) {
      const forward = await pairwiseOnce(
        card,
        registration.value,
        leftVideo.contactSheet,
        rightVideo.contactSheet,
        schemes[0],
        schemes[1],
        os.tmpdir(),
        { displayOrder: 'forward' },
      )
      const reverse = await pairwiseOnce(
        card,
        registration.value,
        leftVideo.contactSheet,
        rightVideo.contactSheet,
        schemes[0],
        schemes[1],
        os.tmpdir(),
        { displayOrder: 'reverse' },
      )
      for (const pair of [forward, reverse]) {
        calls.pairwise += 1
        calls.durations.push({ kind: 'pairwise', cardId: card.id, durationMs: pair.durationMs })
        calls.retries += pair.retries
        if (pair.fast) calls.fast += 1
        if (pair.blocked) calls.blocked += 1
      }
      if (positionProbes.length < 3)
        positionProbes.push({ cardId: card.id, forward: forward.displayWinner, reverse: reverse.displayWinner })
      const winner =
        forward.value && reverse.value && forward.value.winner === reverse.value.winner
          ? forward.value.winner
          : 'unclear'
      for (const record of records.filter((item) => item.cardId === card.id && !item.bait))
        record.pairwiseWinner = winner
    }
  }

  if (!has('--no-baits')) {
    for (const bait of await buildBaits(selectedCards)) {
      try {
        const binding = bindCardEntities(
          bait.promptCard,
          bait.adapted.project.scenes.find((scene) => scene.id === bait.adapted.project.activeSceneId) ??
            bait.adapted.project.scenes[0],
        )
        const rendered = await renderProject(bait.adapted.project, path.join(outDir, 'media'), `bait-${bait.id}`, {
          subjectIds: new Set(Object.values(binding.actorMap).filter((id): id is string => Boolean(id))),
        })
        calibrationVideos.push(rendered)
        renderChecks.push({
          cardId: bait.id,
          scheme: 'bait',
          readbackMismatches: rendered.readbackMismatches,
          measurementSideGaps: rendered.measurementSideGaps,
          unanimatedCharacterIds: rendered.unanimatedCharacterIds,
        })
        if (rendered.readbackMismatches.length) {
          records.push({
            cardId: bait.id,
            scheme: 'bait',
            bait: true,
            mutation: bait.mutation,
            error: `render readback mismatch: ${JSON.stringify(rendered.readbackMismatches)}`,
          })
          continue
        }
        const registration = prereg.get(bait.promptCard.id)
        if (!registration) continue
        const review = await reviewOnce(bait.promptCard, registration, [rendered.contactSheet])
        calls.review += 1
        calls.durations.push({ kind: 'review', cardId: bait.id, scheme: 'bait', durationMs: review.durationMs })
        calls.retries += review.retries
        if (review.blocked) calls.blocked += 1
        if (review.fast) calls.fast += 1
        records.push({
          cardId: bait.id,
          scheme: 'bait',
          bait: true,
          mutation: bait.mutation,
          score: review.value?.review.userScore,
          crossCheck: review.value ? crossCheck(bait.promptCard, bait.adapted, review.value.review) : undefined,
          error: review.error,
          fast: review.fast,
          durationMs: review.durationMs,
        })
      } catch (error) {
        records.push({
          cardId: bait.id,
          scheme: 'bait',
          bait: true,
          mutation: bait.mutation,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  await fs.writeFile(
    path.join(outDir, 'calibration-manifest.json'),
    JSON.stringify(
      { items: calibrationVideos.slice(0, 12).map((video) => ({ video: path.relative(outDir, video.video) })) },
      null,
      2,
    ) + '\n',
  )
  await fs.copyFile(path.join(root, 'judge/calibrate.html'), path.join(outDir, 'calibrate.html'))
  const byCard = selectedCards.map((card) => ({
    cardId: card.id,
    segments: records
      .filter((record) => record.cardId === card.id && record.score != null)
      .map((record) => record.score),
    unstable: false,
  }))
  const average = (values: Array<number | undefined>) =>
    values.reduce<number>((sum, value) => sum + (value ?? 0), 0) / Math.max(1, values.length)
  await fs.writeFile(
    path.join(outDir, 'worst-5.json'),
    JSON.stringify(byCard.sort((a, b) => average(a.segments) - average(b.segments)).slice(0, 5), null, 2) + '\n',
  )
  await writeReport(outDir, records, {
    schemes,
    cards: selectedCards.map((card) => card.id),
    repeats,
    generatedAt: new Date().toISOString(),
    calibration: 'unverified',
    calls,
    positionProbe: positionProbes,
    positionPreference: summarizePositionProbe(positionProbes),
    renderChecks,
  })
  console.log(
    JSON.stringify(
      {
        outDir,
        cards: selectedCards.length,
        schemes,
        repeats,
        records: records.length,
        baitRecords: records.filter((record) => record.bait).length,
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
