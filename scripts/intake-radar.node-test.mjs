import { makeTempDir } from './_test-temp.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { run } from './intake-radar.mjs'
import { readState, rawFilePath } from './lib/intake-radar/store.mjs'

function tmpCacheDir() {
  return makeTempDir('intake-radar-test-')
}

const OK_CREDENTIALS = () => ({ accountId: 'test-account', token: 'test-token' })

function fakeFeedbackContent(id) {
  // 占位内容，不含真实用户文本——只是让 JSON 能解析、字段齐全。
  return JSON.stringify({
    schemaVersion: 1,
    receivedAt: '2026-09-28T00:00:00.000Z',
    route: '/v1/feedback',
    receipt: id,
    ref: id,
    payload: { schemaVersion: 1, manifest: { app: { version: '0.22.3' }, system: { platform: 'win32', locale: 'zh-CN' } }, context: { surface: 'generation', summary: '占位摘要', errorCode: 'unknown', note: null, provider: 'custom', model: null }, attachments: {} },
  })
}

/** 一个极简的 R2 REST 模拟器：list 按 prefix 查表，get 按 key 查表。
 *  记录每一次 get 调用的 key，方便断言"已经在磁盘上的键不该再打网络请求"。 */
function makeFakeFetch({ objectsByPrefix, getLog = [] }) {
  const fetchImpl = async (url) => {
    const u = new URL(url)
    if (u.pathname.endsWith('/objects')) {
      const prefix = u.searchParams.get('prefix')
      const keys = objectsByPrefix[prefix] ?? []
      return { ok: true, json: async () => ({ success: true, result: keys.map((k) => ({ key: k })), result_info: { is_truncated: false, cursor: '' } }) }
    }
    const match = /\/objects\/(.+)$/.exec(u.pathname)
    const key = decodeURIComponent(match[1])
    getLog.push(key)
    const content = fakeFeedbackContent(key.split('/').pop().replace('.json', ''))
    return { ok: true, arrayBuffer: async () => Buffer.from(content) }
  }
  return { fetchImpl, getLog }
}

test('run(): 凭据解析失败 → 返回 1，不碰缓存目录', async () => {
  const cacheDir = tmpCacheDir()
  const errors = []
  const code = await run({
    cacheDirOverride: cacheDir,
    resolveCredentialsImpl: () => { throw new Error('拿不到 token') },
    errorLog: (msg) => errors.push(msg),
    log: () => {},
  })
  assert.equal(code, 1)
  assert.ok(errors.some((m) => m.includes('今天没查成')), `expected "今天没查成" in ${JSON.stringify(errors)}`)
  assert.equal(fs.existsSync(path.join(cacheDir, 'state.json')), false)
})

test('run(): list 失败 → 返回 1，明说"今天没查成"，不写 state', async () => {
  const cacheDir = tmpCacheDir()
  const errors = []
  const failingFetch = async () => ({ ok: false, status: 500, json: async () => ({}) })
  const code = await run({
    cacheDirOverride: cacheDir,
    resolveCredentialsImpl: OK_CREDENTIALS,
    fetchImpl: failingFetch,
    errorLog: (msg) => errors.push(msg),
    log: () => {},
  })
  assert.equal(code, 1)
  assert.ok(errors.some((m) => m.includes('今天没查成')))
  assert.equal(fs.existsSync(path.join(cacheDir, 'state.json')), false)
})

test('run(): 首次成功运行 → 全部键都算新的，写 state + 报告', async () => {
  const cacheDir = tmpCacheDir()
  const { fetchImpl, getLog } = makeFakeFetch({ objectsByPrefix: { 'feedback/': ['feedback/2026-09-27/a.json'], 'events/': [], 'trajectories/': [] } })
  const logs = []
  const code = await run({
    cacheDirOverride: cacheDir,
    resolveCredentialsImpl: OK_CREDENTIALS,
    fetchImpl,
    now: () => new Date('2026-09-29T08:00:00.000Z'),
    log: (msg) => logs.push(msg),
    errorLog: () => {},
  })
  assert.equal(code, 0)
  assert.deepEqual(getLog, ['feedback/2026-09-27/a.json'])
  assert.ok(fs.existsSync(rawFilePath(cacheDir, 'feedback/2026-09-27/a.json')))

  const state = readState(cacheDir)
  assert.ok(state.seenKeys['feedback/2026-09-27/a.json'])
  assert.equal(state.lastRunOk, true)

  assert.ok(fs.existsSync(path.join(cacheDir, 'reports', '2026-09-29.md')))
  assert.ok(fs.existsSync(path.join(cacheDir, 'reports', '2026-09-29.json')))
  const reportJson = JSON.parse(fs.readFileSync(path.join(cacheDir, 'reports', '2026-09-29.json'), 'utf8'))
  assert.equal(reportJson.totals.newFeedbackCount, 1)
  assert.ok(logs.length > 0)
})

test('run(): 第二轮只把新键算"新增"，已见过的键不再重复下载', async () => {
  const cacheDir = tmpCacheDir()
  const shared = { objectsByPrefix: { 'feedback/': ['feedback/2026-09-27/a.json'], 'events/': [], 'trajectories/': [] } }

  const first = makeFakeFetch(shared)
  await run({ cacheDirOverride: cacheDir, resolveCredentialsImpl: OK_CREDENTIALS, fetchImpl: first.fetchImpl, now: () => new Date('2026-09-29T08:00:00.000Z'), log: () => {}, errorLog: () => {} })

  // 第二轮：R2 上多了一个新键，旧键还在。
  shared.objectsByPrefix['feedback/'].push('feedback/2026-09-29/b.json')
  const second = makeFakeFetch(shared)
  const logs2 = []
  const code2 = await run({ cacheDirOverride: cacheDir, resolveCredentialsImpl: OK_CREDENTIALS, fetchImpl: second.fetchImpl, now: () => new Date('2026-09-29T09:00:00.000Z'), log: (m) => logs2.push(m), errorLog: () => {} })

  assert.equal(code2, 0)
  // 旧键已经在磁盘上（第一轮下载过）——第二轮不该再为它打一次 get。
  assert.deepEqual(second.getLog, ['feedback/2026-09-29/b.json'])

  const reportJson = JSON.parse(fs.readFileSync(path.join(cacheDir, 'reports', '2026-09-29.json'), 'utf8'))
  assert.equal(reportJson.totals.feedbackCount, 2) // 累计两条
  assert.equal(reportJson.totals.newFeedbackCount, 1) // 但本轮只有一条"新"
  assert.deepEqual(reportJson.newFeedback.map((i) => i.id), ['b'])
})

test('run(): 缓存目录里已经有文件、但 state.json 是空的（比如复用了别的下载脚本产出的缓存）→ 当成全部"新"，且不重新下载已存在的文件', async () => {
  const cacheDir = tmpCacheDir()
  // 模拟 D:\tmp\intake-pull.mjs 已经下载过的场景：raw 文件已经在磁盘上，但从没跑过这份 state.json。
  const preExistingKey = 'feedback/2026-09-27/pre.json'
  const dest = rawFilePath(cacheDir, preExistingKey)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, fakeFeedbackContent('pre'))

  const { fetchImpl, getLog } = makeFakeFetch({ objectsByPrefix: { 'feedback/': [preExistingKey], 'events/': [], 'trajectories/': [] } })
  const code = await run({ cacheDirOverride: cacheDir, resolveCredentialsImpl: OK_CREDENTIALS, fetchImpl, now: () => new Date('2026-09-29T08:00:00.000Z'), log: () => {}, errorLog: () => {} })

  assert.equal(code, 0)
  assert.deepEqual(getLog, [], '文件已经在磁盘上，不该再触发一次 get 网络请求')
  const reportJson = JSON.parse(fs.readFileSync(path.join(cacheDir, 'reports', '2026-09-29.json'), 'utf8'))
  assert.equal(reportJson.totals.newFeedbackCount, 1, '第一次跑这份雷达时，预先存在的文件仍应算"新"（state 里从没见过）')
})

test('run(): 单个 get 失败 → 整轮返回 1，明说"今天没查成"', async () => {
  const cacheDir = tmpCacheDir()
  const fetchImpl = async (url) => {
    const u = new URL(url)
    if (u.pathname.endsWith('/objects')) {
      return { ok: true, json: async () => ({ success: true, result: [{ key: 'feedback/2026-09-27/a.json' }], result_info: { is_truncated: false, cursor: '' } }) }
    }
    return { ok: false, status: 404 }
  }
  const errors = []
  const code = await run({ cacheDirOverride: cacheDir, resolveCredentialsImpl: OK_CREDENTIALS, fetchImpl, errorLog: (m) => errors.push(m), log: () => {} })
  assert.equal(code, 1)
  assert.ok(errors.some((m) => m.includes('今天没查成')))
})
