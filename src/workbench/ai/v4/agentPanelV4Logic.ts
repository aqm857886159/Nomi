// Agent 面板 v4 · composer 高度与权限档的**纯计算**层。
//
// 为什么单独一层：这三件事（高度上限、权限映射、Enter 语义）都是「随输入 derive」的规则，
// 定稿 Composer 板把它们写成了表。规则住在组件里就只能靠截图证明；住在这里能单测。
import React from 'react'
import type { ProjectAgentApprovalPolicy } from '../../../../electron/shared/projectAgentContracts'
import type { ComposerMode, PermissionTier } from './agentPanelV4Types'
import { PERMISSION_POLICIES } from './agentPanelV4Types'

/**
 * composer 的几何常量，逐项对着定稿样张的 `_agent.css` 抄：
 * `.composer .txt{padding:10px 12px 6px;line-height:1.5;min-height:44px}`（13px × 1.5 ≈ 20）、
 * `.composer .bar{padding:4px 8px 8px}` + `.cb{height:28px}` = 40、外框上下各 1px。
 */
export const COMPOSER_LINE_HEIGHT = 20
const TEXT_PADDING = 16
const TEXT_MIN_HEIGHT = 44
const BAR_HEIGHT = 40
const BORDER = 2
/** 一行 chip（`.composer .att{padding:8px 10px 0}` + `.a{height:24px}`）。 */
const CHIP_ROW_HEIGHT = 32

const composerHeightForRows = (rows: number, chipRows: number): number =>
  Math.max(TEXT_MIN_HEIGHT, rows * COMPOSER_LINE_HEIGHT + TEXT_PADDING) +
  chipRows * CHIP_ROW_HEIGHT +
  BAR_HEIGHT +
  BORDER

/** 定稿的「6 行」档：小面板与收起坞共用。 */
export const COMPOSER_SIX_LINE_CAP = composerHeightForRows(6, 0)

/**
 * 上限**随面板高度 derive，不写死**（定稿 Composer 板「上限怎么定」表）：
 * ≥800 → 面板高 40%；640–800 → 30%；<640 → 6 行；收起坞（结果全屏）→ 6 行，
 * 因为它压在画面上，不能盖住预览。
 */
export function maxComposerHeight(panelHeight: number, mode: ComposerMode | 'dock'): number {
  if (mode === 'dock') return COMPOSER_SIX_LINE_CAP
  if (panelHeight >= 800) return Math.round(panelHeight * 0.4)
  if (panelHeight >= 640) return Math.round(panelHeight * 0.3)
  return COMPOSER_SIX_LINE_CAP
}

/**
 * 实际高度 = 自然高度与上限取小。封顶后 textarea 内部滚动（组件负责），
 * 不弹「太长」提示——定稿高度③。
 */
export function composerHeight(
  panelHeight: number,
  mode: ComposerMode | 'dock',
  rows = 1,
  chipRows = 0,
): number {
  return Math.min(
    maxComposerHeight(panelHeight, mode),
    composerHeightForRows(Math.max(1, rows), Math.max(0, chipRows)),
  )
}

/** 组件侧入口：高度只是 props 的函数，没有 effect、没有测量副本。 */
export function useComposerHeight(
  panelHeight: number,
  mode: ComposerMode | 'dock',
  rows = 1,
  chipRows = 0,
): number {
  return React.useMemo(
    () => composerHeight(panelHeight, mode, rows, chipRows),
    [panelHeight, mode, rows, chipRows],
  )
}

/** 三档 → 仓库合同的两个字段。零新概念（定稿 §2）。 */
export function approvalPolicyForTier(tier: PermissionTier): ProjectAgentApprovalPolicy {
  return PERMISSION_POLICIES[tier]
}

/**
 * 三档「永不放宽」的机器证明。
 *
 * `ProjectAgentApprovalPolicy` 的两根轴在合同里明写「Changing the work mode never widens
 * approval」。工作方式三档删掉之后（2026-09-06 拍板 ①），权限成了面板上唯一的授权控件，
 * 那条不变量就全落在这三档身上：任何一档映射出来的策略都不能比它**该有的**更宽。
 * 宽窄的定义就在这里，单测按它逐档核对——不靠人读表。
 */
export function approvalPolicyRank(policy: ProjectAgentApprovalPolicy): Readonly<{ mode: number; spend: number }> {
  return {
    mode: policy.mode === 'step' ? 0 : policy.mode === 'safe-auto' ? 1 : 2,
    spend: policy.spend === 'confirm' ? 0 : 1,
  }
}

/** left 是否**不比** right 宽（两根轴都不更宽）。 */
export function isNoWiderThan(left: ProjectAgentApprovalPolicy, right: ProjectAgentApprovalPolicy): boolean {
  const a = approvalPolicyRank(left)
  const b = approvalPolicyRank(right)
  return a.mode <= b.mode && a.spend <= b.spend
}

/**
 * Enter 发送 / Shift+Enter 换行 / 中文输入法 composition 期间 Enter 不发送。
 * 第三条是真坑：不判 isComposing 的话，选字时按 Enter 会把半截拼音发出去。
 */
export function shouldSubmitComposer(event: {
  key: string
  shiftKey: boolean
  isComposing: boolean
}): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing
}
