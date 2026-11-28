// 顶栏最右那颗 Nomi 入口的长相：状态 → 脸、角标、胶囊、点、悬停那句话（NomiEntryTopbar 板，设计卡 docs/plan/2026-11-22-nomi-entry-topbar.md）。
// 只判断、不画：宿主（ShellNomiEntry）读 residentActivity 的角标投影传进来；同一件事只在这里判一次，设计实验室和走查读同一份。
//
// 两种「状态」分开用（设计卡调用方表）：
//   · 脸用 face——不看待确认的那份（`useV4DockStatus` 返回的 faceStatus，由 `resolveDockStatuses` 求），在做 + 等你确认时脸照样转、角标盖右上（B5）；
//   · 悬停那句的中段用合并状态（`resolveDockStatus`，等你确认 > 失败 > 在做 > 刚做完 > 空闲），和面板头那句同一个说法。
import type { NomiAgentPose } from '../../../design/identity'
import type { V4DockStatus } from '../../../workbench/ai/v4/agentPanelV4DockStatus'

/** 入口上 data-status 的五种脸（「有新消息」是空闲加未读）——就是品牌组件那五副长相，同一份词表。 */
export type NomiEntryStatus = NomiAgentPose
/** face = 28px 的脸（可带角标 / 点）；capsule = 「等你确认 N」带字胶囊；toggle = 面板打开时退成安静的线性侧栏开关。 */
export type NomiEntryShape = 'face' | 'capsule' | 'toggle'

export type NomiEntryLook = {
  status: NomiEntryStatus
  shape: NomiEntryShape
  /** 脸右上的待确认角标（最多写 9+）；胶囊、开关态或没有待确认时 null。 */
  badge: string | null
  /** 右上的小点：未读（蓝）/ 有一步没成（红）；有待确认或面板打开时不出点。 */
  dot: 'unread' | 'failed' | null
}

/** 角标封顶 9+，全数在悬停那句里（B3）。 */
export const NOMI_ENTRY_BADGE_MAX = 9

export function nomiEntryBadgeText(pendingCount: number): string {
  return pendingCount > NOMI_ENTRY_BADGE_MAX ? `${NOMI_ENTRY_BADGE_MAX}+` : String(pendingCount)
}

/**
 * - face：不含待确认的脸状态（null = 面板还没发布过，当空闲）；
 * - roomy：顶栏够宽（≥900，胶囊放得下）；
 * - open：面板此刻开着（停靠 / 浮窗）——活小人移交舞台至 AgentPanelV4Panel 头部，顶栏入口退成安静线性侧栏开关（方案 A：一个角色一个真身）。
 */
export function nomiEntryLook({ face, pendingCount, unreadCount, open, roomy }: {
  face: V4DockStatus | null
  pendingCount: number
  unreadCount: number
  open: boolean
  roomy: boolean
}): NomiEntryLook {
  const base: Exclude<NomiEntryStatus, 'unread'> = face === 'running' || face === 'done' || face === 'failed' ? face : 'idle'
  const pending = pendingCount > 0
  const status: NomiEntryStatus = base === 'idle' && unreadCount > 0 ? 'unread' : base
  if (open) {
    return { status, shape: 'toggle', badge: null, dot: null }
  }
  const shape: NomiEntryShape = pending && roomy ? 'capsule' : 'face'
  return {
    status,
    shape,
    badge: pending && shape === 'face' ? nomiEntryBadgeText(pendingCount) : null,
    dot: pending ? null : base === 'failed' ? 'failed' : unreadCount > 0 ? 'unread' : null,
  }
}

/** 快捷键前缀按平台写：Mac ⌘，其余 Ctrl+（G1）。 */
export function nomiEntryShortcutPrefix(platform: string): string {
  return /Mac/i.test(platform) ? '⌘' : 'Ctrl+'
}

export type NomiEntryTooltipLabels = {
  /** 「打开 Nomi（⌘J）」 */
  open: string
  /** 「收起面板（⌘\）」 */
  collapse: string
  /** 「等你确认 N」（胶囊里那句） */
  pending: (count: number) => string
  /** 合并状态那句（「Nomi 在这儿」「等你确认 N 条」…） */
  status: string
  /** 「N 条新消息」 */
  unread: (count: number) => string
}

/** 悬停 / 读屏那一句：开头（胶囊 / 收起面板 / 打开 Nomi）· 合并状态 ·（没有待确认时）N 条新消息。 */
export function nomiEntryTooltip(look: NomiEntryLook, { pendingCount, unreadCount, open }: { pendingCount: number; unreadCount: number; open: boolean }, labels: NomiEntryTooltipLabels): string {
  const lead = look.shape === 'capsule' ? labels.pending(pendingCount) : open ? labels.collapse : labels.open
  const unread = pendingCount === 0 && unreadCount > 0 ? labels.unread(unreadCount) : null
  return [lead, labels.status, unread].filter(Boolean).join(' · ')
}
