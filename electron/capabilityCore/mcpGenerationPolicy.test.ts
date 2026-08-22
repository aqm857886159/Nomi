import { describe, expect, it } from 'vitest'

describe('MCP generation policy', () => {
  it('defaults off, blocks new semantics, and leaves the legacy route outside the flag', async () => {
    const module = await import('./mcpGenerationPolicy').catch(() => null)
    expect(module).not.toBeNull()
    if (!module) return

    const policy = module.createMcpGenerationPolicy({
      env: {},
      checkpoints: { p0Passed: false, p2Passed: false, p3Passed: false },
    })

    expect(policy.snapshot()).toMatchObject({
      flagEnabled: false,
      phase: 'schema_only',
      effectiveScope: ['context', 'read', 'events'],
    })
    expect(policy.decide('create')).toMatchObject({
      kind: 'blocked',
      code: 'feature_disabled',
    })
    expect(policy.classifyRoute('nomi_generate')).toEqual({ kind: 'legacy', route: 'nomi_generate' })
  })

  it('keeps write-like calls phase-gated until P0 and P2 evidence passes', async () => {
    const { createMcpGenerationPolicy } = await import('./mcpGenerationPolicy')
    const policy = createMcpGenerationPolicy({
      env: { NOMI_MCP_GENERATION_SINGLE_SHOT_V1: '1' },
      checkpoints: { p0Passed: false, p2Passed: false, p3Passed: false },
      nextAction: 'nomi://p0',
    })

    expect(policy.snapshot()).toMatchObject({ phase: 'schema_only', flagEnabled: true })
    expect(policy.decide('context')).toMatchObject({ kind: 'allowed', phase: 'schema_only' })
    expect(policy.decide('create')).toMatchObject({
      kind: 'blocked',
      code: 'phase_not_ready',
      nextAction: 'nomi://p0',
    })
    expect(policy.decide('gate_request')).toMatchObject({ kind: 'blocked', code: 'phase_not_ready' })
  })

  it('opens only the zero-credit E0 scope after P0 and P2, never the paid scope', async () => {
    const { createMcpGenerationPolicy } = await import('./mcpGenerationPolicy')
    const policy = createMcpGenerationPolicy({
      env: { NOMI_MCP_GENERATION_SINGLE_SHOT_V1: 'true' },
      checkpoints: { p0Passed: true, p2Passed: true, p3Passed: false },
    })

    expect(policy.snapshot()).toMatchObject({
      phase: 'e0_zero_credit',
      effectiveScope: ['context', 'create', 'plan', 'preview', 'read', 'events'],
    })
    expect(policy.decide('plan')).toMatchObject({ kind: 'allowed', phase: 'e0_zero_credit' })
    expect(policy.decide('start')).toMatchObject({ kind: 'blocked', code: 'not_ready' })
    expect(policy.decide('gate_decide')).toMatchObject({ kind: 'blocked', code: 'not_ready' })
  })

  it('opens the paid E1 scope only after the P3 checkpoint', async () => {
    const { createMcpGenerationPolicy } = await import('./mcpGenerationPolicy')
    const policy = createMcpGenerationPolicy({
      env: { NOMI_MCP_GENERATION_SINGLE_SHOT_V1: 'on' },
      checkpoints: { p0Passed: true, p2Passed: true, p3Passed: true },
    })

    expect(policy.snapshot().phase).toBe('e1_paid')
    expect(policy.decide('gate_request')).toMatchObject({ kind: 'allowed', phase: 'e1_paid' })
    expect(policy.decide('start')).toMatchObject({ kind: 'allowed', phase: 'e1_paid' })
    expect(policy.decide('reconcile')).toMatchObject({ kind: 'allowed', phase: 'e1_paid' })
  })

  it('captures the environment once per immutable policy snapshot', async () => {
    const { createMcpGenerationPolicy, MCP_GENERATION_SINGLE_SHOT_FLAG } = await import('./mcpGenerationPolicy')
    const env: Record<string, string> = { [MCP_GENERATION_SINGLE_SHOT_FLAG]: '1' }
    const policy = createMcpGenerationPolicy({
      env,
      checkpoints: { p0Passed: true, p2Passed: true, p3Passed: false },
    })

    env[MCP_GENERATION_SINGLE_SHOT_FLAG] = '0'
    expect(policy.isSingleShotEnabled()).toBe(true)
    expect(policy.snapshot().phase).toBe('e0_zero_credit')
  })

  it('returns a fully frozen snapshot so rollout state cannot be mutated by a caller', async () => {
    const { createMcpGenerationPolicy } = await import('./mcpGenerationPolicy')
    const snapshot = createMcpGenerationPolicy({
      env: { NOMI_MCP_GENERATION_SINGLE_SHOT_V1: '1' },
      checkpoints: { p0Passed: true, p2Passed: true, p3Passed: false },
    }).snapshot()

    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.checkpoints)).toBe(true)
    expect(Object.isFrozen(snapshot.effectiveScope)).toBe(true)
  })

  it('classifies all known legacy generation routes without routing them through the flag', async () => {
    const { createMcpGenerationPolicy } = await import('./mcpGenerationPolicy')
    const policy = createMcpGenerationPolicy({ env: {} })

    for (const route of ['nomi_generate', 'production.start', 'production.control', 'production.decide-gate', 'nomi_start_playbook']) {
      expect(policy.classifyRoute(route)).toMatchObject({ kind: 'legacy', route })
    }
    expect(policy.classifyRoute('nomi_operation_create')).toEqual({ kind: 'semantic' })
  })
})
