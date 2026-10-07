import { describe, expect, it } from 'vitest'
import { buildTelemetryEnvelope, durationBucket, isAutomatedLaunch, isTelemetryEnvelope, isTelemetryProps, toolCallBucket } from './telemetryEvents'

describe('telemetry event contract', () => {
  it('uses fixed enums and rejects free text or extra fields', () => {
    expect(isTelemetryProps({ featureId: 'generation', result: 'success' }, 'feature.used')).toBe(true)
    expect(isTelemetryProps({ featureId: 'generation', result: 'success', prompt: 'secret' }, 'feature.used')).toBe(false)
    expect(isTelemetryProps({ featureId: 'unknown', result: 'success' }, 'feature.used')).toBe(false)
  })

  it('bucketizes durations and validates the complete envelope', () => {
    expect(durationBucket(0)).toBe('<1s')
    expect(durationBucket(5000)).toBe('1-5s')
    const envelope = buildTelemetryEnvelope({ eventName: 'generation.completed', props: { capability: 'image', durationBucket: '<1s', result: 'success', attemptCountBucket: '1' } }, 'short-session', '1.2.3')
    expect(isTelemetryEnvelope(envelope)).toBe(true)
    expect(isTelemetryEnvelope({ ...envelope, props: { ...envelope.props, prompt: 'secret' } })).toBe(false)
  })

  it('Agent 回合成不成功可以上报，但模型身份只到「种类」', () => {
    expect(isTelemetryProps({ result: 'failure', toolCallBucket: '1-3', modelClass: 'custom' }, 'agent.turn.completed')).toBe(true)
    // 模型 id / 供应商 key 不许当 props：自建中转的 key 由用户自己的 base-url 派生。
    expect(isTelemetryProps({ result: 'failure', toolCallBucket: '1-3', modelClass: 'my-proxy-corp-local' }, 'agent.turn.completed')).toBe(false)
    expect(isTelemetryProps({ result: 'failure', toolCallBucket: '1-3', modelClass: 'custom', model: 'gpt-5.5' }, 'agent.turn.completed')).toBe(false)
    // 工具调用次数只分桶：原数在小样本上就是指纹。
    expect(isTelemetryProps({ result: 'success', toolCallBucket: '7', modelClass: 'builtin' }, 'agent.turn.completed')).toBe(false)
    expect([toolCallBucket(0), toolCallBucket(3), toolCallBucket(4), toolCallBucket(Number.NaN)]).toEqual(['0', '1-3', '4+', '0'])
    const envelope = buildTelemetryEnvelope({ eventName: 'agent.turn.completed', props: { result: 'success', toolCallBucket: '4+', modelClass: 'local' } }, 'short-session', '0.22.0')
    expect(isTelemetryEnvelope(envelope)).toBe(true)
  })

  it('Agent 也是一个可上报的功能面（功能用了哪些）', () => {
    expect(isTelemetryProps({ featureId: 'agent', result: 'success' }, 'feature.used')).toBe(true)
  })
})

describe('生成失败原因与自动化标记（只带类别码，不带内容）', () => {
  const base = { capability: 'video', durationBucket: '>5s', attemptCountBucket: '1' } as const

  it('失败事件可以带 errorType 类别码；成功 / 取消不许带', () => {
    expect(isTelemetryProps({ ...base, result: 'failure', errorType: 'asset-upload-failed' }, 'generation.completed')).toBe(true)
    expect(isTelemetryProps({ ...base, result: 'failure' }, 'generation.completed')).toBe(true)
    expect(isTelemetryProps({ ...base, result: 'success', errorType: 'asset-upload-failed' }, 'generation.completed')).toBe(false)
    expect(isTelemetryProps({ ...base, result: 'cancel', errorType: 'network' }, 'generation.completed')).toBe(false)
  })

  it('errorType 装不下原文、路径、URL、提示词', () => {
    for (const leak of ['C:\Users\me\a.png', 'https://api.example.com/v1?key=sk-1', 'a cat riding a bike', '/Users/me/Nomi/x', 'Error: 402 balance', 'x'.repeat(80), '']) {
      expect(isTelemetryProps({ ...base, result: 'failure', errorType: leak }, 'generation.completed')).toBe(false)
    }
  })

  it('自动化标记来自启动事实（NOMI_E2E=1），真实用户的事件里没有这一格', () => {
    expect(isAutomatedLaunch({ NOMI_E2E: '1' })).toBe(true)
    expect(isAutomatedLaunch({})).toBe(false)
    expect(isAutomatedLaunch({ NOMI_E2E: '0' })).toBe(false)
    const props = { eventName: 'generation.completed', props: { ...base, result: 'success' } } as const
    const auto = buildTelemetryEnvelope(props, 's', '1.2.3', 'zh-CN', 'win32', true)
    const real = buildTelemetryEnvelope(props, 's', '1.2.3', 'zh-CN', 'win32', false)
    expect(auto.systemProps.automated).toBe(true)
    expect('automated' in real.systemProps).toBe(false)
    expect(isTelemetryEnvelope(auto)).toBe(true)
    expect(isTelemetryEnvelope(real)).toBe(true)
    expect(isTelemetryEnvelope({ ...auto, systemProps: { ...auto.systemProps, automated: false } })).toBe(false)
    expect(isTelemetryEnvelope({ ...auto, systemProps: { ...auto.systemProps, user: 'me' } })).toBe(false)
  })
})

describe('更新动作的失败原因（只有枚举）', () => {
  it('失败可带 reason 枚举；成功不许带；旧事件无 reason 仍合法；自由文本被拒', () => {
    expect(isTelemetryProps({ action: 'check', result: 'failure', reason: 'network' }, 'update.action')).toBe(true)
    expect(isTelemetryProps({ action: 'check', result: 'failure', reason: 'parse' }, 'update.action')).toBe(true)
    expect(isTelemetryProps({ action: 'check', result: 'failure' }, 'update.action')).toBe(true)
    expect(isTelemetryProps({ action: 'check', result: 'success', reason: 'network' }, 'update.action')).toBe(false)
    expect(isTelemetryProps({ action: 'check', result: 'failure', reason: 'getaddrinfo ENOTFOUND github.com' }, 'update.action')).toBe(false)
    expect(isTelemetryProps({ action: 'check', result: 'failure', reason: 'not-packaged' }, 'update.action')).toBe(false)
    expect(isTelemetryProps({ action: 'check', result: 'failure', reason: 'other', url: 'x' }, 'update.action')).toBe(false)
  })
})
