import type { GenerationCanvasNode } from '../../../generationCanvas/model/generationCanvasTypes'
import type { ArchetypeMode, ArchetypeReferenceSlot } from '../../../../config/modelArchetypes/types'
import type { ModelOption } from '../../../../config/models'
import { stableShotId, type PlanAnchor, type PlanShot, type StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'
import { isVisualAnchor } from '../../../generationCanvas/agent/storyboardPromptCompiler'
import { isAnchorFrozen } from '../../../generationCanvas/model/anchorBibleKeys'
import { hasUsableResult } from '../../../generationCanvas/runner/dependencyWaves'
import { missingRequiredSlots, referencedVisualAnchors, resolveShotArchetypeMode } from '../shotRow/shotRowModel'
import { findAnchorNode, findShotKeyframeNode, findShotNode } from './storyboardNodeBinding'

/**
 * 分镜行的**执行态 derive 层**（纯函数，v5 B）：行状态不是存的，是从「plan × 画布节点」推出来的
 * ——生成中/已生成/失败读绑定节点，等参考卡/缺必填读 plan×锚节点，锁定读节点 frozen 标记
 * （与参考卡定妆同一把锁、同一个 meta 键，anchorBibleKeys 单源）。
 * 组头/标题/footer 的计数全从同一份 derive 来（F2：禁静态快照）。
 */

/**
 * 行状态词表（本表格投影的唯一 owner）：
 * - ready            未生成，点「生成」即可跑（画面格 = 常驻生成按钮）；
 * - waiting-refs     引用的参考卡还没出图（⏳ 可点直达；不进批量）；
 * - missing-required 该行模型必填参考无来源（红态；不进批量）；
 * - generating       本体或首帧图节点在排队/生成（进度覆盖）；
 * - failed           生成失败/超时可找回（红边 + 人话错误；可重试、计入「未生成」批量）；
 * - done             有可用结果（画面格 = 结果图 + 悬停浮条）；
 * - locked           已锁定（结果满意，不进批量不被重跑；同参考卡锁语义）。
 */
export const SHOT_ROW_STATUSES = ['ready', 'waiting-refs', 'missing-required', 'generating', 'failed', 'done', 'locked'] as const
export type ShotRowStatus = (typeof SHOT_ROW_STATUSES)[number]

export type WaitingRef = {
  anchor: PlanAnchor
  /** 该锚绑定的画布节点（未建则 null）；要区分「未生成/生成中」由消费方看 node.status 自行判。 */
  node: GenerationCanvasNode | null
}

export type ShotRowExec = {
  status: ShotRowStatus
  /** 该行绑定的画布节点（未 materialize 则 null）。 */
  node: GenerationCanvasNode | null
  /** 图片+视频镜的首帧图节点。 */
  keyframeNode: GenerationCanvasNode | null
  /** 未就绪的引用锚（等参考图）。 */
  waitingRefs: WaitingRef[]
  /** 已出图但未锁定的引用锚：单跑不拦（画布同一破锁语义）、批量要等锁。 */
  unlockedRefs: PlanAnchor[]
  /** 缺必填参考的槽（红态文案用第一个）。 */
  missingSlots: ArchetypeReferenceSlot[]
  /**
   * 参考已变（v5 §v3-3）：本行产物生成时用的参考图版本（吃参考节点的 meta.refSnapshot，
   * 提交时由 runner 打戳）与锚节点**当前** result 不一致的锚。done 态才亮
   * （locked=用户定稿不闹；重跑本就会用新图）。亮标+「用新图重跑」，绝不自动跑。
   */
  changedRefs: PlanAnchor[]
  /** 已生成态的可显结果（缩略图优先）。 */
  resultUrl: string | null
  /** 生成中的进度（0-100；无 percent 回报时 null，仅显示转圈文案）。 */
  progressPercent: number | null
  progressMessage: string | null
  errorMessage: string | null
  locked: boolean
}

function isNodeActive(node: GenerationCanvasNode | null): boolean {
  return node?.status === 'queued' || node?.status === 'running'
}

function isNodeFailed(node: GenerationCanvasNode | null): boolean {
  return node?.status === 'error' || node?.status === 'recoverable'
}

function resultDisplayUrl(node: GenerationCanvasNode | null): string | null {
  const url = node?.result?.thumbnailUrl || node?.result?.url
  return typeof url === 'string' && url ? url : null
}

/** 该行（按当前解析的档案模式）吃不吃参考：无档案（默认模型）按吃处理（保守，同建边行为）。 */
export function rowConsumesReferences(mode: ArchetypeMode | null | undefined): boolean {
  return !mode || mode.slots.length > 0
}

export function deriveShotRowExec(input: {
  plan: StoryboardPlan
  shot: PlanShot
  designId: string
  nodes: readonly GenerationCanvasNode[]
  /** 该行当前解析的档案模式（shotRowModel.resolveShotArchetypeMode；默认模型 → null）。 */
  mode: ArchetypeMode | null
}): ShotRowExec {
  const { plan, shot, designId, nodes, mode } = input
  const node = findShotNode(nodes, designId, shot)
  const keyframeEnabled = shot.shotKind !== 'image' && shot.keyframe?.enabled === true
  const keyframeNode = keyframeEnabled ? findShotKeyframeNode(nodes, designId, shot) : null

  // 引用锚就绪度（等参考图 / 待锁定）：吃参考的行才看；镜像批量波次的判据
  // （hasUsableResult + frozen），footer 排除原因与真实批次行为不打架。
  const waitingRefs: WaitingRef[] = []
  const unlockedRefs: PlanAnchor[] = []
  if (rowConsumesReferences(mode)) {
    // isVisualAnchor 再过一道：与 materialize 连边同一谓词——不给「永远等一张不会生成的卡」留缝
    // （如 carrier 被手动翻成 visual 的 style 锚，materialize 不建节点也不连边）。
    for (const anchor of referencedVisualAnchors(shot, plan.anchors).filter(isVisualAnchor)) {
      const anchorNode = findAnchorNode(nodes, designId, anchor)
      if (!anchorNode || !hasUsableResult(anchorNode)) {
        waitingRefs.push({ anchor, node: anchorNode })
      } else if (!isAnchorFrozen(anchorNode)) {
        unlockedRefs.push(anchor)
      }
    }
  }

  const missingSlots = missingRequiredSlots(mode, shot, plan.anchors)
  const locked = Boolean(node && isAnchorFrozen(node) && hasUsableResult(node))
  const generating = isNodeActive(node) || isNodeActive(keyframeNode)
  const failedNode = isNodeFailed(node) ? node : isNodeFailed(keyframeNode) ? keyframeNode : null
  const done = Boolean(node && hasUsableResult(node))

  const status: ShotRowStatus = generating
    ? 'generating'
    : failedNode
      ? 'failed'
      : locked
        ? 'locked'
        : done
          ? 'done'
          : missingSlots.length > 0
            ? 'missing-required'
            : waitingRefs.length > 0
              ? 'waiting-refs'
              : 'ready'

  // 参考已变：diff「吃参考节点」（有首帧则锚边连在首帧图上）的提交时快照 vs 锚节点当前 result。
  // 快照里没这把锚（旧产物/后加的引用）不亮——只有确知「跑时用的是旧版」才报，不造假警报。
  const changedRefs: PlanAnchor[] = []
  if (status === 'done') {
    const refConsumer = keyframeNode ?? node
    const rawSnapshot = (refConsumer?.meta as Record<string, unknown> | undefined)?.refSnapshot
    const snapshot = rawSnapshot && typeof rawSnapshot === 'object' && !Array.isArray(rawSnapshot)
      ? (rawSnapshot as Record<string, unknown>)
      : null
    if (snapshot) {
      for (const anchor of referencedVisualAnchors(shot, plan.anchors)) {
        const anchorNode = findAnchorNode(nodes, designId, anchor)
        const currentResultId = anchorNode?.result?.id
        const usedResultId = anchorNode ? snapshot[anchorNode.id] : undefined
        if (
          typeof usedResultId === 'string' && usedResultId
          && typeof currentResultId === 'string' && currentResultId
          && currentResultId !== usedResultId
        ) {
          changedRefs.push(anchor)
        }
      }
    }
  }

  const activeNode = isNodeActive(node) ? node : isNodeActive(keyframeNode) ? keyframeNode : null
  const percent = activeNode?.progress?.percent
  return {
    status,
    node,
    keyframeNode,
    waitingRefs,
    unlockedRefs,
    missingSlots,
    changedRefs,
    resultUrl: resultDisplayUrl(node),
    progressPercent: typeof percent === 'number' && Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null,
    progressMessage: activeNode?.progress?.message || null,
    errorMessage: failedNode?.error || null,
    locked,
  }
}

// ── 表级 derive：每行 runtime（行渲染/批量/计数全吃这一份，F2 禁静态快照）──

export type StoryboardRowRuntime = {
  shot: PlanShot
  /** 该行解析出的档案模式（画面格红态/参考区/画幅胶囊与执行判定同源）。 */
  mode: ArchetypeMode | null
  exec: ShotRowExec
}

/** 整表 derive（编辑器每次渲染算一遍；行组件、组头小结、footer、批量判定共用）。 */
export function deriveStoryboardRowRuntimes(input: {
  plan: StoryboardPlan
  designId: string
  imageModelOptions: readonly ModelOption[]
  videoModelOptions: readonly ModelOption[]
  nodes: readonly GenerationCanvasNode[]
}): StoryboardRowRuntime[] {
  const { plan, designId, imageModelOptions, videoModelOptions, nodes } = input
  return plan.shots.map((shot) => {
    const options = shot.shotKind === 'image' ? imageModelOptions : videoModelOptions
    const modelOption = options.find((option) => option.value === shot.modelKey) ?? null
    const mode = resolveShotArchetypeMode(modelOption, shot.modeId)?.mode ?? null
    return { shot, mode, exec: deriveShotRowExec({ plan, shot, designId, nodes, mode }) }
  })
}

// ── 参考卡（锚）执行态：节点投影（B3 图卡）。刻意**无独立状态词表**——卡面语义全是
// node.status（generating/failed）+ frozen（锁）+ result（有无图）既有 owner 的投影，
// 「N 镜在等它 / 被 N 镜引用」从行 derive 聚合（同一份，F2）。──

export type AnchorCardRuntime = {
  anchor: PlanAnchor
  node: GenerationCanvasNode | null
  /** 视觉锚才生成图；文本锚（仅提示词）恒 false → 文字卡。 */
  visual: boolean
  resultUrl: string | null
  generating: boolean
  failed: boolean
  errorMessage: string | null
  progressPercent: number | null
  locked: boolean
  /** 引用此锚的镜数（visual 反查计数；文本锚=写进提示词的镜数）。 */
  referencedByCount: number
  /** 其中还没出图、正等这张卡的镜数（astat「N 镜在等它」）。 */
  waitingShotCount: number
}

export function deriveAnchorCardRuntimes(input: {
  plan: StoryboardPlan
  designId: string
  nodes: readonly GenerationCanvasNode[]
  /** 行 runtime（deriveStoryboardRowRuntimes 的输出；等待计数与行状态同一份）。 */
  rows: readonly StoryboardRowRuntime[]
}): AnchorCardRuntime[] {
  const { plan, designId, nodes, rows } = input
  return plan.anchors.map((anchor) => {
    const visual = isVisualAnchor(anchor)
    const node = visual ? findAnchorNode(nodes, designId, anchor) : null
    const generating = isNodeActive(node)
    const failed = !generating && isNodeFailed(node)
    const percent = node?.progress?.percent
    return {
      anchor,
      node,
      visual,
      resultUrl: resultDisplayUrl(node),
      generating,
      failed,
      errorMessage: failed ? node?.error || null : null,
      progressPercent: generating && typeof percent === 'number' && Number.isFinite(percent)
        ? Math.max(0, Math.min(100, percent))
        : null,
      locked: Boolean(node && isAnchorFrozen(node) && hasUsableResult(node)),
      referencedByCount: plan.shots.filter((shot) => shot.anchorIds.includes(anchor.id)).length,
      waitingShotCount: rows.filter((row) => row.exec.waitingRefs.some((ref) => ref.anchor.id === anchor.id)).length,
    }
  })
}

// ── 批量（footer 主按钮）与计数：与行状态同一份 derive（F2 禁静态快照）──

export type StoryboardRowWithExec = { shot: PlanShot; exec: ShotRowExec }

export type StoryboardBatchView<T extends StoryboardRowWithExec = StoryboardRowRuntime> = {
  /** 进批次的行（ready + failed 重试；镜序）。 */
  runnable: T[]
  /** 不进批次的原因分桶（footer 写明原因）。 */
  excluded: {
    waitingRefs: number
    /** 参考卡已出图但没锁：批量为保一致性等锁（画布 W2 冻结门同语义）。 */
    unlockedRefs: number
    missingRequired: number
    locked: number
    generating: number
    /**
     * 「本次跳过」（v6 §2.10）：用户勾掉的行。**作用域是这一批**——跑完标记自动清，
     * 与 `locked`（持久、要显式解锁）语义不同、视觉不同、清除时机不同，不许混成一个。
     * 它必须在**这一份 derive** 里减掉，不许 footer 自己再减一次——那正是计数对不上的经典成因。
     */
    skipped: number
  }
  doneCount: number
  /** 按状态计数（组头/标题小结用同一份）。 */
  countByStatus: Record<ShotRowStatus, number>
}

export function deriveStoryboardBatch<T extends StoryboardRowWithExec>(
  rows: readonly T[],
  /** 本次跳过的行（`stableShotId` 键）。缺省 = 没有人跳过。 */
  skippedShotIds?: ReadonlySet<string>,
): StoryboardBatchView<T> {
  const countByStatus = Object.fromEntries(SHOT_ROW_STATUSES.map((status) => [status, 0])) as Record<ShotRowStatus, number>
  const view: StoryboardBatchView<T> = {
    runnable: [],
    excluded: { waitingRefs: 0, unlockedRefs: 0, missingRequired: 0, locked: 0, generating: 0, skipped: 0 },
    doneCount: 0,
    countByStatus,
  }
  for (const row of rows) {
    countByStatus[row.exec.status] += 1
    // 跳过是**批次筛选**，不是状态：它不改 countByStatus（那一份说的是"这镜做完没有"），
    // 只把这一行从 runnable 里摘出来。
    if (skippedShotIds?.has(stableShotId(row.shot))) {
      if (row.exec.status === 'ready' || row.exec.status === 'failed') view.excluded.skipped += 1
      if (row.exec.status === 'done') view.doneCount += 1
      continue
    }
    switch (row.exec.status) {
      case 'done':
        view.doneCount += 1
        break
      case 'locked':
        view.excluded.locked += 1
        break
      case 'generating':
        view.excluded.generating += 1
        break
      case 'waiting-refs':
        view.excluded.waitingRefs += 1
        break
      case 'missing-required':
        view.excluded.missingRequired += 1
        break
      case 'ready':
      case 'failed':
        // 就绪/失败重试的行：引用锚未锁定 → 不进批（批量波次的冻结门会拦，提前说清而不是让 toast 事后报）。
        if (row.exec.unlockedRefs.length > 0) view.excluded.unlockedRefs += 1
        else view.runnable.push(row)
        break
    }
  }
  return view
}
