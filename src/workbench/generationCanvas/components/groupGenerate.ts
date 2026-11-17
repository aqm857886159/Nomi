/**
 * 「生成全部」的唯一执行口（owner）：同一张付费确认、按项勾选，确认后按用户勾的重建执行计划再开出价、派发。
 * 画布的组框工具条 / 右键菜单（useCanvasFrameActions）和生成页列表的分区头「生成全部」都从这里走——
 * 列表没有自己的批量路径，也不另开确认框；每个节点用它自己已选好的模型和参数，并发交给调度器默认值。
 *
 * 勾选规则（用户拍板 C10，docs/design/2026-10-08-approved-designs.md）由共用主人（`generationShotScope` 的 group 意图）算：
 * 没生成的默认勾、已生成的默认不勾（可勾上重生成）、生成中 / 可找回的灰着（不能勾）。这里只把主人的行画成卡上的行。
 * 点了的生成、去掉的不生成——取消的那一项不进计划、不开出价、不派发（见 confirmAndRunPlan 的 itemized）。
 */
import { useProductionCanvasLandingStore } from '../../production/productionCanvasLandingStore'
import { useWorkbenchStore } from '../../workbenchStore'
import { storyboardLabelSource } from '../../generation/list/storyboardLabels'
import { resolveStoryboardShotLabel } from '../../../../electron/shared/canvas/storyboardShotLabel'
import type { GenerationScopePlan, ScopeRowReason } from '../../../../electron/shared/agentCapabilities/generationShotScope'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { PlanRow } from '../../shared/PlanRows'
import i18n from '../../../i18n'
import { nodeNamesInOrder } from '../../generation/list/nodeFallbackName'
import { canvasScopeUnselectableReasons, hasSelectableCanvasScope, planCanvasGenerationScope } from '../runner/generationScopeFacts'
import { confirmAndRunPlan } from './batchPlanPreview'

function rowLabel(node: GenerationCanvasNode, fallbackName: string): string {
  const shot = resolveStoryboardShotLabel(node, storyboardLabelSource(useWorkbenchStore.getState().storyboardDesignsByDocumentId))
  if (shot) {
    const index = String(shot.number).padStart(2, '0')
    return shot.scoped && shot.designTitle ? i18n.t('generationList.shotScoped', { storyboard: shot.designTitle, index }) : i18n.t('generationList.shot', { index })
  }
  return fallbackName
}

/** 主人给的原因 → 卡上已有的状态词（不新增文案）。 */
const ASIDE_KEY: Readonly<Record<ScopeRowReason, string>> = {
  generating: 'shotTable.status.generating',
  failed: 'shotTable.status.failed',
  ready: 'shotTable.status.ready',
  done: 'shotTable.status.done',
  recoverable: 'shotTable.status.recoverable',
  // 分镜里定了妆的行的词（组生成意图不看定妆，这一格在画布卡上不会出现）
  frozen: 'shotTable.status.locked',
  'missing-required': 'shotTable.status.missing-required',
}

/** 确认卡上的候选行（id = 节点 id）：主人分好的行照画，不上卡的（excluded）不画。 */
export function groupGenerateRows(plan: GenerationScopePlan): PlanRow[] {
  const byId = new Map(useGenerationCanvasStore.getState().nodes.map((node) => [node.id, node]))
  const shown = plan.rows.filter((row) => row.state !== 'excluded' && byId.has(row.id))
  // 名字的唯一来源（标题 → 提示词前几字 → 类型 + 序号），列表卡也用它，所以确认卡上两行不会都叫「未命名」。
  const nodes = shown.map((row) => byId.get(row.id)!)
  const ordered = nodeNamesInOrder(nodes)
  return shown.map((row, index) => ({
    id: row.id,
    label: rowLabel(nodes[index], ordered[index] ?? ''),
    checked: row.state === 'checked',
    disabled: row.state === 'disabled',
    aside: i18n.t(ASIDE_KEY[row.reason]),
  }))
}

/** 这批节点里有没有能勾的（不是全在生成中 / 待找回）。按钮可用态与点击后卡上的候选共用主人的同一个判据。 */
export function hasGroupGenerateCandidates(
  nodeIds: readonly string[],
  nodes: readonly GenerationCanvasNode[] = useGenerationCanvasStore.getState().nodes,
  runs: ReturnType<typeof useProductionCanvasLandingStore.getState>['runs'] = useProductionCanvasLandingStore.getState().runs,
): boolean {
  return hasSelectableCanvasScope('group', nodeIds, nodes, { runs })
}

/**
 * 「生成整组 / 生成全部」置灰时的原因（设计系统 C1 / C4：置灰要说清为什么）。能生成 → undefined。
 * 原因来自共用主人对这组的分行（各因为什么勾不上），状态词用卡上同一套；组里根本没有能生成的节点 → 原来那句。
 */
export function groupGenerateDisabledReason(
  nodeIds: readonly string[],
  nodes: readonly GenerationCanvasNode[] = useGenerationCanvasStore.getState().nodes,
  runs: ReturnType<typeof useProductionCanvasLandingStore.getState>['runs'] = useProductionCanvasLandingStore.getState().runs,
): string | undefined {
  if (nodeIds.length === 0) return i18n.t('generationCommon.canvas.group.generateEmpty')
  const reasons = canvasScopeUnselectableReasons('group', nodeIds, nodes, { runs })
  if (!reasons) return undefined
  if (!reasons.length) return i18n.t('generationCommon.canvas.group.generateEmpty')
  const detail = reasons
    .map(({ reason, count }) => i18n.t('generationCommon.canvas.group.generateBlockedPart', { count, status: i18n.t(ASIDE_KEY[reason]) }))
    .join(i18n.t('assetLibrary.listSeparator'))
  return i18n.t('generationCommon.canvas.group.generateBlocked', { detail })
}

/**
 * 同一句原因的订阅版（框头、列表分区头用）：画布节点或在跑的生产任务一变，置灰与原因跟着变。
 * nodeIds 传 undefined = 这扇门此刻不显示，不算。
 */
export function useGroupGenerateDisabledReason(nodeIds: readonly string[] | undefined): string | undefined {
  const runs = useProductionCanvasLandingStore((store) => store.runs)
  return useGenerationCanvasStore((state) => (nodeIds ? groupGenerateDisabledReason(nodeIds, state.nodes, runs) : undefined))
}

/** 确认卡还开着（或刚确认、还在开出价）的批：同一批再点一次不再开第二张卡（两张卡各确认一次 = 同一批花两份钱）。 */
const openBatches = new Set<string>()

/** 派发这批节点；一个都没得勾 = 'empty'（调用方说一句话），否则弹确认（逐项勾选）并返回 'started'。 */
export function runGroupGenerate(nodeIds: readonly string[]): 'empty' | 'started' {
  if (!hasGroupGenerateCandidates(nodeIds)) return 'empty'
  const live = useGenerationCanvasStore.getState()
  const plan = planCanvasGenerationScope('group', nodeIds, live)
  const batchKey = nodeIds.slice().sort().join('|')
  if (openBatches.has(batchKey)) return 'started'
  openBatches.add(batchKey)
  // plan 的成员是默认勾上的那几个；确认后按卡上勾的再问一次主人（见 confirmAndRunPlan 的 itemized）。
  void confirmAndRunPlan(plan, { initiator: 'user', itemized: { rows: groupGenerateRows(plan) } })
    .catch(() => undefined)
    .finally(() => { openBatches.delete(batchKey) })
  return 'started'
}
