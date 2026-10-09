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
