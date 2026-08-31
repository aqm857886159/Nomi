/**
 * Build the renderer's export timeline from the durable ProductionRun receipt.
 *
 * The live canvas store is intentionally not the source of truth here: an
 * external MCP run can generate/adopt media while no canvas window is focused.
 * The arrangement artifact and adopted job artifacts are therefore the only
 * inputs that can safely cross the arrange → export boundary.
 */

type ArrangementClip = {
  shotId?: unknown
  startFrame?: unknown
  endFrame?: unknown
}

type ArrangementSubtitle = {
  startFrame?: unknown
  endFrame?: unknown
  text?: unknown
  style?: unknown
}

type ArrangementTransition = {
  fromShotId?: unknown
  toShotId?: unknown
  type?: unknown
  durationFrames?: unknown
}

type ArrangementRecord = {
  timelineContract?: {
    fps?: unknown
    durationFrames?: unknown
    clips?: unknown
    subtitles?: unknown
    transitions?: unknown
  }
}

type ExportJob = {
  jobId: string
  nodeId?: string
  metadata?: Record<string, unknown>
}

type ExportArtifact = {
  jobId?: string
  kind: string
  status: string
  projectRelativePath?: string
}

export type ProductionExportTimeline = {
  version: 1
  fps: number
  scale: number
  playheadFrame: number
  tracks: Array<{
    id: string
    type: 'image' | 'video' | 'audio'
    label: string
    clips: Array<{
      id: string
      type: 'video'
      sourceNodeId: string
      label: string
      startFrame: number
      endFrame: number
      frameCount: number
      offsetStartFrame: number
      offsetEndFrame: number
      url: string
    }>
  }>
  textClips: Array<{
    id: string
    sourceNodeId?: string
    text: string
    style: 'caption' | 'title'
    startFrame: number
    endFrame: number
  }>
  transitions?: Array<{
    fromClipId: string
    toClipId: string
    type: 'cut' | 'dissolve' | 'fade' | 'match_cut' | 'whip_pan'
    durationFrames?: number
  }>
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function integer(value: unknown, label: string, minimum = 0): number {
  const result = Number(value)
  if (!Number.isInteger(result) || result < minimum) throw new Error(`Production export ${label} is invalid`)
  return result
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Production export ${label} is missing`)
  return value.trim()
}

function assetUrl(projectId: string, relativePath: string): string {
  return `nomi-local://asset/${encodeURIComponent(projectId)}/${relativePath.split('/').map(encodeURIComponent).join('/')}`
}

function transitionType(value: unknown): 'cut' | 'dissolve' | 'fade' | 'match_cut' | 'whip_pan' {
  if (value === 'cut' || value === 'dissolve' || value === 'fade' || value === 'match_cut' || value === 'whip_pan') return value
  throw new Error(`Production export transition type is invalid: ${String(value)}`)
}

export function buildProductionExportTimeline(input: {
  projectId: string
  arrangement: unknown
  jobs: ExportJob[]
  artifacts: ExportArtifact[]
}): ProductionExportTimeline {
  const projectId = nonEmpty(input.projectId, 'projectId')
  const contract = record(record(input.arrangement).timelineContract)
  const fps = integer(contract.fps, 'fps', 1)
  const durationFrames = integer(contract.durationFrames, 'durationFrames', 1)
  const rawClips = Array.isArray(contract.clips) ? contract.clips : []
  if (rawClips.length === 0) throw new Error('Production export arrangement has no clips')

  const jobByNodeId = new Map(input.jobs
    .filter((job) => typeof job.nodeId === 'string' && job.nodeId.trim())
    .map((job) => [job.nodeId!.trim(), job]))
  const artifactByJobId = new Map(input.artifacts
    .filter((artifact) => artifact.kind === 'video' && artifact.status === 'adopted' && typeof artifact.jobId === 'string')
    .map((artifact) => [artifact.jobId!, artifact]))

  const clips = rawClips.map((rawClip, index) => {
    const clip = record(rawClip) as ArrangementClip
    const nodeId = nonEmpty(clip.shotId, `clips[${index}].shotId`)
    const startFrame = integer(clip.startFrame, `clips[${index}].startFrame`)
    const endFrame = integer(clip.endFrame, `clips[${index}].endFrame`, startFrame + 1)
    const job = jobByNodeId.get(nodeId)
    if (!job) throw new Error(`Production export has no job for ${nodeId}`)
    const artifact = artifactByJobId.get(job.jobId)
    const relativePath = nonEmpty(artifact?.projectRelativePath, `artifact for ${nodeId}`)
    return {
      id: `production-clip-${nodeId}`,
      type: 'video' as const,
      sourceNodeId: nodeId,
      label: nodeId,
      startFrame,
      endFrame,
      frameCount: endFrame - startFrame,
      offsetStartFrame: 0,
      offsetEndFrame: 0,
      url: assetUrl(projectId, relativePath),
    }
  })

  const textClips = (Array.isArray(contract.subtitles) ? contract.subtitles : []).map((rawSubtitle, index) => {
    const subtitle = record(rawSubtitle) as ArrangementSubtitle
    const startFrame = integer(subtitle.startFrame, `subtitles[${index}].startFrame`)
    const endFrame = integer(subtitle.endFrame, `subtitles[${index}].endFrame`, startFrame + 1)
    const text = nonEmpty(subtitle.text, `subtitles[${index}].text`)
    const sourceNodeId = clips.find((clip) => clip.startFrame <= startFrame && clip.endFrame > startFrame)?.sourceNodeId
    return {
      id: `production-caption-${index + 1}`,
      ...(sourceNodeId ? { sourceNodeId } : {}),
      text,
      style: subtitle.style === 'title' ? 'title' as const : 'caption' as const,
      startFrame,
      endFrame,
    }
  })

  const transitions = (Array.isArray(contract.transitions) ? contract.transitions : []).map((rawTransition, index) => {
    const transition = record(rawTransition) as ArrangementTransition
    const fromShotId = nonEmpty(transition.fromShotId, `transitions[${index}].fromShotId`)
    const toShotId = nonEmpty(transition.toShotId, `transitions[${index}].toShotId`)
    const durationFrames = transition.durationFrames === undefined
      ? undefined
      : integer(transition.durationFrames, `transitions[${index}].durationFrames`, 1)
    return {
      fromClipId: `production-clip-${fromShotId}`,
      toClipId: `production-clip-${toShotId}`,
      type: transitionType(transition.type),
      ...(durationFrames === undefined ? {} : { durationFrames }),
    }
  })

  return {
    version: 1,
    fps,
    scale: 1,
    playheadFrame: 0,
    tracks: [
      { id: 'imageTrack', type: 'image', label: '图片轨', clips: [] },
      { id: 'videoTrack', type: 'video', label: '视频轨', clips },
      { id: 'audioTrack', type: 'audio', label: '音频轨', clips: [] },
    ],
    textClips,
    ...(transitions.length ? { transitions } : {}),
  }
}
