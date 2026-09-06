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
  summarizeResults,
  XHS_TIME_FILTERS,
  xhsTimeFilter,
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

test('400 可重试：这套 API 的参数错是 422，400 只可能是上游抓取抖动', () => {
  // 依据实测（notes §5）：枚举填错返回 200、schema 不合返回 422，
  // 所以 400 不可能是「我们问错了」。把它当致命错，一次抖动就抹掉整个平台。
  assert.equal(isRetriableStatus(400), true)
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
  for (const needle of ['https://www.douyin.com/video/7', '抖音', '张三', 'ComfyUI 真香', '提到的框架/工具']) {
    assert.ok(md.includes(needle), `渲染结果里少了 ${needle}`)
  }
  assert.ok(md.includes('原文前 300 字'))
})

// ── 6. 真实响应形状回归 ────────────────────────────────────
/**
 * 下面四段夹具是 **2026-09-06 用真实 key 各抓一次**、逐字段对完账后按原样**结构**
 * 缩写而成（值已脱敏：token/链接换成 fixture 值，嵌套层级一层不改）。
 *
 * 为什么必须钉结构而不是钉字段名：这四家翻车过的地方全在**外层包了几层**，
 * 而包错的代价是 HTTP 200 + 退出码 0 + 0 条记录——报告里和「今天没人聊」一模一样。
 * 所以每条都断言「条数」而不只是「不抛」。
 */

/** 小红书：条目在 `data.data.items[]`，比其它三家多包一层信封。 */
function xhsPage({ items, page = 1, nextPage = 2 }) {
  return {
    code: 200,
    data: {
      code: 0,
      success: true,
      page,
      next_page: nextPage,
      search_id: `sid-${page}`,
      search_session_id: `ssid-${page}`,
      data: {
        items: items.map((n) => ({
          mix_track_id: `NOTE__${n}`,
          model_type: 'note',
          note: {
            id: `note${n}`,
            title: `第 ${n} 条：我用 ComfyUI 出片`,
            desc: `正文 ${n}`,
            timestamp: 1_788_000_000 + n,
            type: 'normal',
            xsec_token: `tok${n}`,
            user: { nickname: `小红薯${n}`, userid: `uid${n}`, red_id: `red${n}` },
          },
        })),
      },
    },
  }
}

test('小红书：条目在 data.data.items，不是 data.items（曾静默返回 0 条）', () => {
  const items = PLATFORMS.xhs.itemsOf(xhsPage({ items: [1, 2, 3] }))
  assert.equal(items.length, 3, 'itemsOf 没扒到 data.data.items —— 这正是那次「200 但 0 条」的形状')
  const record = toRecord(PLATFORMS.xhs, items[0])
  assert.deepEqual(record.missingFields, [])
  assert.equal(record.id, 'note1')
  assert.equal(record.author, '小红薯1')
  assert.equal(record.authorId, 'uid1')
  assert.equal(record.title, '第 1 条：我用 ComfyUI 出片')
  assert.equal(record.publishedAt, new Date(1_788_000_001 * 1000).toISOString())
  // 不带 xsec_token 的 /explore/<id> 对未登录访客打不开，链接必须带上。
  assert.equal(record.url, 'https://www.xiaohongshu.com/explore/note1?xsec_token=tok1&xsec_source=pc_search')
  assert.equal(record.fieldConfidence, 'verified-against-live-response')
  assert.equal(record.fieldsVerifiedOn, '2026-09-06')
})

test('小红书：非 note 卡片（广告/用户）在归一前剔掉', () => {
  const payload = xhsPage({ items: [1] })
  payload.data.data.items.push({ model_type: 'user', user: { nickname: '某账号' } })
  assert.equal(PLATFORMS.xhs.itemsOf(payload).length, 1)
})

test('小红书翻页：认服务端的 next_page，给不出就停（不自己 +1 硬翻）', async () => {
  const { impl, calls } = stubFetch([
    { json: xhsPage({ items: [1, 2], page: 1, nextPage: 2 }) },
    { json: xhsPage({ items: [3], page: 2, nextPage: 0 }) },
  ])
  const { sleep } = recordingSleep()
  const group = await searchPlatform({
    platform: PLATFORMS.xhs, keyword: 'ComfyUI', limit: 10, apiKey: FAKE_KEY, fetchImpl: impl, sleep,
  })
  assert.equal(group.records.length, 3)
  const secondUrl = new URL(calls[1].url)
  assert.equal(secondUrl.searchParams.get('page'), '2')
  assert.equal(secondUrl.searchParams.get('search_id'), 'sid-1', '翻页没回传首次搜索的 search_id')
  assert.equal(secondUrl.searchParams.get('search_session_id'), 'ssid-1')
  assert.equal(calls.length, 2, 'next_page 为 0 之后还在继续翻')
})

test('小红书筛选值是中文枚举，且 --since 按四档映射（填错不会报错，只有测试拦得住）', async () => {
  const nowMs = Date.parse('2026-09-06T00:00:00.000Z')
  const day = 86_400_000
  assert.equal(xhsTimeFilter(null, nowMs), '不限')
  assert.equal(xhsTimeFilter(nowMs - day, nowMs), '一天内')
  assert.equal(xhsTimeFilter(nowMs - 5 * day, nowMs), '一周内')
  assert.equal(xhsTimeFilter(nowMs - 30 * day, nowMs), '半年内')
  assert.equal(xhsTimeFilter(nowMs - 400 * day, nowMs), '不限', '超出半年该回落到不限，不是继续传半年内')
  // 边界：正好 1 天 / 7 天 / 180 天都落在本档内。
  assert.equal(xhsTimeFilter(nowMs - 7 * day, nowMs), '一周内')
  assert.equal(xhsTimeFilter(nowMs - 180 * day, nowMs), '半年内')
  assert.deepEqual(Object.values(XHS_TIME_FILTERS), ['不限', '一天内', '一周内', '半年内'])

  // 真发出去的那一条也得是中文，不能是时间戳/英文。
  const { impl, calls } = stubFetch([{ json: xhsPage({ items: [1], nextPage: 0 }) }])
  const { sleep } = recordingSleep()
  await searchPlatform({
    platform: PLATFORMS.xhs, keyword: 'x', limit: 1, sinceMs: nowMs - 5 * day, nowMs,
    apiKey: FAKE_KEY, fetchImpl: impl, sleep,
  })
  const sent = new URL(calls[0].url)
  assert.equal(sent.searchParams.get('time_filter'), '一周内')
  assert.equal(sent.searchParams.get('note_type'), '不限')
  assert.equal(sent.searchParams.get('sort_type'), 'general')
})

test('X：条目是扁平的 tweet_id/screen_name/user_info.name（曾整列缺 id 和 url）', () => {
  const payload = {
    code: 200,
    data: {
      status: 'ok',
      next_cursor: 'CUR-2',
      timeline: [
        {
          type: 'tweet',
          tweet_id: '2089959315843039598',
          screen_name: 'fixture_handle',
          created_at: 'Wed Aug 19 06:15:05 +0000 2026',
          text: 'This open-source AI video tool runs locally.',
          user_info: { screen_name: 'fixture_handle', name: '夹具作者', rest_id: '1818918150504603648' },
        },
        { type: 'module', text: '这是非推文卡片' },
      ],
    },
  }
  const items = PLATFORMS.x.itemsOf(payload)
  assert.equal(items.length, 1, '非 tweet 卡片没被剔掉')
  const record = toRecord(PLATFORMS.x, items[0])
  assert.deepEqual(record.missingFields, [])
  assert.equal(record.id, '2089959315843039598')
  assert.equal(record.url, 'https://x.com/fixture_handle/status/2089959315843039598')
  assert.equal(record.author, '夹具作者')
  assert.equal(record.authorId, 'fixture_handle')
  assert.equal(record.publishedAt, '2026-08-19T06:15:05.000Z')
  assert.deepEqual(PLATFORMS.x.nextCursorOf(payload, { page: 1, collected: 1 }), { cursor: 'CUR-2' })
})

test('抖音：搜索流里的非作品卡片（相关搜索词）剔掉，链接用规范短链', () => {
  const payload = {
    code: 200,
    data: {
      has_more: 1,
      cursor: 8,
      data: [
        {
          type: 1,
          aweme_info: {
            aweme_id: '7626746141451048299',
            desc: '一分钟教你用 ComfyUI 生成视频',
            create_time: 1_788_000_000,
            // 真实响应的 share_url 带着抓取账号的 did/iid 追踪参数，不该进调研产物。
            share_url: 'https://www.iesdouyin.com/share/video/7626746141451048299/?did=REDACTED&iid=REDACTED',
            author: { uid: '913067793217818', nickname: '夹具作者' },
          },
        },
        { type: 6, related_word_list: [{ word: '相关搜索' }] },
      ],
    },
  }
  const items = PLATFORMS.douyin.itemsOf(payload)
  assert.equal(items.length, 1, 'type 6「相关搜索词」卡片没被剔掉')
  const record = toRecord(PLATFORMS.douyin, items[0])
  assert.deepEqual(record.missingFields, [])
  assert.equal(record.url, 'https://www.douyin.com/video/7626746141451048299')
  assert.ok(!record.url.includes('did='), 'URL 里不该带抓取账号的追踪参数')
})

test('B站：付费课程投放（type ketang，pubdate 恒 0）剔掉，只留创作者视频', () => {
  const payload = {
    code: 200,
    data: {
      data: {
        numPages: 50,
        result: [
          { type: 'video', bvid: 'BV1yPtn6MExc', title: 'AI 接吻', author: 'UP主', mid: 37, pubdate: 1_788_000_000 },
          { type: 'ketang', bvid: 'BV1course', title: '【限时优惠】玩转 AI 视频', author: '课堂', mid: 9, pubdate: 0 },
        ],
      },
    },
  }
  const items = PLATFORMS.bilibili.itemsOf(payload)
  assert.equal(items.length, 1, 'ketang 付费课程没被剔掉——它会在报告里堆一排假的「未解析出时间」')
  assert.deepEqual(toRecord(PLATFORMS.bilibili, items[0]).missingFields, [])
})

// ── 7. 汇总段 ──────────────────────────────────────────────
test('summary：打不通 / 没命中 / 有条目但缺字段，三种状态分得开', () => {
  const ok = toRecord(PLATFORMS.douyin, {
    aweme_info: { aweme_id: '1', desc: '正文', create_time: 1_788_000_000, author: { uid: 'u', nickname: '作者' } },
  })
  const lossy = toRecord(PLATFORMS.douyin, { aweme_info: { desc: '只有正文' } })
  const summary = summarizeResults([
    { platform: 'douyin', platformLabel: '抖音', records: [ok, lossy], pages: [{ page: 1, received: 2 }] },
    { platform: 'xhs', platformLabel: '小红书', records: [], pages: [{ page: 1, received: 0 }] },
    { platform: 'x', platformLabel: 'X（Twitter）', records: [], pages: [], error: 'HTTP 400: upstream' },
  ])
  assert.equal(summary.totalRecords, 2)
  assert.deepEqual(
    summary.platforms.map((row) => row.status),
    ['ok', 'empty', 'failed'],
    '「打不通」和「没命中」必须分得开，否则报告里长得一样',
  )
  assert.equal(summary.platformsOk, 1)
  assert.equal(summary.platformsEmpty, 1)
  assert.equal(summary.platformsFailed, 1)
  assert.deepEqual(summary.platforms[0].missingFields, { url: 1, author: 1, publishedAt: 1 })
  assert.equal(summary.platforms[0].fieldsVerifiedOn, '2026-09-06')
  assert.equal(summary.platforms[2].error, 'HTTP 400: upstream')
})

test('Markdown 抬头带对账表：三种状态各自看得出来', () => {
  const md = renderMarkdown({
    keyword: 'ComfyUI',
    since: null,
    generatedAt: '2026-09-06T00:00:00.000Z',
    results: [
      { platform: 'xhs', platformLabel: '小红书', records: [], pages: [{ page: 1, received: 0 }] },
      { platform: 'x', platformLabel: 'X（Twitter）', records: [], pages: [], error: 'HTTP 400: upstream' },
    ],
  })
  assert.ok(md.includes('## 本轮对账'))
  assert.ok(md.includes('⚠️ 没命中'))
  assert.ok(md.includes('✗ 失败：HTTP 400: upstream'))
})
