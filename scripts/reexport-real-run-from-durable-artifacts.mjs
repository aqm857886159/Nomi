import fs from 'node:fs'
import path from 'node:path'

import { buildProductionExportTimeline } from '../dist-electron/productionRun/productionRunExportTimeline.js'
import { compileFfmpegFiltergraph } from '../dist-electron/export/ffmpegFiltergraph.js'
import { renderFiltergraphToMp4 } from '../dist-electron/export/ffmpegRunner.js'

const projectRoot = process.argv[2]
const runId = process.argv[3]
if (!projectRoot || !runId) throw new Error('usage: node scripts/reexport-real-run-from-durable-artifacts.mjs <projectRoot> <runId>')

const runRoot = path.join(projectRoot, '.nomi', 'runs', runId)
const runEnvelope = JSON.parse(fs.readFileSync(path.join(runRoot, 'run.json'), 'utf8'))
const run = runEnvelope.run || runEnvelope
const timelineDocument = JSON.parse(fs.readFileSync(path.join(runRoot, 'timeline-v1.json'), 'utf8'))
const jobRoot = path.join(projectRoot, '.nomi', 'jobs')
const jobDirs = fs.existsSync(jobRoot) ? fs.readdirSync(jobRoot).map((name) => path.join(jobRoot, name)) : []
const previousManifestPath = jobDirs.map((dir) => path.join(dir, 'manifest.json')).find((file) => fs.existsSync(file))
if (!previousManifestPath) throw new Error('previous export manifest not found')
const previousManifest = JSON.parse(fs.readFileSync(previousManifestPath, 'utf8'))
const timeline = buildProductionExportTimeline({
  projectId: run.projectId,
  arrangement: timelineDocument.arrangement,
  jobs: run.jobs,
  artifacts: run.artifacts,
})
const videoTrack = timeline.tracks.find((track) => track.type === 'video')
if (!videoTrack || videoTrack.clips.length === 0) throw new Error('durable timeline has no video clips')

const assets = Object.fromEntries(videoTrack.clips.map((clip) => {
  const relativePath = decodeURIComponent(clip.url.split('/').slice(4).join('/'))
  return [clip.id, {
    id: clip.id,
    kind: 'video',
    absolutePath: path.join(projectRoot, relativePath),
    hasAudio: true,
  }]
}))
const manifest = {
  version: 1,
  projectId: run.projectId,
  createdAt: new Date().toISOString(),
  timeline: {
    fps: timeline.fps,
    durationFrames: timelineDocument.timelineContract.durationFrames,
    range: { startFrame: 0, endFrame: timelineDocument.timelineContract.durationFrames },
    tracks: timeline.tracks.map((track) => ({
      id: track.id,
      kind: track.type,
      type: track.type,
      clips: track.clips.map((clip) => ({
        id: clip.id,
        assetId: clip.id,
        startFrame: clip.startFrame,
        endFrame: clip.endFrame,
        sourceStartFrame: 0,
        sourceEndFrame: clip.frameCount,
      })),
    })),
  },
  transitions: timeline.transitions?.map((transition) => ({
    fromClipId: transition.fromClipId,
    toClipId: transition.toClipId,
    type: transition.type,
    ...(transition.durationFrames ? { durationFrames: transition.durationFrames } : {}),
  })),
  profile: {
    ...previousManifest.profile,
    audioCodec: 'aac',
    audioMode: 'mixdown',
    audioBitrateKbps: 192,
  },
  assets,
  diagnostics: { warnings: ['Re-exported from durable ProductionRun arrange artifact for seam verification.'] },
}

const previousJobDir = path.dirname(previousManifestPath)
const textOverlays = (process.env.NOMI_REEXPORT_NO_TEXT === '1' ? [] : (previousManifest.textOverlays || []).map((overlay, index) => ({
  path: path.join(previousJobDir, `text-overlay-${index}.png`),
  startFrame: overlay.startFrame,
  endFrame: overlay.endFrame,
})))
const filtergraph = compileFfmpegFiltergraph({ manifest, textOverlays })
fs.writeFileSync(path.join(runRoot, 'durable-export-filtergraph.txt'), filtergraph.filterComplex)
const outputName = `nomi-${runId}-durable-export.mp4`
const result = await renderFiltergraphToMp4({
  projectDir: projectRoot,
  outputName,
  profile: manifest.profile,
  filtergraph,
  durationMs: (manifest.timeline.durationFrames / manifest.timeline.fps) * 1000,
})
console.log(JSON.stringify({ ...result, manifest: { clips: videoTrack.clips.length, subtitles: timeline.textClips.length, transitions: timeline.transitions?.length || 0 } }, null, 2))
