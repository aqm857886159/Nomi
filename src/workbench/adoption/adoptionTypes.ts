import type { TimelineClip, TimelineState, TimelineTrackType } from '../timeline/timelineTypes'
import type { TimelineUndoEntry } from '../timeline/timelineUndoHistory'

/**
 * P5 E1 采纳桥的合同类型（`docs/superpowers/plans/2026-08-22-nomi-unified-editor-runtime.md` §5）。
 *
 * 一句话：**生成产物进时间轴，只有这一条路**。此前有 5 条各写各的（见
 * `docs/plan/2026-08-25-p5-e1-adoption-bridge.md` §3 收敛映射表），于是「重复点会多一份」
 * 「产物换版了没人告诉你」「批量落 12 个要按 12 次撤销」这三类 bug 各自有 5 个入口。
 * 收敛到这里之后它们只剩 1 个入口，修一次就整类不再复发（P2）。
 */

/** 采纳意图的身份。合同规定的六元组，缺一不可。 */
export type AdoptionProposalKey = {
  /** 产出这个产物的 run。手动生成（无 agent run）时为 'local'。 */
  runId: string
  /** 生成契约摘要：同 prompt/模型/参数 = 同 hash。 */
  contractHash: string
  /** 产物身份（GenerationNodeResult.id）。 */
  artifactId: string
  /** 产物版本：重出即变（GenerationNodeResult.createdAt）。 */
  artifactVersion: string
  /** 采纳发起时时间轴的内容 revision（见 timelineRevisionOf）。 */
  baseRevision: string
  /** 落点身份：'timeline:<track>@append' | 'timeline:<track>@<frame>' | 'timeline:batch@append'。 */
  destination: string
}

/** 一个待落轴的单位：clip 本体 + 它该去哪条轨、哪一帧。 */
export type AdoptionPlacement = {
  clip: TimelineClip
  trackType: TimelineTrackType
  startFrame: number
}

/**
 * 落点语义。回执文案**从它派生**，不各自 hardcode：
 * 「点击贴尾」和「拖到第 120 帧」对用户是两件事，说成同一句话就是在骗他。
 * 记在提案上（而不是让四个调用方各传一次）——落点在哪算出来的，文案就在哪定，单一真相源。
 */
export type AdoptionPlacementKind = 'append' | 'frame' | 'batch'

export type AdoptionProposalStatus =
  | 'applied'
  | 'stale'
  | 'needs_attention'
  | 'failed'
  | 'needs_recovery'

/** 登记在册的提案。同键重复请求返回**这一份**，不创建竞争提案。 */
export type AdoptProposal = {
  key: AdoptionProposalKey
  /** 归一后的键字符串，registry 的主键。 */
  keyId: string
  status: AdoptionProposalStatus
  /** 落点语义，回执文案据此派生（见 AdoptionPlacementKind）。 */
  placementKind: AdoptionPlacementKind
  /** apply 成功后落下的 clip id（幂等重放时原样返回）。 */
  clipIds: string[]
  /** 本次采纳排进去的单位数（批量时 = 镜头数）。 */
  placedCount: number
  /** 成功 apply 后的轴 revision，用于区分自身重放与外部编辑造成的 stale。 */
  appliedRevision?: string
  /** 请求时被跳过的单位（已在轴上 / 没生成画面），带原因。 */
  skipped: Array<{ nodeId: string; reason: string }>
  createdAt: number
}

export type AdoptionOutcome =
  /** 头一次落成。 */
  | { status: 'applied'; proposal: AdoptProposal; replayed: false }
  /** 同键重复请求：返回**原** Proposal，一个字节都没再写轴。 */
  | { status: 'applied'; proposal: AdoptProposal; replayed: true }
  /** 轴在提案之后动过了：不落，让调用方带最新 baseRevision 重提。 */
  | { status: 'stale'; proposal: AdoptProposal }
  /** 产物换版了（同 artifactId 不同 artifactVersion）：不落，需要人确认要哪版。 */
  | { status: 'needs_attention'; proposal: AdoptProposal; reason: 'artifact_version_changed' }
  /** apply 失败但**补偿成功**：轴回到采纳前，旧态完好。 */
  | { status: 'failed'; proposal: AdoptProposal; error: string }
  /** apply 失败且**补不回去**：保留旧态、标记待恢复，绝不留半落的轴。 */
  | { status: 'needs_recovery'; proposal: AdoptProposal; error: string }
  /** 压根没有可采纳的东西（节点还没生成画面 / 画布没镜头）。 */
  | { status: 'nothing_to_adopt'; skipped: Array<{ nodeId: string; reason: string }> }

/** apply 需要的全部外界能力。注入而非直连 store —— 纯函数才测得动补偿路径。 */
export type AdoptionApplyPorts = {
  readTimeline: () => TimelineState
  /** 原子写入：整批一次落定 + 压**一层**撤销栈。 */
  commitTimeline: (next: TimelineState, base: TimelineState, undoEntry?: TimelineUndoEntry) => void
  /** 补偿：把轴放回 base。返回 false 表示补不回去 → needs_recovery。 */
  restoreTimeline: (base: TimelineState) => boolean
}
