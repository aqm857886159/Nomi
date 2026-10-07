// NF-0928-0003 / NF-1001-0003 / NF-1001-0004：用户在 Agent 面板上看到的三句英文原文（应用内反馈 NF-0928-0003 / NF-1001-0003 / NF-1001-0004）
// 都不是服务商说的，是看门狗与 pi 自己写的。这里钉两件事：
//   ① 报障原文逐字认成事实（改回「交给关键词猜」时，下游人话测试会红）；
//   ② 我们抄的两句 pi 字面量确实还在依赖源码里（升级 pi 改了措辞，这里当场红，而不是悄悄退回英文原文）。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PI_CONTEXT_OVERFLOW_MESSAGE, PI_STREAM_CUT_MESSAGE, laneAssistantFaultOf, laneModelTimeoutMessage, type LaneModelTimeoutPhase,
} from './laneAssistantFault'

// 穷举：契约加了相位而这里没跟上，`satisfies` 当场编译红。
const PHASES = Object.keys({ 'first-response': true, 'first-token': true, idle: true } satisfies Record<LaneModelTimeoutPhase, true>) as LaneModelTimeoutPhase[]

describe('laneAssistantFaultOf', () => {
  it('报障原文：三句英文各认成一个事实', () => {
    expect(laneAssistantFaultOf('Nomi model idle timeout after 120000ms')).toEqual({ kind: 'model-timeout', phase: 'idle', seconds: 120 })
    expect(laneAssistantFaultOf('Stream ended without finish_reason')).toEqual({ kind: 'stream-cut' })
    expect(laneAssistantFaultOf('Assistant request exceeded the context window')).toEqual({ kind: 'context-overflow' })
  })

  it('类边界：看门狗每个相位铸出来的那句都认得回来（格式只有一份）', () => {
    for (const phase of PHASES) {
      expect(laneAssistantFaultOf(laneModelTimeoutMessage(phase, 300_000))).toEqual({ kind: 'model-timeout', phase, seconds: 300 })
    }
  })

  it('服务商溢出原话由宿主用 pi 的表判好传进来；不传就不猜', () => {
    const vendor = 'Your input exceeds the context window of this model'
    expect(laneAssistantFaultOf(vendor, true)).toEqual({ kind: 'context-overflow' })
    expect(laneAssistantFaultOf(vendor)).toBeUndefined()
  })

  it('服务商原话一律不认（留给生成域分类器）', () => {
    for (const text of ['Connection error.', '429 Too Many Requests', '账户余额不足，请充值', 'request timed out', 'model idle timeout']) {
      expect(laneAssistantFaultOf(text), text).toBeUndefined()
    }
  })

  it('抄自 pi 的两句字面量还在依赖源码里', () => {
    const completions = readFileSync(resolve('node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js'), 'utf8')
    expect(completions).toContain(`"${PI_STREAM_CUT_MESSAGE}"`)
    const response = readFileSync(resolve('node_modules/@earendil-works/pi-agent-core/dist/harness/runtime/drive/response.js'), 'utf8')
    expect(response).toContain(`"${PI_CONTEXT_OVERFLOW_MESSAGE}"`)
  })
})
