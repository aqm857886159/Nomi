// 轨迹投影的**金测试**：喂一份真实形状的 Agent 转录进去，断言提示词、文稿、本机路径、
// 密钥、data URI 一个字都不在产物里。
//
// 夹具是 `tests/fixtures/standard-formats/nomi-agent-trace-view/trace.jsonl` —— 即
// `laneTrace.mts` 派生出来的那份**本地完整视图**，也就是投影真正的入料。
// 为什么不直接喂 pi 的 session JSONL：解析 pi 转录的那一步住在 ESM 编译岛里
// （`electron/tsconfig.pi.json`），vitest 这半够不着；而把 pi 的形状在这里再抄一份，
// 抄的那份就永远不会红。所以这里测的是**离开机器前的最后一层**，入料形状由
// `laneNativeLoader.cts` 的桥在编译期守着（见那边的注释）。
//
// 夹具里刻意塞了六类东西，每一类都真的在用户机器上出现过的形状：
//   ① 中文提示词与文稿原文（含用户给对话起的名字，它在 sessionId 里）
//   ② macOS 绝对路径与 file:// 路径
//   ③ 带签名 query 的素材 URL
//   ④ sk- 形状的密钥（塞在工具参数里，字段名就叫 apiKey）
//   ⑤ Authorization: Bearer …（塞在工具结果里）
//   ⑥ data:image/png;base64,…
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectLaneTrajectory, projectTrajectoryTurn, trajectoryConversationId } from './trajectoryProjection'
import type { TrajectoryTurnInput } from '../shared/agentLane/laneTrajectory'

const FIXTURE = path.join(__dirname, '../../tests/fixtures/standard-formats/nomi-agent-trace-view/trace.jsonl')

function fixtureTurns(): TrajectoryTurnInput[] {
  return fs.readFileSync(FIXTURE, 'utf8').trim().split('\n').filter(Boolean)
    .map((line) => JSON.parse(line) as TrajectoryTurnInput)
}

/** 夹具里必须真的含这些串，否则断言「产物里没有它们」是恒真的假绿。 */
const FORBIDDEN = [
  '冬夜的公交车',
  '末班公交车上只剩两个人',
  '女孩把额头贴在起雾的玻璃上',
  '好的。我先读画布状态',
  '更冷的色温',
  '/Users/aoqimin/Documents/Nomi Projects/winter-bus',
  '/Users/aoqimin/Desktop/ref.mov',
  '/Users/aoqimin/.nomi-secrets.env',
  'sk-live-9QhT2mVx7Zb4Lp0RwEaYcN1sKdJf',
  'eyJhbGciOiJIUzI1NiwidHlwIjoiSldUIn0',
  'cdn.example.com/moodboard',
  'sig=Zk9QmTt7Xb2LpRv0',
  'iVBORw0KGgoAAAANSUhEUgAA',
  '余额不足',
]

describe('轨迹投影 · 金测试（阳性对照先立住）', () => {
  it('夹具本身确实含全部 14 个禁出串 —— 没这一步，下面那条断言是假绿', () => {
    const raw = fs.readFileSync(FIXTURE, 'utf8')
    for (const needle of FORBIDDEN) expect(raw, `夹具缺了 ${needle}，断言会恒真`).toContain(needle)
  })

  it('默认投影（没勾内容）：14 个禁出串在产物里零命中', () => {
    const serialized = JSON.stringify(projectLaneTrajectory(fixtureTurns()))
    for (const needle of FORBIDDEN) expect(serialized, `${needle} 泄漏了`).not.toContain(needle)
  })

  it('没勾内容时，装内容的那两个键**根本不存在**（不是空串）', () => {
    const [turn] = projectLaneTrajectory(fixtureTurns()).turns
    expect(Object.hasOwn(turn, 'gen_ai.input.messages')).toBe(false)
    expect(Object.hasOwn(turn, 'gen_ai.output.messages')).toBe(false)
    expect(projectLaneTrajectory(fixtureTurns()).contentIncluded).toBe(false)
  })

  it('勾了内容：提示词/回复出门，但里面的密钥与路径仍被第二道网抹掉', () => {
    const envelope = projectLaneTrajectory(fixtureTurns(), { includeContent: true })
    expect(envelope.contentIncluded).toBe(true)
    const [first] = envelope.turns
    expect(first['gen_ai.input.messages']).toContain('冬夜，末班公交车上只剩两个人')
    const serialized = JSON.stringify(envelope)
    // 他同意分享文稿，不等于同意分享文稿里恰好粘着的路径与签名 URL。
    expect(serialized).not.toContain('/Users/aoqimin/Documents/Nomi Projects/winter-bus')
    expect(serialized).not.toContain('sig=Zk9QmTt7Xb2LpRv0')
    expect(serialized).not.toContain('sk-live-9QhT2mVx7Zb4Lp0RwEaYcN1sKdJf')
  })

  it('工具参数只出键名，一个值都不出', () => {
    const [first] = projectLaneTrajectory(fixtureTurns()).turns
    const calls = first['nomi.turn.tool_calls']
    expect(calls.map((call) => call['gen_ai.tool.name'])).toEqual(['nomi_read_canvas', 'nomi_add_nodes'])
    expect(calls[0]['nomi.tool.argument_keys']).toEqual(['includeAssets', 'projectId'])
    // apiKey 这一格的**存在**是有诊断价值的（Agent 往里塞了东西），它的**值**没有。
    expect(calls[1]['nomi.tool.argument_keys']).toEqual(['apiKey', 'nodes'])
    expect(JSON.stringify(calls)).not.toContain('sk-live')
    expect(JSON.stringify(calls)).not.toContain('winter-bus')
  })

  it('留下的是能诊断的数字与枚举', () => {
    const turns = projectLaneTrajectory(fixtureTurns()).turns
    expect(turns).toHaveLength(2)
    expect(turns[0]['gen_ai.operation.name']).toBe('invoke_agent')
    expect(turns[0]['gen_ai.provider.name']).toEqual(['apimart'])
    expect(turns[0]['gen_ai.request.model']).toEqual(['gpt-5.5'])
    expect(turns[0]['gen_ai.usage.input_tokens']).toBe(18422)
    expect(turns[0]['gen_ai.usage.cache_read.input_tokens']).toBe(16000)
    expect(turns[0]['gen_ai.usage.cache_creation.input_tokens']).toBe(2048)
    expect(turns[0]['gen_ai.usage.output_tokens']).toBe(1310)
    expect(turns[0]['gen_ai.response.finish_reasons']).toEqual(['completed'])
    expect(turns[0]['nomi.turn.duration_ms']).toBe(24310)
    expect(turns[0]['nomi.turn.approval_decisions']).toEqual(['granted-once'])
    expect(turns[1]['gen_ai.response.finish_reasons']).toEqual(['failed'])
    expect(turns[1]['nomi.turn.tool_calls'][0]['nomi.tool.failed']).toBe(true)
    // 出错**几次**出门；错误原文不出门（那条里就藏着一段路径）。
    expect(turns[1]['nomi.turn.error_count']).toBe(1)
  })

  // NF-0928-0003 / NF-1001-0001 / NF-1001-0002 / NF-1001-0003 / NF-1001-0004：五条反馈都只拿到「failed: true」和一个回合总 token 数，定不了是哪种失败、哪一次请求撑爆。
  // 新增的三样都是闭合词表或数字，不含内容。
  it('带出失败码、认得出的错误类别、请求次数与单次最大输入', () => {
    const [base] = fixtureTurns()
    const turn = projectTrajectoryTurn({
      ...base,
      requestInputs: [65_000, 66_200, 64_900, 66_000],
      tools: [{ toolCallId: 'c1', name: 'read_script', arguments: { scope: 'selection' }, durationMs: 236, failed: true, failureCode: 'document_position_unavailable' },
        { toolCallId: 'c2', name: 'read_script', arguments: { scope: 'full' }, durationMs: 300, failed: false, failureCode: null }],
      errors: ['Nomi model first-token timeout after 300000ms', 'Stream ended without finish_reason', 'Assistant request exceeded the context window', '/Users/aoqimin/secret 余额不足'],
    })
    expect(turn['nomi.turn.tool_calls'].map((call) => call['nomi.tool.failure_code'])).toEqual(['document_position_unavailable', null])
    expect(turn['nomi.turn.error_kinds']).toEqual(['model-timeout:first-token', 'stream-cut', 'context-overflow'])
    expect(turn['nomi.turn.request_count']).toBe(4)
    expect(turn['nomi.turn.max_request_input_tokens']).toBe(66_200)
    expect(JSON.stringify(turn)).not.toContain('/Users/aoqimin/secret')
  })

  it('会话 id 哈希掉：它带着本机路径和用户给对话起的名字', () => {
    const [turn] = projectLaneTrajectory(fixtureTurns()).turns
    expect(turn['gen_ai.conversation.id']).toMatch(/^[0-9a-f]{16}$/)
    expect(turn['gen_ai.conversation.id']).toBe(trajectoryConversationId('/nomi-lane/冬夜的公交车——阿泽的分镜稿'))
    // 同一段对话的两个回合仍然串得起来——哈希没有毁掉唯一要紧的那个信号。
    const ids = new Set(projectLaneTrajectory(fixtureTurns()).turns.map((item) => item['gen_ai.conversation.id']))
    expect(ids.size).toBe(1)
  })

  it('审批只认闭合枚举：伪造的 note 不会混进去', () => {
    const [base] = fixtureTurns()
    const turn = projectTrajectoryTurn({
      ...base,
      approvals: [{ decision: '/Users/aoqimin/secret' }, { decision: 'granted-once', toolCallId: 'c', toolName: 't' }, 'denied'],
    })
    expect(turn['nomi.turn.approval_decisions']).toEqual(['granted-once'])
  })

  it('缺格、乱格、负数都不炸（转录是盘上的旧数据，形状不由我们保证）', () => {
    const turn = projectTrajectoryTurn({
      sessionId: '', turnId: '', timestamp: 0, spanName: '', prompt: '', response: '',
      models: [], tokens: { input: -5, cacheRead: Number.NaN, cacheWrite: 1.6, output: 0 },
      durationMs: -1, status: '', tools: [], approvals: [], errors: [],
    })
    expect(turn['gen_ai.usage.input_tokens']).toBe(0)
    expect(turn['gen_ai.usage.cache_read.input_tokens']).toBe(0)
    expect(turn['gen_ai.usage.cache_creation.input_tokens']).toBe(2)
    expect(turn['nomi.turn.duration_ms']).toBeNull()
    expect(turn['gen_ai.response.finish_reasons']).toEqual(['unknown'])
  })

  it('回合数与工具数有上限，且取最近的几回合', () => {
    const [base] = fixtureTurns()
    const many = Array.from({ length: 30 }, (_item, index) => ({ ...base, turnId: `t-${index}`, status: `s-${index}` }))
    const envelope = projectLaneTrajectory(many)
    expect(envelope.turns).toHaveLength(20)
    expect(envelope.turns[19]['gen_ai.response.finish_reasons']).toEqual(['s-29'])
  })
})
