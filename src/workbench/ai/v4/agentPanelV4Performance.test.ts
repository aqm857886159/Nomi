import React, { type JSX } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPanelV4Panel } from './AgentPanelV4Panel'
import { useV4Labels } from './agentPanelV4Labels'
import { collapseV4Flow } from './agentPanelV4Collapse'
import { laneViewModel, type LaneViewModelLabels } from '../lane/laneViewModel'
import { shareFlowItems } from './useAgentPanelV4Data'
import { createReactTestRenderer } from './testReactRenderer'
import type { LanePart, LaneProjection, LaneUsage } from '../../../../electron/shared/agentLane/laneContracts'

const runtime = vi.hoisted(() => {
  const i18n = { language: 'zh-CN', resolvedLanguage: 'zh-CN' }
  return {
    i18n,
    t: vi.fn((key: string) => key),
    rowLabelsCalls: 0,
  }
})

vi.mock('react-i18next', async () => ({
  ...(await vi.importActual<typeof import('react-i18next')>('react-i18next')),
  useTranslation: () => ({ t: runtime.t, i18n: runtime.i18n }),
}))

vi.mock('./agentPanelV4Labels', async () => {
  const actual = await vi.importActual<typeof import('./agentPanelV4Labels')>('./agentPanelV4Labels')
  return {
    ...actual,
    useV4Labels: () => {
      runtime.rowLabelsCalls += 1
      return actual.useV4Labels()
    },
  }
})

const t = (key: string, _options?: Record<string, unknown>) => key
const laneLabels: LaneViewModelLabels = {
  toolLabel: (name) => name,
  toolSummary: () => undefined,
  toolFailure: () => undefined,
  toolFailureDetail: (failure) => failure.code,
  assistantFailure: (text) => text,
  assistantRecovered: 'recovered',
  thinkingLabel: 'thinking',
  formatTokens: (value) => `${value}t`,
  formatCost: (value) => `$${value.toFixed(4)}`,
  retryLabel: (attempt, maxAttempts) => `${attempt}/${maxAttempts}`,
  unknown: '?',
  taskTitle: 'task',
  formatStages: (done, total) => `${done}/${total}`,
  formatMoney: (currency, amount) => `${currency}${amount}`,
  taskUnknown: 'task-unknown',
  attachmentUnavailable: 'attachment-unavailable',
  answered: 'answered',
  skillLabel: (key) => key,
}

const usage: LaneUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  cost: { state: 'unknown', reason: 'no-settled-turn' },
  contextTokens: { state: 'unknown', reason: 'no-settled-turn' },
  reasoningTokens: { state: 'unknown', reason: 'no-settled-turn' },
}

function projection(parts: LanePart[]): LaneProjection {
  return {
    lane: 'main',
    parts,
    running: false,
    usage,
    thinking: { supportedLevels: ['off'], level: 'off', canTurnOff: true },
    queues: [],
  }
}

function historyParts(count: number, finalText: string): LanePart[] {
  return Array.from({ length: count }, (_, index) => {
    const sequence = index * 2
    return [
      {
        sequence,
        entrySeq: sequence + 1,
        contentIndex: 0,
        entryId: `user-${index}`,
        kind: 'user' as const,
        text: `prompt-${index}`,
      },
      {
        sequence: sequence + 1,
        entrySeq: sequence + 2,
        contentIndex: 0,
        entryId: `assistant-${index}`,
        kind: 'assistant-text' as const,
        text: index === count - 1 ? finalText : `reply-${index}`,
        streaming: false,
      },
    ] as LanePart[]
  }).flat()
}

function derivedFlow(count: number, finalText: string) {
  const view = laneViewModel(projection(historyParts(count, finalText)), laneLabels)
  return collapseV4Flow(view.items, t)
}

function LabelsProbe({ language, observed }: { language: string; observed: unknown[] }): JSX.Element {
  runtime.i18n.language = language
  runtime.i18n.resolvedLanguage = language
  observed.push(useV4Labels())
  return React.createElement('span')
}

function panel(flow: readonly ReturnType<typeof derivedFlow>[number][]): React.ReactElement {
  return React.createElement(AgentPanelV4Panel, {
    flow,
    context: {},
    width: 390,
    height: 620,
    slotHandlers: { onPlanToggle: () => undefined, onCollapsePlan: () => undefined },
  })
}

type PanelHostNode = {
  props: unknown
  clientWidth: number
  offsetHeight: number
  style: Record<string, string>
  getBoundingClientRect: () => Record<string, number>
  focus: () => void
  contains: () => boolean
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  listeners: Set<(...args: unknown[]) => void>
  addEventListener: (_type: string, listener: (...args: unknown[]) => void) => void
  removeEventListener: (_type: string, listener: (...args: unknown[]) => void) => void
}

function panelRenderer() {
  return createReactTestRenderer<PanelHostNode>({
    createInstance: (_type, props) => {
      const listeners = new Set<(...args: unknown[]) => void>()
      return {
        props,
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 620,
        clientWidth: 390,
        offsetHeight: 40,
        style: {},
        listeners,
        addEventListener: (_eventType, listener) => { listeners.add(listener) },
        removeEventListener: (_eventType, listener) => { listeners.delete(listener) },
        getBoundingClientRect: () => ({ top: 0, left: 0, right: 390, bottom: 40, width: 390, height: 40, x: 0, y: 0 }),
        focus: () => undefined,
        contains: () => false,
      }
    },
    commitUpdate: (instance, props) => { instance.props = props },
  })
}

beforeEach(() => {
  // The composer measures itself; this host has no layout engine, so layout observers are inert.
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} })
  runtime.t.mockClear()
  runtime.rowLabelsCalls = 0
  runtime.i18n.language = 'zh-CN'
  runtime.i18n.resolvedLanguage = 'zh-CN'
})

describe('Agent panel V4 render budget', () => {
  it('returns one labels object per language and a new object after language changes', () => {
    const observed: unknown[] = []
    const renderer = createReactTestRenderer()
    try {
      renderer.render(React.createElement(LabelsProbe, { language: 'labels-zh', observed }))
      renderer.render(React.createElement(LabelsProbe, { language: 'labels-zh', observed }))
      expect(observed[1]).toBe(observed[0])
      renderer.render(React.createElement(LabelsProbe, { language: 'labels-en', observed }))
      expect(observed[2]).not.toBe(observed[1])
    } finally {
      renderer.close()
    }
  })

  it.each([50, 300])('shares every unchanged derived item (N=%i)', (count) => {
    const previous = derivedFlow(count, 'final')
    const next = derivedFlow(count, 'streamed-final')
    const shared = shareFlowItems(previous, next)
    expect(shared).toHaveLength(previous.length)
    previous.slice(0, -1).forEach((item, index) => expect(shared[index]).toBe(item))
    expect(shared.at(-1)).not.toBe(previous.at(-1))
  })

  it('keeps real panel row renders and translations independent of history length', () => {
    const measurements: Array<{ rows: number; translations: number }> = []
    for (const count of [50, 300]) {
      const renderer = panelRenderer()
      const initial = derivedFlow(count, 'final')
      const updated = derivedFlow(count, 'streamed-final')
      try {
        renderer.render(panel(initial))
        runtime.t.mockClear()
        runtime.rowLabelsCalls = 0
        renderer.render(panel(shareFlowItems(initial, updated)))
        // AgentPanelV4Panel itself calls useV4Labels once; the remainder are V4FlowRow renders.
        measurements.push({ rows: Math.max(0, runtime.rowLabelsCalls - 1), translations: runtime.t.mock.calls.length })
      } finally {
        renderer.close()
      }
    }
    expect(measurements[0]!.rows).toBeLessThanOrEqual(2)
    expect(measurements[1]!.rows).toBeLessThanOrEqual(2)
    expect(measurements[0]!.translations).toBe(measurements[1]!.translations)
  })
})
