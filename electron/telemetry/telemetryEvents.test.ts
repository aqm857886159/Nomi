import { describe, expect, it } from 'vitest'
import { buildTelemetryEnvelope, durationBucket, isAutomatedLaunch, isTelemetryEnvelope, isTelemetryProps, TELEMETRY_EVENT_MIN_SCOPE, TELEMETRY_EVENT_NAMES, TELEMETRY_SCOPE_VERSION } from './telemetryEvents'
import { GENERATION_LOCAL_REFUSALS, LAST_EXIT_VALUES, mainStallCountBucket, mainStallMaxBucket, stageDurationBucket } from '../shared/contracts/telemetry'

const genBase = { capability: 'video', durationBucket: '>5s', mode: 'firstLast', modelClass: 'builtin', submitDuration: '1-5s', waitDuration: '30-120s' } as const
const success = { ...genBase, result: 'success', upstreamStatus: 'ok' } as const
const failure = { ...genBase, result: 'failure', upstreamStatus: 'server-5xx', errorType: 'upstream-server', failureStage: 'wait' } as const
const notSent = { ...genBase, result: 'failure', upstreamStatus: 'not-sent', errorType: 'local-refusal', failureStage: 'submit', localRefusal: 'asset-too-large', waitDuration: 'none' } as const
const cancel = { ...genBase, result: 'cancel' } as const
const perf = { interactionP75: '100-200', interactionP95: '200-500', longFramesPerMin: '1-3', longestFrame: '100-250', observedMinutes: '5-30', page: 'generation', nodes: '21-100', imageNodes: '1-20', generating: true, cpuCores: '9-16', memoryGb: '8plus', mainStallMax: '250-1000', mainStallCount: '1-3' }

describe('事件清单（2026-11-13 删掉从没发过的）', () => {
  it('只剩 6 个事件；feature.used / agent.turn.completed 不再合法', () => {
    expect([...TELEMETRY_EVENT_NAMES]).toEqual(['app.started', 'generation.completed', 'export.completed', 'update.action', 'agent.tool.failed', 'perf.session.summary'])
    expect(isTelemetryProps({ featureId: 'generation', result: 'success' }, 'feature.used' as never)).toBe(false)
    expect(isTelemetryProps({ result: 'success', toolCallBucket: '1-3', modelClass: 'builtin' }, 'agent.turn.completed' as never)).toBe(false)
  })

  it('加字段不抬告知范围：版本仍是 2，只有 perf 汇总要 2', () => {
    expect(TELEMETRY_SCOPE_VERSION).toBe(2)
    expect(TELEMETRY_EVENT_MIN_SCOPE['perf.session.summary']).toBe(2)
    for (const name of TELEMETRY_EVENT_NAMES) if (name !== 'perf.session.summary') expect(TELEMETRY_EVENT_MIN_SCOPE[name]).toBe(1)
  })
})

describe('generation.completed：键集合由结果推出、恰好相等', () => {
  it('成功 / 失败 / 没发出去 / 取消四种形状都合法', () => {
    for (const props of [success, failure, notSent, cancel]) expect(isTelemetryProps(props, 'generation.completed'), JSON.stringify(props)).toBe(true)
  })

  it('写死的 attemptCountBucket 删了：带上就拒', () => {
    expect(isTelemetryProps({ ...success, attemptCountBucket: '1' }, 'generation.completed')).toBe(false)
  })

  it('少一格、多一格、值不在表里都拒', () => {
    const { mode: _mode, ...noMode } = success
    expect(isTelemetryProps(noMode, 'generation.completed')).toBe(false)
    expect(isTelemetryProps({ ...success, prompt: 'a cat' }, 'generation.completed')).toBe(false)
    expect(isTelemetryProps({ ...success, mode: 'i2v-pro' }, 'generation.completed')).toBe(false)
    expect(isTelemetryProps({ ...success, modelClass: 'my-proxy-corp-local' }, 'generation.completed')).toBe(false)
    expect(isTelemetryProps({ ...failure, upstreamStatus: 'HTTP 502 Bad Gateway' }, 'generation.completed')).toBe(false)
    expect(isTelemetryProps({ ...failure, failureStage: 'upload' }, 'generation.completed')).toBe(false)
    expect(isTelemetryProps({ ...notSent, localRefusal: 'file too big: /Users/me/a.mp4' }, 'generation.completed')).toBe(false)
  })

  it('成功只许 upstreamStatus=ok；取消不带失败格；失败格只在失败上', () => {
    expect(isTelemetryProps({ ...success, upstreamStatus: 'unknown' }, 'generation.completed')).toBe(false)
    expect(isTelemetryProps({ ...cancel, upstreamStatus: 'ok' }, 'generation.completed')).toBe(false)
    expect(isTelemetryProps({ ...success, errorType: 'network' }, 'generation.completed')).toBe(false)
    expect(isTelemetryProps({ ...success, failureStage: 'wait' }, 'generation.completed')).toBe(false)
  })

  it('localRefusal 只跟 not-sent 走：not-sent 缺它拒，别的状态带它拒', () => {
    const { localRefusal: _r, ...notSentNoRule } = notSent
    expect(isTelemetryProps(notSentNoRule, 'generation.completed')).toBe(false)
    expect(isTelemetryProps({ ...failure, localRefusal: 'uncoded' }, 'generation.completed')).toBe(false)
    for (const rule of GENERATION_LOCAL_REFUSALS) expect(isTelemetryProps({ ...notSent, localRefusal: rule }, 'generation.completed')).toBe(true)
  })

  it('上游答 ok 的失败只可能在取回 / 落地两段', () => {
    expect(isTelemetryProps({ ...failure, upstreamStatus: 'ok', failureStage: 'fetch' }, 'generation.completed')).toBe(true)
    expect(isTelemetryProps({ ...failure, upstreamStatus: 'ok', failureStage: 'land' }, 'generation.completed')).toBe(true)
    expect(isTelemetryProps({ ...failure, upstreamStatus: 'ok', failureStage: 'wait' }, 'generation.completed')).toBe(false)
  })

  it('errorType 装不下原文、路径、URL、提示词', () => {
    for (const leak of ['C:\\Users\\me\\a.png', 'https://api.example.com/v1?key=sk-1', 'a cat riding a bike', '/Users/me/Nomi/x', 'Error: 402 balance', 'x'.repeat(80), '']) {
      expect(isTelemetryProps({ ...failure, errorType: leak }, 'generation.completed')).toBe(false)
    }
  })

  it('阶段耗时分档：没有这一段 = none，负数 / 非数也落 none', () => {
    expect([stageDurationBucket(null), stageDurationBucket(Number.NaN), stageDurationBucket(-5), stageDurationBucket(0), stageDurationBucket(999), stageDurationBucket(1000), stageDurationBucket(30_000), stageDurationBucket(120_000), stageDurationBucket(599_999), stageDurationBucket(600_000)])
      .toEqual(['none', 'none', 'none', 'lt-1s', 'lt-1s', '1-5s', '30-120s', '2-10m', '2-10m', 'gt-10m'])
  })
})

describe('app.started.lastExit 与 perf 汇总的主进程停顿', () => {
  const started = { appMajor: 0, appMinor: 25, osFamily: 'macos', locale: 'zh-CN', lastExit: 'clean' }
  it('lastExit 必填、只许闭合值', () => {
    for (const value of LAST_EXIT_VALUES) expect(isTelemetryProps({ ...started, lastExit: value }, 'app.started')).toBe(true)
    const { lastExit: _l, ...old } = started
    expect(isTelemetryProps(old, 'app.started')).toBe(false)
    expect(isTelemetryProps({ ...started, lastExit: 'EXC_BAD_ACCESS at 0x0' }, 'app.started')).toBe(false)
  })

  it('perf 汇总 = 渲染层白名单 + 主进程两格；缺一格 / 值不在表里拒', () => {
    expect(isTelemetryProps(perf, 'perf.session.summary')).toBe(true)
    const { mainStallMax: _m, ...rendererOnly } = perf
    expect(isTelemetryProps(rendererOnly, 'perf.session.summary')).toBe(false)
    expect(isTelemetryProps({ ...perf, mainStallMax: '1834' }, 'perf.session.summary')).toBe(false)
    expect(isTelemetryProps({ ...perf, gpu: 'x' }, 'perf.session.summary')).toBe(false)
    expect(isTelemetryProps({ ...perf, nodes: '57' }, 'perf.session.summary')).toBe(false)
  })

  it('mainStallCount 只许闭合档：文字、裸数字都拒', () => {
    for (const bad of ['3', 3, 'a cat riding a bike', '/Users/me/a.png', '']) {
      expect(isTelemetryProps({ ...perf, mainStallCount: bad }, 'perf.session.summary')).toBe(false)
    }
  })

  it('submitDuration 只许闭合档：文字、裸数字都拒', () => {
    for (const bad of ['1834', 1834, 'a cat riding a bike', '/Users/me/a.png', '']) {
      expect(isTelemetryProps({ ...success, submitDuration: bad }, 'generation.completed')).toBe(false)
    }
  })

  it('waitDuration 只许闭合档：文字、裸数字都拒', () => {
    for (const bad of ['1834', 1834, 'a cat riding a bike', '/Users/me/a.png', '']) {
      expect(isTelemetryProps({ ...success, waitDuration: bad }, 'generation.completed')).toBe(false)
    }
  })

  it('主进程停顿分档：监视器没在跑 = unknown；0 次 = none / 0', () => {
    expect([mainStallMaxBucket(null), mainStallMaxBucket(0), mainStallMaxBucket(99), mainStallMaxBucket(100), mainStallMaxBucket(250), mainStallMaxBucket(1000), mainStallMaxBucket(4999), mainStallMaxBucket(5000)])
      .toEqual(['unknown', 'none', 'none', '100-250', '250-1000', '1000-5000', '1000-5000', 'gt-5000'])
    expect([mainStallCountBucket(null), mainStallCountBucket(0), mainStallCountBucket(3), mainStallCountBucket(4), mainStallCountBucket(10), mainStallCountBucket(11)])
      .toEqual(['unknown', '0', '1-3', '4-10', '4-10', 'gt-10'])
  })
})

describe('信封：补丁位与自动化标记', () => {
  it('appPatch 从版本号来；没有补丁号的版本记 0', () => {
    const envelope = buildTelemetryEnvelope({ eventName: 'generation.completed', props: success }, 'short-session', '0.25.3')
    expect(envelope.systemProps).toMatchObject({ appMajor: 0, appMinor: 25, appPatch: 3 })
    expect(isTelemetryEnvelope(envelope)).toBe(true)
    expect(buildTelemetryEnvelope({ eventName: 'generation.completed', props: success }, 's', '0.25').systemProps.appPatch).toBe(0)
    expect(buildTelemetryEnvelope({ eventName: 'generation.completed', props: success }, 's', '0.25.1-rc.2').systemProps.appPatch).toBe(1)
  })

  it('老形状（没有 appPatch）的信封不合法——旧版本排队的事件读出来就丢', () => {
    const envelope = buildTelemetryEnvelope({ eventName: 'generation.completed', props: success }, 'short-session', '0.25.3')
    const { appPatch: _p, ...oldSystem } = envelope.systemProps
    expect(isTelemetryEnvelope({ ...envelope, systemProps: oldSystem })).toBe(false)
    expect(isTelemetryEnvelope({ ...envelope, systemProps: { ...envelope.systemProps, appPatch: '3' } })).toBe(false)
    expect(isTelemetryEnvelope({ ...envelope, props: { ...envelope.props, prompt: 'secret' } })).toBe(false)
  })

  it('总耗时分档不变', () => {
    expect([durationBucket(0), durationBucket(5000), durationBucket(5001)]).toEqual(['<1s', '1-5s', '>5s'])
  })

  it('自动化标记来自启动事实（NOMI_E2E=1），真实用户的事件里没有这一格', () => {
    expect(isAutomatedLaunch({ NOMI_E2E: '1' })).toBe(true)
    expect(isAutomatedLaunch({})).toBe(false)
    expect(isAutomatedLaunch({ NOMI_E2E: '0' })).toBe(false)
    const props = { eventName: 'generation.completed', props: success } as const
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
    expect(isTelemetryProps({ action: 'check', result: 'failure' }, 'update.action')).toBe(true)
    expect(isTelemetryProps({ action: 'check', result: 'success', reason: 'network' }, 'update.action')).toBe(false)
    expect(isTelemetryProps({ action: 'check', result: 'failure', reason: 'getaddrinfo ENOTFOUND github.com' }, 'update.action')).toBe(false)
  })
})
