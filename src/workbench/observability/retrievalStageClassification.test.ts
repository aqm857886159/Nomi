// C4（⑬，用户 10-22 拍板 A）：取回阶段的码（retrieval-*）是「任务已提交、这次没取回」——
// 分类器以前不认它们，retrieval-query 落进 unknown，提示「可以重试一次，或换一个模型」，主动作 retry（= 再生成、再扣一次）。
import { afterAll, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { isRetrievalStageCode, NOMI_ERROR_ONLY_BEFORE_SUBMIT, tagNomiError, type NomiErrorCode } from '../../../electron/shared/nomiErrorCodes'
import { classifyGenerationError } from './classifyError'
import { narrateGenerationErrorActions, narrateIsVendorSideFailure } from './narrate'

const RETRIEVAL_INCOMPLETE = { kind: 'retrieval-incomplete', primary: 'view-task', secondary: null } as const
/**
 * 「结果取回」族每个码的分类和按钮。族以 `isRetrievalStageCode` 为准，新增一个码不在这里回答，下面第一条就红。
 * 这张表也是分类器改成按族判时的对账：换之前已有的 5 个码一个都没变，`retrieval-unavailable` 是新加的。
 * 出站被拦有自己的分支（先于族判据），次按钮的「重试」是它原有的；节点上它走可找回面板，碰不到这颗按钮。
 */
const FAMILY: Readonly<Partial<Record<NomiErrorCode, { kind: string; primary: string; secondary: string | null }>>> = {
  'outbound-blocked': { kind: 'outbound-blocked', primary: 'open-model-access', secondary: 'retry' },
  'retrieval-query': RETRIEVAL_INCOMPLETE,
  'retrieval-parse': RETRIEVAL_INCOMPLETE,
  'retrieval-download': RETRIEVAL_INCOMPLETE,
  'retrieval-timeout': RETRIEVAL_INCOMPLETE,
  'retrieval-unavailable': RETRIEVAL_INCOMPLETE,
}
const FAMILY_CODES = (Object.keys(NOMI_ERROR_ONLY_BEFORE_SUBMIT) as NomiErrorCode[]).filter((code) => isRetrievalStageCode(code))
const RETRIEVAL_CODES = FAMILY_CODES.filter((code) => code !== 'outbound-blocked')
/** 提交前那一族的口径 + 「再来一次」的口径：两种语言都不许出现在取回阶段的说明里。 */
const FORBIDDEN = /重试|没发到|没被请求到|没有发出去|重新生成吧|retry|was never sent|try again/i

function withVendorMessage(upstream: string, message: string): string {
  const structured = { vendorKey: 'relay', method: 'GET', httpStatus: 503, upstreamMsg: upstream, category: 'server', retryable: true }
  return `NOMI_VENDOR_ERR_B64::${Buffer.from(JSON.stringify(structured), 'utf8').toString('base64')}:: ${message}`
}

afterAll(async () => { await i18n.changeLanguage('zh-CN') })

describe('取回阶段码 → 「已提交、这次没取回」', () => {
  it('族里每个码都在表里：分类和主按钮逐个钉住，主按钮没有一个是重试', async () => {
    expect([...FAMILY_CODES].sort()).toEqual(Object.keys(FAMILY).sort())
    for (const lang of ['zh-CN', 'en'] as const) {
      await i18n.changeLanguage(lang)
      for (const code of FAMILY_CODES) {
        const report = classifyGenerationError(tagNomiError(code, 'Nomi says something about this task right now'))
        expect({ kind: report.kind, primary: report.primary, secondary: report.secondary }, `${lang} ${code}`).toEqual(FAMILY[code])
        expect(report.primary, `${lang} ${code}`).not.toBe('retry')
        expect(report.vendorSide, `${lang} ${code}`).toBe(false)
      }
    }
  })

  it('问不了那一句提到模型和 Key 也不会被猜成「Key 无效」：判据是码，不是文案', async () => {
    await i18n.changeLanguage('zh-CN')
    const report = classifyGenerationError(tagNomiError('retrieval-unavailable', 'the model or its API key is unavailable right now: invalid api key 401'))
    expect(report.kind).toBe('retrieval-incomplete')
    expect(report.primary).toBe('view-task')
    expect(report.providerMessage).toBeUndefined()
  })

  for (const lang of ['zh-CN', 'en'] as const) {
    for (const code of RETRIEVAL_CODES) {
      it(`${lang} · ${code}：归到 retrieval-incomplete，主 / 次动作都不是再生成，说明里不出「重试 / 没发到」`, async () => {
        await i18n.changeLanguage(lang)
        const report = classifyGenerationError(tagNomiError(code, '取回卡在「查询任务」这一步：socket hang up'))
        expect(report.kind).toBe('retrieval-incomplete')
        expect(report.primary).toBe('view-task')
        expect(report.secondary).not.toBe('retry')
        expect(`${report.reason} ${report.hint}`).not.toMatch(FORBIDDEN)
        expect(report.vendorSide).toBe(false)
      })
    }
  }

  it('服务商真回的原话照旧显示（#1213：503「无可用渠道」要让用户看见）', async () => {
    await i18n.changeLanguage('zh-CN')
    const report = classifyGenerationError(withVendorMessage('当前分组下无可用渠道', tagNomiError('retrieval-query', '取回卡在「查询任务」这一步：Provider request failed (HTTP 503)')))
    expect(report.kind).toBe('retrieval-incomplete')
    expect(report.providerMessage).toContain('无可用渠道')
  })

  it('没有服务商原话时不从正文里抠一句冒充（Nomi 自己拦下的那句不是服务商说的）', async () => {
    await i18n.changeLanguage('zh-CN')
    const report = classifyGenerationError(tagNomiError('retrieval-query', '取回卡在「查询任务」这一步：Nomi 在本机拦下了这次请求（原始码 outbound-blocked-submit）'))
    expect(report.providerMessage).toBeUndefined()
  })

  it('动作表与「是不是服务商那一侧」表都有这一类的答案', () => {
    expect(narrateGenerationErrorActions('retrieval-incomplete')).toEqual({ primary: 'view-task', secondary: null })
    expect(narrateIsVendorSideFailure('retrieval-incomplete')).toBe(false)
  })
})
