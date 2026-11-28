import { describe, expect, it } from 'vitest'
import { buildTelemetryEnvelope, durationBucket, isAutomatedLaunch, isTelemetryEnvelope, isTelemetryProps, TELEMETRY_EVENT_MIN_SCOPE, TELEMETRY_EVENT_NAMES, TELEMETRY_SCOPE_VERSION } from './telemetryEvents'
import {
  AGENT_FAULT_CATEGORIES, agentToolCallsBucket, clampAgentRetryCount, EXPORT_FAILURE_REASONS,
  GENERATION_LOCAL_REFUSALS, INSTALL_AGE_BUCKETS, installAgeBucketFromElapsedMs,
  LAST_EXIT_VALUES, mainStallCountBucket, mainStallMaxBucket, ONBOARDING_FAIL_REASONS, ONBOARDING_STEPS,
  stageDurationBucket, TIMELINE_ADOPTED_SOURCES,
} from '../shared/contracts/telemetry'

const genBase = { capability: 'video', durationBucket: '>5s', mode: 'firstLast', modelClass: 'builtin', submitDuration: '1-5s', waitDuration: '30-120s' } as const
const success = { ...genBase, result: 'success', upstreamStatus: 'ok' } as const
const failure = { ...genBase, result: 'failure', upstreamStatus: 'server-5xx', errorType: 'upstream-server', failureStage: 'wait' } as const
const notSent = { ...genBase, result: 'failure', upstreamStatus: 'not-sent', errorType: 'local-refusal', failureStage: 'submit', localRefusal: 'asset-too-large', waitDuration: 'none' } as const
const cancel = { ...genBase, result: 'cancel' } as const
const perf = { interactionP75: '100-200', interactionP95: '200-500', longFramesPerMin: '1-3', longestFrame: '100-250', observedMinutes: '5-30', page: 'generation', nodes: '21-100', imageNodes: '1-20', generating: true, cpuCores: '9-16', memoryGb: '8plus', mainStallMax: '250-1000', mainStallCount: '1-3' }

describe('事件清单（2026-11-28 全维度匿名漏斗闭环第 1 刀）', () => {
  it('精确登记 9 个闭合事件；已废弃的 feature.used 与旧版死形状仍被拒', () => {
    expect([...TELEMETRY_EVENT_NAMES]).toEqual([
      'app.started',
      'onboarding.step',
      'generation.completed',
      'timeline.adopted',
      'export.completed',
      'update.action',
      'agent.tool.failed',
      'agent.turn.completed',
      'perf.session.summary',
    ])
    expect(isTelemetryProps({ featureId: 'generation', result: 'success' }, 'feature.used' as never)).toBe(false)
    expect(isTelemetryProps({ result: 'success', toolCallBucket: '1-3', modelClass: 'builtin' }, 'agent.turn.completed')).toBe(false)
  })

  it('闭合漏斗事件落在告知范围 1：版本仍是 2，只有 perf 汇总要 2', () => {
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

describe('漏斗闭合事件白名单与反例（onboarding / agent.turn / timeline.adopted / export / installAgeBucket）', () => {
  const startedBase = { appMajor: 0, appMinor: 25, osFamily: 'macos', locale: 'zh-CN', lastExit: 'clean' } as const

  it('app.started 兼容无 installAgeBucket 的旧队列，新事件只认 4 档粗账龄', () => {
    expect(isTelemetryProps(startedBase, 'app.started')).toBe(true)
    for (const bucket of INSTALL_AGE_BUCKETS) {
      expect(isTelemetryProps({ ...startedBase, installAgeBucket: bucket }, 'app.started')).toBe(true)
    }
    expect(isTelemetryProps({ ...startedBase, installAgeBucket: '2026-11-28T08:00:00Z' }, 'app.started')).toBe(false)
    const day = 24 * 60 * 60 * 1000
    expect([
      installAgeBucketFromElapsedMs(-10),
      installAgeBucketFromElapsedMs(0),
      installAgeBucketFromElapsedMs(day - 1),
      installAgeBucketFromElapsedMs(day),
      installAgeBucketFromElapsedMs(7 * day),
      installAgeBucketFromElapsedMs(8 * day),
      installAgeBucketFromElapsedMs(30 * day),
      installAgeBucketFromElapsedMs(31 * day),
    ]).toEqual(['d0', 'd0', 'd0', 'd1-7', 'd1-7', 'd8-30', 'd8-30', 'd30plus'])
  })

  it('onboarding.step：verify_failed 必带闭合 failReason，其余步骤禁带，密钥与 URL 必拒', () => {
    for (const step of ONBOARDING_STEPS) {
      if (step === 'verify_failed') {
        expect(isTelemetryProps({ step, providerClass: 'builtin' }, 'onboarding.step')).toBe(false)
        for (const failReason of ONBOARDING_FAIL_REASONS) {
          expect(isTelemetryProps({ step, providerClass: 'builtin', failReason }, 'onboarding.step')).toBe(true)
        }
      } else {
        expect(isTelemetryProps({ step, providerClass: 'custom' }, 'onboarding.step')).toBe(true)
        expect(isTelemetryProps({ step, providerClass: 'custom', failReason: 'network' }, 'onboarding.step')).toBe(false)
      }
    }
    for (const leak of ['sk-live-secret123', 'https://my-relay.internal/v1', '/Users/me/.env']) {
      expect(isTelemetryProps({ step: 'verify_failed', providerClass: leak, failReason: 'auth_failed' }, 'onboarding.step')).toBe(false)
      expect(isTelemetryProps({ step: 'verify_failed', providerClass: 'custom', failReason: leak }, 'onboarding.step')).toBe(false)
    }
  })

  it('agent.turn.completed：0..5 重试次数与闭合分档；仅失败带 faultCategory', () => {
    const base = { result: 'success', durationBucket: '1-5s', modelClass: 'builtin', toolCallsBucket: '1-2', retryCount: 0, breakerTripped: false } as const
    expect(isTelemetryProps(base, 'agent.turn.completed')).toBe(true)
    expect(isTelemetryProps({ ...base, result: 'cancel', retryCount: 2 }, 'agent.turn.completed')).toBe(true)
    expect(isTelemetryProps({ ...base, faultCategory: 'timeout' }, 'agent.turn.completed')).toBe(false)
    expect(isTelemetryProps({ ...base, result: 'failure' }, 'agent.turn.completed')).toBe(false)
    for (const faultCategory of AGENT_FAULT_CATEGORIES) {
      expect(isTelemetryProps({ ...base, result: 'failure', retryCount: 3, breakerTripped: true, faultCategory }, 'agent.turn.completed')).toBe(true)
    }
    expect(isTelemetryProps({ ...base, retryCount: 6 }, 'agent.turn.completed')).toBe(false)
    expect(isTelemetryProps({ ...base, retryCount: -1 }, 'agent.turn.completed')).toBe(false)
    expect(isTelemetryProps({ ...base, result: 'failure', faultCategory: 'HTTP 401 sk-secret' }, 'agent.turn.completed')).toBe(false)
    expect([agentToolCallsBucket(0), agentToolCallsBucket(1), agentToolCallsBucket(2), agentToolCallsBucket(3), agentToolCallsBucket(5), agentToolCallsBucket(6)]).toEqual(['0', '1-2', '1-2', '3-5', '3-5', '6plus'])
    expect([clampAgentRetryCount(-1), clampAgentRetryCount(0), clampAgentRetryCount(3), clampAgentRetryCount(9)]).toEqual([0, 0, 3, 5])
  })

  it('timeline.adopted 与 export.completed.failureReason：闭合枚举且兼容旧队列', () => {
    for (const source of TIMELINE_ADOPTED_SOURCES) {
      expect(isTelemetryProps({ capability: 'video', source }, 'timeline.adopted')).toBe(true)
    }
    expect(isTelemetryProps({ capability: 'video', source: '/Users/me/clip.mp4' }, 'timeline.adopted')).toBe(false)

    expect(isTelemetryProps({ format: 'mp4', durationBucket: '1-5s', result: 'failure' }, 'export.completed')).toBe(true)
    for (const failureReason of EXPORT_FAILURE_REASONS) {
      expect(isTelemetryProps({ format: 'mp4', durationBucket: '>5s', result: 'failure', failureReason }, 'export.completed')).toBe(true)
      expect(isTelemetryProps({ format: 'mp4', durationBucket: '1-5s', result: 'success', failureReason }, 'export.completed')).toBe(false)
    }
    expect(isTelemetryProps({ format: 'mp4', durationBucket: '>5s', result: 'failure', failureReason: 'ENOENT /Users/me/shot.mp4' }, 'export.completed')).toBe(false)
  })
})
