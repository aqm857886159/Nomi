// generation.completed 补细（2026-11-13）的 ★9 验收：
//   ① 失败三格的判定矩阵（真的标记生产者：tagNomiError / encodeStructuredErrorMessage，不手拼字符串）；
//   ② 方式一格和节点底栏「方式」同一判据，认不出 = none；
//   ③ 6 处发送口（4 个函数 × 提交终态 / 提交抛错 / 轮询终态）都带新格，且发出去的形状过白名单；
//   ④ 每次结局只多一次 track，不多读盘、不多发别的 IPC（设计卡 ★7）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { tagNomiError, NOMI_ERROR_ONLY_BEFORE_SUBMIT, type NomiErrorCode } from '../../../electron/shared/nomiErrorCodes'
import { encodeStructuredErrorMessage } from '../../../electron/shared/vendorFailure'
import { GENERATION_LOCAL_REFUSALS } from '../../../electron/shared/contracts/telemetry'
import { MODEL_ARCHETYPES, resolveArchetypeForModel } from '../../../electron/shared/modelArchetypes'
import { isTelemetryProps } from '../../../electron/telemetry/telemetryEvents'
import { modeDisplayKind } from '../generationCanvas/nodes/controls/modeMenuModel'
import { generationFailureFacts, generationModeOf, generationTrackPayload } from './generationTelemetry'
import { fetchWorkbenchTaskResultByVendor, pollCanvasShotRun, runWorkbenchTaskByVendor, submitCanvasShotRun } from './taskApi'

const vendorError = (structured: Record<string, unknown>) => encodeStructuredErrorMessage(structured, 'upstream said something with /Users/me/a.png and sk-secret')

describe('失败三格：上游怎么答的 / 卡在哪一段 / 本机哪条规则', () => {
  it.each([
    [401, 'auth'], [403, 'auth'], [429, 'rate-limit'], [400, 'client-4xx'], [404, 'client-4xx'], [500, 'server-5xx'], [503, 'server-5xx'],
  ])('上游回了 HTTP %i → %s（提交那一下抛的 = submit 段）', (httpStatus, expected) => {
    expect(generationFailureFacts(vendorError({ httpStatus, category: 'server' }), 'submit-threw')).toEqual({ upstreamStatus: expected, failureStage: 'submit' })
  })

  it.each([
    ['auth', 'auth'], ['quota', 'rate-limit'], ['balance', 'client-4xx'], ['input', 'client-4xx'], ['server', 'server-5xx'], ['timeout', 'timeout'], ['network', 'network'], ['something-new', 'unknown'],
  ])('只有业务码（没有状态码）按查表类别：%s → %s', (category, expected) => {
    expect(generationFailureFacts(vendorError({ logicalCode: 1001, category }), 'poll-terminal').upstreamStatus).toBe(expected)
  })

  it('只在提交前成立的码 → 没发出去；在闭合表里的报码本身，其余 uncoded', () => {
    const beforeSubmit = (Object.keys(NOMI_ERROR_ONLY_BEFORE_SUBMIT) as NomiErrorCode[]).filter((code) => NOMI_ERROR_ONLY_BEFORE_SUBMIT[code] && code !== 'submission-unknown')
    expect(beforeSubmit.length).toBeGreaterThan(0)
    for (const code of beforeSubmit) {
      const facts = generationFailureFacts(tagNomiError(code, 'human words'), 'submit-threw')
      expect(facts.upstreamStatus, code).toBe('not-sent')
      expect(facts.failureStage, code).toBe('submit')
      expect(facts.localRefusal, code).toBe((GENERATION_LOCAL_REFUSALS as readonly string[]).includes(code) ? code : 'uncoded')
    }
  })

  it('出网地址那一层的拒发不进闭合表（那一层正在删），只记 uncoded', () => {
    expect(generationFailureFacts(tagNomiError('outbound-blocked-submit', 'x'), 'submit-threw').localRefusal).toBe('uncoded')
    expect(GENERATION_LOCAL_REFUSALS as readonly string[]).not.toContain('outbound-blocked-submit')
  })

  it('分类器判成 local-refusal 的主进程结构化拒发（没有 Nomi 码）也是没发出去，规则 uncoded', () => {
    expect(generationFailureFacts(encodeStructuredErrorMessage({ code: 'node_generation_in_flight' }, 'x'), 'submit-threw', 'local-refusal'))
      .toEqual({ upstreamStatus: 'not-sent', failureStage: 'submit', localRefusal: 'uncoded' })
  })

  it('提交结果不明（submission-unknown）= 网络那一下断了，阶段 submit，不算没发出去', () => {
    expect(generationFailureFacts(tagNomiError('submission-unknown', 'x'), 'submit-threw')).toEqual({ upstreamStatus: 'network', failureStage: 'submit' })
  })

  it('取回 / 落地两段：上游其实答了成功 → ok + fetch / land；查询超时 → timeout + wait', () => {
    expect(generationFailureFacts(tagNomiError('retrieval-download', 'x'), 'poll-terminal')).toEqual({ upstreamStatus: 'ok', failureStage: 'fetch' })
    expect(generationFailureFacts(tagNomiError('output-retrieval-failed', 'x'), 'poll-terminal')).toEqual({ upstreamStatus: 'ok', failureStage: 'fetch' })
    expect(generationFailureFacts(tagNomiError('output-unreadable', 'x'), 'poll-terminal')).toEqual({ upstreamStatus: 'ok', failureStage: 'land' })
    expect(generationFailureFacts(tagNomiError('retrieval-timeout', 'x'), 'poll-terminal')).toEqual({ upstreamStatus: 'timeout', failureStage: 'wait' })
  })

  it('什么标记都没有：终态门 = 上游受理后自己报失败（task-failed）；抛错门 = 说不清（unknown）', () => {
    expect(generationFailureFacts('content policy violation', 'poll-terminal')).toEqual({ upstreamStatus: 'task-failed', failureStage: 'wait' })
    expect(generationFailureFacts('content policy violation', 'submit-terminal')).toEqual({ upstreamStatus: 'task-failed', failureStage: 'wait' })
    expect(generationFailureFacts('boom', 'submit-threw')).toEqual({ upstreamStatus: 'unknown', failureStage: 'submit' })
    expect(generationFailureFacts(undefined, 'submit-threw')).toEqual({ upstreamStatus: 'unknown', failureStage: 'submit' })
  })

  it('没码没结构、分类器从原文认出连不上 / 超时（connect ETIMEDOUT）→ network，不落 unknown；分类器认不出照旧 unknown', () => {
    expect(generationFailureFacts('connect ETIMEDOUT 104.21.3.4:443', 'submit-threw', 'network')).toEqual({ upstreamStatus: 'network', failureStage: 'submit' })
    expect(generationFailureFacts('socket hang up', 'poll-terminal', 'network')).toEqual({ upstreamStatus: 'network', failureStage: 'wait' })
    expect(generationFailureFacts('boom', 'submit-threw', 'unknown')).toEqual({ upstreamStatus: 'unknown', failureStage: 'submit' })
  })

  it('坏掉的结构化标记不抛、不猜：落兜底值', () => {
    expect(generationFailureFacts('NOMI_VENDOR_ERR_B64::%%%not-base64:: x', 'submit-threw')).toEqual({ upstreamStatus: 'unknown', failureStage: 'submit' })
  })
})

describe('方式一格：与节点底栏「方式」同一判据', () => {
  it('每个档案的每个方式，按 extras 里记的 modeId 归到同一类', () => {
    let checked = 0
    for (const base of MODEL_ARCHETYPES) {
      const extras = (modeId: string) => ({ modelKey: 'any-model', archetype: { id: base.id, modeId } })
      const resolved = resolveArchetypeForModel({ modelKey: 'any-model', vendorKey: 'v', meta: extras(base.modes[0]?.id ?? '') })
      if (!resolved) continue
      for (const mode of resolved.modes) {
        expect(generationModeOf('v', extras(mode.id)), `${base.id}/${mode.id}`).toBe(modeDisplayKind(resolved, mode))
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(20)
  })

  it('认不出 = none：没有模型、ComfyUI、多方式档案却没记 modeId、档案里没有这个 modeId', () => {
    const multi = MODEL_ARCHETYPES.find((archetype) => archetype.modes.length > 1)!
    expect(generationModeOf('v', undefined)).toBe('none')
    expect(generationModeOf('v', {})).toBe('none')
    expect(generationModeOf('comfyui-local', { modelKey: 'x', archetype: { id: multi.id, modeId: multi.modes[0].id } })).toBe('none')
    expect(generationModeOf('v', { modelKey: 'x', archetype: { id: multi.id } })).toBe('none')
    expect(generationModeOf('v', { modelKey: 'x', archetype: { id: multi.id, modeId: 'no-such-mode' } })).toBe('none')
    expect(generationModeOf('v', { modelKey: 'totally-unknown-model-xyz' })).toBe('none')
  })
})

describe('组包：时间分段与形状', () => {
  const timing = (startedAt: number, acceptedAt: number | null, endedAt: number) => ({ startedAt, acceptedAt, endedAt })
  const withClass = (props: Record<string, unknown>) => ({ ...props, modelClass: 'builtin' })

  it('同步任务：提交段 = 全程，等待段 = none；异步：分两段', () => {
    const sync = generationTrackPayload({ capability: 'image', vendorKey: 'v', mode: 'text', timing: timing(0, null, 3_000), door: 'submit-terminal', result: 'success' })
    expect(sync.props).toMatchObject({ submitDuration: '1-5s', waitDuration: 'none', durationBucket: '1-5s', upstreamStatus: 'ok' })
    const async = generationTrackPayload({ capability: 'video', vendorKey: 'v', mode: 'firstLast', timing: timing(0, 800, 200_000), door: 'poll-terminal', result: 'success' })
    expect(async.props).toMatchObject({ submitDuration: 'lt-1s', waitDuration: '2-10m', durationBucket: '>5s' })
    expect(isTelemetryProps(withClass(async.props), 'generation.completed')).toBe(true)
  })

  it('失败包：原文一个字都不出门，补上 modelClass 后过白名单', () => {
    const payload = generationTrackPayload({ capability: 'video', vendorKey: 'my-relay', mode: 'reference', timing: timing(0, 500, 9_000), door: 'poll-terminal', result: 'failure', errorType: 'upstream-server', failureMessage: vendorError({ httpStatus: 502 }) })
    expect(payload.props).toMatchObject({ upstreamStatus: 'server-5xx', failureStage: 'wait' })
    expect(JSON.stringify(payload.props)).not.toMatch(/Users|sk-secret|upstream said|my-relay/)
    expect(isTelemetryProps(withClass(payload.props), 'generation.completed')).toBe(true)
  })

  it('反例：渲染层交的那份不带 modelClass，直接拿去校验会被拒（必须经主进程补）', () => {
    const payload = generationTrackPayload({ capability: 'image', vendorKey: 'v', mode: 'text', timing: timing(0, null, 10), door: 'submit-terminal', result: 'success' })
    expect(isTelemetryProps(payload.props, 'generation.completed')).toBe(false)
  })
})

// ── 6 处发送口 ──
const track = vi.fn(async () => ({ queued: true }))
const run = vi.fn()
const result = vi.fn()
const canvasSubmit = vi.fn()
const canvasPoll = vi.fn()
const bridgeReads: string[] = []

function installDesktop(): void {
  const tasks = new Proxy({ run, result, canvasSubmit, canvasPoll }, { get(target, key) { bridgeReads.push(`tasks.${String(key)}`); return Reflect.get(target, key) } })
  const telemetry = { track }
  const desktop = new Proxy({ tasks, telemetry }, { get(target, key) { bridgeReads.push(String(key)); return Reflect.get(target, key) } })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { nomiDesktop: desktop } })
}
afterEach(() => { Reflect.deleteProperty(globalThis, 'window'); vi.clearAllMocks(); bridgeReads.length = 0 })

const task = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'image_to_video', status, assets: [], raw: {}, ...extra })
const sent = () => track.mock.calls.map((call) => (call as unknown as [{ eventName: string; vendorKey: string; props: Record<string, unknown> }])[0])
const multi = MODEL_ARCHETYPES.find((archetype) => archetype.modes.length > 1)!
const request = { kind: 'image_to_video' as const, prompt: 'my private prompt', extras: { modelKey: 'x', nodeId: 'n1', archetype: { id: multi.id, modeId: multi.modes[0].id } } }
const shot = (id: string) => ({ projectId: 'p', nodeId: 'n1', runRecordId: id, vendor: 'v', request })

function expectDetailed(event: ReturnType<typeof sent>[number]): void {
  expect(event.eventName).toBe('generation.completed')
  expect(event.vendorKey).toBe('v')
  expect(event.props.mode).not.toBe('none')
  expect(typeof event.props.submitDuration).toBe('string')
  expect(typeof event.props.waitDuration).toBe('string')
  expect(JSON.stringify(event.props)).not.toMatch(/private prompt|Users|sk-secret/)
  expect(isTelemetryProps({ ...event.props, modelClass: 'custom' }, 'generation.completed'), JSON.stringify(event.props)).toBe(true)
}

describe('6 处发送口都带新格', () => {
  it('runWorkbenchTaskByVendor · 提交终态', async () => {
    installDesktop()
    run.mockResolvedValue(task('a1', 'failed', { error: vendorError({ httpStatus: 401 }) }))
    await runWorkbenchTaskByVendor('v', request, null)
    expect(sent()).toHaveLength(1)
    expectDetailed(sent()[0])
    expect(sent()[0].props).toMatchObject({ upstreamStatus: 'auth', failureStage: 'wait', waitDuration: 'none' })
  })

  it('runWorkbenchTaskByVendor · 提交抛错', async () => {
    installDesktop()
    run.mockRejectedValue(new Error(tagNomiError('asset-too-large', 'too big')))
    await expect(runWorkbenchTaskByVendor('v', request, null)).rejects.toThrow()
    expectDetailed(sent()[0])
    expect(sent()[0].props).toMatchObject({ upstreamStatus: 'not-sent', localRefusal: 'asset-too-large', failureStage: 'submit' })
  })

  it('submitCanvasShotRun · 提交终态 + 提交抛错', async () => {
    installDesktop()
    canvasSubmit.mockResolvedValueOnce(task('b1', 'succeeded'))
    await submitCanvasShotRun(shot('b1'))
    canvasSubmit.mockRejectedValueOnce(new Error(vendorError({ httpStatus: 500 })))
    await expect(submitCanvasShotRun(shot('b2'))).rejects.toThrow()
    expect(sent()).toHaveLength(2)
    for (const event of sent()) expectDetailed(event)
    expect(sent()[0].props.upstreamStatus).toBe('ok')
    expect(sent()[1].props).toMatchObject({ upstreamStatus: 'server-5xx', failureStage: 'submit' })
  })

  it('pollCanvasShotRun · 轮询终态（受理后才有等待段）', async () => {
    installDesktop()
    canvasSubmit.mockResolvedValueOnce(task('c1', 'queued'))
    await submitCanvasShotRun(shot('c1'))
    expect(sent()).toHaveLength(0)
    canvasPoll.mockResolvedValueOnce(task('c1', 'failed', { error: tagNomiError('retrieval-timeout', 'x') }))
    await pollCanvasShotRun({ projectId: 'p', runRecordId: 'c1' })
    expect(sent()).toHaveLength(1)
    expectDetailed(sent()[0])
    expect(sent()[0].props).toMatchObject({ upstreamStatus: 'timeout', failureStage: 'wait' })
    expect(sent()[0].props.waitDuration).not.toBe('none')
  })

  it('fetchWorkbenchTaskResultByVendor · 轮询终态', async () => {
    installDesktop()
    run.mockResolvedValueOnce(task('d1', 'running'))
    await runWorkbenchTaskByVendor('v', request, null)
    result.mockResolvedValueOnce({ vendor: 'v', result: task('d1', 'failed', { error: tagNomiError('output-unreadable', 'x') }) })
    await fetchWorkbenchTaskResultByVendor({ taskId: 'd1', vendor: 'v', projectId: null })
    expect(sent()).toHaveLength(1)
    expectDetailed(sent()[0])
    expect(sent()[0].props).toMatchObject({ upstreamStatus: 'ok', failureStage: 'land' })
  })

  it('★7：一次结局只多一次 track；桥上除了本来就要调的任务方法，只碰 telemetry', async () => {
    installDesktop()
    run.mockResolvedValue(task('e1', 'succeeded'))
    await runWorkbenchTaskByVendor('v', request, null)
    expect(track).toHaveBeenCalledTimes(1)
    expect(new Set(bridgeReads)).toEqual(new Set(['tasks', 'tasks.run', 'telemetry']))
  })
})
