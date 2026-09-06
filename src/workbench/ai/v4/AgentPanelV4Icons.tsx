// Agent 面板 v4 · icon ↔ 动词的**唯一**映射（定稿 Process 板下半张表）。
//
// 规则（照抄定稿）：icon 标的是**动的那个对象**（文稿 / 时间轴 / 节点 / 图 / 视频 / 音频），
// 不是具体工具名——用户不认识 `nomi_timeline_read`，认识「时间轴」。「读」「写」由动词说，不占 icon。
// 状态永远在行尾，只用 spinner / ✓ / ⚠ 三个，不用 icon 表达状态。
//
// 明令禁用（定稿画的虚线框）：机器人头、闪光「AI」、芯片「模型」、纯转圈无文字、沙漏。
// 这份表就是那条禁令的执行处——任何积木要 icon 都从这里取，不在组件里各写各的三元表达式。
import React from 'react'
import {
  IconAlertTriangle,
  IconArrowUp,
  IconBolt,
  IconBrain,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconDownload,
  IconFileText,
  IconHistory,
  IconLayersSubtract,
  IconLayoutSidebarRightCollapse,
  IconListCheck,
  IconLoader2,
  IconMessage,
  IconMovie,
  IconMusic,
  IconPackage,
  IconPaperclip,
  IconPencil,
  IconPhoto,
  IconPlug,
  IconPlus,
  IconRefresh,
  IconScissors,
  IconSearch,
  IconTimeline,
  IconTransitionRight,
  IconX,
  type Icon,
} from '@tabler/icons-react'
import type { V4ActionFamily, V4ToolStatus } from './agentPanelV4Types'

/** 家族 → Tabler 组件。逐项对着定稿样张 `_tabler.json` 的 path 反查得到，不是凭名字猜的。 */
const ACTION_ICONS: Readonly<Record<V4ActionFamily, Icon>> = {
  think: IconBrain,
  document: IconFileText,
  timeline: IconTimeline,
  canvas: IconLayersSubtract,
  search: IconSearch,
  write: IconPencil,
  image: IconPhoto,
  video: IconMovie,
  audio: IconMusic,
  edit: IconScissors,
  transition: IconTransitionRight,
  skill: IconPackage,
  plan: IconListCheck,
  export: IconDownload,
  attachment: IconPaperclip,
  layout: IconLayoutSidebarRightCollapse,
  spend: IconBolt,
  credential: IconPlug,
  question: IconMessage,
}

export function ActionIcon({ action, size = 14 }: { action: V4ActionFamily; size?: number }): JSX.Element {
  const Glyph = ACTION_ICONS[action]
  return <Glyph size={size} aria-hidden="true" />
}

/** 定稿 `.spin`：12px 圆环，accent 顶边转。`motion-reduce` 下不转（无障碍）。 */
export function StatusSpinner({ size = 12 }: { size?: number }): JSX.Element {
  return <IconLoader2 size={size} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
}

/** 行尾状态：只有 spinner / ✓ / ⚠ 三个。output-denied 是用户点的「不要」，用 ×。 */
export function ToolStatusIcon({ status, size = 12 }: { status: V4ToolStatus; size?: number }): JSX.Element {
  if (status === 'output-error') return <IconAlertTriangle size={size} aria-hidden="true" />
  if (status === 'output-denied') return <IconX size={size} aria-hidden="true" />
  if (status === 'output-available') return <IconCheck size={size} aria-hidden="true" />
  return <StatusSpinner size={size} />
}

export {
  IconAlertTriangle,
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconHistory,
  IconLayoutSidebarRightCollapse,
  IconMessage,
  IconPackage,
  IconPaperclip,
  IconPlus,
  IconRefresh,
  IconX,
}
