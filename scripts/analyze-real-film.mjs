#!/usr/bin/env node
/** Extract reproducible evidence from a real exported MP4.
 *
 * The script deliberately writes `pending-human-review` verdicts. It never
 * infers narrative continuity from pixels or turns a successful ffprobe into a
 * quality pass. A reviewer (human/VLM) must inspect the generated contact
 * sheets and fill the boundary/narrative verdicts before the acceptance test can
 * pass.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path
const ffprobe = require('@ffprobe-installer/ffprobe').path

function arg(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function die(message) {
  console.error(message)
  process.exitCode = 1
}

function probe(film) {
  return JSON.parse(execFileSync(ffprobe, [
    '-v', 'error', '-show_entries', 'format=duration:stream=index,codec_type,codec_name,duration', '-of', 'json', film,
  ], { encoding: 'utf8' }))
}

function measureAudio(film, duration) {
  const volume = spawnSync(ffmpeg, ['-i', film, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' })
  const volumeLog = `${volume.stdout || ''}\n${volume.stderr || ''}`
  const meanVolumeDb = Number(volumeLog.match(/mean_volume:\s*(-?[\d.]+)\s*dB/i)?.[1])
  const maxVolumeDb = Number(volumeLog.match(/max_volume:\s*(-?[\d.]+)\s*dB/i)?.[1])
  const silence = spawnSync(ffmpeg, ['-i', film, '-map', '0:a:0', '-af', 'silencedetect=noise=-50dB:d=0.5', '-f', 'null', '-'], { encoding: 'utf8' })
  const silenceLog = `${silence.stdout || ''}\n${silence.stderr || ''}`
  const silenceDurations = Array.from(silenceLog.matchAll(/silence_duration:\s*([\d.]+)/gi), (match) => Number(match[1])).filter(Number.isFinite)
  const silentSeconds = silenceDurations.reduce((sum, value) => sum + value, 0)
  return {
    audioMeanVolumeDb: Number.isFinite(meanVolumeDb) ? meanVolumeDb : null,
    audioMaxVolumeDb: Number.isFinite(maxVolumeDb) ? maxVolumeDb : null,
    silenceRatio: duration > 0 ? Math.min(1, silentSeconds / duration) : null,
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function findRunArtifact(runDir, kind) {
  const files = fs.existsSync(runDir) ? fs.readdirSync(runDir).filter((file) => file.endsWith('.json')) : []
  for (const file of files.sort().reverse()) {
    const value = readJson(path.join(runDir, file))
    if (value?.kind === kind || value?.plan?.shots && kind === 'storyboard') return value
  }
  return null
}

function timelineFor(runDir, storyboard, duration) {
  const timeline = findRunArtifact(runDir, 'timeline')
  const clips = timeline?.timelineContract?.clips || timeline?.clips
  if (Array.isArray(clips) && clips.length) return clips.map((clip, index) => ({
    shotId: String(clip.shotId || `shot-${index + 1}`),
    startFrame: Number(clip.startFrame),
    endFrame: Number(clip.endFrame),
  })).filter((clip) => Number.isFinite(clip.startFrame) && Number.isFinite(clip.endFrame) && clip.endFrame > clip.startFrame)
  const shots = Array.isArray(storyboard?.plan?.shots) ? storyboard.plan.shots : Array.isArray(storyboard?.shots) ? storyboard.shots : []
  const fallbackCount = Math.max(6, shots.length)
  const perShot = duration / fallbackCount
  return Array.from({ length: fallbackCount }, (_, index) => ({ shotId: `shot-${index + 1}`, startFrame: Math.round(index * perShot * 30), endFrame: Math.round((index + 1) * perShot * 30) }))
}

function extractFrame(film, timestamp, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  execFileSync(ffmpeg, ['-y', '-ss', String(Math.max(0, timestamp)), '-i', film, '-frames:v', '1', '-q:v', '3', target], { stdio: 'ignore' })
}

function makeTile(inputGlob, target, columns) {
  // Shot ids are authored node ids (for example `gen-v2-video-...`), not
  // necessarily the fallback `shot-1` shape. The input directory is already
  // scoped to either frames or boundaries, so filtering by image type is the
  // durable contract; a shot-id naming convention would silently produce no
  // contact sheet for real ProductionRun exports.
  const files = fs.readdirSync(path.dirname(inputGlob)).filter((file) => file.endsWith('.jpg')).sort()
  if (!files.length) return
  execFileSync(ffmpeg, ['-y', '-pattern_type', 'glob', '-i', inputGlob, '-vf', `scale=320:-2,tile=${columns}x${Math.ceil(files.length / columns)}:padding=8:margin=8`, '-frames:v', '1', '-q:v', '3', target], { stdio: 'ignore' })
}

function makeWaveform(film, target) {
  execFileSync(ffmpeg, ['-y', '-i', film, '-filter_complex', '[0:a:0]aformat=channel_layouts=mono,showwavespic=s=1200x240:colors=0x22c55e[wave]', '-map', '[wave]', '-frames:v', '1', target], { stdio: 'ignore' })
}

function main() {
  const film = path.resolve(arg('--film') || '')
  const runDir = path.resolve(arg('--run') || '')
  const outDir = path.resolve(arg('--out') || path.join(runDir, 'frame-analysis'))
  if (!film || !fs.existsSync(film)) return die(`film not found: ${film}`)
  if (!runDir || !fs.existsSync(runDir)) return die(`run directory not found: ${runDir}`)
  fs.mkdirSync(outDir, { recursive: true })
  const metadata = probe(film)
  const duration = Number(metadata.format?.duration || 0)
  const streams = Array.isArray(metadata.streams) ? metadata.streams : []
  const storyboard = findRunArtifact(runDir, 'storyboard')
  const generationRecord = findRunArtifact(runDir, 'real-provider-generation-record')
  const clips = timelineFor(runDir, storyboard, duration)
  const audioMetrics = measureAudio(film, duration)
  const framesDir = path.join(outDir, 'frames')
  const boundariesDir = path.join(outDir, 'boundaries')
  fs.mkdirSync(framesDir, { recursive: true })
  fs.mkdirSync(boundariesDir, { recursive: true })
  const shotEntries = []
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index]
    const start = clip.startFrame / 30
    const end = clip.endFrame / 30
    const span = Math.max(0.1, end - start)
    const safeEnd = Math.max(0, duration - 0.15)
    const next = clips[index + 1]
    // The timeline clip ranges overlap where the authored xfade lives. Keep
    // shot evidence outside that overlap; boundary evidence below samples the
    // transition separately. Otherwise a “late” shot frame can be a ghosted
    // composite and falsely look like a provider continuity defect.
    const overlap = next ? Math.max(0, (end - next.startFrame / 30)) : 0
    const contentMargin = 0.12
    const early = start + contentMargin + (index > 0 ? overlap : 0)
    const late = end - contentMargin - overlap
    const entry = { shotId: clip.shotId, frames: {}, timestampsSeconds: { early: Math.min(early, safeEnd), middle: Math.min(start + span / 2, safeEnd), late: Math.min(Math.max(start, late), safeEnd) } }
    for (const [label, timestamp] of Object.entries(entry.timestampsSeconds)) {
      const filename = `${clip.shotId}-${label}.jpg`
      extractFrame(film, timestamp, path.join(framesDir, filename))
      entry.frames[label] = path.join('frames', filename)
    }
    shotEntries.push(entry)
  }
  const boundaries = []
  for (let index = 0; index < clips.length - 1; index += 1) {
    const left = clips[index]
    const right = clips[index + 1]
    const cut = right.startFrame / 30
    const overlap = Math.max(0, (left.endFrame - right.startFrame) / 30)
    const entry = {
      fromShotId: left.shotId,
      toShotId: right.shotId,
      timestampsSeconds: { fromTail: Math.max(0, cut - overlap - 0.08), cut: Math.min(cut, Math.max(0, duration - 0.15)), toHead: Math.min(Math.max(0, duration - 0.15), cut + overlap + 0.08) },
      evidence: [],
      spatialContinuity: 'pending-human-review',
      causalHandoff: 'pending-human-review',
      characterState: 'pending-human-review',
      verdict: 'pending-human-review',
    }
    for (const [label, timestamp] of Object.entries(entry.timestampsSeconds)) {
      const filename = `${left.shotId}-to-${right.shotId}-${label}.jpg`
      extractFrame(film, timestamp, path.join(boundariesDir, filename))
      entry.evidence.push(path.join('boundaries', filename))
    }
    boundaries.push(entry)
  }
  makeTile(path.join(framesDir, '*.jpg'), path.join(outDir, 'shot-contact-sheet.jpg'), 3)
  makeTile(path.join(boundariesDir, '*.jpg'), path.join(outDir, 'boundary-contact-sheet.jpg'), 3)
  const waveformFile = path.join(outDir, 'audio-waveform.png')
  makeWaveform(film, waveformFile)
  const analysis = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    filmPath: path.basename(film),
    film: {
      durationSeconds: duration,
      videoCodec: streams.find((stream) => stream.codec_type === 'video')?.codec_name || '',
      audioCodec: streams.find((stream) => stream.codec_type === 'audio')?.codec_name || '',
      subtitleDurationSeconds: Number(streams.find((stream) => stream.codec_type === 'subtitle')?.duration || 0) || null,
      ...audioMetrics,
    },
    audio: {
      narrationCueCount: Array.isArray(generationRecord?.audio?.narration) ? generationRecord.audio.narration.length : 0,
      waveform: path.basename(waveformFile),
      verdict: 'pending-human-review',
    },
    shots: shotEntries,
    boundaries,
    narrative: { openingGoal: false, development: false, turn: false, result: false, verdict: 'pending-human-review' },
    reviewInstructions: '请先看 shot-contact-sheet.jpg，再看 boundary-contact-sheet.jpg；逐项填写 boundaries 的四个 verdict 和 narrative 四个布尔证据。不得根据文件可播放直接通过。',
  }
  fs.writeFileSync(path.join(outDir, 'frame-analysis.json'), `${JSON.stringify(analysis, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ outDir, durationSeconds: duration, shotCount: clips.length, boundaryCount: boundaries.length }, null, 2))
}

main()
