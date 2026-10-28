import { describe, expect, it } from 'vitest'
import { resources } from '../../i18n/resources'
import { ERROR_KEY_BY_KIND, narrateGenerationError } from './narrate'

/**
 * 失败文案不谈钱：现在生成都走中转站，扣没扣钱 Nomi 不知道，界面只说事实（比如「请求还没发出去」）和下一步。
 *
 * 2026-09-30：模型已下线那条错误卡写着「这次失败不计费」——证据只有一家供应商回的 `credits_cost: 0`。
 * 2026-10-02 用户拍板收紧到底：连「请求根本没出门」那几类（出站策略拦下、素材上传失败、素材本机检查不过）
 * 也不再写「没有扣费 / nothing was charged」，只说请求还没发出去；失败标题也不再附「未计费」角标。
 *
 * 这里不逐个类别抽样，而是把目录（generationCommon.observability.error）里的**每一条字符串**读出来，两种语言各一遍：
 * 以后任何人往目录里加一句，都要过这一关。
 */
const NO_CHARGE_CLAIM = /不计费|未计费|不扣费|没有扣费|没扣费|未扣费|不扣额度|没花钱|没有花钱|不花钱|不收费|not billed|not charged|no charge|nothing was charged|wasn['’]t charged|was not charged|without charge|never billed|no cost/i

/** 界面不谈钱的更宽一档：连「扣钱 / 钱已经付过 / 再扣一次 / charge again」这类说法也不许出现（只说事实和下一步）。 */
const MONEY_TALK = /扣钱|扣费|再扣|已付|付过|花钱|charged|charge again|charges you|paid for|you already paid/i

type Leaf = { path: string; text: string }
function leaves(node: unknown, path: string[] = []): Leaf[] {
  if (typeof node === 'string') return [{ path: path.join('.'), text: node }]
  if (!node || typeof node !== 'object') return []
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => leaves(value, [...path, key]))
}

const catalog = (language: 'zh-CN' | 'en') => resources[language].translation.generationCommon.observability.error

describe('失败文案目录里不谈钱', () => {
  it('探针活着：这条判据看得见各种「没扣费」的说法', () => {
    for (const text of ['这次没有扣费', '本次未计费', 'nothing was charged', 'Not charged', 'This failure is not billed']) {
      expect(NO_CHARGE_CLAIM.test(text), text).toBe(true)
    }
  })

  it.each(['zh-CN', 'en'] as const)('%s：目录里没有任何一条字符串说「不扣费」（连请求没出门的那几类也不说）', (language) => {
    const offenders = leaves(catalog(language)).filter((leaf) => NO_CHARGE_CLAIM.test(leaf.text)).map((leaf) => `${leaf.path}: ${leaf.text.slice(0, 80)}`)
    expect(offenders).toEqual([])
  })

  it.each(['zh-CN', 'en'] as const)('%s：目录里没有任何谈钱的说法（扣钱 / 扣费 / charged / charge again…）', (language) => {
    const offenders = leaves(catalog(language)).filter((leaf) => MONEY_TALK.test(leaf.text)).map((leaf) => `${leaf.path}: ${leaf.text.slice(0, 80)}`)
    expect(offenders).toEqual([])
  })

  it('探针活着：宽一档的判据看得见「再扣一次钱」「charges you again」', () => {
    for (const text of ['那会再扣一次钱', '钱已经付过', 'that charges you again', 'you already paid for it']) expect(MONEY_TALK.test(text), text).toBe(true)
  })

  it.each(['zh-CN', 'en'] as const)('%s：没出门的那几类改说「请求还没发出去」这个事实', (language) => {
    const fact = language === 'en' ? /never called|Nothing was sent|never left your machine|left your machine/i : /没被请求到|还没发出去|没有离开你的电脑/
    for (const key of ['assetUploadFailed', 'assetInvalid', 'aspectRatioUnsupported', 'outboundBlockedSubmit', 'outboundBlockedCredentialOrigin'] as const) {
      expect(leaves((catalog(language) as Record<string, unknown>)[key]).some((leaf) => fact.test(leaf.text)), `${language}.${key}`).toBe(true)
    }
  })

  it('失败标题（reason）不附任何「未计费」角标', () => {
    for (const kind of Object.keys(ERROR_KEY_BY_KIND) as Array<keyof typeof ERROR_KEY_BY_KIND>) {
      const { reason } = narrateGenerationError(kind)
      expect(reason, kind).not.toMatch(NO_CHARGE_CLAIM)
      expect(reason, kind).not.toContain(' · ')
    }
  })

  it.each(['zh-CN', 'en'] as const)('%s：说明文字里没有没渲染的 Markdown 星号（节点上的说明是纯文本）', (language) => {
    const offenders = leaves(catalog(language)).filter((leaf) => leaf.text.includes('**')).map((leaf) => leaf.path)
    expect(offenders).toEqual([])
  })
})
