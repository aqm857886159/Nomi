import { describe, expect, it } from 'vitest'
import { formatCustomCallDiagnosticContext, parseCustomCallTestParams } from './customCallDiagnostics'

describe('custom call diagnostic context', () => {
  it('把真实请求和响应一起交给修复 AI，而不是只给一句空产出', () => {
    const context = formatCustomCallDiagnosticContext({
      errorMessage: '没有返回产物',
      transcript: [{
        method: 'POST',
        url: 'https://relay.example/create',
        status: 'ok',
        durationMs: 42,
        requestPreview: '{"prompt":"p"}',
        responsePreview: '{"data":{"job_id":"j-1"}}',
      }],
    })
    expect(context).toContain('没有返回产物')
    expect(context).toContain('POST https://relay.example/create')
    expect(context).toContain('{"prompt":"p"}')
    expect(context).toContain('{"data":{"job_id":"j-1"}}')
  })
})

describe('custom call test params parser', () => {
  it('空白等于不覆盖，JSON 对象保留模式专属参数', () => {
    expect(parseCustomCallTestParams('')).toEqual({})
    expect(parseCustomCallTestParams('{"first_frame_url":"https://cdn/f.png","reference_image_urls":["a","b"]}')).toEqual({
      first_frame_url: 'https://cdn/f.png',
      reference_image_urls: ['a', 'b'],
    })
  })

  it('数组和坏 JSON 在发请求前报错', () => {
    expect(() => parseCustomCallTestParams('[]')).toThrow(/JSON 对象/)
    expect(() => parseCustomCallTestParams('{bad')).toThrow(/JSON/)
  })
})
