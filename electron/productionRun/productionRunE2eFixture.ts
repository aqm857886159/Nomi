import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

export const PRODUCTION_E2E_FIXTURE_PROVIDER = 'nomi-e2e-fixture'
export const PRODUCTION_E2E_FIXTURE_MODEL = 'nomi-e2e-fixture-video'

type FixtureEnvironment = Partial<Record<'NOMI_E2E' | 'NOMI_E2E_PRODUCTION_FIXTURE', string | undefined>>

type FixtureOptions = {
  projectRootResolver: (projectId: string) => string | null
  ffmpegPath?: string
}

function bundledFfmpegPath(): string {
  try {
    const loadFixtureDependency = createRequire(__filename)
    return String((loadFixtureDependency('@ffmpeg-installer/ffmpeg') as { path?: string }).path || '')
  } catch {
    return ''
  }
}

export function isProductionRunE2eFixtureEnabled(
  env: FixtureEnvironment,
  isPackaged: boolean,
): boolean {
  return !isPackaged
    && env.NOMI_E2E === '1'
    && env.NOMI_E2E_PRODUCTION_FIXTURE === '1'
}

function identifier(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(text) || text === '.' || text === '..') {
    throw new Error(`Invalid fixture ${label}`)
  }
  return text
}

function payloadRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid production fixture payload')
  return value as Record<string, unknown>
}

function runFfmpeg(ffmpegPath: string, args: string[], timeoutMs: number): void {
  if (!ffmpegPath) throw new Error('Bundled FFmpeg is unavailable for the Production E2E fixture')
  const result = spawnSync(ffmpegPath, args, {
    encoding: 'utf8',
    timeout: Math.max(1_000, timeoutMs),
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Production fixture FFmpeg failed: ${String(result.stderr || '').slice(-1_000)}`)
}

function projectAssetUrl(projectId: string, relativePath: string): string {
  return `nomi-local://asset/${encodeURIComponent(projectId)}/${relativePath.split('/').map(encodeURIComponent).join('/')}`
}

export function createProductionRunE2eRenderer(options: FixtureOptions) {
  const ffmpegPath = options.ffmpegPath ?? bundledFfmpegPath()
  const generatedByRun = new Map<string, string>()

  return async (operation: string, rawPayload: unknown, timeoutMs: number): Promise<unknown> => {
    const payload = payloadRecord(rawPayload)
    const projectId = identifier(payload.projectId, 'project id')
    const runId = identifier(payload.runId, 'run id')
    const projectRoot = options.projectRootResolver(projectId)
    if (!projectRoot) throw new Error('Production fixture project root is unavailable')

    if (operation === 'production.plan-storyboard') {
      return {
        text: 'Production E2E fixture storyboard',
        plan: {
          title: 'Truthful Nomi production fixture',
          anchors: [],
          shots: [{
            index: 1,
            shotKind: 'video',
            durationSec: 2,
            anchorIds: [],
            prompt: 'A local Nomi workspace moves from brief to a finished video.',
            modelKey: PRODUCTION_E2E_FIXTURE_MODEL,
          }],
        },
      }
    }

    if (operation === 'production.generate-node') {
      const jobId = typeof payload.jobId === 'string' ? payload.jobId.trim() : ''
      if (!/^[A-Za-z0-9._:-]{1,240}$/.test(jobId)) throw new Error('Invalid fixture job id')
      const relativeVideoPath = `assets/generated/fixture-${runId}.mp4`
      const relativeThumbnailPath = `assets/generated/fixture-${runId}.jpg`
      const videoPath = path.join(projectRoot, relativeVideoPath)
      const thumbnailPath = path.join(projectRoot, relativeThumbnailPath)
      fs.mkdirSync(path.dirname(videoPath), { recursive: true })
      runFfmpeg(ffmpegPath, [
        '-y',
        '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
        '-t', '2',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k',
        '-shortest', '-movflags', '+faststart',
        videoPath,
      ], timeoutMs)
      runFfmpeg(ffmpegPath, [
        '-y', '-ss', '0.4', '-i', videoPath, '-frames:v', '1', '-q:v', '2', thumbnailPath,
      ], timeoutMs)
      generatedByRun.set(`${projectId}:${runId}`, relativeVideoPath)
      return {
        status: 'succeeded',
        assets: [{
          type: 'video',
          url: projectAssetUrl(projectId, relativeVideoPath),
          thumbnailUrl: projectAssetUrl(projectId, relativeThumbnailPath),
        }],
      }
    }

    if (operation === 'production.arrange') {
      return { arranged: 1, total: 1, placed: [{ nodeId: 'shot-1', role: 'video', startFrame: 0 }], skipped: [] }
    }

    if (operation === 'production.export') {
      const sourceRelativePath = generatedByRun.get(`${projectId}:${runId}`)
        ?? `assets/generated/fixture-${runId}.mp4`
      const sourcePath = path.join(projectRoot, sourceRelativePath)
      if (!fs.existsSync(sourcePath)) throw new Error('Production fixture has no generated clip to export')
      const outputName = identifier(payload.outputName, 'output name')
      if (!outputName.endsWith('.mp4')) throw new Error('Production fixture export must be MP4')
      const relativePath = `exports/${outputName}`
      const outputPath = path.join(projectRoot, relativePath)
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
      fs.copyFileSync(sourcePath, outputPath)
      return { relativePath, size: fs.statSync(outputPath).size }
    }

    throw new Error(`Production E2E fixture does not implement ${operation}`)
  }
}
