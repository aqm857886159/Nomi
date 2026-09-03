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

  // 【2026-09-03 两次来回，把过程留在这儿防再犯】
  //
  // 第一次：「语义挑战 + 客户端只给光秃秃的同意 → 回落 Nomi 卡」被判成「规则前提生产里永远无法满足 = 半成品
  // 开关」而推翻，改成就地算数；当天被真机走查推回——推翻版让用户点完同意后 gate 回 human_approval_required，
  // 比多点一次更糟。结论：那面旗是对的要求，缺的是铸收据那一环。
  //
  // 第二次（本 PR）：verifyClientGenerationConfirmation 在两个生产装配点接通，主进程铸 client_elicitation 收据。
  // 结果：光秃秃的同意（无 attestation 字段）→ verifyClientGenerationConfirmation 仍然被调（只要它存在）→
  // 主进程照样铸出 client_elicitation 收据 → gate 真的进入 decide/start，生成真的开始。
  // 断言恢复为正确行为：surface:'client'，带收据，不再回落 Nomi。
  it('语义生成挑战：接通 verifyClientGenerationConfirmation 后，客户端光秃秃的同意也能铸收据', async () => {
    const frames: unknown[] = []
    const verifyClientGenerationConfirmation = vi.fn(async () => ({ confirmed: true, receiptId: 'receipt-client-elicitation', receiptToken: 'token-client-elicitation' }))
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
    // 光秃秃的同意：没有 attestation 字段
    protocol.handleIncoming({ id: request.id, result: { action: 'accept', content: { confirm: true } } })
    await expect(resultPromise).resolves.toMatchObject({ surface: 'client', receiptId: 'receipt-client-elicitation', receiptToken: 'token-client-elicitation' })
    // verifyClientGenerationConfirmation 被调（无论 attestation 字段是否存在），Nomi 确认卡不出现
    expect(verifyClientGenerationConfirmation).toHaveBeenCalledTimes(1)
    expect(confirmGenerationInNomi).not.toHaveBeenCalled()
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

// ── 生产装配面下的确认面：现实是什么样，就断言什么样 ──
//
// 为什么要单独一组：上面那些用例都给 transport 传了 verifyClientGenerationConfirmation 的 mock，而
// **两个生产装配点（mcpNodeLauncher / mcpStdioServer）都没有传它**。于是那些绿灯证明不了生产行为——
// 真实用户遇到的是下面这组。它们刻意只用生产真有的能力装配 transport。
//
// 本组断言的是**现状**，不是理想态：没有验证器 = 客户端的同意换不来收据 = 只能回落 Nomi。
// 理想态（客户端点同意就能开始生成）要等「铸收据」那一环接上，不是靠放宽这里的断言换来的。
describe('生产装配面：没有验证器时，客户端的同意换不来收据', () => {
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

  // 这条是本轮最贵的一课：2026-09-03 曾把它断言成「就地确认、不弹 Nomi 卡」，真机走查（打包版 + 真
  // Codex 客户端 + 零额度 loopback）证明那样做的净效果是——elicitation 帧确实弹到客户端了、用户也
  // accept 了，然后 gate 回 `human_approval_required`，生成压根没开始。比多点一次更糟。
  // 现在断言现状：回落 Nomi。等「铸收据」接上再来改它，并且要连着下游一起验，不能只看这一层返回值。
  it('客户端明确点「是」但拿不到收据 → 回落 Nomi 卡（那条路才铸真收据）', async () => {
    const transport = productionTransport()
    await expect(acceptInClient(transport, { confirm: true })).resolves.toMatchObject({
      confirmed: true, surface: 'nomi', receiptId: 'receipt-gui',
    })
    expect(transport.confirmGenerationInNomi).toHaveBeenCalledTimes(1)
  })

  it('客户端已确认但 Nomi 没开着 → 如实回 surface:none，不假装成功', async () => {
    const transport = productionTransport({ isAppOpen: () => false })
    await expect(acceptInClient(transport, { confirm: true })).resolves.toMatchObject({
      confirmed: false, surface: 'none',
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
