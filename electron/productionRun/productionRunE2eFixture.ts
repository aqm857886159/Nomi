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

type SemanticRunSnapshot = {
  projectId?: unknown
  runId?: unknown
  jobs?: unknown
  artifacts?: unknown
  generationPlan?: unknown
}

type SemanticGenerationSource = {
  relativePath: string
  shotId?: string
  nodeId?: string
  durationSeconds?: number
}

type SemanticShotInfo = {
  shotId?: string
  nodeId?: string
  durationSeconds?: number
}

/**
 * Resolve only durable generation artifacts owned by this run.  The semantic
 * scheduler writes files through the generation materializer and records the
 * receipt in `.nomi/runs/<runId>/run.json`; unlike the legacy fixture writer
 * there is intentionally no in-memory map to consult after an app restart.
 * Keep this reader fail-closed so a malformed receipt can never make export
 * read an arbitrary path outside the project.
 */
function readSemanticGenerationPaths(
  projectRoot: string,
  projectId: string,
  runId: string,
): SemanticGenerationSource[] {
  const runFile = path.join(projectRoot, '.nomi', 'runs', runId, 'run.json')
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(runFile, 'utf8'))
  } catch {
    return []
  }
  const envelope = payloadRecord(raw)
  const snapshot = envelope.run && typeof envelope.run === 'object' && !Array.isArray(envelope.run)
    ? envelope.run as SemanticRunSnapshot
    : envelope as SemanticRunSnapshot
  if (snapshot.projectId !== undefined && snapshot.projectId !== projectId) return []
  if (snapshot.runId !== undefined && snapshot.runId !== runId) return []
  const artifacts = Array.isArray(snapshot.artifacts) ? snapshot.artifacts : []
  const jobs = Array.isArray(snapshot.jobs) ? snapshot.jobs : []

  // The semantic planner freezes each shot's provider duration in the
  // candidate parameters.  Carry that value alongside the durable artifact so
  // arrange/export cannot silently fall back to a hard-coded clip length.
  const shotInfo = (): SemanticShotInfo[] => {
    const plan = snapshot.generationPlan
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return []
    const rawShots = (plan as Record<string, unknown>).shots
    if (!Array.isArray(rawShots)) return []
    return rawShots.flatMap((rawShot) => {
      if (!rawShot || typeof rawShot !== 'object' || Array.isArray(rawShot)) return []
      const shot = rawShot as Record<string, unknown>
      const candidate = shot.candidate && typeof shot.candidate === 'object' && !Array.isArray(shot.candidate)
        ? shot.candidate as Record<string, unknown>
        : undefined
      const parameters = candidate?.parameters && typeof candidate.parameters === 'object' && !Array.isArray(candidate.parameters)
        ? candidate.parameters as Record<string, unknown>
        : undefined
      const rawDuration = parameters?.duration ?? parameters?.durationSeconds
      const durationSeconds = typeof rawDuration === 'number' && Number.isFinite(rawDuration) && rawDuration > 0
        ? rawDuration
        : undefined
      const shotId = typeof shot.shotId === 'string' && shot.shotId.trim() ? shot.shotId.trim() : undefined
      const nodeId = typeof shot.nodeId === 'string' && shot.nodeId.trim() ? shot.nodeId.trim() : undefined
      if (!shotId && !nodeId && durationSeconds === undefined) return []
      return [{ ...(shotId ? { shotId } : {}), ...(nodeId ? { nodeId } : {}), ...(durationSeconds === undefined ? {} : { durationSeconds }) }]
    })
  }
  const plannedShots = shotInfo()
  const shotForJob = (job: Record<string, unknown>): SemanticShotInfo | undefined => {
    const metadata = job.metadata && typeof job.metadata === 'object' && !Array.isArray(job.metadata)
      ? job.metadata as Record<string, unknown>
      : undefined
    const shotId = typeof metadata?.shotId === 'string' ? metadata.shotId.trim() : ''
    const nodeId = typeof job.nodeId === 'string' ? job.nodeId.trim() : ''
    return plannedShots.find((shot) => (shotId && shot.shotId === shotId) || (nodeId && shot.nodeId === nodeId) || (nodeId && shot.shotId === nodeId))
  }

  const safeRelativePath = (value: unknown): string | null => {
    if (typeof value !== 'string') return null
    const relative = value.trim()
    if (!relative || relative.includes('\0') || relative.startsWith('/') || relative.startsWith('\\')
      || /^[A-Za-z]:[\\/]/.test(relative) || relative.split(/[\\/]+/).includes('..')) return null
    const root = path.resolve(projectRoot)
    const target = path.resolve(root, relative)
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) return null
    try {
      const rootReal = fs.realpathSync(root)
      const targetReal = fs.realpathSync(target)
      if (targetReal !== rootReal && !targetReal.startsWith(`${rootReal}${path.sep}`)) return null
      if (!fs.statSync(targetReal).isFile()) return null
    } catch {
      return null
    }
    return relative.replace(/\\/g, '/')
  }

  const candidateForJob = (jobId: string, job: Record<string, unknown>): SemanticGenerationSource | null => {
    for (let index = artifacts.length - 1; index >= 0; index -= 1) {
      const artifact = artifacts[index]
      if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) continue
      const record = artifact as Record<string, unknown>
      if (record.jobId !== jobId || record.kind !== 'video' || !['ready', 'adopted'].includes(String(record.status))) continue
      const relative = safeRelativePath(record.projectRelativePath)
      if (relative) {
        const planned = shotForJob(job)
        return {
          relativePath: relative,
          ...(planned?.shotId ? { shotId: planned.shotId } : {}),
          ...(planned?.nodeId ? { nodeId: planned.nodeId } : {}),
          ...(planned?.durationSeconds === undefined ? {} : { durationSeconds: planned.durationSeconds }),
        }
      }
    }
    return null
  }

  const ordered: SemanticGenerationSource[] = []
  const seen = new Set<string>()
  // Jobs are the authoritative shot order.  This also keeps retries from
  // changing the timeline order when their artifacts were appended later.
  for (const job of jobs) {
    if (!job || typeof job !== 'object' || Array.isArray(job)) continue
    const record = job as Record<string, unknown>
    if (record.stageId !== 'generate' || typeof record.jobId !== 'string') continue
      const source = candidateForJob(record.jobId, record)
      if (source && !seen.has(source.relativePath)) {
        seen.add(source.relativePath)
        ordered.push(source)
    }
  }
  // Older snapshots may not persist jobs alongside artifacts.  Preserve their
  // artifact order as a safe compatibility path, still requiring video + file.
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) continue
    const record = artifact as Record<string, unknown>
    if (record.kind !== 'video' || !['ready', 'adopted'].includes(String(record.status))) continue
    const relative = safeRelativePath(record.projectRelativePath)
    if (relative && !seen.has(relative)) {
      seen.add(relative)
      ordered.push({ relativePath: relative })
    }
  }
  return ordered
}

function semanticManifestForSources(
  projectId: string,
  sources: SemanticGenerationSource[],
): Record<string, unknown> {
  const fps = 24
  let cursorFrame = 0
  const clips = sources.map((source, index) => {
    const durationSeconds = source.durationSeconds && Number.isFinite(source.durationSeconds) && source.durationSeconds > 0
      ? source.durationSeconds
      : 1
    const frames = Math.max(1, Math.round(durationSeconds * fps))
    const clip = {
      id: `semantic-clip-${index + 1}`,
      assetId: `semantic-asset-${index + 1}`,
      ...(source.shotId ? { shotId: source.shotId } : {}),
      startFrame: cursorFrame,
      endFrame: cursorFrame + frames,
    }
    cursorFrame += frames
    return clip
  })
  const assets = Object.fromEntries(sources.map((source, index) => {
    const assetId = `semantic-asset-${index + 1}`
    return [assetId, {
      id: assetId,
      kind: 'video',
      url: projectAssetUrl(projectId, source.relativePath),
    }]
  }))
  return {
    version: 1,
    projectId,
    createdAt: new Date().toISOString(),
    timeline: {
      fps,
      durationFrames: cursorFrame,
      range: { startFrame: 0, endFrame: cursorFrame },
      tracks: [{ id: 'semantic-video-track', kind: 'video', clips }],
    },
    profile: {
      preset: 'publish',
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      audioMode: 'mixdown',
      audioBitrateKbps: 96,
      width: 320,
      height: 180,
      fps,
      pixelFormat: 'yuv420p',
      quality: 'small',
    },
    assets,
  }
}

export function createProductionRunE2eRenderer(options: FixtureOptions) {
  const ffmpegPath = options.ffmpegPath ?? bundledFfmpegPath()
  const generatedByRun = new Map<string, string[]>()
  // Test-only deterministic seam: one QA verdict can be made to fail so a
  // focused journey proves the ProductionRun driver's targeted retry path.
  // It is deliberately process-local and opt-in; production never sets this
  // environment flag and therefore keeps the normal all-pass fixture.
  const qaFailOnceRuns = new Set<string>()

  return async (operation: string, rawPayload: unknown, timeoutMs: number): Promise<unknown> => {
    const payload = payloadRecord(rawPayload)
    const projectId = identifier(payload.projectId, 'project id')
    const runId = identifier(payload.runId, 'run id')
    const projectRoot = options.projectRootResolver(projectId)
    if (!projectRoot) throw new Error('Production fixture project root is unavailable')

    if (operation === 'production.plan-directions') {
      // B1 方向门候选（fixture，零额度）：让 e2e 真机走查看到「三选一」方向门的真实渲染。
      return {
        candidates: [
          { key: 'documentary', title: 'Documentary warmth', oneLiner: 'Real creators, real desks — an honest local-first workflow.' },
          { key: 'kinetic', title: 'Kinetic product cut', oneLiner: 'Fast beat-synced shots of the canvas and timeline in motion.' },
          { key: 'minimal', title: 'Minimal studio', oneLiner: 'Clean macro shots of UI and typography on seamless backdrops.' },
        ],
      }
    }

    if (operation === 'production.plan-script') {
      return {
        text: '剧本初稿：雨夜里，创作者在本地画布中整理素材，逐镜确认后导出一条完整短片。',
      }
    }

    if (operation === 'production.plan-storyboard') {
      return {
        text: 'Production E2E fixture storyboard',
        plan: {
          title: 'Truthful Nomi production fixture',
          anchors: [],
          shots: Array.from({ length: 8 }, (_, index) => ({
            index: index + 1,
            shotId: `shot-${index + 1}`,
            shotKind: 'video' as const,
            durationSec: 3.75,
            anchorIds: [],
            prompt: `A local Nomi workspace advances through production step ${index + 1}.`,
            subtitle: String(index + 1),
            transition: index < 7
              ? index === 0
                ? { type: 'dissolve' as const, durationFrames: 12 }
                : index === 1
                  ? { type: 'fade' as const, durationFrames: 12 }
                  : { type: 'cut' as const }
              : undefined,
            modelKey: PRODUCTION_E2E_FIXTURE_MODEL,
          })),
        },
      }
    }

    if (operation === 'production.materialize-shots') {
      const rawShots = (payload as Record<string, unknown>).shots
      const shots = Array.isArray(rawShots) ? rawShots : []
      if (shots.length === 0) throw new Error('Production fixture semantic materialize requires shots')
      const bindings = shots.map((rawShot, index) => {
        const shot = rawShot && typeof rawShot === 'object' && !Array.isArray(rawShot)
          ? rawShot as Record<string, unknown>
          : {}
        const shotId = typeof shot.shotId === 'string' && shot.shotId.trim()
          ? shot.shotId.trim()
          : `shot-${index + 1}`
        return {
          shotId,
          nodeId: `semantic-shot-${index + 1}`,
          stageId: 'generate',
          provider: PRODUCTION_E2E_FIXTURE_PROVIDER,
          model: PRODUCTION_E2E_FIXTURE_MODEL,
          ...(typeof shot.role === 'string' ? { metadata: { role: shot.role } } : {}),
        }
      })
      return { createdNodeIds: bindings.map((binding) => binding.nodeId), connectedCount: 0, bindings }
    }

    if (operation === 'production.materialize-storyboard') {
      const rawPlan = (payload as Record<string, unknown>).plan
      const plan = rawPlan && typeof rawPlan === 'object' && !Array.isArray(rawPlan)
        ? rawPlan as Record<string, unknown>
        : {}
      const rawShots = Array.isArray(plan.shots) ? plan.shots : []
      const shots = rawShots.length > 0 ? rawShots : Array.from({ length: 8 }, (_, index) => ({ index: index + 1 }))
      const bindings = shots.map((shot, index) => {
        const rawShot = shot && typeof shot === 'object' && !Array.isArray(shot) ? shot as Record<string, unknown> : {}
        const transition = rawShot.transition && typeof rawShot.transition === 'object' && !Array.isArray(rawShot.transition)
          ? rawShot.transition as Record<string, unknown>
          : undefined
        const metadata = {
          ...(typeof rawShot.shotId === 'string' ? { shotId: rawShot.shotId } : {}),
          ...(typeof rawShot.subtitle === 'string' ? { subtitle: rawShot.subtitle } : {}),
          ...(transition ? { transition } : {}),
        }
        return {
        nodeId: `shot-${index + 1}`,
        stageId: 'generate',
        provider: PRODUCTION_E2E_FIXTURE_PROVIDER,
        model: PRODUCTION_E2E_FIXTURE_MODEL,
          ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        }
      })
      return { createdNodeIds: bindings.map((binding) => binding.nodeId), connectedCount: 0, bindings }
    }

    if (operation === 'production.generate-node') {
      const jobId = typeof payload.jobId === 'string' ? payload.jobId.trim() : ''
      if (!/^[A-Za-z0-9._:-]{1,240}$/.test(jobId)) throw new Error('Invalid fixture job id')
      const nodeId = typeof payload.nodeId === 'string' && payload.nodeId.trim() ? payload.nodeId.trim() : 'shot-1'
      const relativeVideoPath = `assets/generated/fixture-${runId}-${nodeId}.mp4`
      const relativeThumbnailPath = `assets/generated/fixture-${runId}-${nodeId}.jpg`
      const videoPath = path.join(projectRoot, relativeVideoPath)
      const thumbnailPath = path.join(projectRoot, relativeThumbnailPath)
      fs.mkdirSync(path.dirname(videoPath), { recursive: true })
      runFfmpeg(ffmpegPath, [
        '-y',
        // Keep the zero-provider fixture portable: testsrc2 gives us a deterministic,
        // decodable visual without assuming a system font package in CI or packaged builds.
        '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
        '-t', '3.75',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k',
        '-shortest', '-movflags', '+faststart',
        videoPath,
      ], timeoutMs)
      runFfmpeg(ffmpegPath, [
        '-y', '-ss', '0.4', '-i', videoPath, '-frames:v', '1', '-q:v', '2', thumbnailPath,
      ], timeoutMs)
      const key = `${projectId}:${runId}`
      generatedByRun.set(key, [...(generatedByRun.get(key) || []), relativeVideoPath])
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
      const requestedNodeIds = Array.isArray(payload.shotNodeIds)
        ? payload.shotNodeIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim())
        : null
      // The legacy fixture path has no shotNodeIds and intentionally keeps its
      // eight-shot contract. Semantic runs pass the adopted node ids; derive
      // the arrangement from that durable set so a two-shot run cannot be
      // reported as an unrelated eight-shot timeline.
      if (requestedNodeIds && requestedNodeIds.length === 0) throw new Error('Production fixture semantic arrange requires at least one shot')
      const semanticNodeIds = requestedNodeIds
      const nodeIds = semanticNodeIds ?? Array.from({ length: 8 }, (_, index) => `shot-${index + 1}`)
      if (!semanticNodeIds) {
        // Preserve the pre-semantic fixture contract byte-for-byte for legacy
        // production journeys that do not provide adopted semantic node ids.
        return {
          arranged: 8,
          total: 8,
          placed: Array.from({ length: 8 }, (_, index) => ({ nodeId: `shot-${index + 1}`, role: 'video', startFrame: index * 112 })),
          skipped: [],
          timelineContract: {
            fps: 30,
            durationFrames: 900,
            clips: Array.from({ length: 8 }, (_, index) => ({ shotId: `shot-${index + 1}`, startFrame: index * 112, endFrame: index === 7 ? 900 : (index + 1) * 112 })),
            subtitles: Array.from({ length: 8 }, (_, index) => ({ startFrame: index * 112 + 8, endFrame: Math.min(900, index * 112 + 104), text: String(index + 1) })),
            transitions: [1, 3, 5].map((index) => ({ fromShotId: `shot-${index}`, toShotId: `shot-${index + 1}`, type: 'cut' })),
          },
        }
      }
      const runFile = path.join(projectRoot, '.nomi', 'runs', runId, 'run.json')
      let runSnapshot: Record<string, unknown> = {}
      try {
        const parsed = payloadRecord(JSON.parse(fs.readFileSync(runFile, 'utf8')))
        runSnapshot = parsed.run && typeof parsed.run === 'object' && !Array.isArray(parsed.run)
          ? parsed.run as Record<string, unknown>
          : parsed
      } catch {
        // A semantic materializer may have just committed its artifact. The
        // durable path reader below still validates files; absent metadata uses
        // a one-second clip rather than inventing the old eight-shot layout.
      }
      const plannedShots = (() => {
        const plan = runSnapshot.generationPlan
        const rawShots = plan && typeof plan === 'object' && !Array.isArray(plan)
          ? (plan as Record<string, unknown>).shots
          : undefined
        if (!Array.isArray(rawShots)) return [] as Array<Record<string, unknown>>
        return rawShots.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value)))
      })()
      const plannedShotForNode = (nodeId: string): Record<string, unknown> | undefined => {
        for (const shot of plannedShots) {
          const shotNodeId = typeof shot.nodeId === 'string' ? shot.nodeId.trim() : ''
          const shotId = typeof shot.shotId === 'string' ? shot.shotId.trim() : ''
          if (shotNodeId !== nodeId && shotId !== nodeId) continue
          return shot
        }
        return undefined
      }
      const durationForNode = (nodeId: string): number => {
        const plannedShot = plannedShotForNode(nodeId)
        if (plannedShot) {
          const candidate = plannedShot.candidate && typeof plannedShot.candidate === 'object' && !Array.isArray(plannedShot.candidate)
            ? plannedShot.candidate as Record<string, unknown>
            : undefined
          const parameters = candidate?.parameters && typeof candidate.parameters === 'object' && !Array.isArray(candidate.parameters)
            ? candidate.parameters as Record<string, unknown>
            : undefined
          const value = parameters?.duration ?? parameters?.durationSeconds
          if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
        }
        return semanticNodeIds ? 1 : 3.75
      }
      let cursorFrame = 0
      const fps = 30
      const clips = nodeIds.map((nodeId) => {
        const frames = Math.max(1, Math.round(durationForNode(nodeId) * fps))
        const plannedShot = plannedShotForNode(nodeId)
        const shotId = typeof plannedShot?.shotId === 'string' && plannedShot.shotId.trim()
          ? plannedShot.shotId.trim()
          : nodeId
        const clip = {
          shotId,
          startFrame: cursorFrame,
          endFrame: cursorFrame + frames,
        }
        cursorFrame += frames
        return clip
      })
      return {
        arranged: nodeIds.length,
        total: nodeIds.length,
        placed: clips.map((clip, index) => ({ nodeId: nodeIds[index], role: 'video', startFrame: clip.startFrame })),
        skipped: [],
        timelineContract: {
          fps,
          durationFrames: cursorFrame,
          clips,
          subtitles: clips.map((clip, index) => ({ startFrame: clip.startFrame + Math.min(8, Math.max(1, Math.floor((clip.endFrame - clip.startFrame) / 4))), endFrame: Math.min(cursorFrame, clip.endFrame - Math.min(8, Math.max(1, Math.floor((clip.endFrame - clip.startFrame) / 4)))), text: String(index + 1) })),
          transitions: clips.slice(1).map((clip, index) => ({ fromShotId: clips[index].shotId, toShotId: clip.shotId, type: 'cut' })),
        },
      }
    }

    if (operation === 'production.verify-shots') {
      // W1.5 qa 阶段审片（fixture，零额度）：让 production journey 测试不悬挂，且能看到 qa.verdict 事件
      // 与 qa 阶段摘要落地。回一个「全部过检」的判决（真判分链路由 L1/L2 覆盖，此处只做端到端不阻断）。
      const rawIds = (payload as Record<string, unknown>).shotNodeIds
      const shotNodeIds = Array.isArray(rawIds)
        ? rawIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        : []
      const qaKey = `${projectId}:${runId}`
      if (process.env.NOMI_E2E_PRODUCTION_QA_FAIL_ONCE === '1' && !qaFailOnceRuns.has(qaKey) && shotNodeIds.length > 0) {
        qaFailOnceRuns.add(qaKey)
        const [first, ...rest] = shotNodeIds
        return {
          reviewedShotIds: shotNodeIds,
          verdicts: [
            {
              shotNodeId: first,
              passed: false,
              flagged: [{ dimension: 'continuity', score: 2, reason: 'fixture fail-once: identity continuity needs a targeted retry' }],
            },
            ...rest.map((shotNodeId) => ({ shotNodeId, passed: true })),
          ],
        }
      }
      return {
        reviewedShotIds: shotNodeIds,
        verdicts: shotNodeIds.map((shotNodeId) => ({ shotNodeId, passed: true })),
      }
    }

    if (operation === 'production.export') {
      const key = `${projectId}:${runId}`
      const inMemoryPaths = generatedByRun.get(key) || []
      // Semantic generation never invokes the retired `production.generate-node`
      // renderer writer.  Its materializer owns the files and persists receipts
      // in the ProductionRun snapshot, so export must consume that durable owner
      // state (and continue to work after a renderer/app restart).
      const semanticPaths = inMemoryPaths.length === 0
        ? readSemanticGenerationPaths(projectRoot, projectId, runId)
        : []
      const sourceRecords: SemanticGenerationSource[] = inMemoryPaths.length > 0
        ? inMemoryPaths.map((relativePath) => ({ relativePath }))
        : semanticPaths
      if (sourceRecords.length === 0) throw new Error('Production fixture has no generated clip to export')
      const outputName = identifier(payload.outputName, 'output name')
      if (!outputName.endsWith('.mp4')) throw new Error('Production fixture export must be MP4')
      if (inMemoryPaths.length === 0) {
        // Return a renderer-owned manifest for the production export service.
        // The service resolves nomi-local asset URLs, probes each clip and runs
        // the normal filtergraph exporter; no second timeline or output writer
        // is introduced in this fixture.
        return { manifest: semanticManifestForSources(projectId, sourceRecords) }
      }
      const relativePath = `exports/${outputName}`
      const outputPath = path.join(projectRoot, relativePath)
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
      const concatList = path.join(projectRoot, `.nomi/runs/${runId}/fixture-concat.txt`)
      fs.mkdirSync(path.dirname(concatList), { recursive: true })
      fs.writeFileSync(concatList, sourceRecords.map((source) => `file '${path.join(projectRoot, source.relativePath).replaceAll("'", "'\\''")}'`).join('\n'))
      runFfmpeg(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', '-movflags', '+faststart', outputPath], timeoutMs)
      return { relativePath, size: fs.statSync(outputPath).size }
    }

    throw new Error(`Production E2E fixture does not implement ${operation}`)
  }
}
