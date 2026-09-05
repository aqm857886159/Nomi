// 设计实验室 · Agent 面板取景台与共用夹具
//
// 状态注册表本体按来源拆在 `states/`（R9 分层 + R12 巨壳门岗：单文件 ≤800 行）。
// 这里放三样共用件：状态的类型、两种取景框（shell / piece）与「现役未实现」占位、
// 以及各状态共享的夹具常量（计划镜头、素材、长文本…）。
//
// 两种渲染档，区别只在「这一形态今天走不走得通整条面板」：
//   - `shell`：把 Host 快照灌进 `projectAgentProjectionStore`，渲染现役
//     `ProjectAgentResidentShell`。看到的就是真机面板。
//   - `piece`：直接渲染现役展示组件（`ResidentExceptionStates` / `InterventionSlot` 一族）并喂 props。
//     用在「组件已实现、但还没有任何一条 Host 数据路径能让它在面板里出现」的形态上——
//     这个档位本身就是欠账信号，逐条记在 `coverage` 字段里，汇进不一致清单。

import React from 'react'
import ProjectAgentResidentShell from '../../workbench/ai/ProjectAgentResidentShell'
import { projectAgentProjectionStore } from '../../workbench/ai/projectAgentProjectionStore'
import { useWorkbenchStore } from '../../workbench/workbenchStore'
import { setCommittedProposal, clearCommittedProposal } from '../../workbench/generationCanvas/agent/proposalUndo'
import { StaleConversationDivider } from '../../workbench/ai/staleConversationDivider'
import {
  ResidentArtifactCard,
  ResidentAtPicker,
  ResidentCandidatesCard,
  ResidentDeviationCard,
  ResidentFailureCard,
  ResidentFoldableText,
  ResidentPinnedResultCard,
  ResidentPlanCard,
  ResidentQuestionCard,
  ResidentSpendCard,
  ResidentWriteFailureRow,
} from '../../workbench/ai/resident/ResidentExceptionStates'
import { ResidentThinkingState, ResidentToolChips } from '../../workbench/ai/resident/ResidentUiPrimitives'
import { InterventionSlot } from '../../workbench/ai/InterventionSlot'
import {
  assistantItem,
  failureItem,
  hostState,
  LAB_RECEIPT,
  proposalItem,
  queueItem,
  toolItem,
  userItem,
} from './agentPanelFixtures'
import type { ProjectAgentHostState } from '../../../electron/shared/projectAgentContracts'
import type { AssetRef } from '../../workbench/assets/assetTypes'

/** 面板的单一宽度真相源 = workbenchStore 的 assistantWidth 默认值（340）。 */
export const PANEL_WIDTH = 340
/** 舞台高度。够高才能一屏看完一条完整对话，又不至于让接触表变成长条。 */
export const PANEL_HEIGHT = 620

// 状态/档位的类型住 `labScreen.ts`（各屏共用一份形状）；这里只转出去，
// 让既有 import 路径不用改，也不给同一个契约留第二份定义。
export type { LabCoverage, LabState } from './labScreen'

// ── shell 档：灌 Host 快照，渲染现役面板 ──────────────────────────────────────

export function ShellStage({
  snapshot,
  receipt,
  draft,
}: {
  snapshot: ProjectAgentHostState
  receipt?: typeof LAB_RECEIPT
  draft?: string
}): JSX.Element {
  // useMemo 而不是 useEffect：面板首帧就要读到快照，晚一帧灌会先渲染一次空态，
  // 截图捕到那一帧就成了「面板是空的」的假证据。
  React.useMemo(() => {
    projectAgentProjectionStore.install('design-lab', 1, snapshot)
    if (receipt) setCommittedProposal(receipt)
    else clearCommittedProposal()
    useWorkbenchStore.setState({
      assistantWidth: PANEL_WIDTH,
      projectAgentDockCollapsed: false,
      projectAgentDraft: draft ?? '',
      projectAgentAttachments: [],
      projectAgentReferences: [],
    })
    return null
  }, [snapshot, receipt, draft])
  React.useEffect(() => () => { projectAgentProjectionStore.clear(); clearCommittedProposal() }, [])
  return (
    <div
      className="overflow-hidden rounded-nomi border border-nomi-line bg-nomi-bg"
      style={{ width: PANEL_WIDTH, height: PANEL_HEIGHT }}
      data-design-lab-stage="shell"
    >
      <ProjectAgentResidentShell surface="generation" />
    </div>
  )
}

/** piece 档的取景框：与面板同宽，高度随内容——单件形态不该被拉到满屏高。 */
export function PieceStage({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      className="grid gap-2 rounded-nomi border border-nomi-line bg-[var(--workbench-ai-panel-bg)] p-3 text-nomi-ink"
      style={{ width: PANEL_WIDTH }}
      data-design-lab-stage="piece"
    >
      {children}
    </div>
  )
}

/** 设计文档要求但现役没有的形态：基线钉住「今天这里是空的」，不许悄悄当它存在。 */
export function MissingStage({ what }: { what: string }): JSX.Element {
  return (
    <div
      className="grid place-items-center rounded-nomi border border-dashed border-nomi-line bg-nomi-bg p-4 text-center text-micro text-nomi-ink-60"
      style={{ width: PANEL_WIDTH, minHeight: 96 }}
      data-design-lab-stage="missing"
    >
      <span>现役未实现：{what}</span>
    </div>
  )
}

export const NOOP = (): void => {}

export const PLAN_SHOTS = [
  { id: 's1', title: '镜 1 雨夜街口', description: '霓虹反射在积水上，主角推门而出', selected: true },
  { id: 's2', title: '镜 2 追逐起步', description: '雨衣被风掀起，脚步溅起水花', selected: true },
  { id: 's3', title: '镜 3 巷口急转', description: '手扶砖墙急转，镜头跟摇', selected: false, edited: true },
  { id: 's4', title: '镜 4 雨幕特写', description: '雨水顺着下颌线滑落', selected: true },
  { id: 's5', title: '镜 5 车灯扫过', description: '车灯从画面右侧扫过，人物剪影', selected: false },
]

export const LONG_PLAN_SHOTS = Array.from({ length: 14 }, (_, index) => ({
  id: `l${index + 1}`,
  title: `镜 ${index + 1}`,
  description: '雨夜追逐段落的第 ' + (index + 1) + ' 个画面',
  selected: index % 2 === 0,
}))

export const PLAN_LABELS = {
  parameters: ['16:9 · 电影感', 'seedream 4.0'],
  failureReason: '没能把这段描述拆成镜头',
  billing: '这次没扣钱',
  editLabel: '改描述',
  retryLabel: '重试',
  loadingLabel: '生成计划中…',
  summaryLabel: (total: number, selected: number) => `共 ${total} 镜 · 已选 ${selected}`,
  generateLabel: (selected: number) => `生成已选（${selected} 镜）`,
  editedLabel: '已改',
  selectAllLabel: '全选',
}

export function planCard(state: string, shots: readonly (typeof PLAN_SHOTS)[number][]): JSX.Element {
  return (
    <ResidentPlanCard
      state={state}
      shots={shots}
      parameters={PLAN_LABELS.parameters}
      failureReason={PLAN_LABELS.failureReason}
      billing={PLAN_LABELS.billing}
      editLabel={PLAN_LABELS.editLabel}
      retryLabel={PLAN_LABELS.retryLabel}
      loadingLabel={PLAN_LABELS.loadingLabel}
      summaryLabel={PLAN_LABELS.summaryLabel}
      generateLabel={PLAN_LABELS.generateLabel}
      editedLabel={PLAN_LABELS.editedLabel}
      selectAllLabel={PLAN_LABELS.selectAllLabel}
      onEdit={NOOP}
      onRetry={NOOP}
      onGenerate={NOOP}
    />
  )
}

// 固定的 1×1 纯色 PNG（data URI）。用真图而不是空 url：空 url 会渲染成一排「图已失效」，
// 那是夹具的锅，却会在接触表上被读成「@ 选择器缩略图坏了」的产品缺陷。
export const LAB_THUMB =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAG7wKklwQ/bwAAAABJRU5ErkJggg=='

export const LAB_ASSETS: readonly AssetRef[] = Array.from({ length: 64 }, (_, index) => ({
  id: `asset-${index + 1}`,
  name: `未命名 ${index + 1}`,
  kind: 'image',
  renderUrl: LAB_THUMB,
  source: 'project',
  origin: { source: 'project', projectId: 'design-lab-project', relativePath: `assets/${index + 1}.png` },
}))

// 折叠阈值是 `ResidentFoldableText` 里的「>3 行 或 >360 字」。夹具必须真的越过它，
// 否则截出来的是「没折叠」的样子，却挂在「超长折叠」这条状态名下——一张骗人的基线。
export const LONG_TEXT =
  '这一段是雨夜追逐的整体设定：城市在午夜下过一场大雨，主角刚从便利店抱着一袋东西冲出来，身后有人追。' +
  '我们要的是霓虹在积水里碎成一片一片的那种质感，镜头贴着人物跑，不要航拍，也不要慢镜。' +
  '中段可以有一次急转，主角手扶砖墙拐进小巷，转过去之后车灯从画面右侧扫过来，人物只剩一个剪影。' +
  '雨要下得实，落在肩上要有重量，积水要被踩碎。追的人始终不给正脸，只给脚步声和越来越近的呼吸。' +
  '结尾停在雨幕特写上，雨水顺着下颌线滑下来，画面外的车灯熄掉，整段收在一声闷响里。' +
  '整体色调偏冷，只有霓虹和车灯是暖的；不要配乐，只留雨声和脚步声，最后三秒静音。' +
  '参考片可以看《银翼杀手 2049》的雨戏和《我是谁：没有绝对安全的系统》的追逐段，但不要它们的手持抖动。' +
  '分镜给我五个就够，每一镜写清景别、机位、人物动作和光源方向，别写那些运镜术语，写成我看得懂的人话。'

/** 262 字：越不过 `ResidentFoldableText` 的 360 字阈值，却在 340px 面板里要占十几行。
 *  它是那条阈值真正的问题所在——见不一致清单 #N（中长文本被裁成一行且无展开口）。 */
export const MID_TEXT = LONG_TEXT.slice(0, 262)
