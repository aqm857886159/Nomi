#!/usr/bin/env node
/**
 * TikHub 自媒体检索的**纯逻辑层**：鉴权、重试退避、翻页拼接、字段归一、Markdown 渲染。
 *
 * 为什么单独一层：`tikhub-search.mjs` 是 CLI（读 argv、写盘、退出码），
 * 那些都不可测。把「拿到一段响应之后怎么办」全部搬到这里，node-test 才能用夹具
 * 打完整矩阵（缺 key / 401 / 限流退避 / 分页拼接 / 字段缺失）而**一次都不打真网**。
 *
 * ── 密钥纪律（本文件的头号约束）──
 * key 只有一个来源：环境变量 `TIKHUB_API_KEY`。它从不落盘、不进日志、不进错误信息——
 * 所有对外抛出的文本都过 `redact()`，把 key 原文替换成 `***`。缺 key 时 fail-closed
 * （抛 TikHubConfigError），**不静默跳过、不返回空结果**：空结果和「今天没查成」
 * 在下游报告里长得一模一样，而后者是必须说出口的话。
 *
 * ── 契约来源（R5，2026-09-06 实读）──
 * `https://api.tikhub.io/openapi.json`（V5.3.2，spec 自述更新于 2026-06-22）。
 * 逐字段对账写在 `docs/research/tikhub-api-notes.md`；那份文档是本文件的上游，
 * 端点/参数改了先改文档再改这里。
 */

/** 缺配置（缺 key、平台名不认识）——调用方应当明报并退出非 0，不许降级成空结果。 */
export class TikHubConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'TikHubConfigError'
  }
}

/** HTTP 层失败。`retriable` 决定重试循环是否再试一次（401/422 永远不重试）。 */
export class TikHubHttpError extends Error {
  constructor(status, bodyText, { retriable, retryAfterMs = null } = {}) {
    super(`TikHub HTTP ${status}: ${bodyText}`)
    this.name = 'TikHubHttpError'
    this.status = status
    this.bodyText = bodyText
    this.retriable = Boolean(retriable)
    this.retryAfterMs = retryAfterMs
  }
}

/** 非大陆入口。大陆用户 spec 里写的是 api.tikhub.dev；用 `--base-url` 覆盖。 */
export const DEFAULT_BASE_URL = 'https://api.tikhub.io'
/** spec 自述 `Timeout: >=30s and <=60s`，取下限。 */
export const DEFAULT_TIMEOUT_MS = 30_000
/** spec 自述 `Max Retry: 3`——总尝试次数 3，即最多重试 2 次。 */
export const DEFAULT_MAX_ATTEMPTS = 3
/** 退避基数；第 n 次失败后等 BASE * 2^(n-1)，无抖动（测试要能逐毫秒断言）。 */
export const RETRY_BASE_MS = 1_000
/** 翻页硬上限：任何情况下不许无限翻。 */
export const MAX_PAGES = 10
/** 观点摘要长度：原文前 300 字，不做 AI 改写。 */
export const EXCERPT_CHARS = 300

/** 把 key 从任何要外泄的文本里抹掉。所有 throw / console 输出都必须先过这里。 */
export function redact(text, secrets = []) {
  let out = String(text ?? '')
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 4) out = out.split(secret).join('***')
  }
  return out
}

/**
 * 唯一的 key 来源。缺失 = fail-closed，错误文案是对用户说的原话，别改。
 */
export function readApiKey(env = process.env) {
  const key = typeof env.TIKHUB_API_KEY === 'string' ? env.TIKHUB_API_KEY.trim() : ''
  if (!key) {
    throw new TikHubConfigError('TikHub 未配置：TIKHUB_API_KEY 为空，今天没查成')
  }
  return key
}

// ───────────────────────── 字段抽取小工具 ─────────────────────────

/** 按 'a.b.c' 取值；任何一段断了就返回 undefined（不抛）。 */
function at(object, dottedPath) {
  let cursor = object
  for (const segment of dottedPath.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = cursor[segment]
  }
  return cursor
}

/**
 * 多路径取第一个「有内容」的值。
 * 供应商 `data` 在 spec 里是无类型的（见 notes 文档 §4），所以归一必须是容错的：
 * 少一个字段应当留空并记进 `missingFields`，而不是让整条记录崩掉。
 */
export function pickFirst(object, paths) {
  for (const path of paths) {
    const value = at(object, path)
    if (value === null || value === undefined) continue
    if (typeof value === 'string' && value.trim() === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    return value
  }
  return undefined
}

/** 秒/毫秒时间戳或字符串 → ISO；认不出返回 null（调用方据此记 missingFields）。 */
export function toIsoTimestamp(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) return null
    const ms = numeric > 1e12 ? numeric : numeric * 1000
    const date = new Date(ms)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/** 原文前 300 字，去掉换行压成一段。**不做 AI 改写**——摘要失真比摘要短更贵。 */
export function excerptOf(text) {
  const flat = String(text ?? '').replace(/\s+/gu, ' ').trim()
  return flat.length <= EXCERPT_CHARS ? flat : `${flat.slice(0, EXCERPT_CHARS)}…`
}

/**
 * 提到的框架/工具名，正则抽取。
 *
 * 词表在这里是**数据**：新词加一行即可，不用碰逻辑。除词表外还兜两类通用形状：
 * 话题标签（`#ComfyUI`）与带版本号的英文产品名（`Seedance 2.0`）——自媒体正文里
 * 新工具往往先以这两种形状出现，等它火了才值得进词表。
 */
export const TOOL_VOCABULARY = [
  'ComfyUI', 'Stable Diffusion', 'SDXL', 'LoRA', 'ControlNet', 'Flux', 'Midjourney',
  'Runway', 'Pika', 'Luma', 'Sora', 'Veo', 'Kling', '可灵', 'Seedance', 'Seedream',
  '即梦', 'Hailuo', '海螺', 'Vidu', 'Wan', '通义万相', 'Qwen', 'Nano Banana',
  'CapCut', '剪映', 'DaVinci', 'Premiere', 'After Effects', 'Blender', 'Unreal',
  'n8n', 'LangChain', 'LangGraph', 'CrewAI', 'AutoGen', 'Dify', 'Coze', 'MCP',
  'React Flow', 'Electron', 'Tauri', 'Figma', 'Claude', 'GPT', 'Gemini', 'Whisper',
]

const GENERIC_MENTION_PATTERNS = [
  /#([A-Za-z][A-Za-z0-9._-]{1,30})/gu,
  /\b([A-Z][A-Za-z]{2,20}(?:\s?\d+(?:\.\d+)?))\b/gu,
]

export function extractToolMentions(text) {
  const source = String(text ?? '')
  if (source.trim() === '') return []
  const found = new Set()
  for (const term of TOOL_VOCABULARY) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    // 纯 ASCII 词才加 \b：中文词两侧没有 word boundary，加了永远匹配不上。
    const pattern = /^[\x20-\x7e]+$/u.test(term) ? `\\b${escaped}\\b` : escaped
    if (new RegExp(pattern, 'iu').test(source)) found.add(term)
  }
  for (const pattern of GENERIC_MENTION_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const candidate = match[1].trim()
      if (candidate.length >= 3) found.add(candidate)
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b))
}

// ───────────────────────── 平台适配 ─────────────────────────

/** 抖音只认 0/1/7/180 四档发布时间；把 `--since` 折成最贴近的那一档（客户端仍会精筛）。 */
function douyinPublishBucket(sinceMs, nowMs) {
  if (!sinceMs) return '0'
  const days = Math.ceil((nowMs - sinceMs) / 86_400_000)
  if (days <= 1) return '1'
  if (days <= 7) return '7'
  if (days <= 180) return '180'
  return '0'
}

/**
 * 每个平台一条适配：端点、翻页游标怎么传、条目从哪层取、字段怎么归一。
 *
 * 诚实标注：`douyin` 的 `items`/字段路径是拿免费 demo 端点
 * （`/api/v1/demo/douyin_search/app/general_search`）的**真实响应**核对过的；
 * 其余三家 spec 把 `data` 声明为无类型，路径按平台通用字段名写成多路候选，
 * 未经真实响应核对——所以归一必须容错，并把没取到的字段记进 `missingFields`。
 */
export const PLATFORMS = {
  douyin: {
    id: 'douyin',
    label: '抖音',
    method: 'POST',
    path: '/api/v1/douyin/search/fetch_video_search_v1',
    verified: true,
    buildRequest({ keyword, cursor, sinceMs, nowMs }) {
      return {
        body: {
          keyword,
          cursor: Number(cursor?.offset ?? 0),
          sort_type: '0',
          publish_time: douyinPublishBucket(sinceMs, nowMs),
          filter_duration: '0',
          content_type: '0',
          search_id: String(cursor?.searchId ?? ''),
          backtrace: String(cursor?.backtrace ?? ''),
        },
      }
    },
    itemsOf: (payload) => pickFirst(payload, ['data.data', 'data.aweme_list', 'data']) ?? [],
    nextCursorOf(payload) {
      const inner = payload?.data ?? {}
      if (!inner.has_more) return null
      return {
        offset: Number(inner.cursor ?? 0),
        searchId: String(pickFirst(inner, ['extra.logid', 'log_pb.impr_id']) ?? ''),
        backtrace: String(inner.backtrace ?? ''),
      }
    },
    normalize(item) {
      const post = item?.aweme_info ?? item?.aweme_list?.[0] ?? item ?? {}
      const id = pickFirst(post, ['aweme_id', 'statistics.aweme_id'])
      return {
        id: id ? String(id) : null,
        url: pickFirst(post, ['share_url', 'share_info.share_url'])
          ?? (id ? `https://www.douyin.com/video/${id}` : null),
        author: pickFirst(post, ['author.nickname', 'author.unique_id']) ?? null,
        authorId: pickFirst(post, ['author.uid', 'author.sec_uid']) ?? null,
        publishedAt: toIsoTimestamp(pickFirst(post, ['create_time', 'createTime'])),
        title: pickFirst(post, ['desc', 'share_info.share_title', 'video.title']) ?? null,
        body: pickFirst(post, ['desc', 'share_info.share_desc']) ?? '',
      }
    },
  },

  xhs: {
    id: 'xhs',
    label: '小红书',
    method: 'GET',
    path: '/api/v1/xiaohongshu/app_v2/search_notes',
    verified: false,
    buildRequest({ keyword, cursor, sinceMs, nowMs }) {
      const days = sinceMs ? Math.ceil((nowMs - sinceMs) / 86_400_000) : 0
      const timeFilter = !sinceMs ? '不限' : days <= 1 ? '一天内' : days <= 7 ? '一周内' : days <= 180 ? '半年内' : '不限'
      return {
        query: {
          keyword,
          page: Number(cursor?.page ?? 1),
          sort_type: 'general',
          note_type: '不限',
          time_filter: timeFilter,
          search_id: String(cursor?.searchId ?? ''),
          search_session_id: String(cursor?.sessionId ?? ''),
        },
      }
    },
    itemsOf: (payload) => pickFirst(payload, ['data.items', 'data.notes', 'data.data', 'data']) ?? [],
    nextCursorOf(payload, { page }) {
      const inner = payload?.data ?? {}
      if (inner.has_more === false) return null
      return {
        page: page + 1,
        searchId: String(pickFirst(inner, ['search_id', 'searchId']) ?? ''),
        sessionId: String(pickFirst(inner, ['search_session_id', 'sessionId']) ?? ''),
      }
    },
    normalize(item) {
      const note = item?.note_card ?? item?.note ?? item ?? {}
      const id = pickFirst(item ?? {}, ['id', 'note_id']) ?? pickFirst(note, ['note_id', 'id'])
      return {
        id: id ? String(id) : null,
        url: pickFirst(note, ['share_info.link', 'url'])
          ?? (id ? `https://www.xiaohongshu.com/explore/${id}` : null),
        author: pickFirst(note, ['user.nickname', 'user.nick_name', 'user.name']) ?? null,
        authorId: pickFirst(note, ['user.user_id', 'user.userid', 'user.id']) ?? null,
        publishedAt: toIsoTimestamp(pickFirst(note, ['time', 'create_time', 'timestamp'])),
        title: pickFirst(note, ['display_title', 'title']) ?? null,
        body: pickFirst(note, ['desc', 'display_title', 'title']) ?? '',
      }
    },
  },

  bilibili: {
    id: 'bilibili',
    label: 'B站',
    method: 'GET',
    path: '/api/v1/bilibili/web/fetch_general_search',
    verified: false,
    buildRequest({ keyword, cursor, sinceMs, nowMs }) {
      return {
        query: {
          keyword,
          order: 'totalrank',
          page: Number(cursor?.page ?? 1),
          page_size: 20,
          duration: 0,
          pubtime_begin_s: sinceMs ? Math.floor(sinceMs / 1000) : 0,
          pubtime_end_s: sinceMs ? Math.floor(nowMs / 1000) : 0,
        },
      }
    },
    itemsOf(payload) {
      const result = pickFirst(payload, ['data.data.result', 'data.result']) ?? []
      if (!Array.isArray(result)) return []
      // 综合搜索返回的是「分组数组」；视频组在 result_type === 'video' 里。
      if (result.length > 0 && Array.isArray(result[0]?.data)) {
        const videos = result.find((group) => group?.result_type === 'video') ?? result[0]
        return Array.isArray(videos?.data) ? videos.data : []
      }
      return result
    },
    nextCursorOf(payload, { page, collected }) {
      const numPages = Number(pickFirst(payload, ['data.data.numPages', 'data.numPages']) ?? 0)
      if (numPages > 0 && page >= numPages) return null
      return collected === 0 ? null : { page: page + 1 }
    },
    normalize(item) {
      const bvid = pickFirst(item ?? {}, ['bvid', 'bvId'])
      const rawTitle = pickFirst(item ?? {}, ['title']) ?? null
      return {
        id: bvid ? String(bvid) : (pickFirst(item ?? {}, ['aid', 'id']) ?? null),
        url: bvid ? `https://www.bilibili.com/video/${bvid}` : (pickFirst(item ?? {}, ['arcurl', 'url']) ?? null),
        author: pickFirst(item ?? {}, ['author', 'owner.name']) ?? null,
        authorId: pickFirst(item ?? {}, ['mid', 'owner.mid']) ?? null,
        publishedAt: toIsoTimestamp(pickFirst(item ?? {}, ['pubdate', 'senddate', 'ctime'])),
        // B站搜索标题里带 <em class="keyword"> 高亮标签，落盘前先剥。
        title: rawTitle === null ? null : String(rawTitle).replace(/<[^>]+>/gu, ''),
        body: `${String(rawTitle ?? '').replace(/<[^>]+>/gu, '')} ${pickFirst(item ?? {}, ['description', 'desc']) ?? ''}`.trim(),
      }
    },
  },

  x: {
    id: 'x',
    label: 'X（Twitter）',
    method: 'GET',
    path: '/api/v1/twitter/web/fetch_search_timeline',
    verified: false,
    buildRequest({ keyword, cursor }) {
      const query = { keyword, search_type: 'Top' }
      if (cursor?.cursor) query.cursor = String(cursor.cursor)
      return { query }
    },
    itemsOf: (payload) => pickFirst(payload, ['data.timeline', 'data.tweets', 'data.data', 'data']) ?? [],
    nextCursorOf(payload) {
      const next = pickFirst(payload?.data ?? {}, ['cursor.bottom', 'next_cursor', 'cursor'])
      return next ? { cursor: String(next) } : null
    },
    normalize(item) {
      const tweet = item?.tweet ?? item ?? {}
      const id = pickFirst(tweet, ['rest_id', 'id_str', 'id'])
      const handle = pickFirst(tweet, ['user.screen_name', 'author.screen_name', 'screen_name'])
      return {
        id: id ? String(id) : null,
        url: pickFirst(tweet, ['url'])
          ?? (handle && id ? `https://x.com/${handle}/status/${id}` : null),
        author: pickFirst(tweet, ['user.name', 'author.name']) ?? (handle ? String(handle) : null),
        authorId: handle ? String(handle) : null,
        publishedAt: toIsoTimestamp(pickFirst(tweet, ['created_at', 'legacy.created_at', 'timestamp'])),
        title: null,
        body: pickFirst(tweet, ['full_text', 'text', 'legacy.full_text']) ?? '',
      }
    },
  },
}

export const PLATFORM_IDS = Object.keys(PLATFORMS)

export function resolvePlatforms(name) {
  if (!name || name === 'all') return PLATFORM_IDS.map((id) => PLATFORMS[id])
  const picked = String(name)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const unknown = picked.filter((id) => !PLATFORMS[id])
  if (unknown.length > 0) {
    throw new TikHubConfigError(`不认识的平台：${unknown.join('、')}（可选：${PLATFORM_IDS.join(' / ')} / all）`)
  }
  return picked.map((id) => PLATFORMS[id])
}

// ───────────────────────── 传输：超时 + 有上限的重试退避 ─────────────────────────

/** 哪些失败值得再试一次。401/403/404/422 是「你问错了」，重试只会白烧配额。 */
export function isRetriableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

/** 第 attempt 次失败后等多久。服务端给了 Retry-After 就听它的，否则指数退避，无抖动。 */
export function backoffDelayMs(attempt, retryAfterMs = null) {
  if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0) return retryAfterMs
  return RETRY_BASE_MS * 2 ** (attempt - 1)
}

function parseRetryAfter(headers) {
  const raw = headers && typeof headers.get === 'function' ? headers.get('retry-after') : null
  if (!raw) return null
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null
}

function buildUrl(baseUrl, path, query) {
  const url = new URL(path, baseUrl)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

/**
 * 一次请求 + 有上限的重试。
 *
 * `fetchImpl` / `sleep` 注入是为了测试能打 401 / 429 退避矩阵而不真等、不真联网
 * （R18：测试不许靠墙钟）。生产默认用全局 fetch 与真 setTimeout。
 */
export async function requestJson({
  baseUrl = DEFAULT_BASE_URL,
  path,
  method = 'GET',
  query,
  body,
  apiKey,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  onRetry = () => {},
}) {
  if (typeof fetchImpl !== 'function') {
    throw new TikHubConfigError('当前 Node 没有全局 fetch，请用 Node 18+ 运行本脚本')
  }
  const url = buildUrl(baseUrl, path, query)
  const secrets = apiKey ? [apiKey] : []
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
      if (!response.ok) {
        const text = redact(await response.text().catch(() => ''), secrets).slice(0, 400)
        const retryAfterMs = parseRetryAfter(response.headers)
        const error = new TikHubHttpError(response.status, text, {
          retriable: isRetriableStatus(response.status),
          retryAfterMs,
        })
        if (!error.retriable || attempt === maxAttempts) throw error
        lastError = error
        const delay = backoffDelayMs(attempt, retryAfterMs)
        onRetry({ attempt, delayMs: delay, status: response.status })
        await sleep(delay)
        continue
      }
      return await response.json()
    } catch (error) {
      if (error instanceof TikHubHttpError) {
        if (!error.retriable || attempt === maxAttempts) throw error
        lastError = error
        continue
      }
      // 网络层错误（含超时 abort）：可重试，但仍受 maxAttempts 封顶。
      const wrapped = new Error(redact(error?.message ?? String(error), secrets))
      wrapped.name = error?.name === 'AbortError' ? 'TikHubTimeoutError' : 'TikHubNetworkError'
      if (attempt === maxAttempts) throw wrapped
      lastError = wrapped
      const delay = backoffDelayMs(attempt)
      onRetry({ attempt, delayMs: delay, status: null })
      await sleep(delay)
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError ?? new Error('TikHub 请求失败（原因未知）')
}

// ───────────────────────── 翻页拼接 + 归一 ─────────────────────────

const REQUIRED_FIELDS = ['url', 'author', 'publishedAt', 'title']

/** 归一 + 记账：缺了哪些字段要写进记录本身，报告里才看得出这条证据有多硬。 */
export function toRecord(platform, rawItem) {
  const base = platform.normalize(rawItem) ?? {}
  const body = String(base.body ?? '')
  const title = base.title ?? (body ? excerptOf(body).slice(0, 60) : null)
  const record = {
    platform: platform.id,
    platformLabel: platform.label,
    id: base.id ?? null,
    url: base.url ?? null,
    author: base.author ? String(base.author) : null,
    authorId: base.authorId ? String(base.authorId) : null,
    publishedAt: base.publishedAt ?? null,
    title: title ? String(title) : null,
    excerpt: excerptOf(body),
    mentions: extractToolMentions(`${title ?? ''} ${body}`),
    fieldConfidence: platform.verified ? 'verified-against-live-response' : 'best-effort-unverified',
  }
  record.missingFields = REQUIRED_FIELDS.filter((field) => !record[field])
  return record
}

/**
 * 翻一个平台，直到攒够 `limit` 条、服务端说没有了、或撞上 MAX_PAGES 上限。
 *
 * `since` 的裁剪永远在客户端做（服务端时间桶只是省流量的近似）；
 * 时间字段缺失的条目**保留**并靠 `missingFields` 标注——按缺失字段静默丢条目，
 * 会让「这个平台今天没人聊」和「我们没解析出时间」长得一样。
 */
export async function searchPlatform({
  platform,
  keyword,
  limit = 20,
  sinceMs = null,
  nowMs = Date.now(),
  maxPages = MAX_PAGES,
  ...transport
}) {
  const records = []
  const pages = []
  let cursor = null
  let page = 1

  while (records.length < limit && page <= maxPages) {
    const { body, query } = platform.buildRequest({ keyword, cursor, sinceMs, nowMs })
    const payload = await requestJson({
      ...transport,
      path: platform.path,
      method: platform.method,
      query,
      body,
    })
    const rawItems = platform.itemsOf(payload)
    const items = Array.isArray(rawItems) ? rawItems : []
    pages.push({ page, received: items.length })

    for (const rawItem of items) {
      if (records.length >= limit) break
      const record = toRecord(platform, rawItem)
      if (sinceMs && record.publishedAt && Date.parse(record.publishedAt) < sinceMs) continue
      records.push(record)
    }

    if (items.length === 0) break
    cursor = platform.nextCursorOf(payload, { page, collected: items.length })
    if (!cursor) break
    page += 1
  }

  return { platform: platform.id, platformLabel: platform.label, records, pages }
}

// ───────────────────────── 渲染 ─────────────────────────

function mdEscape(text) {
  return String(text ?? '').replace(/\|/gu, '\\|')
}

/** 人读的那一份。结构固定，方便调研文档直接引用/粘贴。 */
export function renderMarkdown({ keyword, since, generatedAt, results }) {
  const total = results.reduce((sum, group) => sum + group.records.length, 0)
  const lines = [
    `# TikHub 自媒体检索：「${keyword}」`,
    '',
    `- 抓取时间：${generatedAt}`,
    `- 关键词：\`${keyword}\`${since ? ` · 只要 ${since} 之后` : ''}`,
    `- 平台：${results.map((group) => `${group.platformLabel}(${group.records.length})`).join(' · ')}`,
    `- 合计 ${total} 条`,
    '',
    '> 摘要是**原文前 300 字**，没有任何 AI 改写；`framework/tool` 是正则抽取的提及，不是判断。',
    '> 标 `best-effort-unverified` 的平台字段路径未经真实响应核对，读结论时以 URL 原文为准。',
    '',
  ]

  for (const group of results) {
    lines.push(`## ${group.platformLabel}（${group.records.length} 条）`, '')
    if (group.records.length === 0) {
      lines.push('_本次没有命中。_', '')
      continue
    }
    for (const record of group.records) {
      lines.push(`### ${mdEscape(record.title ?? '（无标题）')}`)
      lines.push('')
      lines.push(`- 出处：${record.url ?? '（未解析出 URL）'}`)
      lines.push(`- 平台 / 作者：${record.platformLabel} · ${record.author ?? '（未知作者）'}`)
      lines.push(`- 发布时间：${record.publishedAt ?? '（未解析出时间）'}`)
      lines.push(`- 提到的框架/工具：${record.mentions.length > 0 ? record.mentions.join('、') : '（无）'}`)
      if (record.missingFields.length > 0) lines.push(`- ⚠️ 缺字段：${record.missingFields.join('、')}`)
      lines.push('')
      lines.push(`> ${record.excerpt || '（原文为空）'}`)
      lines.push('')
    }
  }
  return `${lines.join('\n')}\n`
}
