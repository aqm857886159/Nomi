import { describe, expect, it } from 'vitest'
import { classifyGenerationError } from './generationRunController'

describe('classifyGenerationError — 已知分类', () => {
  it('API Key 无效', () => {
    const r = classifyGenerationError('Error: 401 Unauthorized — invalid api key')
    expect(r.reason).toBe('API Key 无效')
    expect(r.hint).toMatch(/API Key/)
  })

  it('配额或限流', () => {
    const r = classifyGenerationError('429 Too Many Requests: rate limit exceeded')
    expect(r.reason).toBe('配额或限流')
  })

  it('网络超时', () => {
    const r = classifyGenerationError('request failed: ETIMEDOUT')
    expect(r.reason).toBe('网络超时')
  })

  it('余额不足（中文）与限流区分开', () => {
    const r = classifyGenerationError('Provider request failed (code 402) at kie: 余额不足，请充值')
    expect(r.reason).toBe('余额不足')
    expect(r.hint).toMatch(/充值/)
  })

  it('余额不足（英文 balance）', () => {
    const r = classifyGenerationError('insufficient balance to perform this request')
    expect(r.reason).toBe('余额不足')
  })

  it('OpenAI insufficient_quota 仍归配额（不误判余额）', () => {
    const r = classifyGenerationError('You exceeded your current quota: insufficient_quota')
    expect(r.reason).toBe('配额或限流')
  })

  it('轮询超时归「生成超时」而非「网络超时」', () => {
    const r = classifyGenerationError('模型任务轮询超时: task-abc123')
    expect(r.reason).toBe('生成超时')
    expect(r.hint).not.toMatch(/网络/)
  })

  it('模型未开通(火山 404,真实 structured IPC 形态):不当成「服务商临时故障」,指向控制台开通', () => {
    const upstreamMsg =
      'Your account 2126482930 has not activated the model doubao-seedream-4-5-251128. Please activate the model service in the Ark Console.'
    const message =
      "Error invoking remote method 'nomi:tasks:run': Error: NOMI_VENDOR_ERR_B64::" +
      Buffer.from(JSON.stringify({ category: 'unknown', httpStatus: 404, upstreamMsg, vendorKey: 'volcengine' }), 'utf8').toString('base64') +
      ":: Provider request failed (HTTP 404) at volcengine POST https://ark.cn-beijing.volces.com/api/v3/images/generations: " + upstreamMsg
    const r = classifyGenerationError(message)
    expect(r.reason).toBe('模型未开通')
    expect(r.hint).toMatch(/开通/)
    expect(r.hint).not.toMatch(/临时故障/)
    expect(r.providerMessage).toMatch(/has not activated/)
  })

  it('模型未开通(无 structured 的纯文本兜底)也能识别 reason', () => {
    const r = classifyGenerationError(
      'Provider request failed (HTTP 404) at volcengine POST https://x: 该模型未开通,请到 Ark 控制台开通管理激活',
    )
    expect(r.reason).toBe('模型未开通')
  })

  it('模型未开通即便上游标 403(被状态码派生成 auth):文本判定压过,不误导查密钥', () => {
    const raw = classifyGenerationError(
      "NOMI_VENDOR_ERR_B64::" +
        Buffer.from(JSON.stringify({ category: 'auth', upstreamMsg: '该模型未开通,请到控制台开通管理激活该模型' }), 'utf8').toString('base64') +
        ":: Provider request failed (HTTP 403) at volcengine POST https://x: 该模型未开通,请到控制台开通管理激活该模型",
    )
    expect(raw.reason).toBe('模型未开通')
    expect(raw.hint).not.toMatch(/API Key/)
  })

  it('剪贴板网页媒体下载失败时优先提示下载到本地', () => {
    const r = classifyGenerationError('网页媒体下载失败：该站点可能禁止跨域请求或开启防盗链。请先下载到本地，再复制或拖入画布。')
    expect(r.reason).toBe('网页媒体下载失败')
    expect(r.hint).toMatch(/下载到本地/)
    expect(r.hint).toMatch(/防盗链/)
  })
})

describe('classifyGenerationError — 未识别兜底（方案 B 改进）', () => {
  it('从 JSON error.message 抠可读首行当 reason，并给兜底 hint', () => {
    const raw = JSON.stringify({ error: { message: 'model is overloaded, try again' } })
    const r = classifyGenerationError(raw)
    expect(r.reason).toBe('model is overloaded, try again')
    expect(r.hint).not.toBe('')
    expect(r.raw).toBe(raw)
  })

  it('从顶层 message 抠', () => {
    const r = classifyGenerationError(JSON.stringify({ message: 'something odd happened' }))
    expect(r.reason).toBe('something odd happened')
  })

  it('纯文本取第一行非空并截断', () => {
    const r = classifyGenerationError('\n  weird provider failure line one  \nstack frame 2\nstack frame 3')
    expect(r.reason).toBe('weird provider failure line one')
  })

  it('超长首行截断到 100 字带省略号', () => {
    const long = 'x'.repeat(300)
    const r = classifyGenerationError(long)
    expect(r.reason.length).toBeLessThanOrEqual(100)
    expect(r.reason.endsWith('…')).toBe(true)
  })

  it('空 raw 退回「生成失败」但仍带兜底 hint', () => {
    const r = classifyGenerationError('')
    expect(r.reason).toBe('生成失败')
    expect(r.hint).not.toBe('')
  })
})

describe('structured 路径(S4-2:VendorRequestError 经 IPC 标记穿透)', () => {
  const encode = (structured: Record<string, unknown>, tail = 'Provider request failed (code 402) at kie POST https://x: 余额不足') =>
    `Error invoking remote method 'nomi:tasks:run': Error: NOMI_VENDOR_ERR_B64::${Buffer.from(JSON.stringify(structured), 'utf8').toString('base64')}:: ${tail}`

  it('balance 类别直读 structured,不靠正则;raw 剥掉标记段', () => {
    const r = classifyGenerationError(encode({ category: 'balance', upstreamMsg: '余额不足', vendorKey: 'kie' }))
    expect(r.reason).toBe('余额不足')
    expect(r.raw).not.toContain('NOMI_VENDOR_ERR_B64')
    expect(r.raw).toContain('余额不足')
  })

  it('中文 upstreamMsg 的 base64 roundtrip 不乱码', () => {
    const r = classifyGenerationError(encode({ category: 'quota', upstreamMsg: '触发限流·稍后再试' }))
    expect(r.reason).toBe('配额或限流')
  })

  it('未知类别退回 legacy 正则路径', () => {
    const r = classifyGenerationError(encode({ category: 'weird-new-thing' }, 'something 401 unauthorized'))
    expect(r.reason).toBe('API Key 无效')
  })
})

describe('providerMessage —— 服务商真实原话提到可见区（别埋进折叠的技术详情）', () => {
  const encode = (structured: Record<string, unknown>, tail = 'Provider request failed (code 429) at dm-fox: x') =>
    `Error: NOMI_VENDOR_ERR_B64::${Buffer.from(JSON.stringify(structured), 'utf8').toString('base64')}:: ${tail}`

  it('structured: 分类标题通用，但服务商原话单独可见', () => {
    const r = classifyGenerationError(encode({ category: 'quota', upstreamMsg: '官方算力限制，请等待一段时间后再进行使用' }))
    expect(r.reason).toBe('配额或限流') // 标题仍是"哪一类"
    expect(r.providerMessage).toBe('官方算力限制，请等待一段时间后再进行使用') // 真实原因可见
  })

  it('structured: 原话与分类标题重复时不冗余显示', () => {
    const r = classifyGenerationError(encode({ category: 'balance', upstreamMsg: '余额不足' }))
    expect(r.reason).toBe('余额不足')
    expect(r.providerMessage).toBeUndefined()
  })

  it('structured: 占位「(no detail from provider)」不显示', () => {
    const r = classifyGenerationError(encode({ category: 'server', upstreamMsg: '(no detail from provider)' }))
    expect(r.providerMessage).toBeUndefined()
  })

  it('legacy: 从 raw 抠出的可读原话也提到可见区', () => {
    const r = classifyGenerationError('429 rate limit: 当前模型排队人数过多，请稍后再试')
    expect(r.reason).toBe('配额或限流')
    expect(r.providerMessage).toMatch(/排队人数过多/)
  })

  it('unknown 兜底: reason 本身就是原话，不重复给 providerMessage', () => {
    const r = classifyGenerationError(JSON.stringify({ message: 'something odd happened' }))
    expect(r.reason).toBe('something odd happened')
    expect(r.providerMessage).toBeUndefined()
  })
})
