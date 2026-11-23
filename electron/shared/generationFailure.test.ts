// 失败分类唯一家的单测：判定入口、确证码（U1-U3）、「全部拦下」的反例、旧用户落盘串、公开码快照。
// 全部是纯函数，不碰网络；自查探针仍先装进程级 fetch 拦截 + 金丝雀（非回环一律抛）。
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  GENERATION_ERROR_KINDS,
  PUBLIC_ERROR_CODES,
  actionsOfKind,
  confirmPublicError,
  decideGenerationFailure,
  failureActionsFor,
  isVendorSideKind,
} from './generationFailure'

const realFetch = globalThis.fetch
beforeAll(async () => {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(typeof input === 'string' ? input : (input as { url?: string })?.url ?? input)
    if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url)) throw new Error(`blocked non-loopback fetch: ${url}`)
    return realFetch(input as RequestInfo)
  })
  await expect(fetch('https://example.invalid/canary')).rejects.toThrow(/blocked non-loopback/)
})
afterAll(() => { vi.unstubAllGlobals() })

const decide = (message: string, extra: { code?: string; transient?: boolean; locale?: 'zh-CN' | 'en' } = {}) =>
  decideGenerationFailure({ message, locale: extra.locale ?? 'zh-CN', ...(extra.code ? { code: extra.code } : {}), ...(extra.transient ? { transient: true } : {}) })

describe('确证码：整词、取最先出现、字段优先', () => {
  it('U1 码是别的词的一部分 → 不是码', () => {
    expect(confirmPublicError(undefined, 'not_node_not_found_extra').code).toBeNull()
    expect(confirmPublicError(undefined, 'xnode_not_found').code).toBeNull()
    expect(confirmPublicError(undefined, 'node_not_found2').code).toBeNull()
  })

  it('U2 两个码并存：按文中位置取最先出现的，不按登记表顺序（调换顺序，结果跟着换）', () => {
    expect(confirmPublicError(undefined, 'unknown_model_identity node_not_found').code).toBe('unknown_model_identity')
    expect(confirmPublicError(undefined, 'node_not_found unknown_model_identity').code).toBe('node_not_found')
  })

  it('U3 确证码在字段里、正文是别的话 → 码不丢；字段里不认识的码不放行', () => {
    expect(confirmPublicError('asset_not_localized', 'still pending').code).toBe('asset_not_localized')
    expect(confirmPublicError('totally_made_up', 'still pending').code).toBeNull()
    // 字段里的码赢过正文里的码
    expect(confirmPublicError('node_not_found', 'unknown_model_identity').code).toBe('node_not_found')
  })

  it('策略码与「码本身就是全部公开信息」的档次只来自字段', () => {
    expect(confirmPublicError('node_not_found', 'private cause')).toMatchObject({ policy: true, codeOnly: true })
    expect(confirmPublicError('human_approval_required', 'x')).toMatchObject({ policy: true, codeOnly: false })
    expect(confirmPublicError(undefined, 'generate failed: renderer_or_provider_unknown')).toMatchObject({ code: 'renderer_or_provider_unknown', policy: false, codeOnly: false })
  })

  it('公开码集合快照：增删公开码必须是显式决定', () => {
    expect(PUBLIC_ERROR_CODES.length).toBe(58)
    expect(PUBLIC_ERROR_CODES).toEqual([...PUBLIC_ERROR_CODES].sort())
    for (const code of ['node_not_found', 'asset_not_localized', 'unknown_model_identity', 'human_approval_required', 'lease_expired', 'renderer_or_provider_unknown', 'integration_revision_stale', 'mode_input_missing']) {
      expect(PUBLIC_ERROR_CODES).toContain(code)
    }
  })

  it('decideGenerationFailure 把确证码一并给出（publicCode），生成类别不受它影响', () => {
    const decision = decide('still pending', { code: 'asset_not_localized' })
    expect(decision.publicCode).toBe('asset_not_localized')
    expect(decision.kind).toBe('unknown')
    expect(decide('not_node_not_found_extra').publicCode).toBeNull()
  })
})

describe('全部拦下的反例：该认的必须认出来（判定不能一律 unknown / 一律只给重试）', () => {
  it('401 Unauthorized → auth + 去模型接入（画布 / 内置助手共用的判定）', () => {
    const decision = decide('401 Unauthorized')
    expect(decision.kind).toBe('auth')
    expect(decision.primary).toBe('open-model-access')
    expect(decision.vendorSide).toBe(true)
  })

  it('取回阶段码 → retrieval-incomplete，主动作是查看任务（不是盲重试）', () => {
    const decision = decide('NOMI_ERR::retrieval-download:: fetch failed')
    expect(decision.kind).toBe('retrieval-incomplete')
    expect(decision.primary).toBe('view-task')
    expect(decision.vendorSide).toBe(false)
  })

  it('不是每一类都只给重试：动作表里存在非 retry 的主动作', () => {
    const primaries = new Set(GENERATION_ERROR_KINDS.map((kind) => actionsOfKind(kind).primary))
    expect(primaries.size).toBeGreaterThan(3)
    expect(GENERATION_ERROR_KINDS.some((kind) => !isVendorSideKind(kind))).toBe(true)
    expect(GENERATION_ERROR_KINDS.some((kind) => isVendorSideKind(kind))).toBe(true)
  })

  it('model-unavailable-upstream → 换同能力模型', () => {
    expect(actionsOfKind('model-unavailable-upstream').primary).toBe('switch-same-capability')
  })
})

describe('输入事实：pi 瞬时 / 任务来源', () => {
  it('认不出 + 瞬时 → 网络类（输入事实，不是出口二次改判）；认得出的不被改', () => {
    const stuck = decide('upstream hiccup 7731', { transient: true })
    expect(stuck.kind).toBe('network')
    expect(stuck.raw).toBe('upstream hiccup 7731')
    expect(decide('upstream hiccup 7731').kind).toBe('unknown')
    expect(decide('401 Unauthorized', { transient: true }).kind).toBe('auth')
  })

  it('无任务号取回失败改重新生成；有任务号且不是制作 Run → 去重新取回', () => {
    const decision = decide('NOMI_ERR::retrieval-download:: fetch failed')
    const none = failureActionsFor(decision, { isProductionRecord: false })
    expect(none).toMatchObject({ primary: 'retry', secondary: null, canRetry: true })
    expect(none.hintKey).toContain('hintWithoutTask')
    const withTask = failureActionsFor(decision, { taskId: 't1', isProductionRecord: false })
    expect(withTask).toMatchObject({ primary: 'open-recoverable', hintKey: null })
    const production = failureActionsFor(decision, { taskId: 't1', productionRunId: 'p1', isProductionRecord: true })
    expect(production.primary).toBe('view-task')
  })
})

describe('旧用户落盘的失败串照新判定显示', () => {
  it('v0.24.0 被打断节点的 error → 本机拒绝（占用中），不是供应商失败', () => {
    const node = JSON.parse(readFileSync(new URL('../../tests/fixtures/old-user-data/runs/v0.24.0-canvas-interrupted/node.json', import.meta.url), 'utf8')) as { error: string }
    const decision = decide(node.error)
    expect(decision.kind).toBe('local-refusal')
    expect(decision.vendorSide).toBe(false)
    expect(decision.primary).toBe('release-regenerate')
  })

  it('空原文 → 认不出，不编原因', () => {
    const decision = decide('')
    expect(decision.kind).toBe('unknown')
    expect(decision.raw).toBe('')
  })
})
