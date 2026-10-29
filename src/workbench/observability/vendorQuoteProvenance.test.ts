// 「服务商原话」只认有来源证据的话（2026-10-27 用户拍板：docs/engineering/direction-checks/2026-10-27-vendor-quote-provenance.md）。
//
// 类边界是「服务商这次到底回没回话」，不是哪一种网络错误。把失败带过 IPC 的两个生产者——vendorHttp（画布生成、取回查询）、
// modelCallFailure（文本任务；Agent 车道的 HTTP 失败也经它铸载荷，原先给 pi 运行时的 describeRuntimeError 没有生产调用者，已删）——
// 在服务商没回话时（连不上 / 超时 / 流中途断了）也把本机的话写进 structured.upstreamMsg，字段名不是证据；载荷里的 httpStatus / logicalCode（服务商回了话才有）才是。
// 所以这里一律用**真生产者**造错误、不手拼载荷：哪天新长出一个不带回话证据的生产者分支，这张表照样接住它。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { classifyGenerationError } from './classifyError'
import { formatTaskFailureMessage } from '../generationCanvas/runner/taskFailureMessage'
import { encodeVendorErrorMessage, requestJson, VendorRequestError } from '../../../electron/vendor/vendorHttp'
import { setSubmitOutboundDepsForTests } from '../../../electron/vendor/vendorOutboundGuard'
import { describeAgentError } from '../../../electron/ai/agentError'
import { modelCallFailure } from '../../../electron/ai/runtimeVendorError'
import { tagNomiError } from '../../../electron/shared/nomiErrorCodes'
import { desktopT } from '../../../electron/i18n'
import type { Vendor } from '../../../electron/catalog/types'

const vendor = { key: 'relay', authType: 'bearer', baseUrlHint: 'https://fixture.invalid' } as unknown as Vendor
const SUBMIT_URL = 'https://fixture.invalid/v1/images/generations'
const QUERY_URL = 'https://fixture.invalid/v1/tasks/task-1'

beforeEach(() => {
  // 提交侧出站授权要做 DNS：钉成「公网、无代理」，本文件只测错误怎么带过去（同 vendorHttp.test.ts）。
  setSubmitOutboundDepsForTests({
    resolve: async () => [{ address: '93.184.216.34', family: 4 as const }],
    readEnvironment: async () => ({ syntheticResolver: false, syntheticSample: '' }),
    isApplicationProxyActive: () => false,
  })
})
afterEach(async () => {
  setSubmitOutboundDepsForTests(null)
  vi.stubEnv('NOMI_VENDOR_HTTP_TIMEOUT_MS', undefined)
  vi.useRealTimers()
  vi.unstubAllGlobals()
  await i18n.changeLanguage('zh-CN')
})

/** vendorHttp 的真实实现，只把 fetch 换成剧本；拿回它抛出的 VendorRequestError。 */
async function vendorHttpError(method: 'GET' | 'POST', url: string, fetchImpl: () => Promise<Response>): Promise<VendorRequestError> {
  vi.stubGlobal('fetch', vi.fn(fetchImpl))
  const error = await requestJson(vendor, 'k', method, url, {}, {}, method === 'POST' ? { prompt: 'a cat' } : null).catch((cause: unknown) => cause)
  if (!(error instanceof VendorRequestError)) throw new Error(`expected a VendorRequestError, got ${String(error)}`)
  return error
}

/** 照 taskIpcGuard 那样编码、经 Electron IPC 外壳到渲染层（节点上存的就是这一串）。 */
const overIpc = (error: VendorRequestError): string => `Error invoking remote method 'nomi:tasks:run': Error: ${encodeVendorErrorMessage(error)}`

/** 取回阶段出口（taskResultQuery.retrievalStageError）对 VendorRequestError 的包法：换上阶段码，原样带着同一份 structured。 */
const retrievalWrapped = (error: VendorRequestError): VendorRequestError =>
  new VendorRequestError(tagNomiError('retrieval-query', `${desktopT('tasks.retrievalStage.query')}${error.message}`), error.structured)

const connectionReset = () => Promise.reject(new TypeError('fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) }))

describe('服务商没回话：各通道写进 upstreamMsg 的本机的话都不进「服务商原话」', () => {
  const cases: Array<[string, () => Promise<{ message: string; local: string }>]> = [
    ['vendorHttp 提交连不上（fetch failed）', async () => {
      const error = await vendorHttpError('POST', SUBMIT_URL, () => Promise.reject(new TypeError('fetch failed')))
      return { message: overIpc(error), local: 'fetch failed' }
    }],
    ['vendorHttp 提交时连接被重置（ECONNRESET）', async () => {
      const error = await vendorHttpError('POST', SUBMIT_URL, connectionReset)
      return { message: overIpc(error), local: 'ECONNRESET' }
    }],
    ['vendorHttp 等响应超时', async () => {
      const error = await vendorHttpError('POST', SUBMIT_URL, () => Promise.reject(new DOMException('Provider response timeout', 'TimeoutError')))
      return { message: overIpc(error), local: '请求超时' }
    }],
    ['vendorHttp 读响应体超时（timeout 类别）', async () => {
      vi.useFakeTimers()
      vi.stubEnv('NOMI_VENDOR_HTTP_TIMEOUT_MS', '10')
      vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ pull: () => new Promise(() => {}) }))))
      const pending = requestJson(vendor, 'k', 'GET', QUERY_URL, {}, {}, null).catch((cause: unknown) => cause)
      await vi.advanceTimersByTimeAsync(11)
      const error = await pending
      if (!(error instanceof VendorRequestError)) throw new Error('expected a VendorRequestError')
      return { message: overIpc(error), local: '读取响应超时' }
    }],
    ['取回阶段查询连不上（出口换码后仍带着同一份 structured）', async () => {
      const error = await vendorHttpError('GET', QUERY_URL, connectionReset)
      return { message: overIpc(retrievalWrapped(error)), local: 'ECONNRESET' }
    }],
    ['文本任务 / Agent：连接层抛错', async () => ({
      message: describeAgentError(modelCallFailure({ vendorKey: 'relay', attempt: { kind: 'thrown', reason: 'fetch failed: connect ECONNREFUSED 127.0.0.1:443' } })),
      local: 'ECONNREFUSED',
    })],
    ['Agent 车道：拿到 2xx 后流中途断了（我们自己的话）', async () => ({
      message: describeAgentError(modelCallFailure({ vendorKey: 'provider', attempt: { kind: 'response', status: 200, bodyBroken: true } })),
      local: desktopT('textTask.streamCut'),
    })],
  ]

  it.each(cases)('%s', async (_label, build) => {
    const { message, local } = await build()
    const report = classifyGenerationError(message)
    expect(report.providerMessage).toBeUndefined()
    expect(report.kind === 'network' || report.kind === 'retrieval-incomplete').toBe(true)
    // 原文一个字都没丢：技术详情（raw）里照样有本机那句。
    expect(report.raw).toContain(local)
  })

  it('英文界面同理', async () => {
    await i18n.changeLanguage('en')
    const error = await vendorHttpError('POST', SUBMIT_URL, connectionReset)
    const report = classifyGenerationError(overIpc(error))
    expect(report.kind).toBe('network')
    expect(report.providerMessage).toBeUndefined()
  })
})

describe('服务商回了话：原话照旧进「服务商原话」（反例，修完不许丢）', () => {
  const QUOTE = '官方算力限制，请等待一段时间后再进行使用'
  const cases: Array<[string, () => Promise<{ message: string; said: string }>]> = [
    ['vendorHttp 回 HTTP 429 + {"error":{"message"}}', async () => {
      const error = await vendorHttpError('POST', SUBMIT_URL, async () => new Response(JSON.stringify({ error: { message: QUOTE } }), { status: 429 }))
      return { message: overIpc(error), said: QUOTE }
    }],
    ['vendorHttp 回 200 + 错误码信封（logicalCode）', async () => {
      const said = '标准模型API仅限企业级-共享API Key调用'
      const error = await vendorHttpError('POST', SUBMIT_URL, async () => new Response(JSON.stringify({ errorCode: 1014, errorMessage: said }), { status: 200 }))
      return { message: overIpc(error), said }
    }],
    ['取回阶段：中转回 503「无可用渠道」', async () => {
      const said = '当前分组 default 下对于模型 无可用渠道'
      const error = await vendorHttpError('GET', QUERY_URL, async () => new Response(JSON.stringify({ error: { message: said } }), { status: 503 }))
      return { message: overIpc(retrievalWrapped(error)), said }
    }],
    ['文本任务 / Agent：服务商回 HTTP 429', async () => ({
      message: describeAgentError(modelCallFailure({ vendorKey: 'relay', attempt: { kind: 'http', status: 429, body: JSON.stringify({ error: { message: QUOTE } }), url: 'https://fixture.invalid/v1/chat/completions' } })),
      said: QUOTE,
    })],
    ['Agent 车道：服务商回 HTTP 503', async () => ({
      message: describeAgentError(modelCallFailure({ vendorKey: 'provider', attempt: { kind: 'http', status: 503, body: JSON.stringify({ error: { message: QUOTE } }), url: 'https://fixture.invalid/v1/chat/completions' } })),
      said: QUOTE,
    })],
    ['异步任务失败格式（只由我们产出，前半句是服务商的话）', async () => {
      const said = 'The render farm returned an unrecognised state after the third checkpoint.'
      return { message: formatTaskFailureMessage(said, { taskId: 'task_01ABC', kind: 'text_to_image' }), said }
    }],
  ]

  it.each(cases)('%s', async (_label, build) => {
    const { message, said } = await build()
    expect(classifyGenerationError(message).providerMessage).toBe(said)
  })
})
