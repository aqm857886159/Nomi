// 设计实验室 · Agent 面板 v4 · **接线证据**（宿主快照 → 真面板）。
//
// 与前三组的区别：这一组一个 prop 都不喂给积木。它把一份 `ProjectAgentHostState`
// install 进真的投影 store，然后渲真的 `ProjectAgentResidentShell`——中间的投影层、
// 回调面、容器全部真的跑一遍。所以这几张图证明的是「宿主真相长这样时，面板长这样」，
// 而不是「给它这些 props 时，它长这样」。
//
// 覆盖按**三面对话**开列（创作 / 生成 / 预览），外加两条只有接线之后才存在的态：
// 队列 + 运行中、以及失败留在原行。冷启动空面板搬去 `05-empty.tsx`——那一格补空态之后
// 按面各有一版起手，留在这里会和空态那三格完全重复（P1：不留并行版）。
// 介入槽与七态收据不在这里——它们要一个活的待决登记表，那是真机走查（loopback 零额度）
// 的活，截图证明不了「点下去发生了什么」。
import React from 'react'
import type { LabState } from '../../labScreen'
import {
  ShellStage,
  labAssistantItem,
  labFailureItem,
  labHostState,
  labQueueItem,
  labToolItem,
  labUserItem,
} from '../agentPanelV4LabHost'
import { useV4Fixtures } from '../agentPanelV4LabKit'

const USAGE = { promptTokens: 62_400, completionTokens: 9_800, cachedPromptTokens: 2_400, totalTokens: 74_600, reasoningTokens: 2_100, costUsd: 0.83 }

function CreationCell(): JSX.Element {
  const fx = useV4Fixtures()
  return (
    <ShellStage
      surface="creation"
      snapshot={labHostState({
        usage: USAGE,
        items: [
          labUserItem('u1', fx.t('agentPanelV4.fixtureUserRead')),
          labToolItem('t1', 'document.read'),
          labAssistantItem('a1', fx.t('agentPanelV4.fixtureAssistantLongest')),
          labUserItem('u2', fx.t('agentPanelV4.fixtureUserShots')),
          labToolItem('t2', 'skill.read'),
        ],
      })}
    />
  )
}

function GenerationCell(): JSX.Element {
  const fx = useV4Fixtures()
  return (
    <ShellStage
      surface="generation"
      draft={fx.t('agentPanelV4.fixtureUserToVideo')}
      snapshot={labHostState({
        usage: USAGE,
        items: [
          labUserItem('u1', fx.t('agentPanelV4.fixtureUserRefs')),
          labToolItem('t1', 'generation.plan'),
          labAssistantItem('a1', fx.t('agentPanelV4.fixtureAssistantPlan')),
        ],
      })}
    />
  )
}

function PreviewCell(): JSX.Element {
  const fx = useV4Fixtures()
  return (
    <ShellStage
      surface="preview"
      snapshot={labHostState({
        usage: USAGE,
        items: [
          labUserItem('u1', fx.t('agentPanelV4.fixtureUserTrim')),
          labToolItem('t1', 'timeline.read'),
          labAssistantItem('a1', fx.t('agentPanelV4.fixtureAssistantTrim')),
          labToolItem('t2', 'timeline.write'),
        ],
      })}
    />
  )
}

/** 运行中 + 队列：composer 变「停止」、占位文案改「将排队发送」、队列行浮在它上面。 */
function RunningCell(): JSX.Element {
  const fx = useV4Fixtures()
  return (
    <ShellStage
      surface="generation"
      draft={fx.t('agentPanelV4.queueTwo')}
      snapshot={labHostState({
        turnStatus: 'running',
        items: [labUserItem('u1', fx.t('agentPanelV4.queueOne'))],
        queue: [labQueueItem('q1', 'turn-lab', 'running')],
      })}
    />
  )
}

/** 失败：错误条留在它发生的那一行，不弹窗不 toast（定稿 Process 板时刻 5）。 */
function FailureCell(): JSX.Element {
  const fx = useV4Fixtures()
  return (
    <ShellStage
      surface="generation"
      snapshot={labHostState({
        turnStatus: 'failed',
        items: [
          labUserItem('u1', fx.t('agentPanelV4.fixtureUserToVideo')),
          labToolItem('t1', 'generation.control', 'failed'),
          labFailureItem('f1', fx.t('agentPanelV4.fixtureVendorFailure'), fx.t('agentPanelV4.fixtureRetryOtherModel')),
        ],
      })}
    />
  )
}

export const V4_WIRED_STATES: readonly LabState[] = [
  {
    id: 'v4-wired-creation',
    name: '接线 · 创作面（真 shell + 真投影）',
    source: '2026-09-06-agent-panel-v4-wiring.md · 接线证据（宿主快照 → 真面板）',
    coverage: 'shell',
    span: 2,
    render: () => <CreationCell />,
  },
  {
    id: 'v4-wired-generation',
    name: '接线 · 生成面（真 shell + 真投影）',
    source: '2026-09-06-agent-panel-v4-wiring.md · 接线证据（宿主快照 → 真面板）',
    coverage: 'shell',
    span: 2,
    render: () => <GenerationCell />,
  },
  {
    id: 'v4-wired-preview',
    name: '接线 · 预览面（真 shell + 真投影）',
    source: '2026-09-06-agent-panel-v4-wiring.md · 接线证据（宿主快照 → 真面板）',
    coverage: 'shell',
    span: 2,
    render: () => <PreviewCell />,
  },
  {
    id: 'v4-wired-running',
    name: '接线 · 运行中 + 队列（composer 变停止）',
    source: '2026-09-06-agent-panel-v4-wiring.md · 接线证据（宿主快照 → 真面板）',
    coverage: 'shell',
    span: 2,
    render: () => <RunningCell />,
  },
  {
    id: 'v4-wired-failure',
    name: '接线 · 失败留在原行（不弹窗）',
    source: '2026-09-06-agent-panel-v4-wiring.md · 接线证据（宿主快照 → 真面板）',
    coverage: 'shell',
    span: 2,
    render: () => <FailureCell />,
  },
]
