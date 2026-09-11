// 「这个节点是哪份候选的投影」——候选来源戳的键名与读法的唯一 owner。
//
// 为什么需要一个戳：画布节点是 Run 里 `generationPlan.candidate` 的**投影**，不是一份独立意图。
// 没有戳，渲染层无从分辨「这张卡是用户自己新建的（该自动挑默认模型）」和「这张卡是 agent 草稿落下来的
// （模型已经由候选定了，不该被自动挑选覆盖）」——2026-09-10 真机症状「节点上的模型和 agent 定的不一致」
// 正是后者被前者的自愈逻辑改写的结果。
//
// 戳只记身份与版本，不记参数：参数的唯一 owner 仍是 `buildPlannedNodeMeta`。
export const CANDIDATE_META_KEYS = {
  /** PlanCandidate.candidateId。 */
  candidateId: 'productionCandidateId',
  /** PlanCandidate.revision：落地时记下，下一次落地据它判断「意图变了没有」。 */
  candidateRevision: 'productionCandidateRevision',
  /** 候选选的模型身份（两段）。模型此刻不可用时它仍在，用来向用户说清「agent 要的是哪个」。 */
  candidateModelKey: 'productionCandidateModelKey',
  candidateModelVendor: 'productionCandidateModelVendor',
} as const

export type CandidateNodeIdentity = {
  candidateId: string
  modelKey: string
  modelVendor: string
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 读节点上的候选来源戳。没有 candidateId = 这张卡不是候选的投影（用户自己建的），返回 null。
 * 调用方据此决定「能不能替这张卡自动挑模型」。
 */
export function readCandidateNodeIdentity(
  meta: Record<string, unknown> | null | undefined,
): CandidateNodeIdentity | null {
  if (!meta) return null
  const candidateId = text(meta[CANDIDATE_META_KEYS.candidateId])
  if (!candidateId) return null
  return {
    candidateId,
    modelKey: text(meta[CANDIDATE_META_KEYS.candidateModelKey]),
    modelVendor: text(meta[CANDIDATE_META_KEYS.candidateModelVendor]),
  }
}
