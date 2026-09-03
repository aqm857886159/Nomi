import { describe, expect, it, vi } from 'vitest'

import { createMcpProtocol, type GenerationGateChallengeProjection, type McpTransport } from './mcpProtocol'

const challenge: GenerationGateChallengeProjection = {
  challengeId: 'challenge-1',
  nonce: 'nonce-1',
  projectName: '短片 A',
  shotSummary: '生成这一镜',
  model: 'model-x',
  referenceCount: 2,
  costScope: 'generation_submit',
  maximumCost: 5,
  currency: '¥',
  expiresAt: '2026-08-23T01:00:00.000Z',
  confirmationText: '允许 Nomi 在项目《短片 A》中使用模型 model-x，最多花费 ¥5，生成这一镜吗？',
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function initialized(transport: McpTransport) {
  const protocol = createMcpProtocol(transport)
  protocol.handleIncoming({
    id: 1,
    method: 'initialize',
    params: { capabilities: { elicitation: {} }, clientInfo: { name: 'Codex' } },
  })
  await tick()
  return protocol
}

describe('one generation challenge, two confirmation surfaces', () => {
  it('uses one registered client elicitation accept and never calls the GUI', async () => {
    const frames: unknown[] = []
    const transport: McpTransport = {
      send: (frame) => frames.push(frame),
      invoke: vi.fn(async () => ({})),
      isAppOpen: () => true,
      getAuthenticatedClient: () => 'codex',
      verifyClientGenerationConfirmation: vi.fn(async (_challenge, attestation) => attestation === 'attestation-1'),
      confirmGenerationInNomi: vi.fn(async () => true),
    }
    const protocol = await initialized(transport)
    const resultPromise = protocol.requestGenerationConfirmation(challenge)
    await tick()
    const request = frames.find((frame) => (frame as { method?: string }).method === 'elicitation/create') as { id: string; params: { message: string } }
    expect(request.params.message).toContain('最多花费 ¥5')
    protocol.handleIncoming({ id: request.id, result: { action: 'accept', content: { confirm: true, attestation: 'attestation-1' } } })

    await expect(resultPromise).resolves.toEqual({
      challengeId: 'challenge-1', confirmed: true, surface: 'client', nextAction: 'in_client',
    })
    expect(transport.confirmGenerationInNomi).not.toHaveBeenCalled()
  })

  it('uses the same challenge in Nomi when the client cannot prove its registered channel', async () => {
    const confirmGenerationInNomi = vi.fn(async (received: GenerationGateChallengeProjection) => {
      expect(received).toBe(challenge)
      return true
    })
    const frames: unknown[] = []
    const protocol = await initialized({
      send: (frame) => frames.push(frame),
      invoke: vi.fn(async () => ({})),
      isAppOpen: () => true,
      confirmGenerationInNomi,
    })

    await expect(protocol.requestGenerationConfirmation(challenge)).resolves.toEqual({
      challengeId: 'challenge-1', confirmed: true, surface: 'nomi', nextAction: 'in_nomi',
    })
    await expect(protocol.requestGenerationConfirmation(challenge)).resolves.toEqual({
      challengeId: 'challenge-1', confirmed: true, surface: 'nomi', nextAction: 'in_nomi',
    })
    expect(frames.some((frame) => (frame as { method?: string }).method === 'elicitation/create')).toBe(false)
    expect(confirmGenerationInNomi).toHaveBeenCalledTimes(1)
  })

  it('uses one GUI fallback card for a semantic challenge and returns its receipt', async () => {
    const confirmGenerationInNomi = vi.fn(async (received: GenerationGateChallengeProjection) => {
      expect(received.handoff).toMatchObject({ clientAttestation: true, challengeToken: 'challenge-token' })
      return { confirmed: true, receiptId: 'receipt-gui-semantic', receiptToken: 'token-gui-semantic' }
    })
    const protocol = createMcpProtocol({
      send: () => undefined,
      invoke: vi.fn(async () => ({})),
      isAppOpen: () => true,
      getAuthenticatedClient: () => 'codex',
      confirmGenerationInNomi,
    })
    await expect(protocol.requestGenerationConfirmation({ ...challenge, handoff: { clientAttestation: true, challengeToken: 'challenge-token' } })).resolves.toMatchObject({
      surface: 'nomi', confirmed: true, receiptId: 'receipt-gui-semantic', receiptToken: 'token-gui-semantic',
    })
    expect(confirmGenerationInNomi).toHaveBeenCalledTimes(1)
  })

  it('accepts one registered client confirm:true on the outstanding challenge without opening Nomi', async () => {
    const confirmGenerationInNomi = vi.fn(async () => ({ confirmed: true, receiptId: 'receipt-1' }))
    const frames: unknown[] = []
    const protocol = await initialized({
      send: (frame) => frames.push(frame),
      invoke: vi.fn(async () => ({})),
      isAppOpen: () => true,
      getAuthenticatedClient: () => 'cursor',
      confirmGenerationInNomi,
    })
    const resultPromise = protocol.requestGenerationConfirmation(challenge)
    await tick()
    const request = frames.find((frame) => (frame as { method?: string }).method === 'elicitation/create') as { id: string }
    protocol.handleIncoming({ id: request.id, result: { action: 'accept', content: { confirm: true } } })
    await expect(resultPromise).resolves.toEqual({
      challengeId: 'challenge-1', confirmed: true, surface: 'client', nextAction: 'in_client',
    })
    await expect(protocol.requestGenerationConfirmation(challenge)).resolves.toMatchObject({
      challengeId: 'challenge-1', confirmed: true, surface: 'client', nextAction: 'in_client',
    })
    expect(confirmGenerationInNomi).not.toHaveBeenCalled()
  })

  it('does not downgrade an invalid optional attestation to client approval', async () => {
    const confirmGenerationInNomi = vi.fn(async () => ({ confirmed: true, receiptId: 'receipt-2' }))
    const frames: unknown[] = []
    const protocol = await initialized({
      send: (frame) => frames.push(frame),
      invoke: vi.fn(async () => ({})),
      isAppOpen: () => true,
      getAuthenticatedClient: () => 'claude',
      verifyClientGenerationConfirmation: vi.fn(async () => false),
      confirmGenerationInNomi,
    })
    const resultPromise = protocol.requestGenerationConfirmation(challenge)
    await tick()
    const request = frames.find((frame) => (frame as { method?: string }).method === 'elicitation/create') as { id: string }
    protocol.handleIncoming({ id: request.id, result: { action: 'accept', content: { confirm: true, attestation: 'invalid' } } })
    await expect(resultPromise).resolves.toMatchObject({
      challengeId: 'challenge-1', confirmed: true, surface: 'nomi', nextAction: 'in_nomi', receiptId: 'receipt-2',
    })
    expect(confirmGenerationInNomi).toHaveBeenCalledTimes(1)
  })

  it('does not create a receipt surface when neither client nor GUI can confirm', async () => {
    const protocol = await initialized({
      send: () => undefined,
      invoke: vi.fn(async () => ({})),
      isAppOpen: () => false,
    })

    await expect(protocol.requestGenerationConfirmation(challenge)).resolves.toEqual({
      challengeId: 'challenge-1', confirmed: false, surface: 'none', nextAction: 'in_nomi',
    })
  })

  it('uses a registered client receipt channel for semantic generation challenges without a second GUI click', async () => {
    const frames: unknown[] = []
    const verifyClientGenerationConfirmation = vi.fn(async (_challenge: GenerationGateChallengeProjection, attestation: unknown) => {
      expect(attestation).toEqual('signed-client-attestation')
      return { confirmed: true, receiptId: 'receipt-semantic-1', receiptToken: 'token-semantic-1' }
    })
    const confirmGenerationInNomi = vi.fn(async () => ({ confirmed: true, receiptId: 'receipt-gui' }))
    const protocol = await initialized({
      send: (frame) => frames.push(frame),
      invoke: vi.fn(async () => ({})),
      isAppOpen: () => true,
      getAuthenticatedClient: () => 'codex',
      verifyClientGenerationConfirmation,
      confirmGenerationInNomi,
    })
    const resultPromise = protocol.requestGenerationConfirmation({ ...challenge, handoff: { clientAttestation: true, challengeToken: 'challenge-token' } })
    await tick()
    const request = frames.find((frame) => (frame as { method?: string }).method === 'elicitation/create') as { id: string }
    protocol.handleIncoming({ id: request.id, result: { action: 'accept', content: { confirm: true, attestation: 'signed-client-attestation' } } })
    await expect(resultPromise).resolves.toMatchObject({ surface: 'client', receiptId: 'receipt-semantic-1', receiptToken: 'token-semantic-1' })
    expect(confirmGenerationInNomi).not.toHaveBeenCalled()
    expect(verifyClientGenerationConfirmation).toHaveBeenCalledTimes(1)
  })

  // 【2026-09-03 行为已由用户拍板改变】本用例原名 'routes a bare semantic client accept to the same
  // GUI challenge'，断言的是「语义生成挑战 + 客户端只给光秃秃的同意 → 回落 Nomi 卡」。那条规则的
  // 依据是签发点带的 handoff.clientAttestation:true（= 我要凭证）。
  //
  // 它被推翻的理由不是规则本身不合理，而是**它的前提在生产里永远无法满足**：两个签发点无条件带那面旗，
  // 而验证凭证的 verifyClientGenerationConfirmation 在两个生产装配点都没接、标准 MCP 客户端也不产出凭证。
  // 净效果是主确认面整个失效——每次花钱确认都被赶回 Nomi 应用，Nomi 没开就直接拒绝。用户拍板：认证
  // 客户端 + 声明 elicitation + 显式点同意，就算数。那面旗随之删除（无实现可满足 = 半成品开关，非防线）。
  //
  // 保留下来的部分：光秃秃的同意**不得**触发凭证验证器（下面仍然断言 not.toHaveBeenCalled）。
  it('语义生成挑战：客户端光秃秃的同意就地算数，且不触碰凭证验证器', async () => {
    const frames: unknown[] = []
    const verifyClientGenerationConfirmation = vi.fn(async () => ({ confirmed: true, receiptId: 'should-not-be-used' }))
    const confirmGenerationInNomi = vi.fn(async () => ({ confirmed: true, receiptId: 'receipt-gui' }))
    const protocol = await initialized({
      send: (frame) => frames.push(frame),
      invoke: vi.fn(async () => ({})),
      isAppOpen: () => true,
      getAuthenticatedClient: () => 'codex',
      verifyClientGenerationConfirmation,
      confirmGenerationInNomi,
    })
    const resultPromise = protocol.requestGenerationConfirmation({ ...challenge, handoff: { challengeToken: 'challenge-token' } })
    await tick()
    const request = frames.find((frame) => (frame as { method?: string }).method === 'elicitation/create') as { id: string }
    protocol.handleIncoming({ id: request.id, result: { action: 'accept', content: { confirm: true } } })
    await expect(resultPromise).resolves.toMatchObject({ confirmed: true, surface: 'client', nextAction: 'in_client' })
    expect(confirmGenerationInNomi).not.toHaveBeenCalled()
    expect(verifyClientGenerationConfirmation).not.toHaveBeenCalled()
  })

  it('treats client decline as no approval and keeps the challenge identity', async () => {
    const frames: unknown[] = []
    const protocol = await initialized({
      send: (frame) => frames.push(frame),
      invoke: vi.fn(async () => ({})),
      isAppOpen: () => true,
      getAuthenticatedClient: () => 'claude',
    })
    const resultPromise = protocol.requestGenerationConfirmation(challenge)
    await tick()
    const request = frames.find((frame) => (frame as { method?: string }).method === 'elicitation/create') as { id: string }
    protocol.handleIncoming({ id: request.id, result: { action: 'decline' } })
    await expect(resultPromise).resolves.toMatchObject({ challengeId: 'challenge-1', confirmed: false, surface: 'client' })
  })
})

// ── 生产装配面下的确认面（2026-09-03 用户拍板：客户端点同意就算数）──
//
// 上面那些用例都给 transport 传了 verifyClientGenerationConfirmation 的 mock，而**两个生产装配点
// （mcpNodeLauncher / mcpStdioServer）都没有传它**。于是那些绿灯证明不了生产行为——真实用户遇到的是
// 下面这组。它们刻意只用生产真有的四项能力装配 transport。
//
// 生产签发点（generationDispatcher.ts / runOwnedGenerationGateAuthority.ts）无条件带
// handoff.clientAttestation:true，所以这组用例也照抄那个形状。
describe('生产装配面：在调用方点同意，不该被赶回 Nomi', () => {
  /** 只含两个生产装配点真正传入的能力——没有 verifyClientGenerationConfirmation。 */
  function productionTransport(overrides: Partial<McpTransport> = {}): McpTransport {
    return {
      send: () => {},
      invoke: vi.fn(async () => ({})),
      isAppOpen: () => true,
      getAuthenticatedClient: () => 'codex',
      confirmGenerationInNomi: vi.fn(async () => ({ confirmed: true, receiptId: 'receipt-gui' })),
      getLocale: () => 'zh-CN',
      ...overrides,
    }
  }

  async function acceptInClient(transport: McpTransport, content: Record<string, unknown>) {
    const frames: unknown[] = []
    const withCapture: McpTransport = { ...transport, send: (frame) => frames.push(frame) }
    const protocol = await initialized(withCapture)
    const promise = protocol.requestGenerationConfirmation({
      ...challenge,
      handoff: { challengeToken: 'challenge-token', clientAttestation: true },
    })
    await tick()
    const request = frames.find((f) => (f as { method?: string }).method === 'elicitation/create') as { id: string }
    protocol.handleIncoming({ id: request.id, result: { action: 'accept', content } })
    return promise
  }

  it('认证客户端声明 elicitation 并明确点「是」→ 就地确认，不弹 Nomi 卡', async () => {
    const transport = productionTransport()
    await expect(acceptInClient(transport, { confirm: true })).resolves.toMatchObject({
      confirmed: true, surface: 'client', nextAction: 'in_client',
    })
    expect(transport.confirmGenerationInNomi).not.toHaveBeenCalled()
  })

  it('客户端已确认但 Nomi 没开着 → 仍然算数（用户的「是」不能因为应用没开就被丢掉）', async () => {
    const transport = productionTransport({ isAppOpen: () => false })
    await expect(acceptInClient(transport, { confirm: true })).resolves.toMatchObject({
      confirmed: true, surface: 'client',
    })
  })

  it('客户端给了凭证但生产装配没有验证器 → 不许降级成就地确认，回落 Nomi', async () => {
    const transport = productionTransport()
    await expect(acceptInClient(transport, { confirm: true, attestation: 'unverifiable' })).resolves.toMatchObject({
      surface: 'nomi',
    })
    expect(transport.confirmGenerationInNomi).toHaveBeenCalledTimes(1)
  })
})
