/**
 * 「生成全部」的唯一执行口（owner）：同一张付费确认、按项勾选，确认后按用户勾的重建执行计划再开出价、派发。
 * 画布的组框工具条 / 右键菜单（useCanvasFrameActions）和生成页列表的分区头「生成全部」都从这里走——
 * 列表没有自己的批量路径，也不另开确认框；每个节点用它自己已选好的模型和参数，并发交给调度器默认值。
 *
 * 勾选规则（用户拍板 C10，docs/design/2026-10-08-approved-designs.md）：没生成的默认勾、已生成的默认不勾（可勾上重生成）、
 * 生成中的锁住（不能勾）。点了的生成、去掉的不生成——取消的那一项不进计划、不开出价、不派发（见 confirmAndRunPlan 的 itemized）。
 */
import { useProductionCanvasLandingStore } from '../../production/productionCanvasLandingStore'
import { useWorkbenchStore } from '../../workbenchStore'
import { storyboardLabelSource } from '../../generation/list/storyboardLabels'
import { resolveStoryboardShotLabel } from '../../../../electron/shared/canvas/storyboardShotLabel'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { PlanRow } from '../../shared/PlanRows'
import i18n from '../../../i18n'
import { buildDependencyWaves } from '../runner/dependencyWaves'
import { confirmAndRunPlan } from './batchPlanPreview'
import { isGenerationNodeBusy } from './canvasProductionScope'

function rowLabel(node: GenerationCanvasNode): string {
  const shot = resolveStoryboardShotLabel(node, storyboardLabelSource(useWorkbenchStore.getState().storyboardDesignsByDocumentId))
  if (shot) {
    const index = String(shot.number).padStart(2, '0')
    return shot.scoped && shot.designTitle ? i18n.t('generationList.shotScoped', { storyboard: shot.designTitle, index }) : i18n.t('generationList.shot', { index })
  }
  return node.title?.trim() || i18n.t('generationList.untitled')
}

/** 这个节点能不能进「生成全部」的候选（有生成能力、此刻没在生成）。不碰文案，按钮可用态每次 store 变化都要算，必须便宜。 */
function isCandidate(node: GenerationCanvasNode | undefined, runs: ReturnType<typeof useProductionCanvasLandingStore.getState>['runs']): node is GenerationCanvasNode {
  return Boolean(node && getGenerationNodeExecutionKind(node.kind) && !isGenerationNodeBusy(node, runs))
}

/** 确认卡上的候选行（id = 节点 id）：每个能生成的节点一行；锁住 / 默认勾选按上面的规则。 */
export function groupGenerateRows(nodeIds: readonly string[]): PlanRow[] {
  const { nodes } = useGenerationCanvasStore.getState()
  const runs = useProductionCanvasLandingStore.getState().runs
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const rows: PlanRow[] = []
  for (const id of nodeIds) {
    const node = byId.get(id)
    if (!node || !getGenerationNodeExecutionKind(node.kind)) continue
    const busy = isGenerationNodeBusy(node, runs)
    const status = node.status ?? 'idle'
    const open = !busy && (status === 'idle' || status === 'error')
    rows.push({
      id,
      label: rowLabel(node),
      checked: open,
      disabled: busy,
      aside: busy ? i18n.t('shotTable.status.generating') : status === 'error' ? i18n.t('shotTable.status.failed') : open ? i18n.t('shotTable.status.ready') : i18n.t('shotTable.status.done'),
    })
  }
  return rows
}

/** 这批节点里有没有能勾的（不是全在生成中）。按钮可用态与点击后卡上的候选共用这一份。 */
export function hasGroupGenerateCandidates(nodeIds: readonly string[]): boolean {
  if (nodeIds.length === 0) return false
  const runs = useProductionCanvasLandingStore.getState().runs
  const wanted = new Set(nodeIds)
  return useGenerationCanvasStore.getState().nodes.some((node) => wanted.has(node.id) && isCandidate(node, runs))
}

/** 确认卡还开着（或刚确认、还在开出价）的批：同一批再点一次不再开第二张卡（两张卡各确认一次 = 同一批花两份钱）。 */
const openBatches = new Set<string>()

/** 派发这批节点；一个都没得勾 = 'empty'（调用方说一句话），否则弹确认（逐项勾选）并返回 'started'。 */
export function runGroupGenerate(nodeIds: readonly string[]): 'empty' | 'started' {
  if (!hasGroupGenerateCandidates(nodeIds)) return 'empty'
  const rows = groupGenerateRows(nodeIds)
  const live = useGenerationCanvasStore.getState()
  const batchKey = nodeIds.slice().sort().join('|')
  if (openBatches.has(batchKey)) return 'started'
  openBatches.add(batchKey)
  const initial = rows.filter((row) => row.checked && row.id).map((row) => row.id!)
  // plan 只是占位的默认选择（真正的执行计划在确认后按勾选重建，见 confirmAndRunPlan 的 itemized）。
  void confirmAndRunPlan(buildDependencyWaves(initial, { nodes: live.nodes, edges: live.edges }), { initiator: 'user', itemized: { rows } })
    .catch(() => undefined)
    .finally(() => { openBatches.delete(batchKey) })
  return 'started'
}
