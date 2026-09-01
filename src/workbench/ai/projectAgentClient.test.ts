import { describe, expect, it, vi } from 'vitest'

import type { ProjectAgentBridge } from '../../desktop/bridge'
import { createInitialProjectAgentState } from '../../../electron/projectAgentHost/projectAgentState'
import { createProjectAgentClient } from './projectAgentClient'

const binding = {
  projectId: 'client-project',
  immutableProjectUuid: '11111111-1111-4111-8111-111111111111',
  projectGeneration: 1,
} as const
const proposal = {
  proposalId: 'proposal-a',
  summary: 'created node',
  stepLabels: ['created node'],
  compensation: [{ kind: 'delete-nodes' as const, nodeIds: ['node-a'] }],
  watchNodes: [],
  reconciliationOk: true,
  anchorMessageId: 'assistant-a',
  anchorTextOffset: 12,
}

describe('ProjectAgent client receipt transport', () => {
  it('forwards only the subscription and CAS mutation through read/write/transition/clear', async () => {
    const receipt = {
      binding,
      revision: 2,
      lifecycle: 'committed' as const,
      proposalId: proposal.proposalId,
      operationId: 'commit-proposal-a',
      proposal,
    }
    const write = {
      expectedRevision: 1,
      proposalId: proposal.proposalId,
      operationId: 'commit-proposal-a',
      lifecycle: 'committed' as const,
      proposal,
    }
    const transition = {
      expectedRevision: 2,
      proposalId: proposal.proposalId,
      operationId: 'undo-proposal-a',
      lifecycle: 'undoing' as const,
    }
    const clear = {
      expectedRevision: 4,
      proposalId: proposal.proposalId,
      operationId: 'clear-proposal-a',
    }
    const bridge = {
      open: vi.fn(async () => ({ ok: true, value: {
        subscriptionId: 'subscription-a',
        snapshot: createInitialProjectAgentState(binding),
        proposalReceipt: receipt,
      } })),
      readProposalReceipt: vi.fn(async () => ({ ok: true, value: receipt })),
      writeProposalReceipt: vi.fn(async () => ({ ok: true, value: receipt })),
      transitionProposalReceipt: vi.fn(async () => ({ ok: true, value: { ...receipt, revision: 3, lifecycle: 'undoing' } })),
      clearProposalReceipt: vi.fn(async () => ({ ok: true, value: { cleared: true, receipt: { ...receipt, revision: 5, lifecycle: 'undone' } } })),
    } as unknown as ProjectAgentBridge
    const client = createProjectAgentClient(() => bridge)

    await expect(client.open(binding)).resolves.toMatchObject({ proposalReceipt: receipt })
    await expect(client.readProposalReceipt('subscription-a')).resolves.toEqual(receipt)
    await expect(client.writeProposalReceipt('subscription-a', write)).resolves.toEqual(receipt)
    await expect(client.transitionProposalReceipt('subscription-a', transition)).resolves.toMatchObject({ revision: 3, lifecycle: 'undoing' })
    await expect(client.clearProposalReceipt('subscription-a', clear)).resolves.toMatchObject({ cleared: true, receipt: { revision: 5 } })
    expect(bridge.writeProposalReceipt).toHaveBeenCalledWith('subscription-a', write)
  })

  it('surfaces a durable write failure instead of manufacturing success', async () => {
    const bridge = {
      writeProposalReceipt: vi.fn(async () => ({
        ok: false,
        error: { code: 'project_agent_unavailable' },
      })),
    } as unknown as ProjectAgentBridge
    const client = createProjectAgentClient(() => bridge)
    const write = {
      expectedRevision: 1,
      proposalId: proposal.proposalId,
      operationId: 'commit-proposal-a',
      lifecycle: 'committed' as const,
      proposal,
    }

    await expect(client.writeProposalReceipt('subscription-a', write)).rejects.toEqual(
      expect.objectContaining({ code: 'project_agent_unavailable' }),
    )
  })
})
