import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_ROOT_ENV } from '../settings/settingsRoot'
import type { FeedbackReportPayload } from './feedbackReport'

let root: string
let resetQueue: (() => void) | undefined

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-feedback-send-'))
  vi.stubEnv(SETTINGS_ROOT_ENV, root)
  vi.stubEnv('NOMI_INTAKE_ENDPOINT', 'https://intake.example')
  vi.stubEnv('NOMI_INTAKE_TOKEN', 'tok')
  vi.resetModules()
})

afterEach(() => {
  resetQueue?.()
  fs.rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function report(overrides: Partial<FeedbackReportPayload['manifest']> = {}): FeedbackReportPayload {
  return {
    schemaVersion: 1,
    manifest: {
      schemaVersion: 1,
      createdAt: '2026-11-01T00:00:00.000Z',
      app: { version: '0.24.1', electron: '43', node: '22', chrome: '130' },
      system: { platform: 'win32', arch: 'x64', osRelease: '10', locale: 'zh-CN', timeZone: 'Asia/Shanghai' },
      projectId: null,
      entries: [{ path: 'logs/tail.txt', bytes: 10, what: '日志' }],
      excluded: [],
      totalBytes: 10,
      ...overrides,
    },
    context: { surface: 'unspecified', summary: '占位摘要', errorCode: null, note: '留言', contentIncluded: false, provider: null, model: null },
    attachments: { 'logs/tail.txt': ['line'] },
  }
}

async function load() {
  const [send, client, queue, reportModule] = await Promise.all([
    import('./feedbackSend'),
    import('../telemetry/intakeClient'),
    import('../telemetry/intakeQueue'),
    import('./feedbackReport'),
  ])
  queue.setIntakeTooLargeHandler('feedback', reportModule.shrinkFeedbackReport)
  resetQueue = queue.resetIntakeQueueTimers
  return { send, client, queue }
}

describe('发送结果翻成界面那句话', () => {
  it('送到了：编号，没有删减', async () => {
    const { send, client, queue } = await load()
    vi.spyOn(client, 'postIntake').mockResolvedValue({ id: 'NF-1101-0001' })
    await expect(send.sendFeedbackReport(report())).resolves.toEqual({ ok: true, id: 'NF-1101-0001', queued: false, trimmed: false })
    expect(queue.readIntakeQueue('feedback')).toEqual([])
  })

  it('接收端不回答：等够了就回「已存本机」，货在队列里，晚到的回答也不丢', async () => {
    const { send, client, queue } = await load()
    let answer: (value: { id: string }) => void = () => undefined
    const post = vi.spyOn(client, 'postIntake').mockImplementation(() => new Promise((resolve) => { answer = resolve }))
    await expect(send.sendFeedbackReport(report(), { waitMs: 5 })).resolves.toEqual({ ok: true, id: null, queued: true, trimmed: false })
    expect(queue.readIntakeQueue('feedback')).toHaveLength(1)
    answer({ id: 'NF-1101-0002' })
    await vi.waitFor(() => expect(queue.readIntakeQueue('feedback')).toEqual([]))
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('断网：立刻回「已存本机」，不等满时间（等满一分钟的话这条用例先超时）', async () => {
    const { send, client, queue } = await load()
    vi.spyOn(client, 'postIntake').mockRejectedValue(new Error('fetch failed'))
    await expect(send.sendFeedbackReport(report(), { waitMs: 60_000 })).resolves.toEqual({ ok: true, id: null, queued: true, trimmed: false })
    expect(queue.readIntakeQueue('feedback')).toHaveLength(1)
  })

  it('接收端回 413：去掉附件再发一次，拿到编号，并告诉用户有东西没带上', async () => {
    const { send, client, queue } = await load()
    const sent: FeedbackReportPayload[] = []
    vi.spyOn(client, 'postIntake').mockImplementation(async (_route, payload) => {
      sent.push(payload as FeedbackReportPayload)
      if (sent.length === 1) throw new client.IntakeHttpError(413)
      return { id: 'NF-1101-0003' }
    })
    await expect(send.sendFeedbackReport(report())).resolves.toEqual({ ok: true, id: 'NF-1101-0003', queued: false, trimmed: true })
    expect(sent).toHaveLength(2)
    expect(sent[1].attachments).toEqual({})
    expect(sent[1].context.summary).toBe('占位摘要')
    expect(sent[1].context.note).toBe('留言')
    expect(sent[1].manifest.excluded).toContainEqual({ what: 'logs/tail.txt', why: 'report-size-limit' })
    expect(queue.readIntakeQueue('feedback')).toEqual([])
  })

  it('组包时就有东西超预算：拿到编号也要说', async () => {
    const { send, client } = await load()
    vi.spyOn(client, 'postIntake').mockResolvedValue({ id: 'NF-1101-0004' })
    const over = report({ excluded: [{ what: 'model-catalog.json', why: 'report-size-limit' }] })
    await expect(send.sendFeedbackReport(over)).resolves.toMatchObject({ ok: true, trimmed: true })
    vi.spyOn(client, 'postIntake').mockRejectedValue(new Error('offline'))
    await expect(send.sendFeedbackReport(over)).resolves.toEqual({ ok: true, id: null, queued: true, trimmed: true })
  })

  it('接收端明确拒收：不说「已存本机」，让用户知道可以再点', async () => {
    const { send, client, queue } = await load()
    vi.spyOn(client, 'postIntake').mockRejectedValue(new client.IntakeHttpError(400))
    await expect(send.sendFeedbackReport(report())).resolves.toEqual({ ok: false, reason: 'failed' })
    expect(queue.readIntakeQueue('feedback')).toEqual([])
  })

  it('存不下来也发不出去：不说「已存本机」', async () => {
    const { send, client } = await load()
    fs.mkdirSync(path.join(root, 'intake-queue-feedback.json'))
    vi.spyOn(client, 'postIntake').mockRejectedValue(new Error('offline'))
    await expect(send.sendFeedbackReport(report())).resolves.toEqual({ ok: false, reason: 'failed' })
  })

  it('存不下来但发出去了：正常的编号', async () => {
    const { send, client } = await load()
    fs.mkdirSync(path.join(root, 'intake-queue-feedback.json'))
    vi.spyOn(client, 'postIntake').mockResolvedValue({ id: 'NF-1101-0005' })
    await expect(send.sendFeedbackReport(report())).resolves.toEqual({ ok: true, id: 'NF-1101-0005', queued: false, trimmed: false })
  })
})
