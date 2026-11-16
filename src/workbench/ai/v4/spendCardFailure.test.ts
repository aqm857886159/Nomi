// 付费卡上说「没成」的那几句（2026-09-30 第 11 条：失败只给存在的出路；D2 第③步：卡上没有参数了）。
// 用户那一幕：卡改不了，点下去却两次弹「这一步没成……可以改一下再按一次」。D2 之后卡上本来就没有可改的东西，
// 所以「改一下再按」整句退役；交给画布的那一镜没发出去时，原因按 Nomi 自己的语义码说。
import { createInstance } from 'i18next'
import { describe, expect, it } from 'vitest'

import { enAgentPanelV4, zhAgentPanelV4 } from '../../../i18n/locales/agentPanelV4'

import { HAND_OVER_FAILURE_COPY, handOverFailureCopy, spendActionFailureCopy } from './spendCardFailure'

/**
 * 两个产地会回的码：渲染层预检 / 交接（`handOverPrecheck`、`production.hand-over-shots`）与主进程交接 / 派发落定
 * （`canvasHandOver`、`appIntegrationCanvasShot`）。派发失败另会带上任务自己的错误码（开放集合），那些按种类说。
 */
const EMITTED_CODES = [
  'project_not_open', 'canvas_node_missing', 'node_generation_in_flight', 'node_needs_reconcile', 'asset_hosting_denied',
  'asset_hosting_consent_required', 'canvas_consent_failed', 'model_not_selected', 'local_model_on_card', 'director_preview_blocked',
  'reference_required', 'reference_combination_invalid', 'prompt_required', 'anchor_not_frozen', 'upstream_not_ready', 'reference_cycle',
  'provider_rejected', 'provider_not_reached', 'canvas_consent_withdrawn', 'renderer_unavailable', 'canvas_landing_failed',
  'canvas_not_consented', 'canvas_hand_over_failed',
] as const

describe('卡上一下动作没做成时说哪一句', () => {
  it('账本说可能已经发出去 / 调用本身抛了：只说「结果未知、先去核对」', () => {
    expect(spendActionFailureCopy({ ok: false, code: 'failed', message: 'generation_execution_failed', failure: 'provider_unavailable' })).toBe('agentPanelV4.spendActionFailed')
    expect(spendActionFailureCopy(undefined)).toBe('agentPanelV4.spendActionFailed')
  })

  it('卡刚变了（Agent 改了稿 / 节点刚改过 / 重新出价）：没发起，看一眼现在的样子再按', () => {
    expect(spendActionFailureCopy({ ok: false, code: 'failed', message: 'generation_quote_changed' })).toBe('agentPanelV4.spendActionCardChanged')
  })

  it('这一段已经不在卡上：通道守卫回在 message 上、主进程记在 reason 上，两处都认', () => {
    expect(spendActionFailureCopy({ ok: false, code: 'failed', message: 'generation_scope_invalid' })).toBe('agentPanelV4.spendActionShotGone')
    expect(spendActionFailureCopy({ ok: false, code: 'failed', message: 'generation_not_started', reason: 'generation_scope_invalid' })).toBe('agentPanelV4.spendActionShotGone')
    expect(spendActionFailureCopy({ ok: false, code: 'failed', message: 'no pending generation to hand over' })).toBe('agentPanelV4.spendActionShotGone')
  })

  it('项目不在前台 / 生成功能还没起来 / 宿主点名的那几种：各说各的', () => {
    expect(spendActionFailureCopy({ ok: false, code: 'run_not_open' })).toBe('generationCommon.production.canvasLanding.actionFailure.runNotOpen')
    expect(spendActionFailureCopy({ ok: false, code: 'unavailable' })).toBe('generationCommon.production.canvasLanding.actionFailure.coreStarting')
    expect(spendActionFailureCopy({ ok: false, code: 'failed', message: 'generation_not_started', failure: 'provider_unavailable' }))
      .toBe('generationCommon.production.canvasLanding.actionFailure.providerUnavailable')
  })

  it('真实参考上传期间范围变了：沿用确认过期的可见下一步', () => {
    expect(spendActionFailureCopy({ ok: false, code: 'failed', message: 'generation_not_started', reason: 'generation_reference_scope_changed', failure: 'approval_stale' }))
      .toBe('generationCommon.production.canvasLanding.actionFailure.approvalStale')
  })

  it('认不出是哪一种：只说没发出去、再按一次（不许说「改一下」——卡上没有可改的东西）', () => {
    expect(spendActionFailureCopy({ ok: false, code: 'failed', message: 'generation_not_started', failure: 'internal_error' })).toBe('agentPanelV4.spendActionNotStarted')
    expect(spendActionFailureCopy({ ok: false, code: 'failed', message: 'generation_not_started' })).toBe('agentPanelV4.spendActionNotStarted')
  })
})

describe('交给画布的一镜为什么没发出去', () => {
  it('每一个登记过的码都有自己那一句（加码不加句会在这里红）', () => {
    for (const code of EMITTED_CODES) {
      const key = handOverFailureCopy({ kind: 'not_sent', code })
      expect(key, code).not.toBe('agentPanelV4.spendCard.failure.notSentFallback')
    }
  })

  it('这些句子中英两轨都在、不是占位；结果未知那一句不说没发出去', async () => {
    for (const [lng, locale] of [['zh-CN', zhAgentPanelV4], ['en', enAgentPanelV4]] as const) {
      const i18n = createInstance()
      await i18n.init({ lng, resources: { [lng]: { translation: { agentPanelV4: locale } } } })
      for (const [code, key] of Object.entries(HAND_OVER_FAILURE_COPY)) {
        if (!key.startsWith('agentPanelV4.')) continue
        const text = String(i18n.t(key))
        expect(text, `${lng}:${code}`).not.toBe(key)
        expect(text, `${lng}:${code}`).not.toContain('{{')
      }
      const unclear = String(i18n.t('agentPanelV4.spendCard.failure.unclear'))
      // 「没发出去」的说法按键从词典取（占位填空）：结果未知那一句不许借用它们中的任何一句。
      for (const key of ['agentPanelV4.spendCard.failedTitle.notSent', 'agentPanelV4.spendCard.detail.notSent']) {
        const notSent = String(i18n.t(key, { shot: '', shots: '' })).trim()
        expect(notSent, `${lng}:${key}`).not.toBe('')
        expect(unclear.toLowerCase(), `${lng}: 结果未知那一句不说「${notSent}」`).not.toContain(notSent.toLowerCase())
      }
      expect(unclear, lng).not.toMatch(/没有花钱|没扣|not charged|nothing was charged/i)
    }
  })

  it('付费卡没有 ×（底栏是「取消」/「先不发了」）：spend* 文案中英都不许教用户点 ×', () => {
    const offenders: string[] = []
    const walk = (lng: string, prefix: string, value: unknown): void => {
      if (typeof value === 'string') {
        if (/(点|click|close it with|press)\s*×/i.test(value)) offenders.push(`${lng}:${prefix}`)
        return
      }
      if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) walk(lng, `${prefix}.${key}`, child)
    }
    for (const [lng, locale] of [['zh-CN', zhAgentPanelV4], ['en', enAgentPanelV4]] as const) {
      for (const [key, value] of Object.entries(locale)) if (key.startsWith('spend')) walk(lng, key, value)
    }
    expect(offenders).toEqual([])
  })
})
