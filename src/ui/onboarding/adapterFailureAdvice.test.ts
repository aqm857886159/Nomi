import { describe, expect, it } from 'vitest'
import { adapterFailureAdvice } from './adapterFailureAdvice'

describe('adapterFailureAdvice', () => {
  // 密钥被拒 → 让他换密钥。给「改地址」是误导：地址对着呢。
  it('sends auth failures to the key, not the address', () => {
    expect(adapterFailureAdvice({ errorCategory: 'auth', httpStatus: 401 })).toEqual({ reasonKey: 'auth', action: 'fixKey' })
  })

  // 404/405 不在 vendorHttp 的 category 查表里（会落 unknown），但它是最常见的一种失败：
  // 地址少写/多写一段（用户接 DeepSeek 时就是漏了 /v1）。用状态码判定，仍是确定性的。
  it('treats 404/405 as a wrong address even though category cannot classify them', () => {
    expect(adapterFailureAdvice({ httpStatus: 404 })).toEqual({ reasonKey: 'notFound', action: 'fixUrl' })
    expect(adapterFailureAdvice({ httpStatus: 405, errorCategory: 'unknown' })).toEqual({ reasonKey: 'notFound', action: 'fixUrl' })
  })

  // 限流是暂时的 —— 催他改配置反而害他把本来对的东西改坏。
  it('tells the user to just retry on rate limits', () => {
    expect(adapterFailureAdvice({ errorCategory: 'quota', httpStatus: 429 }).action).toBe('retry')
  })

  it('tells the user to top up on balance failures', () => {
    expect(adapterFailureAdvice({ errorCategory: 'balance', httpStatus: 402 }).action).toBe('topUp')
  })

  // 参数被拒 = 我们猜的请求形状不合这家口味。改地址/改密钥都没用，只有自己接才走得通。
  it('routes rejected-parameter failures to the escape hatch, not to more config fiddling', () => {
    expect(adapterFailureAdvice({ errorCategory: 'input', httpStatus: 400 })).toEqual({ reasonKey: 'input', action: 'selfConnect' })
  })

  // 对方服务器 5xx 与用户无关，让他等。
  it('does not blame the user for upstream 5xx', () => {
    expect(adapterFailureAdvice({ errorCategory: 'server', httpStatus: 503 }).action).toBe('retry')
  })

  it('keeps a transport timeout distinct and offers a retry instead of configuration changes', () => {
    expect(adapterFailureAdvice({ errorCategory: 'timeout' })).toEqual({ reasonKey: 'network', action: 'retry' })
  })

  // 编译失败 = 我们没读懂这家文档，跟用户配置无关；先于状态码判断，别让他改地址瞎试。
  it('offers the escape hatch when compilation failed, regardless of status', () => {
    expect(adapterFailureAdvice({ stage: 'compile' })).toEqual({ reasonKey: 'compile', action: 'selfConnect' })
    expect(adapterFailureAdvice({ stage: 'compile', httpStatus: 404 }).reasonKey).toBe('compile')
  })

  // 「这个 kind 没有通用协议」（当前只有 3D）与「我们没读懂这家文档」都落在 compile 这个 stage 上，
  // 但给用户的话完全不同：前者要告诉他这条路本来就不通、该走哪条真的走得通的路。分辨靠生产者带来的
  // 结构化原因，不是 error 文案里的关键词——那正是本文件头注释明令禁止的反模式。
  it('separates “this kind has no generic protocol” from “we could not read the docs”', () => {
    expect(adapterFailureAdvice({ stage: 'compile', compileFailureReason: 'no_generic_contract' }))
      .toEqual({ reasonKey: 'noGenericContract', action: 'selfConnect' })
    expect(adapterFailureAdvice({ stage: 'compile', compileFailureReason: 'docs_not_understood' }).reasonKey)
      .toBe('compile')
  })

  // 这一条守的是「别再退回关键词匹配」：原始英文报错原样喂进来也不许改变归类。
  it('ignores the raw English error prose entirely — classification comes from the structured reason', () => {
    const rawProse = 'No safe generic contract exists for this model kind; configure a manual call script'
    expect(adapterFailureAdvice({ stage: 'compile', errorCategory: rawProse }).reasonKey).toBe('compile')
  })

  // 不认得就别装懂 —— 落 unknown 并给最通用的出路，而不是随便挑一个像的原因。
  it('admits it does not understand rather than guessing a plausible reason', () => {
    expect(adapterFailureAdvice({})).toEqual({ reasonKey: 'unknown', action: 'selfConnect' })
    expect(adapterFailureAdvice({ errorCategory: 'weird-new-thing' }).reasonKey).toBe('unknown')
  })
})
