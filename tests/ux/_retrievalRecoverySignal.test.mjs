// 回环夹具 HTTP 入口到达时序契约测试（#1705 走查真信号加固）：
// 证明：若第 4 笔 HTTP POST 在用户点击确认之前就已经发起（即使请求体延迟到确认后才读完记入 jobs），
// 确认前守卫（postInitiatedAt / inFlightPosts）与确认后时序守卫（receivedAt >= confirmClickedAt）都会当场拦红。
import http from 'node:http'
import { performance } from 'node:perf_hooks'
import { afterEach, describe, expect, it } from 'vitest'
import { createProcessFixtureServer } from './process-feedback-real-fixture.mjs'
import { assertNoPostBeforeConfirm, assertPostInitiatedAfterConfirm } from './_runRetrievalRecoverySteps.mjs'

const cleanup = []

afterEach(async () => {
  while (cleanup.length) {
    const fn = cleanup.pop()
    await fn()
  }
})

async function makeFixture(options = {}) {
  const provider = await createProcessFixtureServer(options)
  cleanup.push(async () => {
    await provider.close()
  })
  return provider
}

async function sendCompletePost(origin, prompt) {
  const response = await fetch(`${origin}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'agent-runtime-image', prompt }),
  })
  expect(response.status).toBe(200)
  return response.json()
}

/** 发起一笔 POST 并先冲刷请求头、暂不发完 body，模拟「确认前已发起、确认后才读完体记账」的竞态。 */
function startSlowBodyPost(origin, payload) {
  const url = new URL('/jobs', origin)
  const body = JSON.stringify(payload)
  let resolveResponse
  const done = new Promise((resolve, reject) => {
    resolveResponse = { resolve, reject }
  })
  const req = http.request({
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, (res) => {
    const chunks = []
    res.on('data', (chunk) => chunks.push(chunk))
    res.on('end', () => resolveResponse.resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
  })
  req.on('error', (error) => resolveResponse.reject(error))
  req.flushHeaders()
  return {
    finishBody() {
      req.end(body)
      return done
    },
  }
}

function nextTick() {
  return new Promise((resolve) => setImmediate(resolve))
}

describe('process-feedback-real-fixture HTTP 入口前置记账与确认时序守卫', () => {
  it('正例：前 3 笔完成后记录 confirmClickedAt，之后发起第 4 笔 POST → 通过', async () => {
    const provider = await makeFixture()
    const ctx = {
      posts: () => provider.jobs.length,
      postInitiatedAt: () => provider.postInitiatedAt(),
      inFlightPosts: () => provider.inFlightPosts(),
    }

    await sendCompletePost(provider.origin, 'shot-a')
    await sendCompletePost(provider.origin, 'shot-b')
    await sendCompletePost(provider.origin, 'shot-c')

    assertNoPostBeforeConfirm({ ...ctx, expectedBefore: 3, stage: 'before confirm' })
    const confirmClickedAt = performance.now()
    await sendCompletePost(provider.origin, 'shot-c-resend')

    const fourthAt = assertPostInitiatedAfterConfirm({
      ...ctx,
      expectedCount: 4,
      confirmClickedAt,
      stage: 'after confirm',
    })
    expect(fourthAt).toBeGreaterThanOrEqual(confirmClickedAt)
    expect(provider.postEvents.map((event) => event.seq)).toEqual([1, 2, 3, 4])
  })

  it('反例（核心假绿）：第 4 笔 POST 在确认前已到达入口但晚读完 body 记账 → 确认前与确认后守卫双双拦红', async () => {
    let notifyFourth
    const fourthArrived = new Promise((resolve) => {
      notifyFourth = resolve
    })
    const provider = await makeFixture({
      onPostInitiated(event) {
        if (event.seq === 4) notifyFourth(event)
      },
    })
    const ctx = {
      posts: () => provider.jobs.length,
      postInitiatedAt: () => provider.postInitiatedAt(),
      inFlightPosts: () => provider.inFlightPosts(),
    }

    await sendCompletePost(provider.origin, 'shot-a')
    await sendCompletePost(provider.origin, 'shot-b')
    await sendCompletePost(provider.origin, 'shot-c')

    // 模拟 bug：点击「重试」时就已经提前发出了第 4 笔 POST 请求头，但 body 还没发完。
    const premature = startSlowBodyPost(provider.origin, { model: 'agent-runtime-image', prompt: 'premature-4th' })
    const fourthEvent = await fourthArrived

    // 对照旧假绿条件：此时 jobs.length 仍然是 3（旧 `expect(posts()).toBe(3)` 会假绿通过！）
    expect(provider.jobs.length).toBe(3)
    expect(provider.inFlightPosts()).toBe(1)

    // 第一道防线：确认前守卫当场拦红（已发起 4 笔且在途 1 笔）
    expect(() => assertNoPostBeforeConfirm({ ...ctx, expectedBefore: 3, stage: 'before confirm' }))
      .toThrow(/initiated POST count at HTTP entry|no in-flight POST/)

    // 模拟即便越过了确认前检查，在「点确认」之后这笔提前发出的请求才把 body 发完记入 jobs
    await nextTick()
    const confirmClickedAt = Math.max(performance.now(), fourthEvent.receivedAt + 0.5)
    await premature.finishBody()
    expect(provider.jobs.length).toBe(4)

    // 第二道防线：确认后时序守卫核对第 4 笔入口到达时刻 < confirmClickedAt，照样拦红！
    expect(() => assertPostInitiatedAfterConfirm({
      ...ctx,
      expectedCount: 4,
      confirmClickedAt,
      stage: 'after confirm',
    })).toThrow(/before confirm click/)
  })

  it('反例：第 4 笔 POST 在 confirmClickedAt 之前就已完成 → 必红拦截', async () => {
    const provider = await makeFixture()
    const ctx = {
      posts: () => provider.jobs.length,
      postInitiatedAt: () => provider.postInitiatedAt(),
      inFlightPosts: () => provider.inFlightPosts(),
    }

    await sendCompletePost(provider.origin, 'shot-a')
    await sendCompletePost(provider.origin, 'shot-b')
    await sendCompletePost(provider.origin, 'shot-c')
    await sendCompletePost(provider.origin, 'shot-early')
    await nextTick()
    const confirmClickedAt = Math.max(performance.now(), provider.postInitiatedAt()[3] + 0.5)

    expect(() => assertPostInitiatedAfterConfirm({
      ...ctx,
      expectedCount: 4,
      confirmClickedAt,
      stage: 'after confirm',
    })).toThrow(/before confirm click/)
  })

  it('反例：缺传 postInitiatedAt / inFlightPosts → fail-closed 抛错，不静默放行', () => {
    expect(() => assertNoPostBeforeConfirm({ posts: () => 3, expectedBefore: 3 }))
      .toThrow(/postInitiatedAt 与 inFlightPosts 必填/)
    expect(() => assertPostInitiatedAfterConfirm({ posts: () => 4, expectedCount: 4, confirmClickedAt: 1 }))
      .toThrow(/postInitiatedAt 与 inFlightPosts 必填/)
  })
})
