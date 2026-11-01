import { encodeStructuredErrorMessage } from '../../../electron/vendor/vendorHttp'
// 生成结果上报：失败带类别码（不带原文），异步任务在终态才报一次，不再把「还在跑」记成取消。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GENERATION_ERROR_KINDS } from '../observability/narrate'
import { TELEMETRY_ERROR_TYPE_PATTERN } from '../../../electron/shared/contracts/telemetry'
import { isTelemetryProps } from '../../../electron/telemetry/telemetryEvents'
import { fetchWorkbenchTaskResultByVendor, runWorkbenchTaskByVendor } from './taskApi'

const track = vi.fn(async () => ({ queued: true }))
const run = vi.fn()
const result = vi.fn()

function installDesktop(): void {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { nomiDesktop: { tasks: { run, result }, telemetry: { track } } } })
}
afterEach(() => { Reflect.deleteProperty(globalThis, 'window'); vi.clearAllMocks() })

const task = (status: string, extra: Record<string, unknown> = {}) => ({ id: 't1', kind: 'text_to_video', status, assets: [], raw: {}, ...extra })
const sent = () => track.mock.calls.map((call) => (call as unknown as [{ eventName: string; props: Record<string, unknown> }])[0])

describe('generation.completed 上报', () => {
  it('同步失败：带分类码，原文不出门', async () => {
    installDesktop()
    run.mockResolvedValue(task('failed', { error: 'upload failed for C:/Users/me/secret-prompt.png: ECONNRESET' }))
    await runWorkbenchTaskByVendor('v', { kind: 'text_to_image', prompt: 'my private prompt', extras: {} }, null)
    const [event] = sent()
    expect(event.props.result).toBe('failure')
    expect(typeof event.props.errorType).toBe('string')
    expect(JSON.stringify(event)).not.toMatch(/secret-prompt|private prompt|Users|ECONNRESET/)
    expect(isTelemetryProps(event.props, 'generation.completed')).toBe(true)
  })

  it('成功不带原因', async () => {
    installDesktop()
    run.mockResolvedValue(task('succeeded'))
    await runWorkbenchTaskByVendor('v', { kind: 'text_to_image', prompt: 'p', extras: {} }, null)
    expect(sent()[0].props).not.toHaveProperty('errorType')
    expect(sent()[0].props.result).toBe('success')
  })

  it('提交抛错也是失败，带分类码', async () => {
    installDesktop()
    run.mockRejectedValue(new Error('balance insufficient'))
    await expect(runWorkbenchTaskByVendor('v', { kind: 'text_to_image', prompt: 'p', extras: {} }, null)).rejects.toThrow()
    expect(sent()[0].props.result).toBe('failure')
    expect(isTelemetryProps(sent()[0].props, 'generation.completed')).toBe(true)
  })

  it('异步任务：提交时不报；轮询到终态报一次，失败也带原因', async () => {
    installDesktop()
    run.mockResolvedValue(task('queued'))
    await runWorkbenchTaskByVendor('v', { kind: 'text_to_video', prompt: 'p', extras: {} }, null)
    expect(sent()).toHaveLength(0)
    result.mockResolvedValueOnce({ vendor: 'v', result: task('running') })
    await fetchWorkbenchTaskResultByVendor({ taskId: 't1', vendor: 'v', projectId: null })
    expect(sent()).toHaveLength(0)
    result.mockResolvedValueOnce({ vendor: 'v', result: task('failed', { error: 'content policy violation' }) })
    await fetchWorkbenchTaskResultByVendor({ taskId: 't1', vendor: 'v', projectId: null })
    result.mockResolvedValueOnce({ vendor: 'v', result: task('failed', { error: 'content policy violation' }) })
    await fetchWorkbenchTaskResultByVendor({ taskId: 't1', vendor: 'v', projectId: null })
    expect(sent()).toHaveLength(1)
    expect(sent()[0].props).toMatchObject({ capability: 'video', result: 'failure' })
    expect(typeof sent()[0].props.errorType).toBe('string')
  })

  it('没提交过的任务（重启后找回）轮询到终态不重复报', async () => {
    installDesktop()
    result.mockResolvedValue({ vendor: 'v', result: task('succeeded') })
    await fetchWorkbenchTaskResultByVendor({ taskId: 'recovered', vendor: 'v', projectId: null })
    expect(sent()).toHaveLength(0)
  })

  it('分类表里每一个 kind 都装得进 errorType 的形状', () => {
    for (const kind of GENERATION_ERROR_KINDS) expect(TELEMETRY_ERROR_TYPE_PATTERN.test(kind), kind).toBe(true)
  })
})


it.each(['node_generation_in_flight', 'canvas_consent_predates_upgrade', 'director_preview_blocked', 'production_shot_claimed', 'generation_input_changed', 'storyboard_content_conflict'])('local refusal telemetry keeps the exact kind for %s', async code => {
  installDesktop()
  run.mockRejectedValue(new Error(encodeStructuredErrorMessage({ code, reason: 'needs_reconcile' }, code)))
  await expect(runWorkbenchTaskByVendor('v', { kind: 'text_to_image', prompt: 'private fixture' }, null)).rejects.toThrow()
  expect(sent()[0].props.errorType).toBe('local-refusal')
  expect(JSON.stringify(sent())).not.toContain('private fixture')
})
