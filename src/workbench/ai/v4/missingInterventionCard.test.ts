// 「声称有卡 ⇒ 必须画出点什么」——这一族的机器防线（2026-09-12）。
//
// 复现的是 2026-09-11 那次真实会话：用户让 Agent 把一段素材劈成两半，模型回了一句
// 「已生成剪辑预览，请在确认卡中批准后写入时间线」，dock 上也写着「等你确认 1 条」——
// 而槽里一张卡都没有。用户先以为在加载，再以为 Nomi 坏了。
//
// 这一组分三层量，对应三道防线（R28：拦在最早能拦住的那层）：
//   ① 那张会说话的卡本身（文案走 i18n、reason 说得出断在哪、同时留下排查痕迹）；
//   ② 开发/测试期的硬断言：announce 了却什么都没画 → 当场抛；
//   ③ 真实读通道：主进程拒绝这次读取 → **一个轮询周期内**槽里出现那张卡，而不是沉默。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MISSING_CARD_REASONS,
  assertAnnouncedCardRendered,
  missingCardReasonOfReadFailure,
  missingInterventionCard,
  traceMissingInterventionCard,
} from './missingInterventionCard'
import type { InterventionData } from './agentPanelV4Types'

const t = ((key: string, options?: Record<string, unknown>): string =>
  options ? `${key}(${Object.values(options).join(',')})` : key) as unknown as Parameters<typeof missingInterventionCard>[1]

describe('① 那张会说话的卡', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { vi.restoreAllMocks() })

  it('文案全部走 i18n，断在哪一环作为插值带进正文（不把英文原因直接印给用户）', () => {
    const card = missingInterventionCard({ reason: 'host-unreachable', announcer: 'spend-confirm', detail: 'ipc rejected' }, t)
    expect(card.kind).toBe('missing-card')
    expect(card.title).toBe('agentPanelV4.missingCard.title')
    expect(card.summary).toBe('agentPanelV4.missingCard.body(agentPanelV4.missingCard.reason.host-unreachable)')
    // 英文技术原文只进排查痕迹，不进界面。
    expect(JSON.stringify(card)).not.toContain('ipc rejected')
  })

  it('每一种 reason 都有自己的那句话——不是笼统的「出错了」', () => {
    const summaries = MISSING_CARD_REASONS.map((reason) => missingInterventionCard({ reason, announcer: 'x', detail: 'd' }, t).summary)
    expect(new Set(summaries).size).toBe(MISSING_CARD_REASONS.length)
  })

  it('渲一张卡必定同时留下一行排查痕迹：卡告诉用户断了，这一行告诉我们断在哪', () => {
    missingInterventionCard({ reason: 'spend-surface-unavailable', announcer: 'spend-confirm', detail: 'core not installed' }, t)
    expect(console.error).toHaveBeenCalledWith('[missing-intervention-card]', 'spend-confirm', 'spend-surface-unavailable', 'core not installed')
  })

  it('排查痕迹自己也能单独写（宿主在渲染之外的地方发现断链时用）', () => {
    traceMissingInterventionCard({ reason: 'unknown-kind', announcer: 'lane-approval', detail: '{"shape":"?"}' })
    expect(console.error).toHaveBeenCalledWith('[missing-intervention-card]', 'lane-approval', 'unknown-kind', '{"shape":"?"}')
  })
})

describe('② 开发/测试期的硬断言', () => {
  const card = { kind: 'spend', title: '生成' } as InterventionData

  it('announce 了却什么都没画 → 当场抛，错误里说得出是哪个面在 announce', () => {
    expect(() => assertAnnouncedCardRendered({ announcer: 'agent-panel-intervention-slot', announced: true, rendered: undefined }))
      .toThrow(/agent-panel-intervention-slot announced a pending confirmation/)
  })

  // 阳性对照的另一半：这把尺子也必须量得出「没问题」，否则它恒红 = 没有信息。
  it('画出来了、或者本来就没有要确认的东西 → 不抛', () => {
    expect(() => assertAnnouncedCardRendered({ announcer: 'x', announced: true, rendered: card })).not.toThrow()
    expect(() => assertAnnouncedCardRendered({ announcer: 'x', announced: false, rendered: undefined })).not.toThrow()
  })

  it('那张会说话的卡本身算「画出来了」——它正是这一族该有的出口', () => {
    const loud = missingInterventionCard({ reason: 'host-unreachable', announcer: 'x', detail: 'd' }, t)
    expect(() => assertAnnouncedCardRendered({ announcer: 'x', announced: true, rendered: loud })).not.toThrow()
  })
})

/**
 * ③ 真实读通道那一半：主进程拒绝这次读取时，断在哪一环。
 *
 * 这是「读不到 ≠ 没有」落到代码上的那一行——认不出的错也必须归到某一句话，
 * 一旦这里回了空，沉默就又长回来了。
 */
describe('③ 把主进程的拒绝翻成一句说得出口的话', () => {
  it('能力核没装起来 → 「付费确认这条通道没装起来」', () => {
    expect(missingCardReasonOfReadFailure(new Error('spend_confirm_surface_unavailable'))).toBe('spend-surface-unavailable')
    expect(missingCardReasonOfReadFailure(new Error('Pending spend confirmations cannot be read: the capability core failed to install (boom)')))
      .toBe('spend-surface-unavailable')
  })

  it('其余一律「读不到主进程那份清单」——包括认不出的错，**不回空**', () => {
    expect(missingCardReasonOfReadFailure(new Error('Error invoking remote method'))).toBe('host-unreachable')
    expect(missingCardReasonOfReadFailure('a bare string')).toBe('host-unreachable')
    expect(missingCardReasonOfReadFailure(undefined)).toBe('host-unreachable')
    expect(missingCardReasonOfReadFailure(null)).toBe('host-unreachable')
  })

  it('每一个返回值都是登记在案的 reason（不会翻出一句没有译文的话）', () => {
    for (const error of [new Error('spend_confirm_surface_unavailable'), new Error('x'), 'y', 0]) {
      expect(MISSING_CARD_REASONS).toContain(missingCardReasonOfReadFailure(error))
    }
  })
})
