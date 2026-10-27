// 「服务商原话」那一行（ProviderMessageNote）的两个读者——失败卡 NodeErrorReport、可找回面板 NodeRecoverableReport——
// 只看分类器给没给 providerMessage，不自己判来源。本机网络失败（服务商没回话）两处都不许出现那一行；服务商真回了话照旧出现。
// 2026-10-27 用户拍板：docs/engineering/direction-checks/2026-10-27-vendor-quote-provenance.md
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import i18n from '../../../i18n'
import { encodeVendorErrorMessage, requestJson, VendorRequestError } from '../../../../electron/vendor/vendorHttp'
import { setSubmitOutboundDepsForTests } from '../../../../electron/vendor/vendorOutboundGuard'
import type { Vendor } from '../../../../electron/catalog/types'
import { NodeErrorReport } from './NodeErrorReport'
import { NodeRecoverableReport } from './NodeRecoverableReport'

const vendor = { key: 'relay', authType: 'bearer', baseUrlHint: 'https://fixture.invalid' } as unknown as Vendor

/** vendorHttp 的真实实现跑一次（fetch 换成剧本），照 taskIpcGuard 编码穿 IPC——节点上存的就是这一串。 */
async function realVendorHttpFailure(method: 'GET' | 'POST', fetchImpl: () => Promise<Response>): Promise<string> {
  setSubmitOutboundDepsForTests({
    resolve: async () => [{ address: '93.184.216.34', family: 4 as const }],
    readEnvironment: async () => ({ syntheticResolver: false, syntheticSample: '' }),
    isApplicationProxyActive: () => false,
  })
  vi.stubGlobal('fetch', vi.fn(fetchImpl))
  try {
    const error = await requestJson(vendor, 'k', method, 'https://fixture.invalid/v1/images/generations', {}, {}, method === 'POST' ? { prompt: 'a cat' } : null)
      .catch((cause: unknown) => cause)
    if (!(error instanceof VendorRequestError)) throw new Error('expected a VendorRequestError')
    return `Error invoking remote method 'nomi:tasks:run': Error: ${encodeVendorErrorMessage(error)}`
  } finally {
    setSubmitOutboundDepsForTests(null)
    vi.unstubAllGlobals()
  }
}

const SAID = '当前分组 default 下对于模型 无可用渠道'
/** 本机网络失败：vendorHttp 连接被重置（服务商没回话）+ 来源不明的老格式裸串（老项目存的 node.error）。 */
let networkFailures: string[] = []
/** 服务商回了话：HTTP 503 + 它自己的话。 */
let vendorFailure = ''

beforeAll(async () => {
  networkFailures = [
    await realVendorHttpFailure('POST', () => Promise.reject(new TypeError('fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) }))),
    'TypeError: fetch failed',
  ]
  vendorFailure = await realVendorHttpFailure('GET', async () => new Response(JSON.stringify({ error: { message: SAID } }), { status: 503 }))
})

afterEach(async () => {
  await i18n.changeLanguage('zh-CN')
})

const readers: Array<[string, (message: string) => string]> = [
  ['失败卡 NodeErrorReport', (message) => renderToStaticMarkup(<NodeErrorReport message={message} meta={{}} onRetry={() => {}} />)],
  ['可找回面板 NodeRecoverableReport', (message) => renderToStaticMarkup(<NodeRecoverableReport node={{ runs: [], error: message }} onRecover={() => {}} onDismiss={() => {}} />)],
]

describe('「服务商原话」只在服务商真回了话时出现（两个读者 × 中英）', () => {
  for (const lang of ['zh-CN', 'en'] as const) {
    for (const [reader, render] of readers) {
      it(`${lang} · ${reader}：本机网络失败不出现「服务商原话」，技术详情照旧在`, async () => {
        await i18n.changeLanguage(lang)
        expect(networkFailures[0]).toContain('ECONNRESET')
        for (const message of networkFailures) {
          const markup = render(message)
          expect(markup).not.toContain(i18n.t('generationCommon.error.providerMessage'))
          expect(markup).toContain(i18n.t('generationCommon.error.technicalDetails'))
        }
      })

      it(`${lang} · ${reader}：服务商回了话（HTTP 503）照旧出现原话`, async () => {
        await i18n.changeLanguage(lang)
        const markup = render(vendorFailure)
        expect(markup).toContain(i18n.t('generationCommon.error.providerMessage'))
        expect(markup).toContain('无可用渠道')
      })
    }
  }
})
