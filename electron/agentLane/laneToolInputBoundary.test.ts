// 特征测试：`draft_shots` 的 25 种错写，逐条过**真 lane**——
// 入参边界（包在 pi 的 `prepareArguments` 上）→ pi 的 `validateToolArguments`（TypeBox）→ `execute` 里的契约 parse（Zod）
// → 传输适配器 → 起草准入（模型档案）。模型是本机 HTTP 假端点（逐字回放写好的工具调用），零额度。
//
// 这 25 条来自 Agent 质量调研的探针（它直接调动词 schema，**绕过了 pi 那一层**；真 lane 里大半先被 pi 拦下，
// 模型读到的是 pi 的默认正文 `- shots.0: must not have additional properties` + 整份入参回显，熔断一次都看不见）。
// 这里钉住的是修完之后模型读到的那一段：凡被拒，正文点名出错字段，并给出合法值 / 近似键 / 期望类型 / 范围之一；
// 面板拿到的信封带码和字段清单；同一个错连发时第 3 次起停。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createHttpFixture, type FixtureReply } from '../../tests/agent-runtime/httpFixture.mjs'
import { createModuleRegistry } from '../capabilityCore/moduleRegistry'
import { resetSpendFixture, spendWorld } from '../capabilityCore/agentPanelSpendConfirmTestUtils'
import type { LaneHandle, LanePart } from '../shared/agentLane/laneContracts'
import { LaneDomainFailure } from '../shared/agentLane/laneToolContract'
import type { GenerationProblemCode } from '../shared/generationProblem'
import { buildVideoModelCandidates } from '../shared/videoCapabilities'
import { createExtendedLaneTools } from './laneExtendedTools'
import { openLane } from './laneHost.mjs'
import type { LaneToolFailureEvent, OpenLaneOptions } from './laneRuntimePort'
import { verbToTransportCall } from './laneVerbTransport'

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  resetSpendFixture()
})

// 和起草自纠闭环（`draftSelfCorrection.test.ts`）同一份注册表：合法键 / 时长范围 / 分辨率 / 变体全部由内置档案派生。
const anyParam = { type: 'any' } as const
const SCHEMA = { duration: { type: 'number' }, size: anyParam, resolution: anyParam, generate_audio: anyParam, seed: anyParam } as const
const registry = createModuleRegistry([{
  moduleId: 'generation.single-shot', version: '1.0.0',
  inputKinds: ['text', 'image', 'video'], outputKinds: ['video'],
  modes: ['text_to_video', 'image_to_video'],
  parameterSchema: SCHEMA,
  assetInputSchema: { references: { kind: 'asset', max: 30 } },
  providers: [{ providerId: 'apimart', models: [{ modelId: 'doubao-seedance-2.0', modes: ['text_to_video', 'image_to_video'], parameterSchema: SCHEMA,
    capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true, materialize: true } }] }],
}])
const videoModelCandidates = buildVideoModelCandidates([
  { provider: 'apimart', modelKey: 'doubao-seedance-2.0', label: 'Seedance 2.0' },
  { provider: 'apimart', modelKey: 'doubao-seedance-2.0-fast', label: 'Seedance 2.0 Fast' },
  { provider: 'apimart', modelKey: 'doubao-seedance-2.0-mini', label: 'Seedance 2.0 Mini' },
])

type Shot = Record<string, unknown>
const CANDIDATE = { providerId: 'apimart', modelId: 'doubao-seedance-2.0' }
const shot = (extra: Shot = {}, drop: readonly string[] = []): Shot => {
  const base: Shot = { title: '纸船', prompt: '一只纸船在雨后的水洼里慢慢漂，清晨的光', taskKind: 'text_to_video',
    candidate: CANDIDATE, parameters: { duration: 4, resolution: '480p', generate_audio: false }, ...extra }
  for (const key of drop) delete base[key]
  return base
}
const params = (parameters: Shot): Shot => shot({ parameters })

type ToolResult = Extract<LanePart, { kind: 'tool-result' }>
type Envelope = { code: string; issues?: Array<Record<string, unknown>>; allowed?: string[]; problem?: { code: string; field?: string } }
const failureOf = (result: ToolResult): Envelope | undefined => (result as ToolResult & { failure?: Envelope }).failure

/** 脚本里的一项：一个 draft_shots 调用的入参；或一次回复里的几个调用（`batch`）；或别的工具名（`named`）。 */
class Batch { constructor(readonly calls: ReadonlyArray<readonly [string, unknown]>) {} }
const batch = (...calls: ReadonlyArray<unknown>): Batch => new Batch(calls.map((call) => call instanceof Batch ? call.calls[0]! : ['draft_shots', call] as const))
const named = (name: string, args: unknown): Batch => new Batch([[name, args]])
/** 放在一句话的脚本末尾：这一轮由宿主收掉，模型不会再被请求说那句 done（不写它，下一句话就会吃到这一轮剩下的 done）。 */
const CLOSED = Symbol('turn closed by the host')

/** 一条真 lane：每一句用户话之后，模型逐个发写好的调用（一次一个），最后说一句 done。 */
async function runLane(turns: ReadonlyArray<readonly unknown[]>, options: {
  maxModelRequests?: number; toolLifecycle?: OpenLaneOptions['toolLifecycle']
  /** 第 `at` 次模型请求到达假端点时（回复之前）做一件事，例如用户在这一刻排了一句话。 */
  duringRequest?: { at: number; run: (lane: LaneHandle) => Promise<unknown> }
} = {}) {
  const world = spendWorld({ registry, videoModelCandidates })
  const adapter = world.transport('request')
  let executed = 0
  const tools = createExtendedLaneTools({
    execute: async (call, signal) => { executed += 1; return adapter.tryExecute(verbToTransportCall(call)!.call, signal) as never },
  }).filter((tool) => tool.name === 'draft_shots')
  let id = 0
  const replies: FixtureReply[] = turns.flatMap((items) => [
    ...items.filter((item) => item !== CLOSED).map((item) => ({ type: 'tool' as const,
      calls: (item instanceof Batch ? item.calls : [['draft_shots', item] as const])
        .map(([name, args]) => ({ id: `call-${++id}`, name, arguments: args })) })),
    ...(items.at(-1) === CLOSED ? [] : [{ type: 'text' as const, text: 'done' }]),
  ])
  const during = options.duringRequest
  if (during) {
    const reply = replies[during.at - 1]!
    replies[during.at - 1] = { type: 'deferred', beforeReply: async () => { await during.run(lane!); return reply } }
  }
  const http = await createHttpFixture(replies)
  cleanups.push(http.close)
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-tool-input-boundary-'))
  cleanups.push(() => fs.rmSync(projectDir, { recursive: true, force: true }))
  const events: LaneToolFailureEvent[] = []
  const lane: LaneHandle = await openLane({ fetch: globalThis.fetch, projectDir,
    model: { kind: 'openai-compatible', providerId: 'fixture', modelId: 'fixture', baseURL: http.baseURL, authType: 'api-key', apiKey: 'fixture' },
    systemPrompt: 'Tool input boundary fixture.', tools, onToolFailure: (event) => events.push(event),
    ...(options.maxModelRequests ? { limits: { maxModelRequests: options.maxModelRequests } } : {}),
    ...(options.toolLifecycle ? { toolLifecycle: options.toolLifecycle } : {}) })
  const opened = lane
  cleanups.push(() => opened.close())
  const perTurn: number[] = []
  const queuedAfterTurn: string[][] = []
  for (const [index] of turns.entries()) {
    const before = http.requests.length
    await opened.execute({ kind: 'prompt', text: `起草镜头（第 ${index + 1} 句）。` })
    perTurn.push(http.requests.length - before)
    queuedAfterTurn.push(opened.projection().queues.map((queued) => queued.text))
  }
  const projection = opened.projection()
  const results = projection.parts.filter((part): part is ToolResult => part.kind === 'tool-result')
  return { results, events, drafted: results.filter((result) => !result.isError).length, requests: http.requests.length,
    perTurn, queuedAfterTurn, executed, projection, bodies: http.requests.map((request) => JSON.stringify(request.body)) }
}

/**
 * 25 条错写（Agent 质量调研探针的同一份输入）。`says` = 修完以后模型正文里必须有的那一行：出错字段 + 该填什么。
 * `code` = 面板拿到的信封码。`reason` = 起草准入拒收时信封里那个闭合原因码（`generationProblem.ts`），遥测也报它。
 * `problem` = 准入层没有字段清单、只有一个闭合原因的三条（以前叫「缺口」：只有散文，面板只能说笼统那句）。
 */
type Expect =
  | Readonly<{ accepted: true; why: string }>
  | Readonly<{ says: RegExp; code: string; path?: string; reason?: GenerationProblemCode }>
  | Readonly<{ problem: GenerationProblemCode; says: RegExp; code: string; field: string }>

const SAMPLES: ReadonlyArray<readonly [string, unknown, Expect]> = [
  ['ok-baseline', { shots: [shot()] }, { accepted: true, why: '对照' }],
  ['param-unknown-aspect_ratio', { shots: [params({ duration: 4, aspect_ratio: '16:9' })] },
    { says: /- parameters\.aspect_ratio: no such field here; remove it\. Fields allowed here: duration, generate_audio, resolution, seed, size\./, code: 'generation_input_invalid', reason: 'parameter_not_allowed', path: 'parameters.aspect_ratio' }],
  // 2026-10-05 起 `parameters.aspectRatio` 一律拒（比例只有一个家：镜头上的 aspectRatio）。这一拒在工具自己的准备步骤里，
  // 以前是一条没有码、熔断看不见的立即结果；现在走同一个出口。
  ['param-ratio-camel', { shots: [params({ duration: 4, aspectRatio: '16:9' })] },
    { says: /set aspectRatio on the shot .*leave it out of parameters/, code: 'wrong_verb' }],
  ['duration-out-of-range-0', { shots: [params({ duration: 0 })] }, { says: /- durationSec: expected number\./, code: 'generation_input_invalid', reason: 'parameter_not_allowed', path: 'durationSec' }],
  ['duration-string', { shots: [params({ duration: '4s' })] }, { says: /- durationSec: expected number\./, code: 'generation_input_invalid', reason: 'parameter_not_allowed', path: 'durationSec' }],
  ['duration-top-level', { shots: [shot({ duration: 4 })] },
    { says: /- shots\.0\.duration: no such field here; did you mean "durationSec"\?/, code: 'tool_arguments_invalid', path: 'shots.0.duration' }],
  ['duration-99', { shots: [params({ duration: 99 })] }, { says: /- durationSec: must be between 4 and 15\./, code: 'generation_input_invalid', reason: 'duration_not_in_mode', path: 'durationSec' }],
  ['resolution-4k', { shots: [params({ resolution: '4k' })] },
    { says: /- parameters\.resolution: value is not allowed\. Use one of: 480p, 720p\./, code: 'generation_input_invalid', reason: 'parameter_not_allowed', path: 'parameters.resolution' }],
  ['resolution-1080P-case', { shots: [params({ resolution: '1080P' })] },
    { says: /- parameters\.resolution: value is not allowed\. Use one of: 480p, 720p\./, code: 'generation_input_invalid', reason: 'parameter_not_allowed', path: 'parameters.resolution' }],
  ['bool-as-string', { shots: [params({ generate_audio: 'yes' })] },
    { says: /- parameters\.generate_audio: expected boolean\./, code: 'generation_input_invalid', reason: 'parameter_not_allowed', path: 'parameters.generate_audio' }],
  // 契约 Zod 的 refine（新镜头必须有 prompt）：TypeBox 判不了，落在 execute 里那一次 parse——同一个格式器。
  ['missing-prompt', { shots: [shot({}, ['prompt'])] },
    { says: /- shots\.0\.prompt: required, but missing\. a new shot needs a prompt/, code: 'tool_arguments_invalid', path: 'shots.0.prompt' }],
  ['missing-taskKind', { shots: [shot({}, ['taskKind'])] }, { accepted: true, why: '缺 taskKind 由候选模型的模式推出' }],
  ['bad-taskKind', { shots: [shot({ taskKind: 'video' })] },
    { says: /- shots\.0\.taskKind: value \(received "video"\) is not allowed\. Did you mean "text_to_video"\? Use one of: text_to_image, image_edit, text_to_video, image_to_video\./, code: 'tool_arguments_invalid', path: 'shots.0.taskKind' }],
  ['model-not-in-catalog', { shots: [shot({ candidate: { providerId: 'apimart', modelId: 'sora-2' } })] },
    // 以前正文说「没有配置可用的视频模型」——对点名了 sora-2 的调用是误导（2026-11-08 真实轨迹里 39 题 9 次）。
    { problem: 'unknown_model', field: 'candidate.modelId', says: /apimart\/sora-2 is not in the model catalog/, code: 'generation_input_invalid' }],
  ['candidate-as-string', { shots: [shot({ candidate: 'doubao-seedance-2.0' })] },
    { says: /- shots\.0\.candidate: expected object, received string/, code: 'tool_arguments_invalid', path: 'shots.0.candidate' }],
  ['variant-in-params', { shots: [params({ variant: 'fast' })] },
    { says: /- parameters\.variant: no such field here; did you mean "variantId"\?/, code: 'generation_input_invalid', reason: 'parameter_not_allowed', path: 'parameters.variant' }],
  ['variantId-wrong', { shots: [shot({ variantId: 'turbo' })] },
    { says: /- variantId: value is not allowed\. Use one of: standard, fast, mini\./, code: 'generation_input_invalid', reason: 'parameter_not_allowed', path: 'variantId' }],
  ['unknown-top-field-ratio', { shots: [shot({ ratio: '16:9' })] },
    { says: /- shots\.0\.ratio: no such field here; did you mean "aspectRatio"\?/, code: 'tool_arguments_invalid', path: 'shots.0.ratio' }],
  ['unknown-top-level', { shots: [shot()], aspect: '16:9' },
    { says: /- aspect: no such field here; remove it\. Fields allowed here: operationId, newPlan, taskKind, candidate, shots\./, code: 'tool_arguments_invalid', path: 'aspect' }],
  ['shots-empty', { shots: [] }, { says: /- shots: needs at least 1 item/, code: 'tool_arguments_invalid', path: 'shots' }],
  ['shots-as-object', { shots: shot() }, { accepted: true, why: '工具的容忍步骤把单个对象包成数组（arrayFields）' }],
  ['parameters-json-string', { shots: [shot({ parameters: '{"duration":4}' })] },
    { says: /- shots\.0\.parameters: expected object, received string/, code: 'tool_arguments_invalid', path: 'shots.0.parameters' }],
  ['references-object', { shots: [shot({ references: { url: 'a.png' } })] },
    { says: /- shots\.0\.references: expected array, received object\./, code: 'tool_arguments_invalid', path: 'shots.0.references' }],
  ['references-unknown-id', { shots: [shot({ references: ['asset-nope'] })] },
    { problem: 'parameter_not_allowed', field: 'references', says: /look_at_media/, code: 'generation_input_invalid' }],
  ['image-model-video-task', { shots: [shot({ taskKind: 'text_to_image' })] },
    { problem: 'mode_not_in_model', field: 'taskKind', says: /cannot do text_to_image\. It does: /, code: 'generation_input_invalid' }],
]

describe('25 种 draft_shots 错写过真 lane：被拒的都点名字段、说该填什么', () => {
  for (const [name, args, expected] of SAMPLES) {
    it(name, async () => {
      const { results, events } = await runLane([[args]])
      expect(results).toHaveLength(1)
      const result = results[0]!
      if ('accepted' in expected) {
        expect(result.isError, result.text).toBe(false)
        expect(events).toEqual([])
        return
      }
      expect(result.isError).toBe(true)
      // 不再有整份入参回显、不再有裸 issue JSON。
      expect(result.text).not.toContain('Received arguments')
      expect(result.text).not.toMatch(/^\s*\[/m)
      const failure = failureOf(result)
      // 失败码不再为空：面板按码查本地话，熔断按码认墙，遥测按码计数——三个读者同一个码。
      expect(failure?.code).toBe(expected.code)
      // 起草准入的拒收带闭合原因：信封里有，遥测事件里也有（同一个码）；别的失败两处都没有。
      const reason = 'problem' in expected ? expected.problem : expected.reason
      expect(events).toEqual([{ toolName: 'draft_shots', code: expected.code, attempt: 1, breakerTripped: false, ...(reason ? { reason } : {}) }])
      expect(failure?.problem?.code).toBe(reason)
      expect(result.text).toMatch(expected.says)
      if ('problem' in expected) {
        expect(failure?.issues).toBeUndefined()
        expect(failure?.problem?.field).toBe(expected.field)
        return
      }
      if (expected.path) expect(failure?.issues?.map((issue) => issue.path)).toContain(expected.path)
      // 公开信封不带收到的值。
      expect(JSON.stringify(failure)).not.toContain('"received"')
    }, 30_000)
  }

  it('计数：22 条被拒，19 条带字段清单，3 条没有字段清单、但带闭合原因（不再有只有散文的）', () => {
    const rejected = SAMPLES.filter(([, , expected]) => !('accepted' in expected))
    expect(SAMPLES).toHaveLength(25)
    expect(rejected).toHaveLength(22)
    expect(rejected.filter(([, , expected]) => 'problem' in expected)).toHaveLength(3)
  })
})

const VALID = { shots: [shot()] }
const WRONG_SHAPE = { shots: [shot({ duration: 4 })] }
const WRONG_VALUE = { shots: [params({ resolution: '4k' })] }
/** 第 3 次失败正文末尾的「停」：数的是这个工具自上次成功以来连败几次，并且先把再发一次的后果说清。 */
const STOP = /draft_shots has failed 3 times in a row since it last succeeded\. Do not send it again in this turn: one more call to it ends this turn at once\..*ask_user/s
const STOPPED_HEAD = 'draft_shots was not run (tool_retry_stopped). '
/** 停点那一次模型读到的话。这一轮已经没有下一次请求，所以它不许承诺「现在总结一下」这种这一轮兑现不了的事。 */
const TURN_OVER = /this turn ended here and this call did not run/
const distinctFields = (count: number) => Array.from({ length: count }, (_unused, index) => ({ shots: [shot({ [`bogus_${index}`]: 1 })] }))
const codes = (results: readonly ToolResult[]) => results.map((result) => failureOf(result)?.code ?? 'ok')

// ── 2026-11-09 改合同 ──
// 以前：第 4 次起只回一条「不执行」的立即结果，回合继续；模型不听就一直发，脚本走完（10 个错的调用 = 11 次请求），
// 宿主设的请求上限也拦不住（上限判在 before_tool，立即结果到不了那里）。这些数字在本文件上一版里当「现状」钉着。
// 现在：第 3 次失败的正文说清「再发一次这一轮就结束」；模型又发了 → 这一次不执行，宿主在下一次模型请求**之前**
// 用 pi 的取消原语收掉这一轮。所以下面每条的请求数都是「到停点为止」：3 次失败 + 停点那一次 = 4 次请求。
// oracle 改的原因：旧数字描述的是 bug（无尽空转），新数字描述的是合同（有限纠正机会之后明确停下）。

describe('同一个工具连败 3 次：第 3 次正文带「停」，再发一次就结束这一轮', () => {
  it('形状错（pi 的立即结果）：1、2 次说哪错，第 3 次带上「停」，第 4 次不执行、这一轮到此结束', async () => {
    const { results, events, drafted, requests, executed, projection } = await runLane([Array(6).fill(WRONG_SHAPE)])
    expect(codes(results)).toEqual(['tool_arguments_invalid', 'tool_arguments_invalid', 'tool_arguments_invalid', 'tool_retry_stopped'])
    expect(results[0]!.text).toMatch(/did you mean "durationSec"/)
    expect(results[1]!.text).not.toMatch(STOP)
    expect(results[2]!.text).toMatch(/did you mean "durationSec"/)
    expect(results[2]!.text).toMatch(STOP)
    expect(results[3]!.text.startsWith(STOPPED_HEAD)).toBe(true)
    expect(results[3]!.text).toMatch(TURN_OVER)
    expect(results[3]!.text, '这一轮没有下一次请求了，不许让模型以为它还能「现在总结」').not.toMatch(/State your conclusion|\bnow\b/i)
    expect(requests, '第 5 次请求没有发出去：脚本里剩下的两个调用和那句 done 都没被要').toBe(4)
    expect(drafted).toBe(0)
    expect(executed).toBe(0)
    expect(projection.running).toBe(false)
    expect(events.map(({ attempt, breakerTripped, code }) => [code, attempt, breakerTripped])).toEqual([
      ['tool_arguments_invalid', 1, false], ['tool_arguments_invalid', 2, false], ['tool_arguments_invalid', 3, true],
      ['tool_retry_stopped', 3, true]])
  }, 60_000)

  it('准入层拒收（执行里的失败）同一条：第 3 次正文带上同一句「停」，第 4 次在入参边界拦下、这一轮结束', async () => {
    const { results, events, drafted, requests, executed } = await runLane([Array(6).fill(WRONG_VALUE)])
    expect(codes(results)).toEqual(['generation_input_invalid', 'generation_input_invalid', 'generation_input_invalid', 'tool_retry_stopped'])
    expect(results[1]!.text).not.toMatch(STOP)
    expect(results[2]!.text).toMatch(STOP)
    // 拦截那句把上次拒收给的合法值当选项交出去。
    expect(results[2]!.text).toMatch(/offering the values this call would accept: 480p, 720p\./)
    expect(results[3]!.text.startsWith(STOPPED_HEAD)).toBe(true)
    expect(requests).toBe(4)
    expect(executed, '前 3 次进了执行、被准入拒；停点那一次没进执行').toBe(3)
    expect(drafted).toBe(0)
    expect(events.map(({ attempt, breakerTripped }) => [attempt, breakerTripped])).toEqual([
      [1, false], [2, false], [3, true], [3, true]])
  }, 60_000)

  it('工具自己准备步骤里的拒收同一条', async () => {
    const ratioInParameters = { shots: [params({ duration: 4, aspectRatio: '16:9' })] }
    const { results, requests } = await runLane([Array(4).fill(ratioInParameters)])
    expect(codes(results)).toEqual(['wrong_verb', 'wrong_verb', 'wrong_verb', 'tool_retry_stopped'])
    expect(results[2]!.text).toMatch(STOP)
    expect(requests).toBe(4)
  }, 60_000)

  it('before_tool 里准备那一步的领域拒收同一条：第 3 次带「停」，第 4 次在入参边界拦下', async () => {
    // 桌面端口的 `prepare` 对一条标识符 / 版本对不上的写抛 `LaneDomainFailure`（`rejectPreparation`）。
    // 它被 pi 变成拦截理由，是一条立即结果、跳过 after_tool——不在边界上记数，连发的模型永远停不下来。
    const refusal = () => new LaneDomainFailure({ code: 'capability_authority_invalid',
      message: 'Nomi could not prepare this domain action (capability_authority_invalid).',
      nextAction: 'Read the current project again and request a new action with its current identifiers and revision.' })
    const toolLifecycle: OpenLaneOptions['toolLifecycle'] = {
      prepare: async () => { throw refusal() }, approved: async () => undefined, settled: () => undefined }
    const { results, events, drafted, requests } = await runLane([Array(4).fill(VALID)], { toolLifecycle })
    for (const result of results.slice(0, 3)) expect(result.text).toMatch(/could not prepare this domain action \(capability_authority_invalid\)/)
    expect(results[1]!.text).not.toMatch(STOP)
    expect(results[2]!.text).toMatch(STOP)
    expect(results[3]!.text.startsWith(STOPPED_HEAD)).toBe(true)
    expect(requests).toBe(4)
    expect(drafted).toBe(0)
    expect(events.map(({ code, attempt, breakerTripped }) => [code, attempt, breakerTripped])).toEqual([
      ['capability_authority_invalid', 1, false], ['capability_authority_invalid', 2, false], ['capability_authority_invalid', 3, true],
      ['tool_retry_stopped', 3, true]])
  }, 60_000)

  // 2026-11-09 之前按「码 + 字段路径」分桶，各算各的：错 A 两次、错 B 一次都还没停；每次换一个错字段就永远不停
  // （免费复现：10 个不同的错字段 = 11 次请求，熔断一次没跳）。现在字段只留作诊断，计数只认工具。
  it('换一个错字段、换一种错法都不算进展：错 A 两次、错 B 一次，第 3 次就带「停」', async () => {
    const { results } = await runLane([[WRONG_SHAPE, WRONG_SHAPE, WRONG_VALUE]])
    expect(codes(results)).toEqual(['tool_arguments_invalid', 'tool_arguments_invalid', 'generation_input_invalid'])
    expect(results[1]!.text).not.toMatch(STOP)
    expect(results[2]!.text).toMatch(STOP)
  }, 60_000)

  it('每次换一个错字段 ×10：第 4 次停下，4 次请求（修前 11 次、熔断一次不跳）', async () => {
    const { results, requests } = await runLane([distinctFields(10)])
    expect(codes(results)).toEqual(['tool_arguments_invalid', 'tool_arguments_invalid', 'tool_arguments_invalid', 'tool_retry_stopped'])
    expect(results[2]!.text).toMatch(STOP)
    expect(requests).toBe(4)
  }, 60_000)

  // 已知代价（2026-11-09 定：不改计数规则）：模型每次错一个**不同**字段、正在往对的方向改，第 4 次才写对——
  // 新规则在第 4 次停下，这一次写对的调用不执行。真模型基线里有这种题（三道，都是第 4 次才对）。
  // 这笔账不靠放宽止损来还，靠拒收**一次**就把所有错字段列全，让模型 3 次以内写对；那是根因修复的活，不在这里。
  it('已知代价：每次错一个不同字段、第 4 次才写对 → 第 4 次被停、不执行（靠拒收一次列全字段来消，不靠放宽止损）', async () => {
    const { results, requests, drafted } = await runLane([[...distinctFields(3), VALID, CLOSED]])
    expect(codes(results)).toEqual(['tool_arguments_invalid', 'tool_arguments_invalid', 'tool_arguments_invalid', 'tool_retry_stopped'])
    expect(drafted, '写对的那一次也没执行——这就是代价本身').toBe(0)
    expect(requests).toBe(4)
  }, 60_000)

  // 现状（给根因修复看的）：一次调用里错了三处、分属三层，拒收一次只报最先拦下它的那一层——
  // 工具自己的准备步骤 → pi 的形状校验 → 准入（模型档案）。模型每次都照着改对了被点名的那处，仍要第 4 次才写对，
  // 正好撞上上面那条代价。要消掉它，得让第一次拒收就把三处列全；这条测试在那天会变，连同上面的代价一起改。
  it('现状：三处错分属三层，一次只报一层——照着改也要第 4 次才对', async () => {
    const allThree = { shots: [shot({ duration: 4, parameters: { duration: 4, resolution: '4k', generate_audio: false, aspectRatio: '16:9' } })] }
    const twoLeft = { shots: [shot({ duration: 4, parameters: { duration: 4, resolution: '4k', generate_audio: false } })] }
    const oneLeft = { shots: [params({ duration: 4, resolution: '4k', generate_audio: false })] }
    const { results } = await runLane([[allThree, twoLeft, oneLeft, VALID, CLOSED]])
    expect(codes(results)).toEqual(['wrong_verb', 'tool_arguments_invalid', 'generation_input_invalid', 'tool_retry_stopped'])
    expect(results[0]!.text, '第一次只说比例放错了家').not.toMatch(/durationSec|480p, 720p/)
    expect(results[1]!.text, '第二次才说 duration 写错了地方').toMatch(/did you mean "durationSec"/)
    expect(results[1]!.text).not.toMatch(/480p, 720p/)
    expect(results[2]!.text, '第三次才说分辨率不合法').toMatch(/Use one of: 480p, 720p/)
  }, 60_000)

  it('用户再说一句话，墙倒掉：同一个工具改对了就照常执行', async () => {
    const { results, drafted, perTurn } = await runLane([[...Array(4).fill(WRONG_SHAPE), CLOSED], [VALID]])
    expect(codes(results)).toEqual(['tool_arguments_invalid', 'tool_arguments_invalid', 'tool_arguments_invalid', 'tool_retry_stopped', 'ok'])
    expect(drafted).toBe(1)
    expect(perTurn, '被收掉的那一轮 4 次；下一句话照常开始，起草 + done 两次').toEqual([4, 2])
  }, 60_000)
})

describe('停点之后：这一轮真的结束了', () => {
  it('不再请求模型、不再执行工具、运行结束；停点之前做成的保留，没有悬着的调用或卡', async () => {
    const { results, requests, executed, drafted, projection } = await runLane([[VALID, ...Array(3).fill(WRONG_VALUE), ...Array(4).fill(VALID)]])
    expect(codes(results)).toEqual(['ok', 'generation_input_invalid', 'generation_input_invalid', 'generation_input_invalid', 'tool_retry_stopped'])
    expect(requests, '停点那一次之后一次都没再请求').toBe(5)
    expect(executed, '第一次成功 + 三次被准入拒；停点那一次和它之后的都没执行').toBe(4)
    expect(drafted, '停点之前起草成功的那一条还在').toBe(1)
    expect(projection.running).toBe(false)
    expect(projection.pending, '没有一张卡悬着等人').toBeUndefined()
    const calls = projection.parts.filter((part) => part.kind === 'tool-call')
    expect(calls.filter((part) => part.kind === 'tool-call' && part.running)).toEqual([])
    expect(results.map((result) => result.toolCallId), '每一个调用都有结果，没有一条悬着').toEqual(
      calls.map((part) => (part.kind === 'tool-call' ? part.toolCallId : '')))
  }, 60_000)

  it('停点那一刻用户排着的话不丢：这一轮收掉时还回队里（看得见、能撤回），下一句话连同它一起发给模型', async () => {
    const LATER = '另外，第二镜换成黄昏。'
    const { perTurn, bodies, queuedAfterTurn } = await runLane([[...Array(4).fill(WRONG_SHAPE), CLOSED], [VALID]],
      { duringRequest: { at: 4, run: (lane) => lane.execute({ kind: 'follow-up', text: LATER }) } })
    expect(perTurn).toEqual([4, 2])
    expect(queuedAfterTurn[0], '收掉那一轮时它被 pi 从队里拿走，宿主得把它放回去').toEqual([LATER])
    expect(bodies.slice(0, 4).some((body) => body.includes(LATER)), '它排在这一轮之后，这一轮的请求里不该有它').toBe(false)
    expect(bodies[4]).toContain(LATER)
    expect(queuedAfterTurn[1]).toEqual([])
  }, 60_000)

  it('同一批里：墙立着时先发被拦的、再发一个对的——两条都不执行，这一轮结束', async () => {
    const { results, requests, drafted } = await runLane([[...Array(3).fill(WRONG_SHAPE), batch(WRONG_SHAPE, VALID)]])
    expect(codes(results)).toEqual(['tool_arguments_invalid', 'tool_arguments_invalid', 'tool_arguments_invalid', 'tool_retry_stopped', 'tool_retry_stopped'])
    expect(results[4]!.text).toMatch(TURN_OVER)
    expect(drafted).toBe(0)
    expect(requests).toBe(4)
  }, 60_000)

  it('未知工具名（模型把名字写错）×10：不经过任何工具的入参边界，同样在第 4 次之后收掉，4 次请求', async () => {
    const { results, requests, executed, projection } = await runLane([Array(10).fill(named('draft_shot', VALID))])
    expect(results).toHaveLength(4)
    expect(results.every((result) => result.isError && result.toolName === 'draft_shot')).toBe(true)
    expect(requests).toBe(4)
    expect(executed).toBe(0)
    expect(projection.running).toBe(false)
  }, 60_000)
})

describe('宿主设了请求上限：上限判在请求入口，立即结果也绕不过去', () => {
  it('同一个形状错 ×10、上限 5：在停点（第 4 次）就停了，到不了上限', async () => {
    const { requests } = await runLane([Array(10).fill(WRONG_SHAPE)], { maxModelRequests: 5 })
    expect(requests).toBe(4)
  }, 60_000)

  it('全部执行成功、上限 5：5 次请求，5 次起草都执行（最后一次回复里的调用照常跑完），第 6 次请求不发', async () => {
    const { requests, drafted, results } = await runLane([Array(10).fill(VALID)], { maxModelRequests: 5 })
    expect(requests).toBe(5)
    expect(drafted).toBe(5)
    expect(results.some((result) => result.isError)).toBe(false)
  }, 60_000)

  it('同一批一个对的一个错的、上限 1：对的照常执行，下一次请求不发（修前错的那条是立即结果，绕过上限多要了 1 次）', async () => {
    const { requests, results, drafted, projection } = await runLane([[batch(VALID, WRONG_SHAPE)]], { maxModelRequests: 1 })
    expect(codes(results)).toEqual(['ok', 'tool_arguments_invalid'])
    expect(drafted).toBe(1)
    expect(requests).toBe(1)
    expect(projection.running).toBe(false)
  }, 60_000)
})

describe('正对照：做成的工作不被停', () => {
  it('30 步全成功（生产缺省不设上限）：31 次请求，30 次起草全执行，一次不被停', async () => {
    const { requests, drafted, results } = await runLane([Array(30).fill(VALID)])
    expect(requests).toBe(31)
    expect(drafted).toBe(30)
    expect(results.some((result) => result.isError)).toBe(false)
  }, 120_000)

  it('反例：起草 → 改参数 → 再起草，每步都成功，不被拦（不设上限、上限 5 都一样）', async () => {
    const steps = [VALID, { shots: [params({ duration: 6, resolution: '720p', generate_audio: false })] },
      { shots: [shot({ title: '纸船 · 第二版' })] }]
    for (const options of [{}, { maxModelRequests: 5 }]) {
      const { requests, results, drafted } = await runLane([steps], options)
      expect(drafted).toBe(3)
      expect(requests).toBe(4)
      expect(results.some((result) => result.isError)).toBe(false)
    }
  }, 60_000)

  it('错两次、第 3 次写对：这个工具的连败归零，之后照常', async () => {
    const { results, requests } = await runLane([[WRONG_SHAPE, WRONG_VALUE, VALID, WRONG_SHAPE, WRONG_SHAPE, VALID]])
    expect(codes(results)).toEqual(['tool_arguments_invalid', 'generation_input_invalid', 'ok', 'tool_arguments_invalid', 'tool_arguments_invalid', 'ok'])
    expect(results.some((result) => STOP.test(result.text))).toBe(false)
    expect(requests).toBe(7)
  }, 60_000)
})
