import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_ROOT_ENV } from '../settings/settingsRoot'
import type { FeedbackSendResult } from '../shared/contracts/feedback'
import type { FeedbackReportPayload } from './feedbackReport'

// 接收端的每一种回答 × 本机队列写得了 / 写不了 的矩阵。
//
// 用户点过发送之后只有三种结局：拿到编号；明确知道存在本机、之后会重发；明确知道没能确认、留言还在可以再点。
// 这张清单挡的是第四种：某种回答让界面停在「正在发送…」，或者报告悄悄没了。
// 新加一种接收端回答，就在 ANSWERS 里加一行，并写清它属于哪一档。

type Fate = 'delivered' | 'delivered-trimmed' | 'kept-for-retry' | 'refused'

type Answer = {
  name: string
  fate: Fate
  /** 第几次请求（从 0 数）怎么回答。 */
  reply: (attempt: number, httpError: (status: number) => Error) => Promise<{ id: string }>
}

const refuse = (status: number): Answer['reply'] => async (_attempt, httpError) => { throw httpError(status) }
const ok: Answer['reply'] = async () => ({ id: 'NF-1101-0001' })

/** 接收端和网络的全部回答形状。401 / 403 / 404 留着重试：令牌随版本轮换，更新 App 后还能送达。 */
const ANSWERS: Answer[] = [
  { name: '200', fate: 'delivered', reply: ok },
  { name: '413，去掉附件后收下', fate: 'delivered-trimmed', reply: async (attempt, httpError) => { if (attempt === 0) throw httpError(413); return { id: 'NF-1101-0001' } } },
  { name: '413，去掉附件后还是 413', fate: 'refused', reply: refuse(413) },
  { name: '400', fate: 'refused', reply: refuse(400) },
  ...[401, 403, 404, 429, 500, 502, 503].map((status): Answer => ({ name: String(status), fate: 'kept-for-retry', reply: refuse(status) })),
  { name: '断网', fate: 'kept-for-retry', reply: async () => { throw new TypeError('fetch failed') } },
  { name: '上传超时', fate: 'kept-for-retry', reply: async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') } },
  { name: '永不回答', fate: 'kept-for-retry', reply: () => new Promise(() => undefined) },
]

/** 用户在界面上看到的那句话对应的结果。 */
function expectedResult(fate: Fate, queueWritable: boolean): FeedbackSendResult {
  if (fate === 'delivered') return { ok: true, id: 'NF-1101-0001', queued: false, trimmed: false }
  if (fate === 'delivered-trimmed') return { ok: true, id: 'NF-1101-0001', queued: false, trimmed: true }
  if (fate === 'kept-for-retry' && queueWritable) return { ok: true, id: null, queued: true, trimmed: false }
  // 明确拒收，或者存不下来也发不出去：都不许说「已存本机」。
  return { ok: false, reason: 'failed' }
}

function report(): FeedbackReportPayload {
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
    },
    context: { surface: 'unspecified', summary: '占位摘要', errorCode: null, note: '留言', contentIncluded: false, provider: null, model: null },
    attachments: { 'logs/tail.txt': ['line'] },
  }
}

describe('反馈送达矩阵', () => {
  let root: string
  let resetQueue: (() => void) | undefined

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-feedback-matrix-'))
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

  for (const queueWritable of [true, false]) {
    for (const answer of ANSWERS) {
      it(`${answer.name} × 队列${queueWritable ? '写得了' : '写不了'}`, async () => {
        const { send, client, queue } = await load()
        if (!queueWritable) fs.mkdirSync(path.join(root, 'intake-queue-feedback.json'))
        let attempt = 0
        const post = vi.spyOn(client, 'postIntake').mockImplementation(() => {
          attempt += 1
          return answer.reply(attempt - 1, (status) => new client.IntakeHttpError(status))
        })

        // 界面最多等这么久；「永不回答」那一行靠它证明不会卡住。
        await expect(send.sendFeedbackReport(report(), { waitMs: 5 })).resolves.toEqual(expectedResult(answer.fate, queueWritable))

        if (!queueWritable) return
        if (answer.fate !== 'kept-for-retry') {
          await vi.waitFor(() => expect(queue.readIntakeQueue('feedback')).toEqual([]))
          return
        }
        // 留下的货：在盘上，而且接收端一恢复就送得到，送到了就离开队列。
        expect(queue.readIntakeQueue('feedback')).toHaveLength(1)
        if (answer.name === '永不回答') return
        await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1))
        post.mockResolvedValue({ id: 'NF-1101-0001' })
        await queue.flushIntakeQueue('feedback')
        expect(queue.readIntakeQueue('feedback')).toEqual([])
      })
    }
  }
})
