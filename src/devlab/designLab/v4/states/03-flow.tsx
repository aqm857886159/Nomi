// 设计实验室 · Agent 面板 v4 · **整块面板**的板（Flow 创作 / 生成 / 预览 + Rendering + Dark + Collapsed）
//
// 只有这几张板在定稿里真的画了一整块面板，所以只有这几个状态渲整块。
// Main / Feasible / Sources / Process 四张板是**说明板**（文字卡、可行性表、来源对照表、时刻表），
// 没有可对账的界面件——它们的界面内容已经拆进 Vocabulary / Composer 两组的单件状态里，
// 不为它们再造一个「整块面板」状态充数。
import React from 'react'
import { AgentPanelV4Panel } from '../../../../workbench/ai/v4/AgentPanelV4Panel'
import { AgentPanelV4Composer } from '../../../../workbench/ai/v4/AgentPanelV4Composer'
import { V4Intervention } from '../../../../workbench/ai/v4/AgentPanelV4Cards'
import { V4CollapsedLogoDock } from '../../../../workbench/ai/v4/AgentPanelV4Dock'
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
 * 收起坞：右上角一枚 Nomi logo 钮 + 同一个 composer 和介入槽落到画面下沿（定稿 Collapsed 板，
 * 2026-09-06 用户改：右上角从两颗小 icon 换回 logo）。
 *
 * 这一格挂着 `needs-confirm`：介入槽正浮在下沿等人点，logo 上就该冒同一件事的角标——
 * 两处说的是同一条待决，对不上就是收起态在撒谎。
 */
function CollapsedScene(): JSX.Element {
  const fx = useV4Fixtures()
  const labels = useV4Labels()
  return (
    <div className="relative bg-nomi-ink-05" style={{ width: 620, height: 360 }}>
      <div className="flex h-full min-w-0 flex-col justify-end gap-2 p-3">
        <V4Intervention data={fx.slots.reversible} labels={labels.intervention} />
        <AgentPanelV4Composer
          panelHeight={360}
          dock
          mode="running"
          chips={[fx.chips.clip]}
          value={fx.t('agentPanelV4.fixtureUserTrim')}
        />
      </div>
      <div className="absolute right-2 top-2">
        <V4CollapsedLogoDock status="needs-confirm" pendingCount={1} labels={labels.dock} />
      </div>
    </div>
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
    name: 'Collapsed · 结果全屏（右上 logo 钮 + 下沿 composer / 介入槽）',
    source: '2026-09-06-agent-panel-v4.md · Collapsed 板',
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
