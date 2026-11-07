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

import { createHttpFixture } from '../../tests/agent-runtime/httpFixture.mjs'
import { createModuleRegistry } from '../capabilityCore/moduleRegistry'
import { resetSpendFixture, spendWorld } from '../capabilityCore/agentPanelSpendConfirmTestUtils'
import type { LaneHandle, LanePart } from '../shared/agentLane/laneContracts'
import { LaneDomainFailure } from '../shared/agentLane/laneToolContract'
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
type Envelope = { code: string; issues?: Array<Record<string, unknown>>; allowed?: string[] }
const failureOf = (result: ToolResult): Envelope | undefined => (result as ToolResult & { failure?: Envelope }).failure

/** 一条真 lane：每一句用户话之后，模型逐个发写好的调用（一次一个），最后说一句 done。 */
async function runLane(turns: ReadonlyArray<readonly unknown[]>, options: { maxModelRequests?: number; toolLifecycle?: OpenLaneOptions['toolLifecycle'] } = {}) {
  const world = spendWorld({ registry, videoModelCandidates })
  const adapter = world.transport('request')
  const tools = createExtendedLaneTools({
    execute: async (call, signal) => adapter.tryExecute(verbToTransportCall(call)!.call, signal) as never,
  }).filter((tool) => tool.name === 'draft_shots')
  let id = 0
  const http = await createHttpFixture(turns.flatMap((calls) => [
    ...calls.map((args) => ({ type: 'tool' as const, calls: [{ id: `call-${++id}`, name: 'draft_shots', arguments: args }] })),
    { type: 'text' as const, text: 'done' },
  ]))
  cleanups.push(http.close)
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-tool-input-boundary-'))
  cleanups.push(() => fs.rmSync(projectDir, { recursive: true, force: true }))
  const events: LaneToolFailureEvent[] = []
  const lane: LaneHandle = await openLane({ fetch: globalThis.fetch, projectDir,
    model: { kind: 'openai-compatible', providerId: 'fixture', modelId: 'fixture', baseURL: http.baseURL, authType: 'api-key', apiKey: 'fixture' },
    systemPrompt: 'Tool input boundary fixture.', tools, onToolFailure: (event) => events.push(event),
    ...(options.maxModelRequests ? { limits: { maxModelRequests: options.maxModelRequests } } : {}),
    ...(options.toolLifecycle ? { toolLifecycle: options.toolLifecycle } : {}) })
  cleanups.push(() => lane.close())
  for (const [index] of turns.entries()) await lane.execute({ kind: 'prompt', text: `起草镜头（第 ${index + 1} 句）。` })
  const results = lane.projection().parts.filter((part): part is ToolResult => part.kind === 'tool-result')
  return { results, events, drafted: results.filter((result) => !result.isError).length, requests: http.requests.length }
}

/**
 * 25 条错写（Agent 质量调研探针的同一份输入）。`says` = 修完以后模型正文里必须有的那一行：出错字段 + 该填什么。
 * `code` = 面板拿到的信封码。`gap` = 准入层只有散文、还没有结构化字段事实的三条（正文照旧有中文原句，信封有码没有字段）。
 */
type Expect =
  | Readonly<{ accepted: true; why: string }>
  | Readonly<{ says: RegExp; code: string; path?: string }>
  | Readonly<{ gap: string; code: string }>

const SAMPLES: ReadonlyArray<readonly [string, unknown, Expect]> = [
  ['ok-baseline', { shots: [shot()] }, { accepted: true, why: '对照' }],
  ['param-unknown-aspect_ratio', { shots: [params({ duration: 4, aspect_ratio: '16:9' })] },
    { says: /- parameters\.aspect_ratio: no such field here; remove it\. Fields allowed here: duration, generate_audio, resolution, seed, size\./, code: 'generation_input_invalid', path: 'parameters.aspect_ratio' }],
  // 2026-10-05 起 `parameters.aspectRatio` 一律拒（比例只有一个家：镜头上的 aspectRatio）。这一拒在工具自己的准备步骤里，
  // 以前是一条没有码、熔断看不见的立即结果；现在走同一个出口。
  ['param-ratio-camel', { shots: [params({ duration: 4, aspectRatio: '16:9' })] },
    { says: /set aspectRatio on the shot .*leave it out of parameters/, code: 'wrong_verb' }],
  ['duration-out-of-range-0', { shots: [params({ duration: 0 })] }, { says: /- durationSec: expected number\./, code: 'generation_input_invalid', path: 'durationSec' }],
  ['duration-string', { shots: [params({ duration: '4s' })] }, { says: /- durationSec: expected number\./, code: 'generation_input_invalid', path: 'durationSec' }],
  ['duration-top-level', { shots: [shot({ duration: 4 })] },
    { says: /- shots\.0\.duration: no such field here; did you mean "durationSec"\?/, code: 'tool_arguments_invalid', path: 'shots.0.duration' }],
  ['duration-99', { shots: [params({ duration: 99 })] }, { says: /- durationSec: must be between 4 and 15\./, code: 'generation_input_invalid', path: 'durationSec' }],
  ['resolution-4k', { shots: [params({ resolution: '4k' })] },
    { says: /- parameters\.resolution: value is not allowed\. Use one of: 480p, 720p\./, code: 'generation_input_invalid', path: 'parameters.resolution' }],
  ['resolution-1080P-case', { shots: [params({ resolution: '1080P' })] },
    { says: /- parameters\.resolution: value is not allowed\. Use one of: 480p, 720p\./, code: 'generation_input_invalid', path: 'parameters.resolution' }],
  ['bool-as-string', { shots: [params({ generate_audio: 'yes' })] },
    { says: /- parameters\.generate_audio: expected boolean\./, code: 'generation_input_invalid', path: 'parameters.generate_audio' }],
  // 契约 Zod 的 refine（新镜头必须有 prompt）：TypeBox 判不了，落在 execute 里那一次 parse——同一个格式器。
  ['missing-prompt', { shots: [shot({}, ['prompt'])] },
    { says: /- shots\.0\.prompt: required, but missing\. a new shot needs a prompt/, code: 'tool_arguments_invalid', path: 'shots.0.prompt' }],
  ['missing-taskKind', { shots: [shot({}, ['taskKind'])] }, { accepted: true, why: '缺 taskKind 由候选模型的模式推出' }],
  ['bad-taskKind', { shots: [shot({ taskKind: 'video' })] },
    { says: /- shots\.0\.taskKind: value \(received "video"\) is not allowed\. Did you mean "text_to_video"\? Use one of: text_to_image, image_edit, text_to_video, image_to_video\./, code: 'tool_arguments_invalid', path: 'shots.0.taskKind' }],
  ['model-not-in-catalog', { shots: [shot({ candidate: { providerId: 'apimart', modelId: 'sora-2' } })] },
    { gap: '准入层说「没有配置可用的视频模型」（对点名了 sora-2 的调用是误导），没有结构化字段', code: 'generation_input_invalid' }],
  ['candidate-as-string', { shots: [shot({ candidate: 'doubao-seedance-2.0' })] },
    { says: /- shots\.0\.candidate: expected object, received string/, code: 'tool_arguments_invalid', path: 'shots.0.candidate' }],
  ['variant-in-params', { shots: [params({ variant: 'fast' })] },
    { says: /- parameters\.variant: no such field here; did you mean "variantId"\?/, code: 'generation_input_invalid', path: 'parameters.variant' }],
  ['variantId-wrong', { shots: [shot({ variantId: 'turbo' })] },
    { says: /- variantId: value is not allowed\. Use one of: standard, fast, mini\./, code: 'generation_input_invalid', path: 'variantId' }],
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
    { gap: '准入层说「参考素材不在素材库里，先用 look_at_media」，没有结构化字段', code: 'generation_input_invalid' }],
  ['image-model-video-task', { shots: [shot({ taskKind: 'text_to_image' })] },
    { gap: '准入层说「这个模型做不了 text_to_image，它做 …」，没有结构化字段', code: 'generation_input_invalid' }],
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
      expect(events).toEqual([{ toolName: 'draft_shots', code: expected.code, attempt: 1, breakerTripped: false }])
      if ('gap' in expected) {
        expect(failure?.issues, expected.gap).toBeUndefined()
        return
      }
      expect(result.text).toMatch(expected.says)
      if (expected.path) expect(failure?.issues?.map((issue) => issue.path)).toContain(expected.path)
      // 公开信封不带收到的值。
      expect(JSON.stringify(failure)).not.toContain('"received"')
    }, 30_000)
  }

  it('计数：22 条被拒，19 条带结构化字段，3 条只有散文（缺口）', () => {
    const rejected = SAMPLES.filter(([, , expected]) => !('accepted' in expected))
    expect(SAMPLES).toHaveLength(25)
    expect(rejected).toHaveLength(22)
    expect(rejected.filter(([, , expected]) => 'says' in expected)).toHaveLength(19)
  })
})

const WRONG_SHAPE = { shots: [shot({ duration: 4 })] }
const WRONG_VALUE = { shots: [params({ resolution: '4k' })] }
const STOP = /draft_shots has failed the same way 3 times in a row\. Do not send it again in this turn.*ask_user/s
const STOPPED_HEAD = 'draft_shots was not run (tool_retry_stopped). '

describe('同一个错连发 6 次：第 3 次起停', () => {
  it('形状错（pi 的立即结果，以前熔断一次都没见过）：1、2 次说哪错，第 3 次带上「停」，4–6 次不执行', async () => {
    const { results, events, drafted } = await runLane([Array(6).fill(WRONG_SHAPE)])
    expect(results.map((result) => failureOf(result)?.code)).toEqual([
      'tool_arguments_invalid', 'tool_arguments_invalid', 'tool_arguments_invalid', 'tool_retry_stopped', 'tool_retry_stopped', 'tool_retry_stopped'])
    expect(results[0]!.text).toMatch(/did you mean "durationSec"/)
    expect(results[1]!.text).not.toMatch(STOP)
    expect(results[2]!.text).toMatch(/did you mean "durationSec"/)
    expect(results[2]!.text).toMatch(STOP)
    for (const result of results.slice(3)) expect(result.text.startsWith(STOPPED_HEAD)).toBe(true)
    expect(drafted).toBe(0)
    expect(events.map(({ attempt, breakerTripped, code }) => [code, attempt, breakerTripped])).toEqual([
      ['tool_arguments_invalid', 1, false], ['tool_arguments_invalid', 2, false], ['tool_arguments_invalid', 3, true],
      ['tool_retry_stopped', 3, true], ['tool_retry_stopped', 3, true], ['tool_retry_stopped', 3, true]])
  }, 60_000)

  it('准入层拒收（执行里的失败）同一条：第 3 次正文带上同一句「停」，第 4 次起在入参边界就拦下', async () => {
    const { results, events, drafted } = await runLane([Array(6).fill(WRONG_VALUE)])
    expect(results.map((result) => failureOf(result)?.code)).toEqual([
      'generation_input_invalid', 'generation_input_invalid', 'generation_input_invalid', 'tool_retry_stopped', 'tool_retry_stopped', 'tool_retry_stopped'])
    expect(results[1]!.text).not.toMatch(STOP)
    expect(results[2]!.text).toMatch(STOP)
    // 拦截那句把上次拒收给的合法值当选项交出去。
    expect(results[2]!.text).toMatch(/offering the values this call would accept: 480p, 720p\./)
    for (const result of results.slice(3)) expect(result.text.startsWith(STOPPED_HEAD)).toBe(true)
    expect(drafted).toBe(0)
    expect(events.map(({ attempt, breakerTripped }) => [attempt, breakerTripped])).toEqual([
      [1, false], [2, false], [3, true], [3, true], [3, true], [3, true]])
  }, 60_000)

  it('工具自己准备步骤里的拒收（以前没有码、熔断看不见）同一条', async () => {
    const ratioInParameters = { shots: [params({ duration: 4, aspectRatio: '16:9' })] }
    const { results } = await runLane([Array(4).fill(ratioInParameters)])
    expect(results.map((result) => failureOf(result)?.code)).toEqual(['wrong_verb', 'wrong_verb', 'wrong_verb', 'tool_retry_stopped'])
    expect(results[2]!.text).toMatch(STOP)
  }, 60_000)

  it('before_tool 里准备那一步的领域拒收（以前原样再抛，熔断看不见）同一条：第 3 次带「停」，第 4 次在入参边界拦下', async () => {
    // 桌面端口的 `prepare` 对一条标识符 / 版本对不上的写抛 `LaneDomainFailure`（`rejectPreparation`）。
    // 它被 pi 变成拦截理由，是一条立即结果、跳过 after_tool——不在边界上记数，连发的模型永远停不下来。
    const refusal = () => new LaneDomainFailure({ code: 'capability_authority_invalid',
      message: 'Nomi could not prepare this domain action (capability_authority_invalid).',
      nextAction: 'Read the current project again and request a new action with its current identifiers and revision.' })
    const toolLifecycle: OpenLaneOptions['toolLifecycle'] = {
      prepare: async () => { throw refusal() }, approved: async () => undefined, settled: () => undefined }
    const { results, events, drafted } = await runLane([Array(4).fill({ shots: [shot()] })], { toolLifecycle })
    for (const result of results.slice(0, 3)) expect(result.text).toMatch(/could not prepare this domain action \(capability_authority_invalid\)/)
    expect(results[1]!.text).not.toMatch(STOP)
    expect(results[2]!.text).toMatch(STOP)
    expect(results[3]!.text.startsWith(STOPPED_HEAD)).toBe(true)
    expect(drafted).toBe(0)
    expect(events.map(({ code, attempt, breakerTripped }) => [code, attempt, breakerTripped])).toEqual([
      ['capability_authority_invalid', 1, false], ['capability_authority_invalid', 2, false], ['capability_authority_invalid', 3, true],
      ['tool_retry_stopped', 3, true]])
  }, 60_000)

  it('不同字段的错各算各的：错 A 两次、错 B 一次，都还没停', async () => {
    const { results } = await runLane([[WRONG_SHAPE, WRONG_SHAPE, WRONG_VALUE]])
    for (const result of results) expect(result.text).not.toMatch(STOP)
    expect(results.map((result) => failureOf(result)?.code)).toEqual(['tool_arguments_invalid', 'tool_arguments_invalid', 'generation_input_invalid'])
  }, 60_000)

  it('用户再说一句话，墙倒掉：同一个工具改对了就照常执行', async () => {
    const { results, drafted } = await runLane([[WRONG_SHAPE, WRONG_SHAPE, WRONG_SHAPE, WRONG_SHAPE], [{ shots: [shot()] }]])
    expect(results.map((result) => failureOf(result)?.code ?? 'ok')).toEqual([
      'tool_arguments_invalid', 'tool_arguments_invalid', 'tool_arguments_invalid', 'tool_retry_stopped', 'ok'])
    expect(drafted).toBe(1)
  }, 60_000)
})

describe('反例：模型无视拦截，一直调同一个工具', () => {
  it('拦得住：之后每一次都不执行（改对了也不执行，墙要等用户开口才倒），一分钱不花', async () => {
    const { results, drafted } = await runLane([[...Array(3).fill(WRONG_SHAPE), ...Array(7).fill({ shots: [shot()] })]])
    expect(results).toHaveLength(10)
    expect(results.slice(3).every((result) => result.text.startsWith(STOPPED_HEAD))).toBe(true)
    expect(drafted).toBe(0)
  }, 60_000)

  it('回合不会自己结束：缺省没有请求上限，模型发多少次就拦多少次（每次一个模型请求，不执行、不花生成的钱）', async () => {
    const unbounded = await runLane([Array(10).fill(WRONG_SHAPE)])
    expect(unbounded.results).toHaveLength(10)
    expect(unbounded.requests).toBe(11)
  }, 60_000)

  // 已知缺口：回合请求上限只在 `before_tool` 里拦（`terminate: true`），而形状错 / 被拦下的调用是 pi 的立即结果，
  // 根本不经过 `before_tool`——宿主设了上限，这种循环也截不断。pi 的立即结果只能是 `terminate: false`
  // （`harness/execution/tools.js` 的 `prepareToolCall`），要硬停只能另找出口；修好的那天这条会红，把 `.fails` 去掉。
  it.fails('宿主设了请求上限时，立即结果的循环也该在上限处截断', async () => {
    const capped = await runLane([Array(10).fill(WRONG_SHAPE)], { maxModelRequests: 5 })
    expect(capped.results.length).toBeLessThan(10)
    expect(capped.results.at(-1)!.text).toMatch(/reached its 5-model-request limit/)
  }, 60_000)
})
