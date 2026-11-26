// 「服务商原话」只认有来源证据的话（2026-10-27 用户拍板：docs/engineering/direction-checks/2026-10-27-vendor-quote-provenance.md）。
//
// 类边界是「服务商这次到底回没回话」，不是哪一种网络错误。把失败带过 IPC 的两个生产者——vendorHttp（画布生成、取回查询）、
// modelCallFailure（文本任务；Agent 车道的 HTTP 失败也经它铸载荷，原先给 pi 运行时的 describeRuntimeError 没有生产调用者，已删）——
// 在服务商没回话时（连不上 / 超时 / 流中途断了）也把本机的话写进 structured.upstreamMsg，字段名不是证据；载荷里的 httpStatus / logicalCode（服务商回了话才有）才是。
// 所以这里一律用**真生产者**造错误、不手拼载荷：哪天新长出一个不带回话证据的生产者分支，这张表照样接住它。
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { classifyGenerationError } from './classifyError'
import { providerFailureIsUnclassified, providerFailureText, takeUnclassifiedProviderFailures } from '../ai/lane/laneCommandFailure'
import { decideGenerationFailure, formatTaskFailureMessage } from '../../../electron/shared/generationFailure'
import { encodeVendorErrorMessage, requestJson, VendorRequestError } from '../../../electron/vendor/vendorHttp'
import { describeAgentError } from '../../../electron/ai/agentError'
import { modelCallFailure } from '../../../electron/ai/runtimeVendorError'
import { tagNomiError } from '../../../electron/shared/nomiErrorCodes'
import { desktopT } from '../../../electron/i18n'
import type { Vendor } from '../../../electron/catalog/types'

const vendor = { key: 'relay', authType: 'bearer', baseUrlHint: 'https://fixture.invalid' } as unknown as Vendor
const SUBMIT_URL = 'https://fixture.invalid/v1/images/generations'
const QUERY_URL = 'https://fixture.invalid/v1/tasks/task-1'

afterEach(async () => {
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
      return { message: formatTaskFailureMessage(said, { taskId: 'task_01ABC', kind: 'text_to_image' }, 'zh-CN'), said }
    }],
  ]

  it.each(cases)('%s', async (_label, build) => {
    const { message, said } = await build()
    expect(classifyGenerationError(message).providerMessage).toBe(said)
  })
})

describe('服务商回复里的诊断和业务说明', () => {
  const page = '<!DOCTYPE html><html><body>Sign in</body></html>'

  it('401 网页经过模型调用和 Agent 文案投影，只显示鉴权原因', () => {
    const message = describeAgentError(modelCallFailure({ vendorKey: 'relay',
      attempt: { kind: 'http', status: 401, url: SUBMIT_URL, body: page } }))
    const report = classifyGenerationError(message)
    const shown = providerFailureText(message, (key, params) => i18n.t(key, params))
    expect(report.kind).toBe('auth')
    expect.soft(report.providerMessage).toBeUndefined()
    expect.soft(shown).toBe(report.reason)
    expect(shown).not.toContain('<')
  })

  it.each([
    ['zh-CN', '官方算力限制，请稍后再试', page],
    ['en', 'Daily quota exceeded for this model', 'ServiceUnavailableError'],
  ] as const)('%s 已存的 503 保留业务原话，隐藏技术报文', async (locale, business, diagnostic) => {
    await i18n.changeLanguage(locale)
    const reports = [business, diagnostic].map(upstreamMsg => classifyGenerationError(overIpc(
      new VendorRequestError(upstreamMsg, { vendorKey: 'relay', method: 'POST', url: SUBMIT_URL,
        httpStatus: 503, category: 'server', retryable: true, upstreamMsg }))))
    expect(reports.map(report => report.kind)).toEqual(['server', 'server'])
    expect(reports[1].raw).toContain(diagnostic)
    expect(reports.map(report => report.providerMessage)).toEqual([business, undefined])
  })

  it.each([
    ['zh-CN', '本模型仅支持方图', '<b>仅支持方图</b>'],
    ['en', 'This model only supports square images.', 'RenderPipelineException'],
  ] as const)('%s 未知分类只让同语种业务句当标题', async (locale, business, diagnostic) => {
    await i18n.changeLanguage(locale)
    const reportForTask = (said: string) => classifyGenerationError(formatTaskFailureMessage(said, { taskId: 't-1' }, locale))
    expect(reportForTask(business).reason).toBe(business)
    const report = reportForTask(diagnostic)
    expect(report.kind).toBe('unknown')
    expect(report.providerMessage).toBeUndefined()
    expect(report.reason).toBe(i18n.t('generationCommon.observability.error.unknown.reason'))
  })

  it.each([
    ['inline HTML', 'Upstream reply: <title>Gateway</title>'],
    ['HTML attribute', '<section class="gateway">'],
    ['paired tags', '<strong>Unavailable</strong>'],
    ['HTML break', 'Upstream reply:<br/>Unavailable'],
    ['truncated JSON', '{"error":{"message":"Overloaded"'],
    ['JSON member', '"detail":"Temporarily offline"}'],
    ['array', '[{"status":503}]'],
    ['nested class', JSON.stringify({ error: { message: 'RenderPipelineException' } })],
    ['HTTP template', 'HTTP 503: provider returned no usable error message. Next: retry.'],
  ])('%s 不进入服务商原话', (_shape, diagnostic) => {
    const message = formatTaskFailureMessage(diagnostic, { taskId: 't-1' }, 'zh-CN')
    expect(classifyGenerationError(message).providerMessage).toBeUndefined()
  })

  it.each(['ServiceUnavailableError', 'Service Unavailable', '503 Service Unavailable', 'Bad Gateway', 'Gateway Timeout'])('没有状态码也没有瞬时标记的 %s 按服务端失败处理', message => {
    const decision = decideGenerationFailure({ message, locale: 'en', transient: false })
    expect(decision).toMatchObject({ kind: 'server', reason: { key: 'generationCommon.observability.error.server.reason' }, raw: message })
    expect(decision.providerMessage).toBeUndefined()
  })

  it.each(['RenderPipelineException', 'RENDER_BACKEND_FAULT', 'com.vendor.RenderPipelineException',
    'io.grpc.StatusRuntimeException', '{"code":500}', 'TypeError: Failed to render\n  at render (worker.js:4:2)'])('无来源的 %s 只留在技术详情', message => {
    const decision = decideGenerationFailure({ message, locale: 'en' })
    expect(decision).toMatchObject({ kind: 'unknown', reason: { key: 'generationCommon.observability.error.unknown.reason' }, raw: message })
  })
})

describe('审查回归：业务动作、技术详情和 Agent 未分类日志', () => {
  const ratio = 'Invalid value for "aspect_ratio": choose 16:9 or 9:16.'
  const stack = 'TypeError: Failed to render\n  at render (worker.js:4:2)'

  it.each([
    ...['image', 'video', 'prompt'].map(field => {
      const text = `Replace <${field}> with an uploaded image before generating.`
      return [text, text]
    }),
    [JSON.stringify({ error: { message: ratio } }), ratio],
  ])('HTTP 400 在画布和 Agent 保留具体改法 %s', (body, said) => {
    const message = describeAgentError(modelCallFailure({ vendorKey: 'relay',
      attempt: { kind: 'http', status: 400, body, url: SUBMIT_URL } }))
    expect(classifyGenerationError(message)).toMatchObject({ kind: 'input', providerMessage: said })
    expect(providerFailureText(message, (key, params) => i18n.t(key, params))).toContain(said)
  })

  it('旧节点保留服务地区限制和下一步', () => {
    const message = 'Service unavailable in your region. Select a different region.'
    expect(decideGenerationFailure({ message, locale: 'en' })).toMatchObject({ kind: 'unknown', reason: { text: message } })
  })

  it.each([stack, stack.replace(/\s+/g, ' '), 'com.vendor.RenderPipelineException'])(
    'HTTP 503 将 %s 留在技术详情', diagnostic => {
      const message = describeAgentError(modelCallFailure({ vendorKey: 'relay',
        attempt: { kind: 'http', status: 503, body: JSON.stringify({ error: { message: diagnostic } }), url: SUBMIT_URL } }))
      const report = classifyGenerationError(message)
      expect(report.kind).toBe('server')
      expect(report.raw).toContain(diagnostic)
      expect.soft(report.providerMessage).toBeUndefined()
      expect(providerFailureText(message, (key, params) => i18n.t(key, params))).toBe(report.reason)
    })

  it.each(['zh-CN', 'en'])('%s 未知技术行使用 Agent 原兜底，每个条目只记一次', async locale => {
    await i18n.changeLanguage(locale)
    const messages = ['unknown_model_identity', 'not_node_not_found_extra', 'asset_not_localized', '{"code":500}']
    for (const raw of messages) {
      expect.soft(providerFailureIsUnclassified(raw)).toBe(true)
      expect.soft(providerFailureText(raw, (key, params) => i18n.t(key, params))).toBe(i18n.t('agentResident.providerUnknownError'))
    }
    const items = messages.map(raw => ({ kind: 'error', identity: raw, raw }))
    const seen = new Set<string>()
    expect(takeUnclassifiedProviderFailures(items, seen)).toEqual(messages)
    expect(takeUnclassifiedProviderFailures(items, seen)).toEqual([])
  })
})
