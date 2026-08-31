import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'vitest'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sampleRoot = path.join(repoRoot, 'artifacts', 'nomi-agentic-draft-film-2026-08-21')
const runRoot = path.join(sampleRoot, '.nomi', 'runs', 'run-agentic-draft-film-30s')
const filmPath = path.join(sampleRoot, 'exports', 'nomi-agentic-draft-film-30s.mp4')

function json(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(runRoot, relativePath), 'utf8'))
}

function ensureSample() {
  if (fs.existsSync(filmPath) && fs.existsSync(path.join(runRoot, 'timeline-v1.json'))) return
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts/benchmarks/build-agentic-draft-film.mjs')], {
    cwd: repoRoot,
    stdio: 'ignore',
    timeout: 120_000,
  })
}

function probeFilm() {
  const ffprobe = require('@ffprobe-installer/ffprobe').path
  return JSON.parse(execFileSync(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,codec_name,duration',
    '-of', 'json', filmPath,
  ], { encoding: 'utf8' }))
}

describe('real 30-second draft film', () => {
  it('passes the media, timeline, provenance, and project persistence contract', () => {
    ensureSample()
    assert.ok(fs.existsSync(filmPath), 'the real acceptance MP4 must exist')
    const script = json('script-v1.json')
    const storyboard = json('storyboard-v1.json')
    const timeline = json('timeline-v1.json').timelineContract
    const run = json('run.json')
    const probe = probeFilm()

    assert.equal(script.kind, 'script')
assert.equal(script.reviewStatus, 'approved')
assert.equal(storyboard.kind, 'storyboard')
assert.equal(storyboard.reviewStatus, 'approved')
assert.equal(storyboard.sourceScriptArtifactId, script.artifactId)
assert.equal(storyboard.sourceScriptVersion, script.version)
assert.equal(storyboard.sourceScriptHash, script.contentHash)
assert.equal(storyboard.plan.shots.length, 8)
assert.equal(timeline.durationFrames, 900)
assert.equal(timeline.clips.length, 8)
assert.ok(timeline.subtitles.length >= 8, 'the rough cut must have a real subtitle track')
assert.ok(timeline.transitions.length >= 2, 'the rough cut must have authored transitions')

for (let index = 0; index < timeline.clips.length; index += 1) {
  const clip = timeline.clips[index]
  assert.equal(clip.startFrame, index === 0 ? 0 : timeline.clips[index - 1].endFrame)
  assert.ok(clip.endFrame > clip.startFrame)
}
for (const subtitle of timeline.subtitles) {
  assert.ok(subtitle.startFrame >= 0 && subtitle.endFrame <= timeline.durationFrames)
  assert.ok(subtitle.endFrame > subtitle.startFrame && subtitle.text.trim())
}
for (const transition of timeline.transitions) {
  const from = timeline.clips.findIndex((clip) => clip.shotId === transition.fromShotId)
  const to = timeline.clips.findIndex((clip) => clip.shotId === transition.toShotId)
  assert.equal(to, from + 1, 'authored transitions must connect adjacent shots')
  assert.ok(['cut', 'dissolve', 'fade', 'match_cut', 'whip_pan'].includes(transition.type))
}

const streams = probe.streams || []
const duration = Number(probe.format?.duration)
assert.ok(Math.abs(duration - 30) < 0.1, `film duration must be ~30s, got ${duration}`)
assert.ok(streams.some((stream) => stream.codec_type === 'video' && stream.codec_name === 'h264'))
assert.ok(streams.some((stream) => stream.codec_type === 'audio' && stream.codec_name === 'aac'))
assert.ok(streams.some((stream) => stream.codec_type === 'subtitle' && Number(stream.duration) <= 30.1))
assert.equal(run.artifacts.find((artifact) => artifact.kind === 'script')?.status, 'adopted')
assert.equal(run.artifacts.find((artifact) => artifact.kind === 'storyboard')?.status, 'adopted')
assert.ok(run.artifacts.some((artifact) => artifact.kind === 'timeline'))
assert.ok(run.skillEvidence?.script?.length >= 1 && run.skillEvidence?.storyboard?.length >= 1)

// This is intentionally an acceptance artifact, not a provider-quality claim.
// The source note must stay truthful if the fixture is regenerated.
assert.match(run.note, /复用.*launch-film|仓库已有.*launch-film/)
    globalThis.console.log('REAL DRAFT FILM CONTRACT PASS: 30s MP4, subtitles, authored transitions, provenance, and project artifacts')
  })
})
