// The real shell subscribes to the same lane client as the desktop app.
import React from 'react'
import type { LanePart, LaneQueuedMessage, LaneWorkspaceProjection } from '../../../../electron/shared/agentLane/laneContracts'
import { capabilityAliasesFor } from '../../../../electron/shared/agentCapabilities/registry'
import { EMPTY_LANE_PROJECTION, laneClient } from '../../../workbench/ai/lane/laneClient'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import ProjectAgentResidentShell from '../../../workbench/ai/ProjectAgentResidentShell'
import type { ResidentSurface } from '../../../workbench/ai/resident/residentShellDisplay'
import { V4_PANEL_WIDTH } from './agentPanelV4LabKit'

const CLOCK = Date.parse('2026-09-06T09:00:00.000Z')
const identity = { sequence: 0, entrySeq: 0, contentIndex: 0 }

export function labUserItem(_id: string, text: string): readonly LanePart[] {
  return [{ ...identity, kind: 'user', text }]
}
export function labAssistantItem(_id: string, text: string): readonly LanePart[] {
  return [{ ...identity, kind: 'assistant-text', text, streaming: false }]
}
export function labToolItem(id: string, capabilityId: string, isError = false): readonly LanePart[] {
  const toolName = capabilityAliasesFor(capabilityId, 'pi')[0] ?? capabilityId
  const call: LanePart = { ...identity, kind: 'tool-call', toolCallId: id, toolName, args: {}, running: false }
  return [call, {
    ...identity, kind: 'tool-result', toolCallId: id, toolName, text: '', isError,
  }]
}
export function labFailureItem(_id: string, text: string, nextAction?: string): readonly LanePart[] {
  return [{ ...identity, kind: 'error', text: [text, nextAction].filter(Boolean).join('\n') }]
}
export function labQueueItem(entryId: string, text: string): LaneQueuedMessage {
  return { entryId, text, kind: 'follow-up' }
}
export function labHostState(input: {
  items: readonly (readonly LanePart[])[]
  queue?: readonly LaneQueuedMessage[]
  running?: LaneWorkspaceProjection['active']['running']
  usage?: { promptTokens: number; completionTokens: number; cachedPromptTokens: number; totalTokens: number; reasoningTokens: number; costUsd: number }
}): LaneWorkspaceProjection {
  const usage = input.usage
  return {
    lanes: [{ laneName: 'main', sessionId: 'lab-session', createdAt: CLOCK, updatedAt: CLOCK }],
    active: {
      ...EMPTY_LANE_PROJECTION,
      parts: input.items.flat().map((part, sequence) => ({ ...part, sequence, entrySeq: sequence + 1 })),
      running: input.running ?? false,
      queues: input.queue ?? [],
      ...(usage ? { usage: {
        inputTokens: usage.promptTokens, outputTokens: usage.completionTokens,
        cacheReadTokens: usage.cachedPromptTokens, cacheWriteTokens: 0, totalTokens: usage.totalTokens,
        cost: { state: 'known' as const, value: usage.costUsd },
        contextTokens: { state: 'known' as const, value: usage.promptTokens + usage.cachedPromptTokens },
        reasoningTokens: { state: 'known' as const, value: usage.reasoningTokens },
      } } : {}),
    },
  }
}

export function ShellStage({ snapshot, surface = 'generation', draft = '', width = V4_PANEL_WIDTH, height = 620 }: {
  snapshot: LaneWorkspaceProjection
  surface?: ResidentSurface
  draft?: string
  width?: number
  height?: number
}): JSX.Element {
  React.useMemo(() => {
    laneClient.connect({
      onProjection: (listener) => { listener(snapshot); return () => undefined },
      send: async () => ({ ok: false as const, code: 'agent_lane_bridge_absent' as const, diagnostic: 'design lab host is read-only' }),
    })
    useWorkbenchStore.setState({ editingPanelLayout: { ...useWorkbenchStore.getState().editingPanelLayout, assistantWidth: width }, projectAgentDockCollapsed: false,
      projectAgentDraft: draft, projectAgentAttachments: [], creationActiveSkill: null })
    return null
  }, [draft, snapshot, width])
  React.useEffect(() => () => laneClient.connect(undefined), [])
  return (
    <div className="overflow-hidden rounded-nomi border border-nomi-line bg-nomi-bg"
      style={{ width, height }} data-design-lab-stage="shell">
      <ProjectAgentResidentShell surface={surface} />
    </div>
  )
}
