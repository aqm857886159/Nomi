// 设计实验室 · Agent 面板 v4 · **整块面板**的板（Flow 创作 / 生成 / 预览 + Rendering + Dark + Collapsed）
//
// 只有这几张板在定稿里真的画了一整块面板，所以只有这几个状态渲整块。
// Main / Feasible / Sources / Process 四张板是**说明板**（文字卡、可行性表、来源对照表、时刻表），
// 没有可对账的界面件——它们的界面内容已经拆进 Vocabulary / Composer 两组的单件状态里，
// 不为它们再造一个「整块面板」状态充数。
import React from 'react'
import { IconBrowser, IconSettings } from '../../../../vendor/tablerIcons'
import { AgentPanelV4Panel } from '../../../../workbench/ai/v4/AgentPanelV4Panel'
import { AgentPanelV4Composer } from '../../../../workbench/ai/v4/AgentPanelV4Composer'
import { V4Intervention } from '../../../../workbench/ai/v4/AgentPanelV4Cards'
import { AgentTopbarChip } from '../../../../ui/app-shell/AgentTopbarChip'
import { agentTopbarChipBadge } from '../../../../ui/app-shell/agentTopbarChipBadge'
import { TooltipProvider } from '../../../../design'
import { dockStatusLabel } from '../../../../workbench/ai/v4/agentPanelV4DockStatus'
import { useV4Labels } from '../../../../workbench/ai/v4/agentPanelV4Labels'
import { useV4Fixtures } from '../agentPanelV4LabKit'
import type { LabState } from '../../labScreen'

function FlowCreation(): JSX.Element {
  const fx = useV4Fixtures()
  return (
    <AgentPanelV4Panel
      flow={fx.flows.creation}
      slot={fx.slots.plan}
      context={{ ...fx.context, used: 36000 }}
      composer={{ skillSelected: true }}
      height={860}
    />
  )
}

function FlowGeneration(): JSX.Element {
  const fx = useV4Fixtures()
  return (
    <AgentPanelV4Panel
      flow={fx.flows.generation}
      slot={fx.slots.spendOneClip}
      context={{ ...fx.context, used: 68000 }}
      composer={{ mode: 'running' }}
      height={860}
    />
  )
}

function FlowPreview(): JSX.Element {
  const fx = useV4Fixtures()
  return (
    <AgentPanelV4Panel
      flow={fx.flows.preview}
      slot={fx.slots.threeEdits}
      context={{ ...fx.context, used: 82000 }}
      height={860}
    />
  )
}

function RenderingPanel(): JSX.Element {
  const fx = useV4Fixtures()
  return <AgentPanelV4Panel flow={fx.flows.rendering} context={{ ...fx.context, used: 44000 }} height={640} />
}

function DarkPanel(): JSX.Element {
  const fx = useV4Fixtures()
  return (
    <AgentPanelV4Panel
      flow={fx.flows.dark}
      slot={fx.slots.reversible}
      context={{ ...fx.context, used: 82000 }}
      height={800}
      darkMode
    />
  )
}

/**
 * 收起整场景（定稿 Collapsed 板 + 09-01 定稿 §11.2 收起态）。
 *
 * 两件事同屏才说得清收起是什么：**顶栏**那一格冒出角标（面板去哪儿了），
 * **画面下沿**留着同一个 composer 和介入槽（对话并没有被中断）。中间那一大片是还给内容的屏幕。
 *
 * 角标挂 `needs-confirm` 且数字 = 1：下沿正浮着一条介入槽等人点，顶栏那格报的必须是同一条。
 * 两处对不上，收起态就是在撒谎。
 */
function CollapsedScene(): JSX.Element {
  const fx = useV4Fixtures()
  const labels = useV4Labels()
  const tooltip = `${labels.dock.open} · ${dockStatusLabel('needs-confirm', 1, labels.dock)}`
  return (
    <TooltipProvider delayDuration={250} disableHoverableContent>
      <div className="flex flex-col bg-nomi-ink-05" style={{ width: 620, height: 360 }}>
        {/* 顶栏右簇的那一段：浏览器 │ 角标 │ 设置。落点就是这一格，四个面都一样。 */}
        <div className="flex shrink-0 items-center justify-end gap-2.5 border-b border-nomi-line-soft bg-nomi-paper px-2.5 py-1.5">
          <span className="grid size-[30px] place-items-center rounded-[var(--nomi-radius-sm)] text-[var(--nomi-ink-80)]" aria-hidden="true">
            <IconBrowser size={15} stroke={1.8} />
          </span>
          <span className="h-[18px] w-px bg-workbench-border" aria-hidden="true" />
          <AgentTopbarChip
            reason="resident-collapsed"
            label="Nomi"
            tooltip={tooltip}
            status="needs-confirm"
            badge={agentTopbarChipBadge(1, 1)}
            onOpen={() => undefined}
          />
          <span className="h-[18px] w-px bg-workbench-border" aria-hidden="true" />
          <span className="grid size-[30px] place-items-center rounded-[var(--nomi-radius-sm)] text-[var(--nomi-ink-80)]" aria-hidden="true">
            <IconSettings size={15} stroke={1.8} />
          </span>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-end gap-2 p-3">
          <V4Intervention data={fx.slots.reversible} labels={labels.intervention} />
          <AgentPanelV4Composer
            panelHeight={360}
            dock
            mode="idle"
            permission="step"
            value={fx.t('agentPanelV4.fixtureUserTrim')}
          />
        </div>
      </div>
    </TooltipProvider>
  )
}

export const V4_FLOW_STATES: readonly LabState[] = [
  {
    id: 'v4-flow-creation',
    name: 'FlowCreation · 读文稿 → 载技能 → 起草分镜 → 计划槽',
    source: '2026-09-06-agent-panel-v4.md · FlowCreation 板',
    coverage: 'component-only',
    span: 2,
    render: () => <FlowCreation />,
  },
  {
    id: 'v4-flow-generation',
    name: 'FlowGeneration · 四张参考图任务卡 + 付费槽',
    source: '2026-09-06-agent-panel-v4.md · FlowGeneration 板',
    coverage: 'component-only',
    span: 2,
    render: () => <FlowGeneration />,
  },
  {
    id: 'v4-flow-preview',
    name: 'FlowPreview · 修剪 + 前移 + 三处改动计划',
    source: '2026-09-06-agent-panel-v4.md · FlowPreview 板',
    coverage: 'component-only',
    span: 2,
    render: () => <FlowPreview />,
  },
  {
    id: 'v4-rendering',
    name: 'Rendering · 助手文本的 12 种 Markdown 格式',
    source: '2026-09-06-agent-panel-v4.md · Rendering 板',
    coverage: 'component-only',
    span: 2,
    render: () => <RenderingPanel />,
  },
  {
    id: 'v4-collapsed',
    name: 'Collapsed · 结果全屏（顶栏角标 + 下沿 composer / 介入槽）',
    source: '2026-09-06-agent-panel-v4.md · Collapsed 板 + 2026-09-01 §11.2 收起态',
    coverage: 'component-only',
    span: 2,
    render: () => <CollapsedScene />,
  },
  {
    id: 'v4-dark',
    name: 'Dark · 同一块面板，token 翻转',
    source: '2026-09-06-agent-panel-v4.md · Dark 板',
    coverage: 'component-only',
    span: 2,
    scheme: 'dark',
    render: () => <DarkPanel />,
  },
]
