import { describe, expect, it } from 'vitest'
import { BUILTIN_VENDOR_SEEDS, isLocalSeed } from '../catalog/builtinVendorSeeds'
import { agentToolFailedProps, modelClassOfVendor } from './agentToolFailureTelemetry'
import { buildTelemetryEnvelope, isTelemetryEnvelope, isTelemetryProps, TELEMETRY_EVENT_MIN_SCOPE } from './telemetryEvents'

const cloud = BUILTIN_VENDOR_SEEDS.find((seed) => !isLocalSeed(seed))!
const local = BUILTIN_VENDOR_SEEDS.find((seed) => isLocalSeed(seed))

describe('agent.tool.failed：哪个工具、哪种失败、第几次、拦没拦、哪一类模型——只有标识符', () => {
  it('五格恰好；多一格、用户文字、模型 id、超范围次数一律被拒', () => {
    const props = { toolName: 'draft_shots', failureCode: 'tool_arguments_invalid', attempt: 3, breakerTripped: true, modelClass: 'builtin' }
    expect(isTelemetryProps(props, 'agent.tool.failed')).toBe(true)
    expect(isTelemetryProps({ ...props, prompt: 'a paper boat' }, 'agent.tool.failed')).toBe(false)
    expect(isTelemetryProps({ ...props, toolName: 'a paper boat in the rain' }, 'agent.tool.failed')).toBe(false)
    expect(isTelemetryProps({ ...props, failureCode: 'Validation failed for tool' }, 'agent.tool.failed')).toBe(false)
    expect(isTelemetryProps({ ...props, modelClass: 'gpt-5.5' }, 'agent.tool.failed')).toBe(false)
    expect(isTelemetryProps({ ...props, attempt: 6 }, 'agent.tool.failed')).toBe(false)
    expect(isTelemetryProps({ ...props, attempt: 0 }, 'agent.tool.failed')).toBe(false)
    expect(isTelemetryProps({ ...props, breakerTripped: 'yes' }, 'agent.tool.failed')).toBe(false)
    expect(TELEMETRY_EVENT_MIN_SCOPE['agent.tool.failed']).toBe(1)
    expect(isTelemetryEnvelope(buildTelemetryEnvelope({ eventName: 'agent.tool.failed', props: props as never }, 'short-session', '0.25.0'))).toBe(true)
  })

  it('失败事实 → 五格：次数封顶 5、码不是标识符记 unknown、工具名不是标识符记 other', () => {
    expect(agentToolFailedProps({ toolName: 'draft_shots', code: 'tool_retry_stopped', attempt: 9, breakerTripped: true }, { vendorKey: cloud.key }))
      .toEqual({ toolName: 'draft_shots', failureCode: 'tool_retry_stopped', attempt: 5, breakerTripped: true, modelClass: 'builtin' })
    const odd = agentToolFailedProps({ toolName: 'Draft Shots!', code: 'Some English text', attempt: 0, breakerTripped: false }, {})
    expect(odd).toEqual({ toolName: 'other', failureCode: 'unknown', attempt: 1, breakerTripped: false, modelClass: 'custom' })
    expect(isTelemetryProps(odd, 'agent.tool.failed')).toBe(true)
  })

  // 2026-11-08：粗码 generation_input_invalid 数不出「点名的模型不存在」和「没配默认模型」各几次，第 6 格 reason 数得出。
  it('第 6 格 reason：只许闭合原因码表里的值；没有 reason 的老事件照旧合法', () => {
    const base = { toolName: 'draft_shots', failureCode: 'generation_input_invalid', attempt: 1, breakerTripped: false, modelClass: 'builtin' }
    expect(isTelemetryProps(base, 'agent.tool.failed')).toBe(true)
    expect(isTelemetryProps({ ...base, reason: 'unknown_model' }, 'agent.tool.failed')).toBe(true)
    expect(isTelemetryProps({ ...base, reason: 'no_default_model' }, 'agent.tool.failed')).toBe(true)
    // 表外的值一律拒：形状像标识符也不行（码表是闭合的），更不许是一句话或模型 id。
    expect(isTelemetryProps({ ...base, reason: 'model_typo' }, 'agent.tool.failed')).toBe(false)
    expect(isTelemetryProps({ ...base, reason: 'volcengine/doubao-seedream-5-0-pro' }, 'agent.tool.failed')).toBe(false)
    expect(isTelemetryProps({ ...base, reason: '没有这个模型' }, 'agent.tool.failed')).toBe(false)
    expect(isTelemetryProps({ ...base, reason: undefined }, 'agent.tool.failed')).toBe(false)
    expect(isTelemetryEnvelope(buildTelemetryEnvelope({ eventName: 'agent.tool.failed', props: { ...base, reason: 'ratio_not_in_mode' } as never }, 'short-session', '0.25.0'))).toBe(true)
  })

  it('失败事实 → reason：码表里的原样带上，表外的整格不出门', () => {
    const fact = { toolName: 'draft_shots', code: 'generation_input_invalid', attempt: 2, breakerTripped: false }
    expect(agentToolFailedProps({ ...fact, reason: 'unknown_model' }, { vendorKey: cloud.key }))
      .toEqual({ toolName: 'draft_shots', failureCode: 'generation_input_invalid', attempt: 2, breakerTripped: false, modelClass: 'builtin', reason: 'unknown_model' })
    const stray = agentToolFailedProps({ ...fact, reason: 'Model X is not in the catalog' }, { vendorKey: cloud.key })
    expect(stray).not.toHaveProperty('reason')
    expect(isTelemetryProps(stray, 'agent.tool.failed')).toBe(true)
  })

  it('模型只到种类：自建中转的 key（用户地址铸出来的）塌成 custom，兄弟连接认回内置家', () => {
    expect(modelClassOfVendor('internal-proxy-corp-local')).toBe('custom')
    expect(modelClassOfVendor(undefined)).toBe('custom')
    expect(modelClassOfVendor(cloud.key)).toBe('builtin')
    expect(modelClassOfVendor(`${cloud.key}--my-connection`)).toBe('builtin')
    if (local) expect(modelClassOfVendor(local.key)).toBe('local')
  })
})
