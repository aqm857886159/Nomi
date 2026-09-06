/**
 * TikHub 检索层的夹具测试：**一次都不打真网**。
 *
 * 覆盖五条真会翻车的路径（每条都是一次真实事故形状）：
 *   1. 缺 key —— 必须 fail-closed 抛出那句原话，不许静默返回空结果
 *   2. 401 —— 不重试（重试只会白烧配额），且响应里回显的 token 必须被抹成 ***
 *   3. 429 限流 —— 按指数退避重试，认 Retry-After，重试次数有硬上限
 *   4. 分页拼接 —— 多页游标接得上、攒够 limit 就停、服务端说没了就停
 *   5. 字段缺失容错 —— 少字段不许让整条记录崩掉，要落进 missingFields
 *
 * 等待全部走注入的假 sleep（R18：测试不许靠墙钟；真 sleep 会让这个文件慢且 flaky）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TikHubConfigError,
  TikHubHttpError,
  backoffDelayMs,
  extractToolMentions,
  isRetriableStatus,
  PLATFORMS,
  readApiKey,
  renderMarkdown,
  requestJson,
  resolvePlatforms,
  searchPlatform,
  toRecord,
  toIsoTimestamp,
} from './tikhub-search-lib.mjs'

const FAKE_KEY = 'fixture-token-not-a-real-key'

/** 按脚本依次应答的假 fetch；顺带记下每次请求，方便断言翻页参数真的变了。 */
function stubFetch(responses) {
  const calls = []
  const queue = [...responses]
  const impl = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null })
    const next = queue.shift()
    if (!next) throw new Error(`夹具用光了，但代码又发了一次请求：${url}`)
    if (typeof next === 'function') return next(url, init)
    const { status = 200, json = {}, text = '', headers = {} } = next
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => headers[name.toLowerCase()] ?? null },
      json: async () => json,
      text: async () => text,
    }
  }
  return { impl, calls }
}

function recordingSleep() {
  const slept = []
  return { slept, sleep: async (ms) => { slept.push(ms) } }
}

// ── 1. 缺 key ─────────────────────────────────────────────
test('缺 key：抛出那句原话，不返回空结果', () => {
  assert.throws(() => readApiKey({}), (error) => {
    assert.ok(error instanceof TikHubConfigError)
    assert.equal(error.message, 'TikHub 未配置：TIKHUB_API_KEY 为空，今天没查成')
    return true
  })
  // 纯空白也算缺——`export TIKHUB_API_KEY=" "` 是真实会发生的手滑。
  assert.throws(() => readApiKey({ TIKHUB_API_KEY: '   ' }), TikHubConfigError)
  assert.equal(readApiKey({ TIKHUB_API_KEY: ' abc ' }), 'abc')
})

test('平台名打错要报错，不许静默跳过', () => {
  assert.throws(() => resolvePlatforms('douyin,weibo'), /weibo/u)
  assert.equal(resolvePlatforms('all').length, 4)
  assert.deepEqual(resolvePlatforms('xhs,bilibili').map((p) => p.id), ['xhs', 'bilibili'])
})

// ── 2. 401 ────────────────────────────────────────────────
test('401：不重试，且响应里回显的 token 被抹成 ***', async () => {
  const { impl, calls } = stubFetch([
    { status: 401, text: `Invalid API token, your submitted API token is ${FAKE_KEY}.` },
  ])
  const { slept, sleep } = recordingSleep()
  await assert.rejects(
    requestJson({ path: '/api/v1/x', apiKey: FAKE_KEY, fetchImpl: impl, sleep }),
    (error) => {
      assert.ok(error instanceof TikHubHttpError)
      assert.equal(error.status, 401)
      assert.equal(error.retriable, false)
      assert.ok(!error.message.includes(FAKE_KEY), '错误信息里泄漏了 key')
      assert.ok(error.message.includes('***'))
      return true
    },
  )
  assert.equal(calls.length, 1, '401 被重试了——白烧配额')
  assert.deepEqual(slept, [])
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${FAKE_KEY}`)
})

test('422 参数错同样不重试', () => {
  assert.equal(isRetriableStatus(422), false)
  assert.equal(isRetriableStatus(401), false)
  assert.equal(isRetriableStatus(429), true)
  assert.equal(isRetriableStatus(503), true)
})

// ── 3. 限流退避 ────────────────────────────────────────────
test('429：指数退避重试，且重试次数有硬上限', async () => {
  const { impl, calls } = stubFetch([
    { status: 429, text: 'rate limited' },
    { status: 429, text: 'rate limited' },
    { status: 200, json: { code: 200, data: { ok: true } } },
  ])
  const { slept, sleep } = recordingSleep()
  const payload = await requestJson({ path: '/api/v1/x', apiKey: FAKE_KEY, fetchImpl: impl, sleep, maxAttempts: 3 })
  assert.deepEqual(payload, { code: 200, data: { ok: true } })
  assert.equal(calls.length, 3)
  assert.deepEqual(slept, [1000, 2000], '退避不是 1s→2s 指数')
})

test('429 一直红：到 maxAttempts 就放弃，不无限重试', async () => {
  const { impl, calls } = stubFetch([
    { status: 429, text: 'rate limited' },
    { status: 429, text: 'rate limited' },
    { status: 429, text: 'rate limited' },
  ])
  const { slept, sleep } = recordingSleep()
  await assert.rejects(
    requestJson({ path: '/api/v1/x', apiKey: FAKE_KEY, fetchImpl: impl, sleep, maxAttempts: 3 }),
    /429/u,
  )
  assert.equal(calls.length, 3)
  assert.equal(slept.length, 2)
})

test('Retry-After 头压过指数退避', async () => {
  const { impl } = stubFetch([
    { status: 429, text: 'slow down', headers: { 'retry-after': '5' } },
    { status: 200, json: { code: 200 } },
  ])
  const { slept, sleep } = recordingSleep()
  await requestJson({ path: '/api/v1/x', apiKey: FAKE_KEY, fetchImpl: impl, sleep })
  assert.deepEqual(slept, [5000])
  assert.equal(backoffDelayMs(1, 5000), 5000)
  assert.equal(backoffDelayMs(3, null), 4000)
})

test('网络层报错也重试，且错误信息不带 key', async () => {
  const { impl } = stubFetch([
    () => { throw new Error(`connect ECONNREFUSED (token=${FAKE_KEY})`) },
    () => { throw new Error(`connect ECONNREFUSED (token=${FAKE_KEY})`) },
  ])
  const { sleep } = recordingSleep()
  await assert.rejects(
    requestJson({ path: '/api/v1/x', apiKey: FAKE_KEY, fetchImpl: impl, sleep, maxAttempts: 2 }),
    (error) => {
      assert.ok(!error.message.includes(FAKE_KEY))
      assert.equal(error.name, 'TikHubNetworkError')
      return true
    },
  )
})

// ── 4. 分页拼接 ────────────────────────────────────────────
/** 抖音真实响应形状（对照免费 demo 端点 /api/v1/demo/douyin_search/app/general_search）。 */
function douyinPage(ids, { hasMore, cursor }) {
  return {
    code: 200,
    data: {
      status_code: 0,
      cursor,
      has_more: hasMore ? 1 : 0,
      backtrace: `bt-${cursor}`,
      extra: { logid: `logid-${cursor}` },
      data: ids.map((id) => ({
        type: 1,
        aweme_info: {
          aweme_id: String(id),
          desc: `第 ${id} 条：我用 ComfyUI 和 可灵 做了个片子 #Seedance 2.0`,
          create_time: 1_788_000_000 + id,
          share_url: `https://www.iesdouyin.com/share/video/${id}/`,
          author: { uid: `u${id}`, nickname: `作者${id}` },
        },
      })),
    },
  }
}

test('分页：两页拼起来，游标从上一页的响应里取', async () => {
  const { impl, calls } = stubFetch([
    { json: douyinPage([1, 2, 3], { hasMore: true, cursor: 20 }) },
    { json: douyinPage([4, 5], { hasMore: false, cursor: 40 }) },
  ])
  const { sleep } = recordingSleep()
  const group = await searchPlatform({
    platform: PLATFORMS.douyin,
    keyword: 'ComfyUI',
    limit: 10,
    apiKey: FAKE_KEY,
    fetchImpl: impl,
    sleep,
  })
  assert.equal(group.records.length, 5)
  assert.deepEqual(group.records.map((r) => r.id), ['1', '2', '3', '4', '5'])
  assert.deepEqual(group.pages, [{ page: 1, received: 3 }, { page: 2, received: 2 }])
  assert.equal(calls[0].body.cursor, 0)
  assert.equal(calls[1].body.cursor, 20, '第二页没带上一页返回的 cursor')
  assert.equal(calls[1].body.search_id, 'logid-20')
  assert.equal(calls[1].body.backtrace, 'bt-20')
})

test('分页：攒够 limit 就停，不多要一页', async () => {
  const { impl, calls } = stubFetch([{ json: douyinPage([1, 2, 3], { hasMore: true, cursor: 20 }) }])
  const { sleep } = recordingSleep()
  const group = await searchPlatform({
    platform: PLATFORMS.douyin, keyword: 'x', limit: 2, apiKey: FAKE_KEY, fetchImpl: impl, sleep,
  })
  assert.equal(group.records.length, 2)
  assert.equal(calls.length, 1)
})

test('分页：--since 在客户端精筛，时间早于门槛的丢掉', async () => {
  const { impl } = stubFetch([{ json: douyinPage([1, 2], { hasMore: false, cursor: 20 }) }])
  const { sleep } = recordingSleep()
  const sinceMs = (1_788_000_002) * 1000
  const group = await searchPlatform({
    platform: PLATFORMS.douyin, keyword: 'x', limit: 10, sinceMs, nowMs: sinceMs + 86_400_000,
    apiKey: FAKE_KEY, fetchImpl: impl, sleep,
  })
  assert.deepEqual(group.records.map((r) => r.id), ['2'])
})

test('分页：空页立刻停，不会打到 MAX_PAGES', async () => {
  const { impl, calls } = stubFetch([{ json: { code: 200, data: { data: [], has_more: 1, cursor: 20 } } }])
  const { sleep } = recordingSleep()
  const group = await searchPlatform({
    platform: PLATFORMS.douyin, keyword: 'x', limit: 50, apiKey: FAKE_KEY, fetchImpl: impl, sleep,
  })
  assert.equal(group.records.length, 0)
  assert.equal(calls.length, 1)
})

// ── 5. 字段缺失容错 ────────────────────────────────────────
test('字段缺失：不崩、留空、记进 missingFields', () => {
  const record = toRecord(PLATFORMS.douyin, { aweme_info: { desc: '只有正文，没作者没时间' } })
  assert.equal(record.platform, 'douyin')
  assert.equal(record.author, null)
  assert.equal(record.publishedAt, null)
  assert.equal(record.url, null)
  assert.deepEqual(record.missingFields.sort(), ['author', 'publishedAt', 'url'])
  assert.equal(record.excerpt, '只有正文，没作者没时间')
})

test('字段缺失：整个 item 是空对象也不抛', () => {
  for (const platform of Object.values(PLATFORMS)) {
    const record = toRecord(platform, {})
    assert.equal(record.platform, platform.id)
    assert.equal(record.excerpt, '')
    assert.ok(record.missingFields.includes('url'))
  }
})

test('摘要是原文前 300 字，不改写', () => {
  const long = '甲'.repeat(400)
  const record = toRecord(PLATFORMS.douyin, { aweme_info: { desc: long } })
  assert.equal(record.excerpt.length, 301, '应当是 300 字 + 省略号')
  assert.ok(record.excerpt.startsWith('甲'.repeat(300)))
  assert.ok(record.excerpt.endsWith('…'))
})

test('时间戳：秒/毫秒/字符串都认，认不出返回 null', () => {
  assert.equal(toIsoTimestamp(1_788_000_000), '2026-08-29T10:40:00.000Z')
  assert.equal(toIsoTimestamp(1_788_000_000_000), '2026-08-29T10:40:00.000Z')
  assert.equal(toIsoTimestamp('2026-01-02'), '2026-01-02T00:00:00.000Z')
  assert.equal(toIsoTimestamp(''), null)
  assert.equal(toIsoTimestamp('不是时间'), null)
  assert.equal(toIsoTimestamp(0), null)
})

test('框架/工具名正则抽取：词表词 + 话题标签 + 带版本号的产品名', () => {
  const mentions = extractToolMentions('我先用 ComfyUI 出图，再丢进 可灵 里，#Seedance 2.0 也试了')
  assert.ok(mentions.includes('ComfyUI'))
  assert.ok(mentions.includes('可灵'))
  assert.ok(mentions.includes('Seedance'))
  assert.deepEqual(extractToolMentions(''), [])
  // 「Confusion」不该因为含 Comfy 前缀就被当成 ComfyUI（ASCII 词有 word boundary）。
  assert.ok(!extractToolMentions('Comfyui-ish 不算').includes('Stable Diffusion'))
})

test('B站标题里的高亮标签要剥掉', () => {
  const record = toRecord(PLATFORMS.bilibili, {
    bvid: 'BV1xx', title: '用 <em class="keyword">ComfyUI</em> 做动画', author: 'UP主', pubdate: 1_788_000_000,
  })
  assert.equal(record.title, '用 ComfyUI 做动画')
  assert.equal(record.url, 'https://www.bilibili.com/video/BV1xx')
  assert.deepEqual(record.missingFields, [])
})

test('Markdown 渲染：出处/平台/作者/时间/摘要/提及六件都在', () => {
  const group = { platform: 'douyin', platformLabel: '抖音', records: [toRecord(PLATFORMS.douyin, {
    aweme_info: {
      aweme_id: '7', desc: 'ComfyUI 真香', create_time: 1_788_000_000,
      share_url: 'https://example.invalid/7', author: { uid: 'u7', nickname: '张三' },
    },
  })] }
  const md = renderMarkdown({ keyword: 'ComfyUI', since: null, generatedAt: '2026-09-06T00:00:00.000Z', results: [group] })
  for (const needle of ['https://example.invalid/7', '抖音', '张三', 'ComfyUI 真香', '提到的框架/工具']) {
    assert.ok(md.includes(needle), `渲染结果里少了 ${needle}`)
  }
  assert.ok(md.includes('原文前 300 字'))
})
