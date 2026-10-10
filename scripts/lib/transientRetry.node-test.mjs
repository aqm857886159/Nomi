import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { makeTempDir } from '../_test-temp.mjs'
import {
  assertGhReadOnly,
  execGhReadSync,
  fetchWithRetry,
  isTransientError,
  retryTransient,
  retryTransientSync,
} from './transientRetry.mjs'

const noSleep = async () => {}
const fetchFailed = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })

test('瞬断后重试成功，退避逐次翻倍', async () => {
  let calls = 0
  const sleeps = []
  const value = await retryTransient(async () => {
    calls += 1
    if (calls < 3) throw fetchFailed()
    return 'ok'
  }, { baseDelayMs: 100, sleep: async (ms) => { sleeps.push(ms) } })
  assert.equal(value, 'ok')
  assert.equal(calls, 3)
  assert.deepEqual(sleeps, [100, 200])
})

test('非瞬断（4xx / 权限 / 形状不对 / 域名不存在）立刻失败，只调用一次', async () => {
  for (const error of [
    Object.assign(new Error('GitHub API request failed with HTTP 403'), { httpStatus: 403 }),
    Object.assign(new Error('gh: Resource not accessible by integration (HTTP 403)'), { stderr: 'HTTP 403' }),
    new Error('Unexpected token < in JSON'),
    Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }),
  ]) {
    let calls = 0
    await assert.rejects(
      retryTransient(async () => { calls += 1; throw error }, { sleep: noSleep }),
      (thrown) => thrown === error && !/重试/.test(thrown.message),
    )
    assert.equal(calls, 1, error.message)
  }
})

test('次数用完：抛最后一个错误，message 写明重试几次', async () => {
  let calls = 0
  await assert.rejects(
    retryTransient(async () => { calls += 1; throw fetchFailed() }, { attempts: 4, sleep: noSleep }),
    (error) => /fetch failed.*重试 3 次后仍失败，共尝试 4 次/u.test(error.message) && error.retryAttempts === 4,
  )
  assert.equal(calls, 4)
})

test('isTransientError 认得 fetch / 子进程 / gh / git 的网络错误，不认被自己的超时杀掉的子进程', () => {
  assert.equal(isTransientError(fetchFailed()), true)
  assert.equal(isTransientError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })), true)
  assert.equal(isTransientError(Object.assign(new Error('Command failed: gh api'), { stderr: Buffer.from('error connecting to api.github.com') })), true)
  assert.equal(isTransientError(Object.assign(new Error('Command failed: gh api'), { stderr: 'gh: HTTP 502: Bad Gateway' })), true)
  assert.equal(isTransientError({ message: 'x', details: { stderr: 'fatal: unable to access remote: Could not resolve host: github.com' } }), true)
  assert.equal(isTransientError(Object.assign(new Error('x'), { code: 'ETIMEDOUT', signal: 'SIGKILL' })), false)
  assert.equal(isTransientError(Object.assign(new Error('gh: Not Found (HTTP 404)'), { stderr: 'HTTP 404' })), false)
  assert.equal(isTransientError('fetch failed'), false)
})

test('同步版：瞬断后成功 / 非瞬断不重试', () => {
  let calls = 0
  const sleeps = []
  assert.equal(retryTransientSync(() => { calls += 1; if (calls === 1) throw fetchFailed(); return 'ok' }, { sleep: (ms) => sleeps.push(ms) }), 'ok')
  assert.equal(sleeps.length, 1)
  let hard = 0
  assert.throws(() => retryTransientSync(() => { hard += 1; throw new Error('HTTP 404') }, { sleep: () => {} }), /HTTP 404/)
  assert.equal(hard, 1)
})

test('fetchWithRetry：5xx 重试、4xx 原样返回给调用方、写方法进不来', async () => {
  let calls = 0
  const response = await fetchWithRetry('https://api.github.com/x', {}, {
    fetchImpl: async () => { calls += 1; return calls === 1 ? { ok: false, status: 503 } : { ok: true, status: 200 } },
    sleep: noSleep,
  })
  assert.equal(response.status, 200)
  assert.equal(calls, 2)

  const denied = await fetchWithRetry('https://api.github.com/x', {}, { fetchImpl: async () => ({ ok: false, status: 404 }), sleep: noSleep })
  assert.equal(denied.status, 404)

  await assert.rejects(
    fetchWithRetry('https://api.github.com/x', {}, { fetchImpl: async () => ({ ok: false, status: 500 }), sleep: noSleep }),
    /HTTP 500.*重试 2 次后仍失败/u,
  )
  await assert.rejects(fetchWithRetry('https://api.github.com/x', { method: 'POST' }, { fetchImpl: async () => ({ ok: true, status: 200 }) }), /只给只读请求/)
})

test('gh 只读校验：写命令、POST、隐式 POST、mutation 都进不来', () => {
  for (const args of [
    ['pr', 'view', '1', '--json', 'body'],
    ['api', '--method', 'GET', '/repos/a/b'],
    ['api', 'repos/a/b/pulls/1/files', '--paginate', '--jq', '.[]'],
    ['api', 'graphql', '-f', 'query=query{viewer{login}}', '-F', 'owner=a'],
    ['issue', 'list', '--repo', 'a/b'],
  ]) assert.doesNotThrow(() => assertGhReadOnly(args), args.join(' '))
  for (const args of [
    ['pr', 'merge', '1'],
    ['pr', 'create'],
    ['issue', 'comment', '1'],
    ['release', 'upload', 'v1'],
    ['api', '--method', 'POST', '/x'],
    ['api', '-X', 'DELETE', '/x'],
    ['api', '/x', '-f', 'a=b'],
    ['api', 'graphql', '-f', 'query=mutation{x}'],
  ]) assert.throws(() => assertGhReadOnly(args), /execGhReadSync/, args.join(' '))
})

test('execGhReadSync 用真子进程：先瞬断一次再成功；404 只试一次', () => {
  const dir = makeTempDir('nomi-gh-retry-')
  try {
    const counter = path.join(dir, 'count')
    const script = path.join(dir, 'fake-gh.mjs')
    fs.writeFileSync(script, [
      "import fs from 'node:fs'",
      `const file = ${JSON.stringify(counter)}`,
      "const n = fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf8')) : 0",
      'fs.writeFileSync(file, String(n + 1))',
      "if (process.argv[2] === 'hard') { console.error('gh: Not Found (HTTP 404)'); process.exit(1) }",
      "if (n === 0) { console.error('error connecting to api.github.com'); process.exit(1) }",
      "console.log('done')",
      '',
    ].join('\n'))
    const out = execGhReadSync([script], { bin: process.execPath }, { sleep: () => {} })
    assert.equal(out.trim(), 'done')
    assert.equal(fs.readFileSync(counter, 'utf8'), '2')
    fs.writeFileSync(counter, '0')
    assert.throws(() => execGhReadSync([script, 'hard'], { bin: process.execPath }, { sleep: () => {} }), /Command failed/)
    assert.equal(fs.readFileSync(counter, 'utf8'), '1')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
