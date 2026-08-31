import { safeExternalText } from './productionRunProjectionSanitizer'
import { buildProductionDeepLink } from './productionDeepLink'
import type { ArtifactProjection } from './artifactProjection'
import type { ProductionArtifact, ProductionRun } from './productionRunTypes'

export type ScriptProvenance = {
  artifactId?: string
  version?: number
  hash?: string
}

function textField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

export function provenanceFromRecord(value: unknown, fallbackArtifactId?: string, artifactKind?: ProductionArtifact['kind']): ScriptProvenance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const raw = value as Record<string, unknown>
  const kind = artifactKind || (raw.kind === 'storyboard' || raw.kind === 'script' ? raw.kind : undefined)
  const isStoryboard = kind === 'storyboard'
  const plan = raw.plan && typeof raw.plan === 'object' && !Array.isArray(raw.plan) ? raw.plan as Record<string, unknown> : undefined
  const source = raw.sourceScript && typeof raw.sourceScript === 'object' && !Array.isArray(raw.sourceScript)
    ? raw.sourceScript as Record<string, unknown>
    : undefined
  const artifactId = textField(raw.sourceScriptArtifactId)
    ?? textField(plan?.sourceScriptArtifactId)
    ?? textField(source?.artifactId)
    ?? textField(raw.sourceArtifactId)
    ?? fallbackArtifactId
  const version = positiveInteger(raw.sourceScriptVersion)
    ?? positiveInteger(plan?.sourceScriptVersion)
    ?? positiveInteger(source?.version)
    ?? positiveInteger(raw.sourceVersion)
    ?? (isStoryboard ? undefined : positiveInteger(raw.version))
  const hash = textField(raw.sourceScriptHash)
    ?? textField(raw.scriptHash)
    ?? textField(plan?.sourceScriptHash)
    ?? textField(source?.hash)
    ?? textField(raw.sourceContentHash)
    ?? textField(raw.sourceHash)
    ?? (isStoryboard ? undefined : textField(raw.hash))
    ?? (isStoryboard ? undefined : textField(raw.contentHash))
    ?? (isStoryboard ? undefined : textField(raw.planHash))
  return { ...(artifactId ? { artifactId } : {}), ...(version ? { version } : {}), ...(hash ? { hash } : {}) }
}

export function provenanceFromPayload(payload: Record<string, unknown>): ScriptProvenance {
  const source = payload.sourceScript && typeof payload.sourceScript === 'object' && !Array.isArray(payload.sourceScript)
    ? payload.sourceScript as Record<string, unknown>
    : undefined
  const artifactId = textField(payload.sourceScriptArtifactId) ?? textField(source?.artifactId)
  const version = positiveInteger(payload.sourceScriptVersion) ?? positiveInteger(source?.version)
  const hash = textField(payload.sourceScriptHash) ?? textField(source?.hash)
  return {
    ...(artifactId ? { artifactId } : {}),
    ...(version ? { version } : {}),
    ...(hash ? { hash } : {}),
  }
}

export function sameProvenance(left: ScriptProvenance, right: ScriptProvenance): boolean {
  return left.artifactId === right.artifactId
    && left.version === right.version
    && left.hash === right.hash
}

export function completeProvenance(value: ScriptProvenance): value is Required<ScriptProvenance> {
  return Boolean(value.artifactId && value.version && value.hash)
}

export function storyboardMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const metadata: Record<string, unknown> = {}
  const shotId = textField(raw.shotId)
  const ffDesc = textField(raw.ffDesc)
  const motionDesc = textField(raw.motionDesc)
  const subtitle = textField(raw.subtitle)
  const dialogue = textField(raw.dialogue)
  const lfDesc = textField(raw.lfDesc)
  const narrativeGoal = textField(raw.narrativeGoal)
  const actionChain = textField(raw.actionChain)
  const dramaticBeat = textField(raw.dramaticBeat)
  const previousShotId = textField(raw.previousShotId)
  const firstFrameRef = textField(raw.firstFrameRef)
  const variationType = raw.variationType === 'large' || raw.variationType === 'medium' || raw.variationType === 'small' ? raw.variationType : undefined
  const camIdx = typeof raw.camIdx === 'number' && Number.isInteger(raw.camIdx) && raw.camIdx >= 0 ? raw.camIdx : undefined
  if (shotId) metadata.shotId = shotId
  if (ffDesc) metadata.ffDesc = ffDesc
  if (motionDesc) metadata.motionDesc = motionDesc
  if (subtitle) metadata.subtitle = subtitle
  if (dialogue) metadata.dialogue = dialogue
  if (lfDesc) metadata.lfDesc = lfDesc
  if (narrativeGoal) metadata.narrativeGoal = narrativeGoal
  if (actionChain) metadata.actionChain = actionChain
  if (dramaticBeat) metadata.dramaticBeat = dramaticBeat
  if (previousShotId) metadata.previousShotId = previousShotId
  if (firstFrameRef) metadata.firstFrameRef = firstFrameRef
  if (variationType) metadata.variationType = variationType
  if (camIdx !== undefined) metadata.camIdx = camIdx
  if (raw.continuity !== undefined && (typeof raw.continuity === 'string' || typeof raw.continuity === 'number' || (typeof raw.continuity === 'object' && raw.continuity !== null && !Array.isArray(raw.continuity)))) metadata.continuity = raw.continuity
  if (typeof raw.continuityLocks === 'string' && raw.continuityLocks.trim()) {
    metadata.continuityLocks = raw.continuityLocks.trim()
  } else if (Array.isArray(raw.continuityLocks)) {
    const locks = raw.continuityLocks
      .filter((lock): lock is string => typeof lock === 'string' && lock.trim().length > 0)
      .map((lock) => lock.trim())
    if (locks.length) metadata.continuityLocks = locks
  }
  const transitionValue = raw.transition
  const transition = transitionValue === 'cut' || transitionValue === 'dissolve' || transitionValue === 'fade' || transitionValue === 'match_cut' || transitionValue === 'whip_pan'
    ? { type: transitionValue }
    : transitionValue && typeof transitionValue === 'object' && !Array.isArray(transitionValue)
      ? transitionValue as Record<string, unknown>
      : undefined
  const transitionType = transition && (transition.type === 'cut' || transition.type === 'dissolve' || transition.type === 'fade' || transition.type === 'match_cut' || transition.type === 'whip_pan') ? transition.type : undefined
  const durationFrames = transition && typeof transition.durationFrames === 'number' && Number.isInteger(transition.durationFrames) && transition.durationFrames > 0 ? transition.durationFrames : undefined
  if (transitionType) metadata.transition = { type: transitionType, ...(durationFrames ? { durationFrames } : {}) }
  return Object.keys(metadata).length ? metadata : undefined
}

export function metadataProjection(run: ProductionRun, artifact: ProductionArtifact): Omit<ArtifactProjection, 'preview'> {
  return {
    artifactId: artifact.artifactId,
    runId: run.runId,
    projectId: run.projectId,
    stageId: artifact.stageId,
    ...(artifact.jobId ? { jobId: artifact.jobId } : {}),
    kind: artifact.kind,
    status: artifact.status,
    ...(artifact.version !== undefined ? { version: artifact.version } : {}),
    ...(artifact.source ? { source: artifact.source } : {}),
    ...(artifact.parentArtifactId ? { parentArtifactId: artifact.parentArtifactId } : {}),
    ...(artifact.retryCount !== undefined ? { retryCount: artifact.retryCount } : {}),
    ...(artifact.retryReason ? { retryReason: safeExternalText(artifact.retryReason) } : {}),
    ...(artifact.contentHash ? { contentHash: artifact.contentHash } : {}),
    ...(artifact.sourceArtifactId ? { sourceArtifactId: artifact.sourceArtifactId } : {}),
    ...(artifact.sourceVersion !== undefined ? { sourceVersion: artifact.sourceVersion } : {}),
    ...(artifact.sourceContentHash ? { sourceContentHash: artifact.sourceContentHash } : {}),
    ...(artifact.sourceHash ? { sourceHash: artifact.sourceHash } : {}),
    ...(artifact.sourceScriptArtifactId ? { sourceScriptArtifactId: artifact.sourceScriptArtifactId } : {}),
    ...(artifact.sourceScriptVersion !== undefined ? { sourceScriptVersion: artifact.sourceScriptVersion } : {}),
    ...(artifact.sourceScriptHash ? { sourceScriptHash: artifact.sourceScriptHash } : {}),
    ...(artifact.reviewStatus ? { reviewStatus: artifact.reviewStatus } : {}),
    ...(artifact.skillEvidence ? { skillEvidence: artifact.skillEvidence } : {}),
    createdAt: artifact.createdAt,
    ...(artifact.adoptedAt ? { adoptedAt: artifact.adoptedAt } : {}),
    nomiUri: `nomi://project/${encodeURIComponent(run.projectId)}/run/${encodeURIComponent(run.runId)}/artifact/${encodeURIComponent(artifact.artifactId)}`,
    openInNomi: buildProductionDeepLink(run.projectId, run.runId, artifact.artifactId),
  }
}
