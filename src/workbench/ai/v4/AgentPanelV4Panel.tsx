// Agent 面板 v4 · 整块面板的装配壳
//
// 定稿三张 Flow 板（创作 / 生成 / 预览）+ Rendering + Dark 板画的都是**同一个壳**装不同内容：
//   头部（N Nomi + Context 环 …… 历史 / 收起）→ 对话流 → 介入槽（永远在 composer 正上方）
//   → 队列（只在运行中还继续输入时）→ composer。
//
// 头部逐件照定稿 `.ph`：`<logo>N</logo>Nomi <ctx/> <sp/> <ic>hist side</ic>`——
// **Context 环紧跟品牌名**（不是甩到最右），右端是历史与收起两个图标。品牌名是「Nomi」不是「Nomi Agent」。
//
// 这个壳**不**按 view 枚举改形状：它只接一份对话流数据。早先那版把 44 个状态全渲成
// 「整块面板 + 几处 if」，结果接触表三列近乎一样，看不出任何一个积木的状态差别。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import { AgentPanelV4Composer } from './AgentPanelV4Composer'
import { V4ContextRing } from './AgentPanelV4Context'
import { V4Intervention, V4Queue, V4TaskCard } from './AgentPanelV4Cards'
import { V4AssistantMessage, V4Thinking, V4UserBubble } from './AgentPanelV4Message'
import { V4ErrorBar, V4ToolReceipt } from './AgentPanelV4Receipt'
import { IconHistory, IconLayoutSidebarRightCollapse } from './AgentPanelV4Icons'
import { useV4Labels } from './agentPanelV4Labels'
import type {
  ComposerMode,
  ContextUsage,
  InterventionData,
  PermissionTier,
  QueueRowData,
  TaskCardData,
  ToolReceipt,
  V4AssistantStatus,
  V4Chip,
} from './agentPanelV4Types'
import { DEFAULT_PERMISSION_TIER } from './agentPanelV4Types'

export type V4FlowItem =
  | { kind: 'user'; text: string; chips?: readonly V4Chip[] }
  | { kind: 'assistant'; text: string; status: V4AssistantStatus }
  | { kind: 'thinking'; label: string; meta: string }
  | { kind: 'tool'; receipt: ToolReceipt }
  | { kind: 'task'; task: TaskCardData }
  | { kind: 'error'; reason: string; action?: string }

export type AgentPanelV4PanelProps = {
  flow: readonly V4FlowItem[]
  slot?: InterventionData
  queue?: readonly QueueRowData[]
  context: ContextUsage
  composer?: { mode?: ComposerMode; permission?: PermissionTier; chips?: readonly V4Chip[]; text?: string; skillSelected?: boolean; focused?: boolean }
  width?: number
  height?: number
  darkMode?: boolean
}

/** 对话流里的一条 = 一个积木；哪个积木由 kind 决定，壳不认识内容。 */
export function V4FlowRow({ item, darkMode, panelHeight }: { item: V4FlowItem; darkMode: boolean; panelHeight?: number }): JSX.Element {
  const labels = useV4Labels()
  if (item.kind === 'user') return <V4UserBubble text={item.text} chips={item.chips} darkMode={darkMode} />
  if (item.kind === 'assistant') return <V4AssistantMessage text={item.text} status={item.status} labels={labels.assistant} panelHeight={panelHeight} />
  if (item.kind === 'thinking') return <V4Thinking label={item.label} meta={item.meta} />
  if (item.kind === 'tool') return <V4ToolReceipt receipt={item.receipt} statusLabel={labels.toolStatus[item.receipt.status]} undoLabel={labels.task.undo} />
  if (item.kind === 'task') return <V4TaskCard task={item.task} labels={labels.task} />
  return <V4ErrorBar reason={item.reason} action={item.action} />
}

export function AgentPanelV4Panel({
  flow,
  slot,
  queue,
  context,
  composer,
  width = 390,
  height = 620,
  darkMode = false,
}: AgentPanelV4PanelProps): JSX.Element {
  const { t } = useTranslation()
  const labels = useV4Labels()
  return (
    <section
      className="flex flex-col overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper"
      style={{ width, height }}
      data-v4-panel="true"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-nomi-line-soft px-3 text-body-sm font-semibold">
        <span
          className="grid size-[18px] shrink-0 place-items-center rounded-nomi-sm bg-nomi-ink text-micro not-italic text-nomi-paper"
          aria-hidden="true"
        >
          {t('agentPanelV4.logo')}
        </span>
        {t('agentPanelV4.brand')}
        <V4ContextRing usage={context} labels={labels.context} />
        <span className="flex-1" />
        <span className="flex shrink-0 gap-2 text-nomi-ink-40">
          <button type="button" aria-label={t('agentPanelV4.history')}>
            <IconHistory size={15} />
          </button>
          <button type="button" aria-label={t('agentPanelV4.collapsePanel')}>
            <IconLayoutSidebarRightCollapse size={15} />
          </button>
        </span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 py-2.5">
        {flow.map((item, index) => (
          <V4FlowRow key={`${item.kind}-${index}`} item={item} darkMode={darkMode} panelHeight={height} />
        ))}
      </div>
      {slot ? (
        <div className="shrink-0 px-2.5 pb-2">
          <V4Intervention data={slot} labels={labels.intervention} />
        </div>
      ) : null}
      {queue?.length ? (
        <div className="shrink-0 px-2.5 pb-2">
          <V4Queue rows={queue} labels={labels.queue} />
        </div>
      ) : null}
      <div className={cn('shrink-0 px-2.5 pb-2.5', !slot && !queue?.length && 'pt-2')}>
        <AgentPanelV4Composer
          panelHeight={height}
          mode={composer?.mode ?? 'idle'}
          permission={composer?.permission ?? DEFAULT_PERMISSION_TIER}
          chips={composer?.chips}
          initialText={composer?.text ?? ''}
          skillSelected={composer?.skillSelected}
          focused={composer?.focused}
        />
      </div>
    </section>
  )
}
