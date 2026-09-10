// 设计实验室 · 设置「模型」页顶部那张「用 AI 帮我接入」卡。
//
// 取景整卡：这一格要看的是**一屏一个主动作**成不成立——分段控件、状态行、主按钮、
// 折叠证据行、末行出口挤在一张卡里，只截其中一段就把那个判断删掉了。
//
// 夹具喂的是**真实调用点的形状**（AiAssistedOnboardingSection 传下来的那三个 props），
// 不是编出来的：info 用 McpInfo 的真类型，progress 由现役投影函数 projectAssistedProgress
// 从真实 stage 算出来——「那一步该亮着还是灰着」不许由夹具作者拍脑袋决定。
import React from 'react'

import { AiAssistedOnboardingCard } from '../../../../ui/onboarding/AiAssistedOnboardingCard'
import { projectAssistedProgress } from '../../../../ui/onboarding/assistedProgressProjection'
import type { McpInfo } from '../../../../desktop/mcpBridgeTypes'
import { SETTINGS_CELL_WIDTH } from '../settingsLabKit'
import type { LabState } from '../../labScreen'

/** 一台真机上 readMcpInfo() 的形状；command/args 写成确定值，基线才不会跟着机器变。 */
function mcpInfo(connected: readonly string[]): McpInfo {
  const clients: McpInfo['clients'] = {}
  for (const key of ['claude', 'codex', 'cursor', 'pi', 'workbuddy']) {
    clients[key] = {
      installed: connected.includes(key),
      appInstalled: true,
      configPath: `/Users/me/.config/${key}/mcp.json`,
      snippet: '{}',
      configState: connected.includes(key) ? 'current' : 'absent',
      launcherKind: 'packaged',
      migration: 'none',
      backupPath: null,
    }
  }
  return {
    tokenReady: true,
    rpcRunning: true,
    server: {
      command: '/Applications/Nomi.app/Contents/Resources/node',
      args: ['/Applications/Nomi.app/Contents/Resources/app.asar/scripts/nomi-mcp.mjs'],
      env: { NOMI_MCP_STDIO: '1' },
    },
    trustedHosts: ['nomi'],
    clients,
  }
}

function Stage({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      className="overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper p-4"
      style={{ width: SETTINGS_CELL_WIDTH }}
      data-design-lab-stage="assisted-onboarding"
    >
      {children}
    </div>
  )
}

const noop = (): void => undefined

export const ASSISTED_ONBOARDING_STATES: readonly LabState[] = [
  {
    id: 'assisted-01-idle',
    name: '用 AI 帮我接入 · 默认（Claude Code 已连上）',
    source: '现役 AiAssistedOnboardingCard.tsx（docs/design/2026-09-11-ai-assisted-onboarding-entry.md §Main）',
    mirrors: 'src/ui/onboarding/AiAssistedOnboardingSection.tsx:160',
    coverage: 'shell',
    render: () => (
      <Stage>
        <AiAssistedOnboardingCard
          info={mcpInfo(['claude'])}
          progress={null}
          onOpenAssistantConnections={noop}
          onManualConnect={noop}
        />
      </Stage>
    ),
  },
  {
    id: 'assisted-02-not-connected',
    name: '还没连上这家 · 一行状态 + 去连接（卡上没有第二颗「一键接入」）',
    source: '现役 AiAssistedOnboardingCard.tsx（设计定稿 §Checkpoints 删除清单：一键接入只有一个家）',
    mirrors: 'src/ui/onboarding/AiAssistedOnboardingSection.tsx:160',
    coverage: 'shell',
    render: () => (
      <Stage>
        <AiAssistedOnboardingCard
          info={mcpInfo([])}
          progress={null}
          onOpenAssistantConnections={noop}
          onManualConnect={noop}
        />
      </Stage>
    ),
  },
  {
    id: 'assisted-03-progress',
    name: '外部 Agent 正在接 · 五步进度（stage=certifying）',
    source: '现役 AiAssistedOnboardingCard.tsx + AssistedIntegrationProgress.tsx（设计定稿 §Progress）',
    mirrors: 'src/ui/onboarding/AiAssistedOnboardingSection.tsx:160',
    coverage: 'shell',
    render: () => (
      <Stage>
        <AiAssistedOnboardingCard
          info={mcpInfo(['codex'])}
          progress={{
            view: projectAssistedProgress({ stage: 'certifying' }),
            name: 'Seedance 2.0',
            hostLabel: 'Codex',
            reasonCode: null,
          }}
          onOpenAssistantConnections={noop}
          onManualConnect={noop}
        />
      </Stage>
    ),
  },
  {
    id: 'assisted-04-failed',
    name: '没有接进来 · 原始错误码 + Key 不丢（不复用「进行中」的壳）',
    source: '现役 AssistedIntegrationProgress.tsx 的失败分支（设计定稿 §Progress 下半）',
    mirrors: 'src/ui/onboarding/AiAssistedOnboardingSection.tsx:160',
    coverage: 'shell',
    render: () => (
      <Stage>
        <AiAssistedOnboardingCard
          info={mcpInfo(['codex'])}
          progress={{
            view: projectAssistedProgress({ stage: 'failed', lastLiveStage: 'certifying' }),
            name: 'Seedance 2.0',
            hostLabel: 'Codex',
            reasonCode: '402 insufficient_balance',
          }}
          onOpenAssistantConnections={noop}
          onManualConnect={noop}
        />
      </Stage>
    ),
  },
  // 暗色只取两格：默认态（accent 主按钮 + success 勾）与失败态（danger 底 + 原始错误码）——
  // 这两格里所有需要在暗色下重新判一次的颜色决定都出现了；其余两格的配色是它们的子集。
  {
    id: 'assisted-05-idle-dark',
    name: '用 AI 帮我接入 · 默认 · 暗',
    source: '现役 AiAssistedOnboardingCard.tsx（docs/design/2026-09-11-ai-assisted-onboarding-entry.md §Main）',
    mirrors: 'src/ui/onboarding/AiAssistedOnboardingSection.tsx:160',
    coverage: 'shell',
    scheme: 'dark',
    render: () => (
      <Stage>
        <AiAssistedOnboardingCard
          info={mcpInfo(['claude'])}
          progress={null}
          onOpenAssistantConnections={noop}
          onManualConnect={noop}
        />
      </Stage>
    ),
  },
  {
    id: 'assisted-06-failed-dark',
    name: '没有接进来 · 暗',
    source: '现役 AssistedIntegrationProgress.tsx 的失败分支（设计定稿 §Progress 下半）',
    mirrors: 'src/ui/onboarding/AiAssistedOnboardingSection.tsx:160',
    coverage: 'shell',
    scheme: 'dark',
    render: () => (
      <Stage>
        <AiAssistedOnboardingCard
          info={mcpInfo(['codex'])}
          progress={{
            view: projectAssistedProgress({ stage: 'failed', lastLiveStage: 'certifying' }),
            name: 'Seedance 2.0',
            hostLabel: 'Codex',
            reasonCode: '402 insufficient_balance',
          }}
          onOpenAssistantConnections={noop}
          onManualConnect={noop}
        />
      </Stage>
    ),
  },
]
