/* global process */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { describe, it } from 'vitest'
import { validateFrameAnalysis, validateGenerationRecord } from '../../scripts/realFilmContinuityContract.mjs'

const require = createRequire(import.meta.url)
const ffprobe = require('@ffprobe-installer/ffprobe').path
const filmDir = process.env.NOMI_REAL_FILM_DIR ? path.resolve(process.env.NOMI_REAL_FILM_DIR) : ''

function findFile(root, predicate) {
  if (!root || !fs.existsSync(root)) return null
  const queue = [root]
  while (queue.length) {
    const current = queue.shift()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name)
      if (entry.isDirectory()) queue.push(target)
      else if (predicate(target, entry.name)) return target
    }
  }
  return null
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

describe('real provider film acceptance (requires NOMI_REAL_FILM_DIR)', () => {
  if (!filmDir) {
    it.skip('not a pass: set NOMI_REAL_FILM_DIR to a real Nomi project after generation and frame review')
    return
  }
  it('requires the actual MP4, production envelope, extracted frames, and reviewed boundaries', () => {
    const film = process.env.NOMI_REAL_FILM ? path.resolve(process.env.NOMI_REAL_FILM) : findFile(filmDir, (target, name) => name.endsWith('.mp4') && target.includes('export'))
    assert.ok(film && fs.existsSync(film), 'real exported MP4 is required')
    const runDir = process.env.NOMI_REAL_FILM_RUN ? path.resolve(process.env.NOMI_REAL_FILM_RUN) : findFile(filmDir, (target, name) => name === 'storyboard-v1.json') && path.dirname(findFile(filmDir, (target, name) => name === 'storyboard-v1.json'))
    assert.ok(runDir && fs.existsSync(runDir), 'real ProductionRun directory is required')
    const analysisFile = process.env.NOMI_REAL_FILM_ANALYSIS ? path.resolve(process.env.NOMI_REAL_FILM_ANALYSIS) : path.join(runDir, 'frame-analysis', 'frame-analysis.json')
    assert.ok(fs.existsSync(analysisFile), 'run analyze-real-film.mjs first; no analysis means no pass')
    const analysis = readJson(analysisFile)
    const frameResult = validateFrameAnalysis(analysis)
    assert.deepEqual(frameResult, { ok: true, errors: [] })
    for (const shot of analysis.shots) {
      for (const relative of Object.values(shot.frames || {})) assert.ok(fs.existsSync(path.join(path.dirname(analysisFile), relative)), `missing extracted frame: ${relative}`)
    }
    for (const boundary of analysis.boundaries) {
      for (const relative of boundary.evidence || []) assert.ok(fs.existsSync(path.join(path.dirname(analysisFile), relative)), `missing boundary evidence: ${relative}`)
    }
    const storyboardPath = findFile(runDir, (_target, name) => name.startsWith('storyboard-v') && name.endsWith('.json'))
    assert.ok(storyboardPath, 'storyboard artifact must be in the same project')
    const storyboard = readJson(storyboardPath)
    const recordPath = findFile(runDir, (_target, name) => name.includes('generation-record') && name.endsWith('.json'))
    assert.ok(recordPath, 'real generation record must be in the same project')
    const record = readJson(recordPath)
    assert.deepEqual(validateGenerationRecord(record), { ok: true, errors: [] })
    assert.equal(record.export?.retry?.shotId, 'shot-4', 'the reviewed real run must retain the targeted shot retry')
    assert.equal(record.video?.shots?.[3]?.retryCount, 1, 'retry lineage must be durable in the generation record')
    assert.ok(record.video?.shots?.[3]?.parentUrl, 'retry must retain the rejected parent asset')
    assert.match(record.video?.shots?.[3]?.prompt || '', /桌子下面必须是空的|桌下为空/, 'retry request must carry the root-cause constraint')
    assert.equal(record.audio?.narration?.length, 6, 'all six story beats must have real generated narration')
    assert.ok(record.audio.narration.every((cue) => cue.url && cue.modelKey), 'narration cues must retain provider assets and model identity')
    record.audio.narration.slice(0, -1).forEach((cue, index) => {
      assert.ok(cue.endSeconds <= record.audio.narration[index + 1].startSeconds, `${cue.shotId} narration must finish before the next shot narration`)
    })
    assert.ok(record.audio.narration.at(-1).endSeconds <= analysis.film.durationSeconds, 'final narration must finish inside the film')
    assert.ok(analysis.audio?.waveform && fs.existsSync(path.join(path.dirname(analysisFile), analysis.audio.waveform)), 'audible waveform evidence is required')
    assert.match(analysis.reviewBasis || '', /第4镜.*桌下没有第二张脸/, 'frame review must name the observed root-cause fix')
    const probe = JSON.parse(require('node:child_process').execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', film], { encoding: 'utf8' }))
    assert.ok(Math.abs(Number(probe.format?.duration) - 30) <= 0.75)
    assert.ok(Array.isArray(storyboard.plan?.shots) && storyboard.plan.shots.length >= 6)
  })
})
