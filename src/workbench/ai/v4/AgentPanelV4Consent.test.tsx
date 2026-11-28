import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReactTestRenderer, type TestHostNode } from './testReactRenderer'
import { V4ConsentCard } from './AgentPanelV4Consent'
import { hasSettledAgentConversation } from '../../onboarding/onboardingProgress'
import {
  canAskFirstAgentConsent,
  hasAskedAgentConsent,
  markAgentConsentAsked,
  markChecklistStep,
  markFirstAgentTurnCompleted,
} from '../../onboarding/onboardingState'
import type { LaneWorkspaceProjection } from '../../../../electron/shared/agentLane/laneContracts'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  }
})

type RenderedNode = TestHostNode & {
  type: string
  props: Record<string, unknown>
}

function createWindowStub() {
  const store = new Map<string, string>()
  const listeners = new Map<string, Set<EventListener>>()
  const telemetryGet = vi.fn(async () => ({
    schemaVersion: 1,
    enabled: false,
    endpointMode: 'aptabase',
    scopeVersion: 2,
    status: 'disabled',
  }))
  const telemetrySet = vi.fn(async (payload: { enabled: boolean }) => ({
    schemaVersion: 1,
    enabled: payload.enabled,
    endpointMode: 'aptabase',
    scopeVersion: 2,
    status: payload.enabled ? 'configured' : 'disabled',
  }))

  const stubWindow = {
    localStorage: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => void store.clear(),
    },
    addEventListener: (type: string, listener: EventListener) => {
      const set = listeners.get(type) ?? new Set<EventListener>()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener: (type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener)
    },
    dispatchEvent: (event: Event) => {
      for (const listener of [...(listeners.get(event.type) ?? [])]) listener(event)
      return true
    },
    nomiDesktop: {
      settings: {
        telemetry: {
          get: telemetryGet,
          set: telemetrySet,
        },
      },
    },
  }

  return { store, stubWindow, telemetryGet, telemetrySet }
}

function mountConsentCard(props: { force?: 'first' | 'scope' } = {}) {
  const activeNodes = new Set<RenderedNode>()
  const renderer = createReactTestRenderer<RenderedNode>({
    createInstance: (type, nodeProps) => {
      const node: RenderedNode = { type, props: nodeProps }
      activeNodes.add(node)
      return node
    },
    commitUpdate: (node, nextProps) => {
      node.props = nextProps
    },
  })
  const render = (nextProps = props) => {
    activeNodes.clear()
    renderer.render(<V4ConsentCard {...nextProps} />)
    renderer.flushPassiveEffects()
  }
  const consentNode = () => [...activeNodes].find((node) => node.props['data-v4-block'] === 'consent')
  const acceptButton = () => [...activeNodes].find((node) => 'data-v4-consent-accept' in node.props)
  const declineButton = () => [...activeNodes].find((node) => 'data-v4-consent-decline' in node.props)
  render(props)
  return {
    renderer,
    render,
    consentNode,
    acceptButton,
    declineButton,
    close: () => renderer.close(),
  }
}

describe('V4ConsentCard deferred first-ask timing (UX-A4)', () => {
  let env: ReturnType<typeof createWindowStub>

  beforeEach(() => {
    env = createWindowStub()
    vi.stubGlobal('window', env.stubWindow)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stays hidden on fresh blank entry before first generation or first Agent turn', () => {
    const mounted = mountConsentCard()
    try {
      expect(canAskFirstAgentConsent()).toBe(false)
      expect(mounted.consentNode()).toBeUndefined()
    } finally {
      mounted.close()
    }
  })

  it('appears live when first generation succeeds while mounted, and asks only once', () => {
    const mounted = mountConsentCard()
    try {
      expect(mounted.consentNode()).toBeUndefined()

      markChecklistStep('generated')
      mounted.renderer.flushPassiveEffects()

      const card = mounted.consentNode()
      expect(card?.props['data-v4-consent-mode']).toBe('first')

      const accept = mounted.acceptButton()
      expect(typeof accept?.props.onClick).toBe('function')
      ;(accept?.props.onClick as () => void)()
      mounted.renderer.flushPassiveEffects()

      expect(hasAskedAgentConsent()).toBe(true)
      expect(env.telemetrySet).toHaveBeenCalledWith({ enabled: true })

      // Re-mount after answering: must never appear again even if another milestone fires.
      mounted.close()
      markFirstAgentTurnCompleted()
      const remounted = mountConsentCard()
      try {
        expect(remounted.consentNode()).toBeUndefined()
      } finally {
        remounted.close()
      }
    } finally {
      mounted.close()
    }
  })

  it('appears after first completed Agent turn and records asked on decline without enabling telemetry', () => {
    markFirstAgentTurnCompleted()
    const mounted = mountConsentCard()
    try {
      expect(mounted.consentNode()?.props['data-v4-consent-mode']).toBe('first')

      const decline = mounted.declineButton()
      expect(typeof decline?.props.onClick).toBe('function')
      ;(decline?.props.onClick as () => void)()
      mounted.renderer.flushPassiveEffects()

      expect(hasAskedAgentConsent()).toBe(true)
      expect(env.telemetrySet).not.toHaveBeenCalled()
    } finally {
      mounted.close()
    }
  })

  it('preserves force="first" and force="scope" for design lab regardless of milestone state', () => {
    const firstForced = mountConsentCard({ force: 'first' })
    try {
      expect(firstForced.consentNode()?.props['data-v4-consent-mode']).toBe('first')
    } finally {
      firstForced.close()
    }

    const scopeForced = mountConsentCard({ force: 'scope' })
    try {
      expect(scopeForced.consentNode()?.props['data-v4-consent-mode']).toBe('scope')
    } finally {
      scopeForced.close()
    }
  })

  it('keeps legacy mode="scope" reconfirmation intact for already-asked opted-in users', async () => {
    markAgentConsentAsked()
    env.telemetryGet.mockResolvedValueOnce({
      schemaVersion: 1,
      enabled: true,
      endpointMode: 'aptabase',
      scopeVersion: 1,
      status: 'configured',
    })

    const mounted = mountConsentCard()
    try {
      await Promise.resolve()
      await Promise.resolve()
      mounted.renderer.flushPassiveEffects()
      expect(mounted.consentNode()?.props['data-v4-consent-mode']).toBe('scope')
    } finally {
      mounted.close()
    }
  })
})

describe('hasSettledAgentConversation', () => {
  const baseSnapshot = (overrides: Partial<LaneWorkspaceProjection> = {}): Pick<LaneWorkspaceProjection, 'lanes' | 'active'> => ({
    lanes: [{ laneName: 'main', sessionId: 's1', createdAt: 1, updatedAt: 1 }],
    active: {
      lane: 'main',
      parts: [],
      running: false,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        cost: { state: 'unknown', reason: 'no-settled-turn' },
        contextTokens: { state: 'unknown', reason: 'no-settled-turn' },
        reasoningTokens: { state: 'unknown', reason: 'no-settled-turn' },
      },
      thinking: { supportedLevels: ['off'], level: 'off', canTurnOff: true },
      queues: [],
    },
    ...overrides,
  })

  it('returns false for a blank single-lane project', () => {
    expect(hasSettledAgentConversation(baseSnapshot())).toBe(false)
  })

  it('returns false while an assistant turn is still running or streaming or interrupted', () => {
    const runningSnapshot = baseSnapshot()
    runningSnapshot.active = {
      ...runningSnapshot.active,
      running: true,
      parts: [{ kind: 'assistant-text', sequence: 1, text: 'hello', streaming: true }],
    }
    expect(hasSettledAgentConversation(runningSnapshot)).toBe(false)

    const interruptedSnapshot = baseSnapshot()
    interruptedSnapshot.active = {
      ...interruptedSnapshot.active,
      running: false,
      parts: [{ kind: 'assistant-text', sequence: 1, text: 'partial', streaming: false, interrupted: true }],
    }
    expect(hasSettledAgentConversation(interruptedSnapshot)).toBe(false)
  })

  it('returns true once an assistant turn finishes cleanly or multiple historical threads exist', () => {
    const completedSnapshot = baseSnapshot()
    completedSnapshot.active = {
      ...completedSnapshot.active,
      running: false,
      parts: [{ kind: 'assistant-text', sequence: 1, text: 'Done.', streaming: false }],
    }
    expect(hasSettledAgentConversation(completedSnapshot)).toBe(true)

    const multiThreadSnapshot = baseSnapshot({
      lanes: [
        { laneName: 'main', sessionId: 's1', createdAt: 1, updatedAt: 1 },
        { laneName: 'thread-2', sessionId: 's2', createdAt: 2, updatedAt: 2 },
      ],
    })
    expect(hasSettledAgentConversation(multiThreadSnapshot)).toBe(true)
  })
})
