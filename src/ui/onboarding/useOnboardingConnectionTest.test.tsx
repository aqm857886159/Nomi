import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReactTestRenderer } from '../../workbench/ai/v4/testReactRenderer'
import { useOnboardingConnectionTest } from './useOnboardingConnectionTest'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

type HookParams = Parameters<typeof useOnboardingConnectionTest>[0]
type HookResult = ReturnType<typeof useOnboardingConnectionTest>

const seen = vi.hoisted(() => ({
  testConnection: vi.fn(),
}))

let current: HookResult | null = null

function HookHarness(props: HookParams): null {
  current = useOnboardingConnectionTest(props)
  return null
}

function mount(vendorKey?: string) {
  const renderer = createReactTestRenderer()
  const bridge = {
    onboarding: { testConnection: seen.testConnection },
  } as HookParams['bridge']
  renderer.render(
    <HookHarness
      bridge={bridge}
      baseUrl="http://127.0.0.1:4010/v1"
      apiKey="fixture-key"
      {...(vendorKey ? { vendorKey } : {})}
      models={[]}
      providerKind="openai-compatible"
      kindForced={false}
      noApiKey={false}
      proxyUrl=""
      buildHeadersObject={() => ({})}
      onDetectedKind={() => undefined}
      onProtocolFallback={() => undefined}
    />,
  )
  return renderer
}

describe('useOnboardingConnectionTest vendor identity forwarding', () => {
  beforeEach(() => {
    current = null
    seen.testConnection.mockReset().mockResolvedValue({ ok: true, reachabilityOnly: true })
  })

  afterEach(() => {
    current = null
  })

  it('forwards an existing vendorKey to the desktop testConnection bridge', async () => {
    const renderer = mount('custom-relay')
    await current!.handleTestConnection()
    expect(seen.testConnection).toHaveBeenCalledWith(expect.objectContaining({ vendorKey: 'custom-relay' }))
    renderer.close()
  })

  it('omits vendorKey when the hook caller has no saved vendor identity', async () => {
    const renderer = mount()
    await current!.handleTestConnection()
    const payload = seen.testConnection.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('vendorKey')
    renderer.close()
  })
})
