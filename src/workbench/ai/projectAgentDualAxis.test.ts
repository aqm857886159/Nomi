import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_PROJECT_AGENT_APPROVAL_POLICY,
  DEFAULT_PROJECT_AGENT_WORK_MODE,
  projectAgentApprovalPolicyOf,
  projectAgentWorkModeOf,
} from '../../../electron/shared/projectAgentContracts'
import type { ProjectAgentHostState } from '../../../electron/shared/projectAgentContracts'
import { createInitialProjectAgentState } from '../../../electron/projectAgentHost/projectAgentState'

const deps = vi.hoisted(() => ({
  command: vi.fn(),
  state: null as null | { subscriptionId: string; subscriptionEpoch: number; snapshot: ProjectAgentHostState },
  applySnapshot: vi.fn(),
}))

vi.mock('./projectAgentClient', () => ({
  projectAgentClient: { command: deps.command },
}))
vi.mock('./projectAgentProjectionStore', () => ({
  projectAgentProjectionStore: {
    getState: () => deps.state,
    applySnapshot: deps.applySnapshot,
  },
}))

import { enqueueProjectAgentTurn } from './projectAgentTurnCommands'

const binding = {
  projectId: 'dual-axis-project',
  immutableProjectUuid: '11111111-1111-4111-8111-111111111111',
  projectGeneration: 1,
} as const

beforeEach(() => {
  deps.command.mockReset()
  deps.applySnapshot.mockReset()
  const snapshot = createInitialProjectAgentState(binding)
  deps.state = { subscriptionId: 'subscription-a', subscriptionEpoch: 1, snapshot }
  deps.command.mockImplementation(async (command: { type: string }) => ({
    state: { ...snapshot, hostRevision: snapshot.hostRevision + 1 },
    patch: null,
    replayed: false,
    command,
  }))
})

describe('Project Agent dual-axis policy contract', () => {
  it('defaults legacy records to the Agent work mode and step/confirm approval without coupling the axes', () => {
    expect(projectAgentWorkModeOf(undefined)).toBe(DEFAULT_PROJECT_AGENT_WORK_MODE)
    expect(projectAgentApprovalPolicyOf(undefined)).toEqual(DEFAULT_PROJECT_AGENT_APPROVAL_POLICY)
  })

  it('freezes work mode and explicit approval/spend policy independently on turn and queue', async () => {
    const approvalPolicy = { mode: 'project' as const, spend: 'within-budget' as const }
    await enqueueProjectAgentTurn({
      request: {
        prompt: 'make a draft',
        capability: 'creation-editor',
        history: { kind: 'ephemeral' },
        projectId: binding.projectId,
      },
      displayPrompt: 'make a draft',
      workMode: 'editSelection',
      approvalPolicy,
      target: { kind: 'document', documentId: 'document-1', anchor: { kind: 'whole-document' } },
      originSurface: { surfaceId: 'creation', kind: 'document' },
    })

    const command = deps.command.mock.calls[0][0]
    expect(command.payload.turn.workMode).toBe('editSelection')
    expect(command.payload.queueItem.workMode).toBe('editSelection')
    expect(command.payload.turn.approvalPolicy).toEqual(approvalPolicy)
    expect(command.payload.queueItem.approvalPolicy).toEqual(approvalPolicy)
    expect(command.payload.request.workMode).toBe('editSelection')
  })

  it('keeps the IPC request projection from carrying approval authority or drifting work mode', async () => {
    await enqueueProjectAgentTurn({
      request: {
        prompt: 'safe draft',
        capability: 'creation-editor',
        history: { kind: 'ephemeral' },
        projectId: binding.projectId,
        workMode: 'legacy-auto',
        approvalPolicy: { mode: 'project', spend: 'within-budget' },
      } as never,
      displayPrompt: 'safe draft',
      target: { kind: 'document', documentId: 'document-2', anchor: { kind: 'whole-document' } },
      originSurface: { surfaceId: 'creation', kind: 'document' },
    })

    const command = deps.command.mock.calls[0][0]
    expect(command.payload.turn.workMode).toBe(DEFAULT_PROJECT_AGENT_WORK_MODE)
    expect(command.payload.request.workMode).toBe(DEFAULT_PROJECT_AGENT_WORK_MODE)
    expect(command.payload.request.approvalPolicy).toBeUndefined()
  })
})
