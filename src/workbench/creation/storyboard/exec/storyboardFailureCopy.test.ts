import { describe, expect, it } from 'vitest'
import { encodeStructuredErrorMessage } from '../../../../../electron/vendor/vendorHttp'
import { tagNomiError } from '../../../../../electron/shared/nomiErrorCodes'
import i18n from '../../../../i18n'
import { classifyGenerationError } from '../../../observability/classifyError'
import { storyboardFailureCopy } from './storyboardFailureCopy'

/** 主进程 canvas-submit 抛出来、穿过 IPC 之后渲染层拿到的那句话（runTaskIpcGuard 的结构化标记）。 */
const ipc = (code: string, reason: string, message: string) => `Error invoking remote method 'nomi:tasks:canvas-submit': Error: ${encodeStructuredErrorMessage({ code, reason }, message)}`

describe('分镜画面格失败态：说原因、说下一步，不再只写「生成失败」（V-1042 第 22 张）', () => {
  it.each(['zh-CN', 'en'])('%s：在本机就被拦下 ⇒ 没发出去，可以直接重试', async (lang) => {
    await i18n.changeLanguage(lang)
    try {
      const copy = storyboardFailureCopy(ipc('submission_not_sent', 'never_reached_network', 'acme connection is disabled, missing, or locked'))
      expect(copy.reason).toBe(i18n.t('generationCommon.observability.error.submissionNotSent.reason'))
      expect(copy.hint.startsWith(i18n.t('generationCommon.observability.error.submissionNotSent.hint')), copy.hint).toBe(true)
      // 「见下方技术详情」在画面格的悬停里也成立：下面真的接着这一次的原因（没有 IPC 外壳）。
      expect(copy.hint).toContain(`${i18n.t('generationCommon.error.technicalDetails')}${lang === 'en' ? ': ' : '：'}acme connection is disabled, missing, or locked`)
      expect(copy.hint).not.toContain('Error invoking remote method')
      expect(copy.canRetry).toBe(true)
      expect(copy.reason).not.toBe(i18n.t('storyboardEditor.frame.failed'))
    } finally {
      await i18n.changeLanguage('zh-CN')
    }
  })

  it('连不上（出网闸在连上之前拒）⇒ 「连不上服务商」那一条，可以重试', () => {
    const copy = storyboardFailureCopy(ipc('submission_not_sent', 'connect_failed', 'Provider request failed (network) at acme POST https://api.apimart.ai: fetch failed'))
    expect(copy.reason).toBe(i18n.t('generationCommon.observability.error.network.reason'))
    expect(copy.canRetry).toBe(true)
  })

  it('更具体的本机拒绝（Nomi 自己的出网策略）保留它自己的说法', () => {
    const message = `Provider request refused by outbound policy at acme POST https://x: ${tagNomiError('outbound-blocked-submit', 'private address')}`
    expect(classifyGenerationError(ipc('submission_not_sent', 'never_reached_network', message)).kind).toBe('outbound-blocked-submit')
  })

  it('结果未知 / 被认领拒成 needs_reconcile ⇒ 说「可能已被收下」，画面格不给重试', () => {
    for (const message of [
      ipc('production_shot_claimed', 'needs_reconcile', 'production_shot_claimed: needs_reconcile'),
      tagNomiError('submission-unknown', 'Provider submission receipt is unknown; reconciliation is required'),
    ]) {
      const copy = storyboardFailureCopy(message)
      expect(copy.canRetry, message).toBe(false)
      expect(copy.reason).not.toBe(i18n.t('storyboardEditor.frame.failed'))
    }
  })
})
