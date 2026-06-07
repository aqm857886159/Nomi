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
