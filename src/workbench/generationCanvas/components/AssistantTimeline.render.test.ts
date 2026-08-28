import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { WorkbenchAiMessage } from '../../ai/workbenchAiTypes'
import type { ReconcileDeviation } from '../agent/reconcile'
import type { CommittedProposalRecord } from '../agent/proposalUndo'
import AssistantTimeline, { type AssistantTimelineProps } from './AssistantTimeline'

vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}))

const noop = vi.fn()
const message: WorkbenchAiMessage = {
  id: 'assistant-a',
  turnId: 'turn-a',
  role: 'assistant',
  content: 'Before tool. After tool.',
  status: 'streaming',
}

function baseProps(): AssistantTimelineProps {
  return {
    messages: [message],
    staleBoundaryId: null,
    onSuggestion: noop,
    pendingToolCalls: [],
    approveCalls: noop,
    rejectPending: noop,
    committedProposal: null,
    deviationReport: null,
    deviationAnchor: null,
    onDeviationUndo: noop,
    onDeviationDismiss: noop,
    onDeviationAiFix: noop,
    onContentDismiss: noop,
    threadBottomRef: { current: null },
  }
}

function renderTimeline(overrides: Partial<AssistantTimelineProps>): string {
  return renderToStaticMarkup(React.createElement(AssistantTimeline, { ...baseProps(), ...overrides }))
}

function expectBetween(html: string, before: string, cardMarker: string, after: string): void {
  const beforeIndex = html.indexOf(before)
  const cardIndex = html.indexOf(cardMarker)
  const afterIndex = html.indexOf(after)
  expect(beforeIndex).toBeGreaterThan(-1)
  expect(cardIndex).toBeGreaterThan(beforeIndex)
  expect(afterIndex).toBeGreaterThan(cardIndex)
}

describe('AssistantTimeline rendered chronology', () => {
  it('renders non-empty streaming text before and after a pending card instead of loading placeholders', () => {
    const html = renderTimeline({
      pendingToolCalls: [{
        toolCallId: 'tool-a',
        toolName: 'set_node_prompt',
        args: { nodeId: 'node-a', prompt: 'updated' },
        anchorMessageId: 'assistant-a',
        anchorTextOffset: 'Before tool.'.length,
      }],
    })

    expectBetween(html, 'Before tool.', 'data-tool-call-id="tool-a"', 'After tool.')
    expect(html).not.toContain('generationCommon.assistant.processingShort')
  })

  it('keeps the committed undo-visible card at the approval text offset', () => {
    const committed = {
      proposalId: 'proposal-a',
      summary: 'updated node',
      stepLabels: ['updated node'],
      compensation: [],
      watchNodes: [],
      reconciliationOk: true,
      anchorMessageId: 'assistant-a',
      anchorTextOffset: 'Before tool.'.length,
    } satisfies CommittedProposalRecord & { anchorTextOffset: number }

    const html = renderTimeline({ messages: [{ ...message, status: 'done' }], committedProposal: committed })
    expectBetween(html, 'Before tool.', 'data-committed-proposal-card="proposal-a"', 'After tool.')
    expect(html).toContain('data-proposal-undo-all="true"')
  })

  it('keeps the deviation card at the same approval text offset', () => {
    const deviation: ReconcileDeviation = {
      where: 'node-a',
      field: '提示词',
      expected: 'updated',
      actual: 'old',
    }
    const html = renderTimeline({
      messages: [{ ...message, status: 'done' }],
      deviationReport: [deviation],
      deviationAnchor: {
        anchorMessageId: 'assistant-a',
        anchorTextOffset: 'Before tool.'.length,
      },
    })

    expectBetween(html, 'Before tool.', 'data-reconcile-deviation-card="true"', 'After tool.')
    expect(html).toContain('data-reconcile-undo-all="true"')
  })
})
