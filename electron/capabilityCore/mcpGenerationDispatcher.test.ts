import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { dispatch, RpcError } from './dispatcher'
import { createMcpGenerationPolicy } from './mcpGenerationPolicy'
import { createProjectLeaseAuthority } from './projectLease'
import { createProjectLeaseStore } from './projectLeaseStore'
import { createApprovalReceiptAuthority } from './approvalReceipt'

const tempDirs: string[] = []

function makeAuthority() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-dispatch-lease-'))
  tempDirs.push(dir)
  const authority = createProjectLeaseAuthority({
    macKey: 'dispatch-authority-key',
    keyId: 'dispatch-authority-v1',
    store: createProjectLeaseStore({
      filePath: path.join(dir, 'leases.json'),
      macKey: 'dispatch-store-key',
      keyId: 'dispatch-store-v1',
    }),
    now: () => '2026-08-23T00:00:00.000Z',
    randomId: (() => {
      let index = 0
      return () => `lease-id-${++index}`
    })(),
  })
  return authority
}

function makeLease(
  authority: ReturnType<typeof createProjectLeaseAuthority>,
  projectId = 'project-1',
  scopeSet = ['context:read'],
) {
  const handle = authority.issueSelectionHandle({
    immutableProjectUuid: 'immutable-project-uuid-1',
    projectGeneration: 1,
    canonicalRootDigest: 'root-digest-1',
    manifestDigest: 'manifest-digest-1',
    scopeSet,
  })
  return authority.issueLease(handle.token, {
    projectId,
    leasePrincipal: 'mcp:test',
    sessionId: 'session-1',
    connectionNonce: 'connection-1',
  }).token
}

function makeApprovalReceipt() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-dispatch-receipt-'))
  tempDirs.push(dir)
  const authority = createApprovalReceiptAuthority({
    filePath: path.join(dir, 'receipts.json'),
    macKey: 'dispatch-receipt-key',
    storeMacKey: 'dispatch-receipt-store-key',
    keyId: 'dispatch-receipt-v1',
    now: () => '2026-08-23T00:00:00.000Z',
    randomId: (() => {
      let index = 0
      return () => 'receipt-id-' + ++index
    })(),
  })
  const challenge = authority.requestChallenge({
    challengeKey: 'run-1:contract-1:generation_submit:revision-1',
    immutableProjectUuid: 'immutable-project-uuid-1',
    projectGeneration: 1,
    projectId: 'project-1',
    runId: 'run-1',
    gateId: 'gate-1',
    contractHash: 'contract-1',
    targetHash: 'contract-1',
    projectRevision: 1,
    costScope: 'CNY:5',
    pricingSnapshotHash: 'price-1',
    reservationPreview: { currency: 'CNY', maximum: 5 },
  })
  const gesture = authority.createMainProcessGestureAttestation(challenge.token, {
    webContentsId: 10,
    frameId: 2,
    origin: 'app://nomi',
    decision: 'accept',
  })
  const minted = authority.mintReceipt(challenge.token, gesture)
  return { authority, receiptId: minted.receipt.receiptId, token: minted.token }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function policy(options: { enabled?: boolean; p0Passed?: boolean; p2Passed?: boolean; p3Passed?: boolean } = {}) {
  return createMcpGenerationPolicy({
    env: { NOMI_MCP_GENERATION_SINGLE_SHOT_V1: options.enabled === true ? '1' : '' },
    checkpoints: {
      p0Passed: options.p0Passed === true,
      p2Passed: options.p2Passed === true,
      p3Passed: options.p3Passed === true,
    },
  })
}

function context(overrides: Record<string, unknown> = {}) {
  const productionRuns = {
    createDraft: vi.fn(async () => ({ runId: 'run-1', status: 'draft' })),
    readProjection: vi.fn(async () => ({ runId: 'run-1', status: 'draft' })),
    readEvents: vi.fn(async () => ({ events: [], nextCursor: 0 })),
    readArtifactProjection: vi.fn(async () => ({ artifactId: 'artifact-1' })),
    readFull: vi.fn(() => ({ revision: 1, gates: [] })),
    command: vi.fn(async () => ({ run: {}, events: [] })),
  }
  return {
    productionRuns,
    ctx: {
      runTask: vi.fn(async () => ({ status: 'succeeded' })),
      makeGateway: vi.fn(() => { throw new Error('semantic stubs must not resolve a canvas gateway') }),
      productionRuns,
      origin: { host: 'external' as const },
      generationPolicy: policy({ enabled: true }),
      ...overrides,
    },
  }
}

describe('generation.single-shot dispatcher policy boundary', () => {
  it('returns a typed feature_disabled error before any semantic service call', async () => {
    const { ctx, productionRuns } = context({ generationPolicy: policy() })

    await expect(dispatch('nomi_operation_create', { projectId: 'project-1' }, ctx as never))
      .rejects.toMatchObject({
        code: 'feature_disabled',
        nextAction: expect.any(String),
        phase: 'schema_only',
        capability: 'create',
      })
    expect(productionRuns.createDraft).not.toHaveBeenCalled()
    expect(ctx.runTask).not.toHaveBeenCalled()
    expect(ctx.makeGateway).not.toHaveBeenCalled()
  })

  it('returns phase_not_ready for write-like semantic routes before P0/P2', async () => {
    const { ctx, productionRuns } = context({ generationPolicy: policy({ enabled: true }) })

    await expect(dispatch('nomi_start_generation', { runId: 'run-1' }, ctx as never))
      .rejects.toMatchObject({
        code: 'phase_not_ready',
        nextAction: expect.any(String),
        phase: 'schema_only',
        capability: 'start',
      })
    expect(productionRuns.command).not.toHaveBeenCalled()
    expect(ctx.runTask).not.toHaveBeenCalled()
    expect(ctx.makeGateway).not.toHaveBeenCalled()
  })

  it('fails closed with not_ready even when the policy phase would allow a write', async () => {
    const { ctx, productionRuns } = context({
      generationPolicy: policy({ enabled: true, p0Passed: true, p2Passed: true }),
    })

    await expect(dispatch('nomi_operation_create', { projectId: 'project-1' }, ctx as never))
      .rejects.toMatchObject({
        code: 'lease_required',
        nextAction: expect.any(String),
        phase: 'e0_zero_credit',
        capability: 'create',
      })
    expect(productionRuns.createDraft).not.toHaveBeenCalled()
  })

  it('allows context/read only through an explicitly supplied handler', async () => {
    const generationContext = vi.fn(async (params: Record<string, unknown>) => ({ params, phase: 'schema_only' }))
    const { ctx } = context({
      generationPolicy: policy({ enabled: true, p0Passed: true, p2Passed: true }),
      generationContext,
      projectLeaseAuthority: undefined,
    })

    await expect(dispatch('nomi_get_generation_context', { projectId: 'project-1' }, ctx as never))
      .rejects.toMatchObject({ code: 'lease_required', capability: 'context', phase: 'e0_zero_credit' })
    expect(generationContext).not.toHaveBeenCalled()
  })

  it('opens a session only from a main-process signed selection handle and returns a scoped lease', async () => {
    const authority = makeAuthority()
    const selection = authority.issueSelectionHandle({
      immutableProjectUuid: 'immutable-project-uuid-1',
      projectGeneration: 1,
      canonicalRootDigest: 'root-digest-1',
      manifestDigest: 'manifest-digest-1',
      scopeSet: ['context:read'],
    })
    const resolveProjectSelection = vi.fn(() => ({
      projectId: 'project-1',
      leasePrincipal: 'mcp:test',
      sessionId: 'session-1',
      connectionNonce: 'connection-1',
      serverNonce: 'server-nonce-1',
    }))
    const { ctx } = context({
      generationPolicy: policy({ enabled: true, p0Passed: true, p2Passed: true }),
      projectLeaseAuthority: authority,
      resolveProjectSelection,
    })

    const opened = await dispatch('nomi_session_open', {
      projectSelectionHandle: selection.token,
    }, ctx as never)
    expect(opened).toMatchObject({
      protocolVersion: 1,
      projectId: 'project-1',
      sessionId: 'session-1',
      serverNonce: 'server-nonce-1',
      phase: 'e0_zero_credit',
      effectiveScope: expect.arrayContaining(['context']),
    })
    const projection = opened as { leaseHandle: string; projectId: string }
    expect(authority.verifyLease(projection.leaseHandle, { projectId: projection.projectId, sessionId: 'session-1' })).toMatchObject({
      projectId: 'project-1',
      projectGeneration: 1,
    })
    expect(resolveProjectSelection).toHaveBeenCalledTimes(1)
    await expect(dispatch('nomi_session_open', { projectId: 'project-1' }, ctx as never))
      .rejects.toMatchObject({ httpStatus: 400 })
  })

  it('opens a read-only session from a registered client current-project bootstrap without trusting project fields', async () => {
    const authority = makeAuthority()
    const resolveCurrentProject = vi.fn((request: { client: string; clientSessionNonce: string }) => {
      expect(request).toEqual({ client: 'codex', clientSessionNonce: 'client-session-1' })
      return {
        projectId: 'project-1',
        immutableProjectUuid: 'immutable-project-uuid-1',
        projectGeneration: 1,
        canonicalRootDigest: 'root-digest-1',
        manifestDigest: 'manifest-digest-1',
        revocationEpoch: 0,
        leasePrincipal: 'mcp:codex',
        sessionId: 'session-1',
        connectionNonce: 'connection-1',
        serverNonce: 'server-nonce-1',
      }
    })
    const { ctx } = context({
      generationPolicy: policy({ enabled: true, p0Passed: true, p2Passed: true }),
      projectLeaseAuthority: authority,
      resolveCurrentProject,
      origin: { host: 'codex' as const },
    })

    const opened = await dispatch('nomi_session_open', {
      bootstrap: { mode: 'current_project', clientSessionNonce: 'client-session-1' },
    }, ctx as never)

    expect(opened).toMatchObject({ projectId: 'project-1', sessionId: 'session-1', serverNonce: 'server-nonce-1' })
    const projection = opened as { leaseHandle: string }
    expect(authority.verifyLease(projection.leaseHandle)).toMatchObject({
      projectId: 'project-1',
      scopeSet: ['context:read'],
    })
    expect(resolveCurrentProject).toHaveBeenCalledTimes(1)
  })

  it('rejects current-project bootstrap from an unregistered origin before resolving a project', async () => {
    const resolveCurrentProject = vi.fn()
    const { ctx } = context({
      generationPolicy: policy({ enabled: true, p0Passed: true, p2Passed: true }),
      projectLeaseAuthority: makeAuthority(),
      resolveCurrentProject,
      origin: { host: 'external' as const },
    })

    await expect(dispatch('nomi_session_open', {
      bootstrap: { mode: 'current_project', clientSessionNonce: 'client-session-1' },
    }, ctx as never)).rejects.toMatchObject({ code: 'lease_required', capability: 'context' })
    expect(resolveCurrentProject).not.toHaveBeenCalled()
  })

  it('rejects bootstrap requests that try to select a path or expand the read-only scope', async () => {
    const resolveCurrentProject = vi.fn(() => ({
      projectId: 'project-1',
      immutableProjectUuid: 'immutable-project-uuid-1',
      projectGeneration: 1,
      canonicalRootDigest: 'root-digest-1',
      manifestDigest: 'manifest-digest-1',
      revocationEpoch: 0,
      leasePrincipal: 'mcp:codex',
      sessionId: 'session-1',
      connectionNonce: 'connection-1',
      serverNonce: 'server-nonce-1',
    }))
    const { ctx } = context({
      generationPolicy: policy({ enabled: true, p0Passed: true, p2Passed: true }),
      projectLeaseAuthority: makeAuthority(),
      resolveCurrentProject,
      origin: { host: 'codex' as const },
    })

    await expect(dispatch('nomi_session_open', {
      bootstrap: { mode: 'current_project', clientSessionNonce: 'client-session-1', scopeSet: ['generation:submit'] },
    }, ctx as never)).rejects.toMatchObject({ httpStatus: 400 })
    await expect(dispatch('nomi_session_open', {
      bootstrap: { mode: 'current_project', clientSessionNonce: 'client-session-1' },
      path: '/tmp/foreign-project',
    }, ctx as never)).rejects.toMatchObject({ httpStatus: 400 })
    expect(resolveCurrentProject).not.toHaveBeenCalled()
  })

  it('accepts only a verified project lease before invoking semantic context/read', async () => {
    const generationContext = vi.fn(async (params: Record<string, unknown>) => ({ params, phase: 'e0_zero_credit' }))
    const liveAuthority = makeAuthority()
    const { ctx } = context({
      generationPolicy: policy({ enabled: true, p0Passed: true, p2Passed: true }),
      generationContext,
      projectLeaseAuthority: liveAuthority,
    })
    const liveLease = makeLease(liveAuthority)

    await expect(dispatch('nomi_get_generation_context', { projectId: 'project-1', leaseHandle: liveLease }, ctx as never))
      .resolves.toEqual({ params: { projectId: 'project-1', leaseHandle: liveLease }, phase: 'e0_zero_credit' })
    expect(generationContext).toHaveBeenCalledTimes(1)
    await expect(dispatch('nomi_get_generation_context', { projectId: 'project-2', leaseHandle: liveLease }, ctx as never))
      .rejects.toMatchObject({ code: 'project_scope_changed', capability: 'context' })
    await expect(dispatch('nomi_get_generation_context', { projectId: 'project-1', leaseHandle: `${liveLease.slice(0, -1)}x` }, ctx as never))
      .rejects.toMatchObject({ code: 'lease_invalid', capability: 'context' })
    expect(generationContext).toHaveBeenCalledTimes(1)
  })

  it('requires a main-process receipt for gate decisions and never treats a boolean as proof', async () => {
    const leaseAuthority = makeAuthority()
    const leaseHandle = makeLease(leaseAuthority, 'project-1', ['generation:gate'])
    const approval = makeApprovalReceipt()
    const { ctx } = context({
      generationPolicy: policy({ enabled: true, p0Passed: true, p2Passed: true, p3Passed: true }),
      projectLeaseAuthority: leaseAuthority,
      approvalReceiptAuthority: approval.authority,
      projectRevisionResolver: () => 1,
    })

    await expect(dispatch('nomi_decide_generation_gate', {
      projectId: 'project-1', leaseHandle, runId: 'run-1', gateId: 'gate-1', approved: true,
    }, ctx as never)).rejects.toMatchObject({
      code: 'human_approval_required',
      capability: 'gate_decide',
      phase: 'e1_paid',
    })

    await expect(dispatch('nomi_decide_generation_gate', {
      projectId: 'project-1', leaseHandle, runId: 'run-1', gateId: 'gate-1',
      contractHash: 'contract-1', receiptId: approval.receiptId,
    }, ctx as never)).rejects.toMatchObject({
      code: 'not_ready',
      capability: 'gate_decide',
      phase: 'e1_paid',
    })
    await expect(dispatch('nomi_decide_generation_gate', {
      projectId: 'project-1', leaseHandle, runId: 'run-1', gateId: 'gate-1',
      contractHash: 'contract-1', pricingSnapshotHash: 'price-new', receiptId: approval.receiptId,
    }, ctx as never)).rejects.toMatchObject({
      code: 'receipt_invalid',
      capability: 'gate_decide',
    })
    // Verification is read-only at this boundary; the ProductionRun gate owner consumes the receipt.
    expect(approval.authority.verifyReceipt(approval.token).receiptId).toBe(approval.receiptId)
  })

  it('passes one verified receipt and lease to the generation authorization owner without invoking a provider', async () => {
    const leaseAuthority = makeAuthority()
    const leaseHandle = makeLease(leaseAuthority, 'project-1', ['generation:gate'])
    const approval = makeApprovalReceipt()
    const authorizeGeneration = vi.fn(async (input: { lease: unknown; receipt: { receiptId: string }; params: Record<string, unknown> }) => ({
      status: 'authorization_committed',
      receiptId: input.receipt.receiptId,
      projectId: input.params.projectId,
    }))
    const { ctx } = context({
      generationPolicy: policy({ enabled: true, p0Passed: true, p2Passed: true, p3Passed: true }),
      projectLeaseAuthority: leaseAuthority,
      approvalReceiptAuthority: approval.authority,
      projectRevisionResolver: () => 1,
      authorizeGeneration,
    })

    await expect(dispatch('nomi_decide_generation_gate', {
      projectId: 'project-1', leaseHandle, runId: 'run-1', gateId: 'gate-1',
      contractHash: 'contract-1', receiptId: approval.receiptId,
    }, ctx as never)).resolves.toEqual({
      status: 'authorization_committed',
      receiptId: approval.receiptId,
      projectId: 'project-1',
    })
    expect(authorizeGeneration).toHaveBeenCalledTimes(1)
    expect(authorizeGeneration.mock.calls[0]?.[0].lease).toMatchObject({
      projectId: 'project-1',
      scopeSet: expect.arrayContaining(['generation:gate', 'generation:submit']),
    })
    expect(leaseAuthority.verifyLease(authorizeGeneration.mock.calls[0]?.[0].params.leaseHandle)).toMatchObject({
      scopeSet: expect.arrayContaining(['generation:submit']),
    })
    expect(ctx.runTask).not.toHaveBeenCalled()
    expect(ctx.makeGateway).not.toHaveBeenCalled()
  })

  it('returns one server-owned generation challenge projection before any provider or spend call', async () => {
    const leaseAuthority = makeAuthority()
    const leaseHandle = makeLease(leaseAuthority, 'project-1', ['generation:gate'])
    const requestGenerationGate = vi.fn(async (input: { lease: { projectId: string }; params: Record<string, unknown> }) => ({
      challengeId: 'challenge-1',
      confirmationText: '允许 Nomi 在当前项目使用模型 X，最多花费 ¥5，生成这一镜吗？',
      projectId: input.lease.projectId,
      model: input.params.model,
      maximumCost: 5,
    }))
    const { ctx } = context({
      generationPolicy: policy({ enabled: true, p0Passed: true, p2Passed: true, p3Passed: true }),
      projectLeaseAuthority: leaseAuthority,
      requestGenerationGate,
    })

    await expect(dispatch('nomi_request_generation_gate', {
      projectId: 'project-1', leaseHandle, model: 'model-x', runId: 'run-1', contractHash: 'contract-1',
    }, ctx as never)).resolves.toMatchObject({
      challengeId: 'challenge-1',
      confirmationText: expect.stringContaining('最多花费'),
    })
    expect(requestGenerationGate).toHaveBeenCalledTimes(1)
    expect(ctx.runTask).not.toHaveBeenCalled()
    expect(ctx.makeGateway).not.toHaveBeenCalled()
  })

  it('returns not_ready for context/read when no handler exists', async () => {
    const { ctx } = context({ generationPolicy: policy({ enabled: true }) })

    await expect(dispatch('nomi_get_generation_context', {}, ctx as never))
      .rejects.toMatchObject({ code: 'not_ready', capability: 'context', phase: 'schema_only' })
  })

  it('keeps legacy production.start behaviour when no semantic fields are present', async () => {
    const { ctx, productionRuns } = context({ generationPolicy: policy() })

    await expect(dispatch('production.start', {
      projectId: 'project-1', playbook: 'brand.promo', brief: { goal: 'legacy draft' },
    }, ctx as never)).resolves.toMatchObject({ runId: 'run-1' })
    expect(productionRuns.createDraft).toHaveBeenCalledTimes(1)
  })

  it('firewalls legacy routes carrying P3 semantic bindings before any service call', async () => {
    const { ctx, productionRuns } = context({ generationPolicy: policy() })

    await expect(dispatch('production.start', {
      projectId: 'project-1', playbook: 'brand.promo', brief: { goal: 'must not route' },
      leaseHandle: 'lease-1', operationId: 'operation-1', runId: 'run-1', contractHash: 'hash-1',
    }, ctx as never)).rejects.toMatchObject({
      code: 'legacy_path_forbidden',
      nextAction: expect.any(String),
      phase: 'schema_only',
      capability: 'create',
    })
    expect(productionRuns.createDraft).not.toHaveBeenCalled()
  })

  it('firewalls the actual generate dispatcher method before it can reach the provider path', async () => {
    const { ctx } = context({ generationPolicy: policy() })

    await expect(dispatch('generate', {
      projectId: 'project-1', vendor: 'provider', modelKey: 'model', intent: 'image', prompt: 'legacy',
      leaseHandle: 'lease-1', operationId: 'operation-1', contractHash: 'hash-1',
    }, ctx as never)).rejects.toMatchObject({
      code: 'legacy_path_forbidden',
      capability: 'create',
      phase: 'schema_only',
    })
    expect(ctx.runTask).not.toHaveBeenCalled()
    expect(ctx.makeGateway).not.toHaveBeenCalled()
  })

  it.each([
    'executionBinding', 'requestFingerprint', 'providerIdempotencyKey', 'runtimeEnvelopeRef',
    'runtimeEnvelopeHash', 'fencingEpoch', 'envelopeState', 'providerTaskId', 'sessionId', 'nonce',
    'baseRevision', 'projectRevision', 'attempt', 'runtimeEnvelope',
  ])('firewalls canonical binding marker %s on generate', async (field) => {
    const { ctx } = context({ generationPolicy: policy() })
    await expect(dispatch('generate', {
      projectId: 'project-1', vendor: 'provider', modelKey: 'model', intent: 'image', prompt: 'legacy',
      [field]: 'sealed-value',
    }, ctx as never)).rejects.toMatchObject({ code: 'legacy_path_forbidden' })
    expect(ctx.runTask).not.toHaveBeenCalled()
    expect(ctx.makeGateway).not.toHaveBeenCalled()
  })

  it.each(['moduleRef', 'candidate', 'providerId'])('firewalls nested canonical wrapper marker %s inside generate params', async (field) => {
    const { ctx } = context({ generationPolicy: policy() })
    await expect(dispatch('generate', {
      projectId: 'project-1', vendor: 'provider', modelKey: 'model', intent: 'image', prompt: 'legacy',
      params: { runtime: { [field]: { runId: 'run-1' } } },
    }, ctx as never)).rejects.toMatchObject({ code: 'legacy_path_forbidden' })
    expect(ctx.runTask).not.toHaveBeenCalled()
    expect(ctx.makeGateway).not.toHaveBeenCalled()
  })

  it('fails closed on excessively deep legacy payloads', async () => {
    let nested: Record<string, unknown> = { leaf: true }
    for (let index = 0; index < 40; index += 1) nested = { nested }
    const { ctx } = context({ generationPolicy: policy() })
    await expect(dispatch('generate', {
      projectId: 'project-1', vendor: 'provider', modelKey: 'model', intent: 'image', prompt: 'legacy', params: nested,
    }, ctx as never)).rejects.toMatchObject({ code: 'legacy_path_forbidden' })
    expect(ctx.runTask).not.toHaveBeenCalled()
  })

  it('does not change unknown method errors', async () => {
    const { ctx } = context({ generationPolicy: policy({ enabled: true }) })
    await expect(dispatch('nomi_unknown_generation_method', {}, ctx as never))
      .rejects.toMatchObject({ httpStatus: 404, message: '未知方法: nomi_unknown_generation_method' })
  })

  it('keeps runId-only production.control compatibility while rejecting a semantic binding', async () => {
    const { ctx, productionRuns } = context({ generationPolicy: policy() })
    await dispatch('production.control', { projectId: 'project-1', runId: 'run-1', action: 'pause' }, ctx as never)
    expect(productionRuns.command).toHaveBeenCalledTimes(1)

    await expect(dispatch('production.control', {
      projectId: 'project-1', runId: 'run-1', action: 'pause', leaseHandle: 'lease-1', operationId: 'operation-1',
    }, ctx as never)).rejects.toMatchObject({ code: 'legacy_path_forbidden' })
    expect(productionRuns.command).toHaveBeenCalledTimes(1)
  })

  it.each([
    'production.get',
    'production.events',
    'production.artifact',
    'production.artifact.read',
    'production.artifact.revise',
    'production.artifact.review',
    'production.storyboard.materialize',
  ])('firewalls semantic bindings on legacy %s before read/write services', async (method) => {
    const { ctx, productionRuns } = context({ generationPolicy: policy() })
    await expect(dispatch(method, {
      projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-1', leaseHandle: 'lease-1',
    }, ctx as never)).rejects.toMatchObject({
      code: 'legacy_path_forbidden',
      nextAction: expect.any(String),
    })
    expect(productionRuns.readProjection).not.toHaveBeenCalled()
    expect(productionRuns.readEvents).not.toHaveBeenCalled()
    expect(productionRuns.readArtifactProjection).not.toHaveBeenCalled()
    expect(productionRuns.command).not.toHaveBeenCalled()
  })

  it('does not infer a P3 binding from bare legacy identifiers', async () => {
    const { ctx, productionRuns } = context({ generationPolicy: policy() })
    await expect(dispatch('production.get', { projectId: 'project-1', runId: 'run-1' }, ctx as never))
      .resolves.toMatchObject({ runId: 'run-1' })
    expect(productionRuns.readProjection).toHaveBeenCalledWith('project-1', 'run-1')
  })

  it('exposes policy errors as RpcError instances', async () => {
    const { ctx } = context({ generationPolicy: policy() })
    try {
      await dispatch('nomi_operation_create', {}, ctx as never)
      throw new Error('expected dispatch to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(RpcError)
      expect(error).toMatchObject({ code: 'feature_disabled', capability: 'create' })
    }
  })
})
