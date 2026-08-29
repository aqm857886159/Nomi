import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'

type ApprovedScriptLike = {
  artifactId: string
  kind: string
  status: string
  version?: number
  contentHash?: string
}

export type CandidateStoryboardLike = {
  artifactId: string
  kind: string
  status: string
  version?: number
  contentHash?: string
}

export function storyboardPlanSourceMatchesApprovedScript(
  plan: Pick<StoryboardPlan, 'sourceScriptArtifactId' | 'sourceScriptVersion' | 'sourceScriptHash'>,
  artifacts: readonly ApprovedScriptLike[],
): boolean {
  if (!plan.sourceScriptArtifactId && plan.sourceScriptVersion === undefined && !plan.sourceScriptHash) return true
  const approvedScript = [...artifacts]
    .reverse()
    .find((artifact) => artifact.kind === 'script' && (artifact.status === 'adopted' || artifact.status === 'ready'))
  return Boolean(approvedScript)
    && plan.sourceScriptArtifactId === approvedScript?.artifactId
    && plan.sourceScriptVersion === approvedScript?.version
    && plan.sourceScriptHash === approvedScript?.contentHash
}

export function storyboardDesignNeedsSync(documentUpdatedAt: number, sourceDocumentUpdatedAt: number): boolean {
  return documentUpdatedAt > sourceDocumentUpdatedAt
}

export async function storyboardPlanContentHash(plan: StoryboardPlan): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(plan)))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function findMatchingCandidateStoryboard(
  plan: StoryboardPlan,
  artifacts: readonly CandidateStoryboardLike[],
): Promise<CandidateStoryboardLike | undefined> {
  const candidates = artifacts.filter((artifact) => artifact.kind === 'storyboard' && artifact.status === 'candidate' && artifact.contentHash)
  if (!candidates.length) return undefined
  const planHash = await storyboardPlanContentHash(plan)
  return planHash ? candidates.find((artifact) => artifact.contentHash === planHash) : undefined
}
