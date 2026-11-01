import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_ROOT_ENV } from '../settings/settingsRoot'

let root: string
const ORIGINAL = { root: process.env[SETTINGS_ROOT_ENV], endpoint: process.env.NOMI_INTAKE_ENDPOINT, token: process.env.NOMI_INTAKE_TOKEN }

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-intake-queue-'))
  vi.stubEnv(SETTINGS_ROOT_ENV, root)
  vi.stubEnv("NOMI_INTAKE_ENDPOINT", 'https://intake.example')
  vi.stubEnv("NOMI_INTAKE_TOKEN", 'tok')
  vi.resetModules()
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
  for (const [key, value] of [[SETTINGS_ROOT_ENV, ORIGINAL.root], ['NOMI_INTAKE_ENDPOINT', ORIGINAL.endpoint], ['NOMI_INTAKE_TOKEN', ORIGINAL.token]] as const) {
    if (value === undefined) vi.stubEnv(key, undefined)
    else vi.stubEnv(key, value)
  }
  vi.restoreAllMocks()
})

async function load() {
  return import('./intakeQueue')
}

describe('反馈/轨迹的落盘队列', () => {
  it('入队即落盘；两种货物各自一个文件（清轨迹不该连带清反馈）', async () => {
    const queue = await load()
    queue.enqueueIntake('feedback', { summary: 'a' })
    queue.enqueueIntake('trajectories', { turn: 1 })
    expect(fs.existsSync(path.join(root, 'intake-queue-feedback.json'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'intake-queue-trajectories.json'))).toBe(true)
    expect(queue.clearIntakeQueue('trajectories')).toEqual({ deletedCount: 1 })
    expect(queue.readIntakeQueue('feedback')).toHaveLength(1)
    expect(queue.readIntakeQueue('trajectories')).toHaveLength(0)
  })

  it('队列文件坏了不该让下一次反馈也发不出去', async () => {
    fs.writeFileSync(path.join(root, 'intake-queue-feedback.json'), '{ not json')
    const queue = await load()
    expect(queue.readIntakeQueue('feedback')).toEqual([])
    queue.enqueueIntake('feedback', { summary: 'a' })
    expect(queue.readIntakeQueue('feedback')).toHaveLength(1)
  })

  it('发成功的从队列里消失，发不出去的留着', async () => {
    const queue = await load()
    const client = await import('./intakeClient')
    queue.enqueueIntake('feedback', { summary: 'a' })
    queue.enqueueIntake('feedback', { summary: 'b' })

    const post = vi.spyOn(client, 'postIntake')
      .mockResolvedValueOnce({ id: 'NF-0915-0001' })
      .mockRejectedValueOnce(new Error('offline'))
    await queue.flushIntakeQueue('feedback')
    queue.resetIntakeQueueTimers()

    expect(post).toHaveBeenCalledTimes(2)
    const left = queue.readIntakeQueue('feedback')
    expect(left).toHaveLength(1)
    expect(left[0].payload).toEqual({ summary: 'b' })
  })

  it('一条发不出去就停手，不对着同一个挂掉的端点把整队都撞一遍', async () => {
    const queue = await load()
    const client = await import('./intakeClient')
    for (const summary of ['a', 'b', 'c']) queue.enqueueIntake('feedback', { summary })
    const post = vi.spyOn(client, 'postIntake').mockRejectedValue(new Error('offline'))
    await queue.flushIntakeQueue('feedback')
    queue.resetIntakeQueueTimers()
    expect(post).toHaveBeenCalledTimes(1)
    expect(queue.readIntakeQueue('feedback')).toHaveLength(3)
  })

  it('端点没配就不发（也不清队列）—— 等打好包配上再发', async () => {
    vi.stubEnv("NOMI_INTAKE_ENDPOINT", undefined)
    const queue = await load()
    const client = await import('./intakeClient')
    const post = vi.spyOn(client, 'postIntake')
    queue.enqueueIntake('feedback', { summary: 'a' })
    await queue.flushIntakeQueue('feedback')
    expect(post).not.toHaveBeenCalled()
    expect(queue.readIntakeQueue('feedback')).toHaveLength(1)
  })

  it('过期的与超量的会被裁掉，队列不会无边界长大', async () => {
    const queue = await load()
    const stale = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
    fs.writeFileSync(path.join(root, 'intake-queue-feedback.json'), JSON.stringify({
      schemaVersion: 1,
      pending: [{ id: 'old', queuedAt: stale, payload: { summary: 'old' } }],
    }))
    expect(queue.readIntakeQueue('feedback')).toHaveLength(0)

    for (let index = 0; index < 60; index += 1) queue.enqueueIntake('feedback', { summary: `s-${index}` })
    const kept = queue.readIntakeQueue('feedback')
    expect(kept).toHaveLength(50)
    // 裁的是最旧的：最近出的问题才是用户在等的那个。
    expect(kept.at(-1)?.payload).toEqual({ summary: 's-59' })
  })

  it('同一种货物的 flush 不重入（两次调用共享一个在飞 promise）', async () => {
    const queue = await load()
    const client = await import('./intakeClient')
    queue.enqueueIntake('feedback', { summary: 'a' })
    let resolve: (value: { id: string }) => void = () => undefined
    vi.spyOn(client, 'postIntake').mockImplementation(() => new Promise((done) => { resolve = done }))
    const first = queue.flushIntakeQueue('feedback')
    const second = queue.flushIntakeQueue('feedback')
    expect(first).toBe(second)
    resolve({ id: 'NF-0915-0002' })
    await first
    queue.resetIntakeQueueTimers()
  })
})

describe('用户交来的货：先落盘再发', () => {
  it('发送还没回答时货已经在盘上：这时候关窗、断电都不丢', async () => {
    const queue = await load()
    const client = await import('./intakeClient')
    let answer: (value: { id: string }) => void = () => undefined
    vi.spyOn(client, 'postIntake').mockImplementation(() => new Promise((resolve) => { answer = resolve }))
    const submitted = queue.submitIntake('feedback', { summary: 'a' }, { waitMs: 60_000 })
    expect(queue.readIntakeQueue('feedback')).toHaveLength(1)
    answer({ id: 'NF-1101-0001' })
    await expect(submitted).resolves.toEqual({ status: 'delivered', result: { id: 'NF-1101-0001' }, shrunk: false })
    expect(queue.readIntakeQueue('feedback')).toEqual([])
  })

  it('同一件货不会同时发两次：用户那次发送和后台补发碰到一起', async () => {
    const queue = await load()
    const client = await import('./intakeClient')
    const answers: ((value: { id: string }) => void)[] = []
    const post = vi.spyOn(client, 'postIntake').mockImplementation(() => new Promise((resolve) => { answers.push(resolve) }))
    const submitted = queue.submitIntake('feedback', { summary: 'a' }, { waitMs: 5 })
    await expect(submitted).resolves.toEqual({ status: 'pending' })
    const flushed = queue.flushIntakeQueue('feedback')
    await Promise.resolve()
    expect(post).toHaveBeenCalledTimes(1)
    answers[0]({ id: 'NF-1101-0002' })
    await flushed
    expect(post).toHaveBeenCalledTimes(1)
    expect(queue.readIntakeQueue('feedback')).toEqual([])
  })

  it('送达之后顺手把上次留下的也带走', async () => {
    const queue = await load()
    const client = await import('./intakeClient')
    queue.enqueueIntake('feedback', { summary: 'old' })
    const post = vi.spyOn(client, 'postIntake').mockResolvedValue({ id: 'NF-1101-0003' })
    await queue.submitIntake('feedback', { summary: 'new' }, { waitMs: 60_000 })
    await queue.flushIntakeQueue('feedback')
    expect(post.mock.calls.map(([, payload]) => (payload as { summary: string }).summary).sort()).toEqual(['new', 'old'])
    expect(queue.readIntakeQueue('feedback')).toEqual([])
  })

  it('旧版留下的队列文件（没有新字段）能读能发', async () => {
    fs.writeFileSync(path.join(root, 'intake-queue-feedback.json'), JSON.stringify({
      schemaVersion: 1,
      pending: [{ id: 'from-old-version', queuedAt: new Date().toISOString(), payload: { summary: 'old' } }],
    }))
    const queue = await load()
    const client = await import('./intakeClient')
    const post = vi.spyOn(client, 'postIntake').mockResolvedValue({ id: 'NF-1101-0004' })
    await queue.flushIntakeQueue('feedback')
    expect(post).toHaveBeenCalledWith('/v1/feedback', { summary: 'old' })
    expect(queue.readIntakeQueue('feedback')).toEqual([])
  })
})

describe('接收端的回答分两种', () => {
  for (const status of [401, 403, 404, 429, 500, 503]) {
    it(`${status} 留在队列：更新 App 或过一会儿就可能好`, async () => {
      const queue = await load()
      const client = await import('./intakeClient')
      queue.enqueueIntake('feedback', { summary: 'a' })
      vi.spyOn(client, 'postIntake').mockRejectedValue(new client.IntakeHttpError(status))
      await queue.flushIntakeQueue('feedback')
      queue.resetIntakeQueueTimers()
      expect(queue.readIntakeQueue('feedback')).toHaveLength(1)
    })
  }

  it('400 重发也不会变：拿掉，不堵后面的', async () => {
    const queue = await load()
    const client = await import('./intakeClient')
    for (const summary of ['bad', 'good']) queue.enqueueIntake('feedback', { summary })
    const post = vi.spyOn(client, 'postIntake')
      .mockRejectedValueOnce(new client.IntakeHttpError(400))
      .mockResolvedValueOnce({ id: 'NF-1101-0005' })
    await queue.flushIntakeQueue('feedback')
    expect(post).toHaveBeenCalledTimes(2)
    expect(queue.readIntakeQueue('feedback')).toEqual([])
  })

  it('413 没有缩小办法：拿掉，不堵后面的', async () => {
    const queue = await load()
    const client = await import('./intakeClient')
    for (const summary of ['big', 'good']) queue.enqueueIntake('feedback', { summary })
    const post = vi.spyOn(client, 'postIntake')
      .mockRejectedValueOnce(new client.IntakeHttpError(413))
      .mockResolvedValueOnce({ id: 'NF-1101-0006' })
    await queue.flushIntakeQueue('feedback')
    expect(post).toHaveBeenCalledTimes(2)
    expect(queue.readIntakeQueue('feedback')).toEqual([])
  })

  it('413 缩一次：缩完还 413 就放弃，不转圈', async () => {
    const queue = await load()
    const client = await import('./intakeClient')
    queue.setIntakeTooLargeHandler('feedback', () => ({ summary: 'small' }))
    queue.enqueueIntake('feedback', { summary: 'big' })
    const post = vi.spyOn(client, 'postIntake').mockRejectedValue(new client.IntakeHttpError(413))
    await queue.flushIntakeQueue('feedback')
    expect(post.mock.calls.map(([, payload]) => payload)).toEqual([{ summary: 'big' }, { summary: 'small' }])
    expect(queue.readIntakeQueue('feedback')).toEqual([])
  })

  it('缩完后网断了：缩过的那份留在盘上，下次不用再撞一次 413', async () => {
    const queue = await load()
    const client = await import('./intakeClient')
    queue.setIntakeTooLargeHandler('feedback', () => ({ summary: 'small' }))
    queue.enqueueIntake('feedback', { summary: 'big' })
    vi.spyOn(client, 'postIntake')
      .mockRejectedValueOnce(new client.IntakeHttpError(413))
      .mockRejectedValueOnce(new Error('offline'))
    await queue.flushIntakeQueue('feedback')
    queue.resetIntakeQueueTimers()
    expect(queue.readIntakeQueue('feedback')).toMatchObject([{ payload: { summary: 'small' }, shrunk: true }])
  })
})

describe('重试：不用等下次启动', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  async function flushTimers(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms)
  }

  it('第一次发送失败就排上重试，恢复后不重启就送达（线上有报告晚到七天）', async () => {
    const queue = await load()
    const client = await import('./intakeClient')
    const post = vi.spyOn(client, 'postIntake')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ id: 'NF-1101-0007' })
    await expect(queue.submitIntake('feedback', { summary: 'a' }, { waitMs: 60_000 })).resolves.toEqual({ status: 'pending' })
    expect(queue.readIntakeQueue('feedback')).toHaveLength(1)
    await flushTimers(60_000)
    expect(post).toHaveBeenCalledTimes(2)
    expect(queue.readIntakeQueue('feedback')).toEqual([])
    queue.resetIntakeQueueTimers()
  })

  it('一直失败：间隔翻倍，封顶一小时；成功一次就归位', async () => {
    const queue = await load()
    const client = await import('./intakeClient')
    queue.enqueueIntake('feedback', { summary: 'a' })
    const post = vi.spyOn(client, 'postIntake').mockRejectedValue(new Error('offline'))
    await queue.flushIntakeQueue('feedback')
    expect(post).toHaveBeenCalledTimes(1)

    await flushTimers(60_000)
    expect(post).toHaveBeenCalledTimes(2)
    await flushTimers(60_000)
    expect(post).toHaveBeenCalledTimes(2) // 第二次要等两分钟
    await flushTimers(60_000)
    expect(post).toHaveBeenCalledTimes(3)

    // 一路翻倍到封顶之后，一小时一次。
    await flushTimers(4 * 60_000 + 8 * 60_000 + 16 * 60_000 + 32 * 60_000)
    expect(post).toHaveBeenCalledTimes(7)
    await flushTimers(59 * 60_000)
    expect(post).toHaveBeenCalledTimes(7)
    await flushTimers(60_000)
    expect(post).toHaveBeenCalledTimes(8)

    post.mockResolvedValue({ id: 'NF-1101-0008' })
    await flushTimers(60 * 60_000)
    expect(queue.readIntakeQueue('feedback')).toEqual([])

    post.mockClear()
    post.mockRejectedValue(new Error('offline'))
    queue.enqueueIntake('feedback', { summary: 'b' })
    await queue.flushIntakeQueue('feedback')
    await flushTimers(60_000)
    expect(post).toHaveBeenCalledTimes(2)
    queue.resetIntakeQueueTimers()
  })

  it('重试定时器只排一个：连着失败几次也不会叠起来', async () => {
    const queue = await load()
    const client = await import('./intakeClient')
    const post = vi.spyOn(client, 'postIntake').mockRejectedValue(new Error('offline'))
    await queue.submitIntake('feedback', { summary: 'a' }, { waitMs: 60_000 })
    await queue.submitIntake('feedback', { summary: 'b' }, { waitMs: 60_000 })
    expect(post).toHaveBeenCalledTimes(2)
    await flushTimers(60_000)
    expect(post).toHaveBeenCalledTimes(3)
    queue.resetIntakeQueueTimers()
  })
})
