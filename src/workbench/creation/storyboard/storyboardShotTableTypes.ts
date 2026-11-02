import type React from 'react'
import type { ModelOption } from '../../../config/models'
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import type { AnchorCardRuntime, StoryboardRowRuntime } from './exec/storyboardRowStatus'
import type { ShotVariant } from './shotRow/shotVariants'

export type StoryboardShotTableProps = {
  pendingActions?: ReadonlySet<string>
  plan: StoryboardPlan
  projectId?: string | null
  /** 行执行 runtime（与 plan.shots 同序；exec/storyboardRowStatus 单源 derive）。 */
  rows: StoryboardRowRuntime[]
  /** C1：参考卡 runtime（供行级 @ 候选）。缺省 = 不开 @ 面板。 */
  anchorCards?: AnchorCardRuntime[]
  imageModelOptions: ModelOption[]
  videoModelOptions: ModelOption[]
  /** 提示词为空的镜号（validatePlan 的 empty-shot-prompt 投影，行红边用）。 */
  emptyPromptShots: Set<number>
  /**
   * 执行计划的行内警示（返工 7 / D1）：键 = `stableShotId`，值 = 已渲染好的短句 + 完整理由。
   * 表与行都不认识引擎（不 import planResolver）——句子在编辑器用 `strategyText` 渲染好再传下来。
   */
  durationWarnings?: ReadonlyMap<string, { kind: 'overflow' | 'underflow'; text: string; detail: string }> | undefined
  onChange: (plan: StoryboardPlan) => void
  /** The resident Agent receives the same stable storyboard reference as the row selection UI. */
  onStoryboardShotSelect?: (shot: StoryboardPlan['shots'][number]) => void
  /** 选中集变化时上报（编辑器与浮条读同一份选择，不各存一份）。 */
  onSelectionChange?: ((runtimes: StoryboardRowRuntime[]) => void) | undefined
  /** 行内「生成」（画面格常驻按钮 / 失败重试）。 */
  onGenerateRow: (runtime: StoryboardRowRuntime) => void
  /** 浮条 ↻ 原地重生成。 */
  onRegenerateRow: (runtime: StoryboardRowRuntime) => void
  /**
   * 可找回行的**免费**续查（`recoverNodeResult`）。可选：设计实验室等只读取景不接执行通路，
   * 缺省时那枚按钮就不出现——但绝不许拿 `onGenerateRow` 顶替（那是付费重跑）。
   */
  onRecoverRow?: ((runtime: StoryboardRowRuntime) => void) | undefined
  /** 行 ⋯ 菜单里的「锁定 / 解锁」镜级开关。 */
  onToggleLockRow: (runtime: StoryboardRowRuntime) => void
  /** 结果态双击打开预览。 */
  onOpenPreviewRow: (runtime: StoryboardRowRuntime) => void
  onLocateInCanvasRow?: ((runtime: StoryboardRowRuntime) => void) | undefined
  /** 参考已变「用新图重跑」。 */
  onRerunFreshRefsRow: (runtime: StoryboardRowRuntime) => void
  onGenerateSelected: (runtimes: StoryboardRowRuntime[]) => void
  onDeleteSelected: (runtimes: StoryboardRowRuntime[]) => void
  filterAnchorId?: string | null
  /**
   * 「本次跳过」的行（`stableShotId` 键，v6 §2.10）。**受控**：owner 是编辑器，因为 footer 的
   * 「将跑 N 镜」必须与它同一份 derive（合同 §9.3：不许 footer 自己再减一次）。
   */
  skippedShotIds?: ReadonlySet<string>
  onToggleSkip?: ((shotId: string) => void) | undefined
  /** 每镜的历史变体（§2.9）；键 = `stableShotId`。本轮由调用方喂，落盘是下一刀。 */
  variantsByShotId?: Readonly<Record<string, readonly ShotVariant[]>>
  adoptedVariantByShotId?: Readonly<Record<string, string>>
  onAdoptVariant?: ((runtime: StoryboardRowRuntime, variant: ShotVariant) => void) | undefined
  onDeleteVariant?: ((runtime: StoryboardRowRuntime, variant: ShotVariant) => void) | undefined
  /** 每镜产出的 `@tag`（§2.10）；键 = `stableShotId`。 */
  outputTagByShotId?: Readonly<Record<string, string>>
  /** Agent 入口——多选浮条与每行 ⋯ 菜单两处。 */
  onAgentHandoff?: ((runtimes: StoryboardRowRuntime[]) => void) | undefined
  /** 播放本场；整片播放复用同一 playback queue owner。 */
  onPlayGroup?: ((runtimes: StoryboardRowRuntime[]) => void) | undefined
  /**
   * 表所在的滚动区（分镜页那条 `data-storyboard-scroll`）。窗口化按它的视口算挂哪几行；
   * 缺省（设计实验室取景、无滚动区）= 按 `FALLBACK_VIEWPORT` 那么高的视口挂。
   */
  scrollRef?: React.RefObject<HTMLElement | null>
}
