#!/usr/bin/env node
/**
 * BENCHMARK_ONLY: this file is frozen media-contract evidence, not a Nomi
 * ProductionRun/MCP entrypoint. It intentionally writes a deterministic
 * fixture and must never be used to claim an end-to-end product run.
 *
 * Build the local, visual acceptance sample for the agentic production path.
 *
 * This intentionally uses the repository's existing high-quality launch film as
 * source media, then applies the same final concerns the production contract
 * owns: a 30-second contiguous timeline, project-local export, Chinese captions,
 * and authored transition metadata. It does not claim a provider generation.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname)
const sampleRoot = path.join(repoRoot, 'artifacts', 'nomi-agentic-draft-film-2026-08-21')
const exportDir = path.join(sampleRoot, 'exports')
const runDir = path.join(sampleRoot, '.nomi', 'runs', 'run-agentic-draft-film-30s')
const sourceVideo = path.join(repoRoot, 'marketing', 'assets', 'video', 'launch-film-en.mp4')
const sourceVtt = path.join(repoRoot, 'marketing', 'assets', 'video', 'launch-film-zh.vtt')
const outputVideo = path.join(exportDir, 'nomi-agentic-draft-film-30s.mp4')
const trimmedVtt = path.join(sampleRoot, 'subtitles-30s.vtt')

function ensureInputs() {
  if (!fs.existsSync(sourceVideo)) throw new Error(`missing source video: ${sourceVideo}`)
  if (!fs.existsSync(sourceVtt)) throw new Error(`missing subtitle source: ${sourceVtt}`)
}

function parseTimestamp(value) {
  const parts = value.trim().split(':').map(Number)
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  throw new Error(`invalid VTT timestamp: ${value}`)
}

function readSubtitles() {
  const text = fs.readFileSync(sourceVtt, 'utf8').replace(/^WEBVTT\s*/i, '')
  return text.split(/\n\s*\n/).flatMap((block) => {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const timingIndex = lines.findIndex((line) => line.includes('-->'))
    if (timingIndex < 0) return []
    const [start, end] = lines[timingIndex].split('-->').map((part) => part.trim().split(/\s+/)[0])
    const caption = lines.slice(timingIndex + 1).join(' ').trim()
    if (!caption) return []
    return [{ startFrame: Math.round(parseTimestamp(start) * 30), endFrame: Math.round(parseTimestamp(end) * 30), text: caption, style: 'caption' }]
  }).filter((cue) => cue.startFrame < 900 && cue.endFrame > 0)
    .map((cue) => ({ ...cue, startFrame: Math.max(0, cue.startFrame), endFrame: Math.min(900, cue.endFrame) }))
}

function buildTimeline(subtitles) {
  const durations = [120, 120, 120, 120, 120, 120, 120, 60]
  let cursor = 0
  const clips = durations.map((duration, index) => {
    const clip = { shotId: `shot-${index + 1}`, startFrame: cursor, endFrame: cursor + duration }
    cursor += duration
    return clip
  })
  return {
    fps: 30,
    durationFrames: 900,
    clips,
    subtitles,
    // These are explicit hard cuts. The exporter already renders them normally;
    // omitted boundaries remain semantically different from authored transitions.
    transitions: [
      { fromShotId: 'shot-2', toShotId: 'shot-3', type: 'cut' },
      { fromShotId: 'shot-4', toShotId: 'shot-5', type: 'cut' },
      { fromShotId: 'shot-6', toShotId: 'shot-7', type: 'cut' },
    ],
  }
}

function vttTime(frame) {
  const totalMs = Math.round((frame / 30) * 1000)
  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const seconds = Math.floor((totalMs % 60_000) / 1000)
  const millis = totalMs % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

function writeTrimmedVtt(subtitles) {
  const blocks = subtitles.map((cue, index) => `${index + 1}\n${vttTime(cue.startFrame)} --> ${vttTime(cue.endFrame)}\n${cue.text}`)
  fs.mkdirSync(sampleRoot, { recursive: true })
  fs.writeFileSync(trimmedVtt, `WEBVTT\n\n${blocks.join('\n\n')}\n`, 'utf8')
}

function writeJson(relativePath, value) {
  const target = path.join(sampleRoot, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function buildFilm() {
  fs.mkdirSync(exportDir, { recursive: true })
  execFileSync('ffmpeg', [
    '-y', '-ss', '0', '-t', '30', '-i', sourceVideo, '-i', trimmedVtt,
    '-map', '0:v:0', '-map', '0:a:0?', '-map', '1:0',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-c:s', 'mov_text', '-movflags', '+faststart', outputVideo,
  ], { stdio: 'inherit' })
}

function writeProjectArtifacts(timeline, scriptContent, sourceHash) {
  const scriptHash = createHash('sha256').update(scriptContent).digest('hex')
  const scriptArtifactId = 'artifact-script-v1'
  const storyboardArtifactId = 'artifact-storyboard-v1'
  const createdAt = new Date().toISOString()
  const plan = {
    title: 'Nomi agentic production 30s acceptance film',
    sourceScriptArtifactId: scriptArtifactId,
    sourceScriptVersion: 1,
    sourceScriptHash: scriptHash,
    anchors: [{ id: 'nomi-world', kind: 'style', label: 'Nomi dark workspace / warm accent', description: '黑色工作台、暖色强调线、专业剪辑节奏。' }],
    shots: timeline.clips.map((clip, index) => ({
      index: index + 1,
      shotId: clip.shotId,
      shotKind: 'video',
      durationSec: (clip.endFrame - clip.startFrame) / 30,
      anchorIds: ['nomi-world'],
      prompt: `Nomi product film shot ${index + 1}: show the workflow moving from intent to an editable result.`,
      ffDesc: '深色专业工作台，画面中心保持清晰的工作对象与暖色强调线。',
      motionDesc: '镜头平稳推进，界面和内容按节奏出现，保持文字可读。',
      lfDesc: '镜头落在可继续编辑的项目状态，不改变工作台身份。',
      variationType: index === 0 || index === 6 ? 'large' : 'small',
      camIdx: index % 3,
      continuity: { world: 'nomi-world', previousShot: index ? `shot-${index}` : null },
      subtitle: timeline.subtitles.find((cue) => cue.startFrame >= clip.startFrame && cue.startFrame < clip.endFrame)?.text,
      transition: (() => {
        const transition = timeline.transitions.find((candidate) => candidate.fromShotId === clip.shotId)
        return transition ? { type: transition.type, ...(transition.durationFrames ? { durationFrames: transition.durationFrames } : {}) } : undefined
      })(),
    })),
  }
  writeJson(path.join('.nomi', 'runs', 'run-agentic-draft-film-30s', 'script-v1.json'), {
    schemaVersion: 1, kind: 'script', artifactId: scriptArtifactId, version: 1, source: 'external-mcp',
    content: scriptContent, contentHash: scriptHash, reviewStatus: 'approved', createdAt,
  })
  writeJson(path.join('.nomi', 'runs', 'run-agentic-draft-film-30s', 'storyboard-v1.json'), {
    schemaVersion: 1, kind: 'storyboard', artifactId: storyboardArtifactId, version: 1, source: 'external-mcp',
    sourceArtifactId: scriptArtifactId, sourceVersion: 1, sourceContentHash: scriptHash, sourceScriptArtifactId: scriptArtifactId,
    sourceScriptVersion: 1, sourceScriptHash: scriptHash, reviewStatus: 'approved', planHash: createHash('sha256').update(JSON.stringify(plan)).digest('hex'), plan, createdAt,
  })
  writeJson(path.join('.nomi', 'runs', 'run-agentic-draft-film-30s', 'timeline-v1.json'), {
    schemaVersion: 1, kind: 'timeline', artifactId: 'artifact-timeline-v1', version: 1, source: 'external-mcp',
    timelineContract: timeline, media: { relativePath: 'exports/nomi-agentic-draft-film-30s.mp4', sourceHash }, createdAt,
  })
  writeJson(path.join('.nomi', 'runs', 'run-agentic-draft-film-30s', 'run.json'), {
    schemaVersion: 1, projectId: 'nomi-agentic-draft-film-2026-08-21', runId: 'run-agentic-draft-film-30s',
    status: 'awaiting_rough_cut_review', currentStage: 'assemble', source: 'external-mcp',
    artifacts: [
      { artifactId: 'artifact-brief-v1', kind: 'brief', status: 'adopted', path: '.nomi/runs/run-agentic-draft-film-30s/brief-v1.json' },
      { artifactId: scriptArtifactId, kind: 'script', status: 'adopted', version: 1, path: '.nomi/runs/run-agentic-draft-film-30s/script-v1.json' },
      { artifactId: storyboardArtifactId, kind: 'storyboard', status: 'adopted', version: 1, path: '.nomi/runs/run-agentic-draft-film-30s/storyboard-v1.json' },
      { artifactId: 'artifact-timeline-v1', kind: 'timeline', status: 'adopted', path: '.nomi/runs/run-agentic-draft-film-30s/timeline-v1.json' },
    ],
    gates: [{ gateId: 'gate-export-v1', scope: 'export', status: 'waiting', summary: '审阅粗剪后批准导出' }],
    skillEvidence: {
      script: ['writer-screenwriter', 'writer-structure', 'writer-dialogue', 'writer-review'],
      storyboard: ['director-shot-translation', 'director-cinematography', 'director-consistency', 'director-staging'],
    },
    note: '视觉媒体来自仓库已有 launch-film-en.mp4；本样片验收的是项目归档、字幕、时间轴合同和可播放导出，不冒充新模型生成。',
  })
  writeJson(path.join('.nomi', 'project.json'), { id: 'nomi-agentic-draft-film-2026-08-21', name: 'Nomi Agentic Draft Film 2026-08-21', version: 1 })
}

ensureInputs()
const subtitles = readSubtitles()
writeTrimmedVtt(subtitles)
buildFilm()
const timeline = buildTimeline(subtitles)
const sourceHash = createHash('sha256').update(fs.readFileSync(outputVideo)).digest('hex')
writeProjectArtifacts(timeline, '一句话：让用户从一句话开始，经过剧本与分镜审阅，在 Nomi 里完成一条可继续编辑的 30 秒初稿。', sourceHash)
console.log(`Built ${outputVideo}`)
console.log(`Project artifacts: ${runDir}`)
