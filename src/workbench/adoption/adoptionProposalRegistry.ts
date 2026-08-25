import type { AdoptProposal, AdoptionProposalKey, AdoptionProposalStatus } from './adoptionTypes'
import type { TimelineState } from '../timeline/timelineTypes'
import { proposalIdentityId, proposalKeyId, proposalSlotId, timelineRevisionOf } from './adoptionProposalKey'

/**
 * 提案登记处（进程内，不落盘）。
 *
 * 它存在的唯一理由：**同一个采纳意图只能有一份提案**。合同原话——
 * 「重复请求返回原 Proposal，revision/asset 变化返回 stale/needs_attention，不创建竞争提案」。
 *
 * 为什么不落盘：提案是**在途意图**，不是用户资产。重开 app 后轴已经是新的了，
 * 旧提案的 baseRevision 必然对不上——留着它只会制造一堆恒 stale 的僵尸记录。
 */

/** 上限。提案是短命对象，200 条足够覆盖一次会话的连续采纳，超了按插入序淘汰最旧的。 */
const REGISTRY_LIMIT = 200

type RegistryEntry = {
  proposal: AdoptProposal
  identityId: string
  slotId: string
}

const entries = new Map<string, RegistryEntry>()

/** 测试与切项目用：清空在途提案。 */
export function resetAdoptionRegistry(): void {
  entries.clear()
}

export function getAdoptionProposal(keyId: string): AdoptProposal | undefined {
  return entries.get(keyId)?.proposal
}

/** 只读快照，给走查/调试用。 */
export function listAdoptionProposals(): AdoptProposal[] {
  return [...entries.values()].map((entry) => entry.proposal)
}

/** 轴仍包含提案落下的全部片段时，重复点击是幂等重放而非 stale。 */
export function proposalIsLanded(proposal: AdoptProposal, timeline: TimelineState): boolean {
  const landed = new Set(timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.id)))
  return proposal.clipIds.length > 0
    && proposal.clipIds.every((clipId) => landed.has(clipId))
    && (!proposal.appliedRevision || proposal.appliedRevision === timelineRevisionOf(timeline))
}

function evictIfNeeded(): void {
  while (entries.size > REGISTRY_LIMIT) {
    const oldest = entries.keys().next()
    if (oldest.done) return
    entries.delete(oldest.value)
  }
}

export type LookupResult =
  /** 同键、且已落成：幂等重放，返回原提案，**不再写轴**。 */
  | { kind: 'replay'; proposal: AdoptProposal }
  /** 同一个采纳意图，但轴动过了（baseRevision 不同）→ stale。 */
  | { kind: 'stale'; proposal: AdoptProposal }
  /** 同一个槽位，但产物换版了（artifactId/Version 不同）→ needs_attention。 */
  | { kind: 'needs_attention'; proposal: AdoptProposal }
  /** 全新意图，放行。 */
  | { kind: 'fresh' }

/**
 * 四选一判定。顺序有讲究：
 *  1. 先查**全等键** —— 完全同一次意图，直接重放（最常见：用户手抖连点两下）。
 *  2. 再查**同身份不同 revision** —— 同一个产物同一个落点，但轴动过了 → stale。
 *  3. 再查**同槽位不同产物版本** —— 节点重出了 V2 → needs_attention（让人确认要哪版）。
 *  4. 都不是 → fresh。
 *
 * 2 和 3 的先后不能反：产物换版时 baseRevision 往往也变了，若先判 stale，
 * 用户重提一次就会**静默把 V2 落进去**——而他看的缩略图可能还是 V1。
 * 所以「换版」必须比「轴动过」更早被截住。
 */
export function lookupAdoptionProposal(key: AdoptionProposalKey): LookupResult {
  const keyId = proposalKeyId(key)
  const exact = entries.get(keyId)
  if (exact && exact.proposal.status === 'applied') {
    return { kind: 'replay', proposal: exact.proposal }
  }

  const slotId = proposalSlotId(key)
  const identityId = proposalIdentityId(key)

  for (const entry of entries.values()) {
    if (entry.proposal.status !== 'applied') continue
    // 3：同槽位（同 run/契约/落点），但产物身份或版本变了。
    if (entry.slotId === slotId) {
      const sameArtifact = entry.proposal.key.artifactId === key.artifactId
      const sameVersion = entry.proposal.key.artifactVersion === key.artifactVersion
      if (sameArtifact && !sameVersion) {
        return { kind: 'needs_attention', proposal: entry.proposal }
      }
    }
  }

  for (const entry of entries.values()) {
    if (entry.proposal.status !== 'applied') continue
    // 2：同身份（含 artifactId + 落点），只有 baseRevision 不同。
    if (entry.identityId === identityId
      && entry.proposal.key.artifactVersion === key.artifactVersion
      && entry.proposal.key.baseRevision !== key.baseRevision) {
      return { kind: 'stale', proposal: entry.proposal }
    }
  }

  return { kind: 'fresh' }
}

/** 登记一份提案（新建或更新状态）。 */
export function registerAdoptionProposal(
  key: AdoptionProposalKey,
  status: AdoptionProposalStatus,
  details: {
    clipIds?: string[]
    placedCount?: number
    appliedRevision?: string
    skipped?: Array<{ nodeId: string; reason: string }>
  } = {},
): AdoptProposal {
  const keyId = proposalKeyId(key)
  const proposal: AdoptProposal = {
    key,
    keyId,
    status,
    clipIds: details.clipIds || [],
    placedCount: details.placedCount ?? (details.clipIds ? details.clipIds.length : 0),
    ...(details.appliedRevision ? { appliedRevision: details.appliedRevision } : {}),
    skipped: details.skipped || [],
    createdAt: Date.now(),
  }
  // 先删再插：Map 保持插入序 = 淘汰顺序，重登记的提案应算「最新」。
  entries.delete(keyId)
  entries.set(keyId, { proposal, identityId: proposalIdentityId(key), slotId: proposalSlotId(key) })
  evictIfNeeded()
  return proposal
}
