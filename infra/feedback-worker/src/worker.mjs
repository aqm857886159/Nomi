// Nomi 反馈接收端 —— 一个 Cloudflare Worker，两条路由，落 R2，返回编号。
//
// 为什么自己写而不是接 Sentry / PostHog / Aptabase（方案 §先查别人 里有完整四列表）：
// 我们对用户的承诺是「数据只去我们的端点」。第三方 SDK 的代价不是钱，是**这句承诺无法自证**
// ——只要它在进程里，「不收别的」就只能靠对方的文档。所以传输这一格自建，
// 而白名单 / 同意合同 / 脱敏 / 发件箱全部沿用仓库里已有的那套（一行没重写）。
//
// 这个 Worker 刻意**什么都不判断**：脱敏在客户端做完了（`electron/telemetry/` +
// `electron/logging/redact.ts`），它到这儿只负责存。服务端再抹一遍会制造一种
// 「反正服务端会兜」的错觉，而那正是客户端脱敏松掉的起点。
//
// 两条路由（都是 POST JSON）：
//   /v1/feedback      用户主动点的一键反馈 → 返回可引用的编号 NF-MMDD-NNNN
//   /v1/events        白名单用量事件（开关管） → 返回接收条数
// （`/v1/trajectories` 2026-11-13 删了：从没有发布版本往它发过东西；轨迹只作为反馈包的附件到达。）
//
// 认证：`Authorization: Bearer <INTAKE_TOKEN>`。**这不是密钥，是发布令牌**——它随桌面 App
// 一起发出去，任何人解包都能拿到。它挡的是「随手扫到这个 URL 的机器人」，不是定向滥用。
// 所以它可以随时轮换（改一次 secret，下一版 App 带新的），也所以这个端点不许承载任何
// 需要真正授权才能做的事：只能写，不能读、不能列、不能删。

const MAX_BODY_BYTES = 2 * 1024 * 1024
// 路由名与落盘前缀是同一个词（`/v1/feedback` → `feedback/…`），所以不留一张只是把它抄一遍的表。
const ROUTES = new Set(['/v1/feedback', '/v1/events'])

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

function bearer(request) {
  const header = request.headers.get('authorization') || ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : ''
}

/**
 * 人可以口述的编号：`NF-MMDD-NNNN`。
 *
 * 序号来自 KV 的一次 read-modify-write，**它不是原子的**——两条同时到达的反馈可能拿到同一个
 * 显示号。这被刻意接受，因为编号只是「用户能念出来的把手」，不是主键：
 * 每份反馈都另外落在 `feedback/<日期>/<uuid>.json`，uuid 由 crypto 生成，**永不冲突、永不覆盖**。
 * 撞号的后果只是两份报告共用一个好记的名字，没有任何数据丢失。
 * 用原子计数器（Durable Object）换掉这点瑕疵，代价是部署时多一个概念和一条 migration，
 * 对「三步部署」不值得。
 */
async function nextReceipt(env, now) {
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const day = String(now.getUTCDate()).padStart(2, '0')
  const dayKey = `counter:${now.getUTCFullYear()}-${month}-${day}`
  let sequence
  try {
    // KV 没绑时 `env.INTAKE_KV.get` 自己就抛，和「KV 抖了一下」落到同一个 catch —— 不为它写第二条分支。
    const current = Number.parseInt((await env.INTAKE_KV.get(dayKey)) || '0', 10)
    sequence = (Number.isFinite(current) && current > 0 ? current : 0) + 1
    // 35 天后自然过期：计数器只在当天有意义，留着只是垃圾。
    await env.INTAKE_KV.put(dayKey, String(sequence), { expirationTtl: 35 * 24 * 60 * 60 })
  } catch {
    // 编号退化成随机四位，报告照常落盘 —— 丢不得的是报告，不是那个好记的名字。
    sequence = 1 + Math.floor(Math.random() * 9999)
  }
  return `NF-${month}${day}-${String(sequence % 10000).padStart(4, '0')}`
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'GET' && url.pathname === '/') {
      // 存活探针。刻意不报版本、不报桶名、不报有多少条数据。
      return new Response('nomi-feedback-intake\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } })
    }

    if (!ROUTES.has(url.pathname)) return json(404, { ok: false, error: 'unknown_route' })
    // 反馈是唯一要回「用户能口述的编号」的那条（用户拍板⑥：只给编号）。
    const wantsReceipt = url.pathname === '/v1/feedback'
    if (request.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' })
    // 普通比较就够：这串是**随 App 发出去的发布令牌**，不是密钥（README 第 1 条）。
    // 给一个公开值写常数时间比较是防护剧场——能计时探测出来的东西，解包就能直接读到。
    if (!env.INTAKE_TOKEN || bearer(request) !== env.INTAKE_TOKEN) return json(401, { ok: false, error: 'unauthorized' })
    if (!env.INTAKE_BUCKET) return json(500, { ok: false, error: 'bucket_not_bound' })

    const declared = Number.parseInt(request.headers.get('content-length') || '0', 10)
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json(413, { ok: false, error: 'too_large' })

    const raw = await request.text()
    // content-length 可以撒谎或缺席，所以实际长度再量一次。
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json(413, { ok: false, error: 'too_large' })

    let payload
    try {
      payload = JSON.parse(raw)
    } catch {
      return json(400, { ok: false, error: 'invalid_json' })
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json(400, { ok: false, error: 'invalid_json' })

    const now = new Date()
    const ref = crypto.randomUUID()
    const receipt = wantsReceipt ? await nextReceipt(env, now) : null
    const stamp = now.toISOString().slice(0, 10)
    const key = `${url.pathname.slice('/v1/'.length)}/${stamp}/${ref}.json`

    // 存的是「客户端发来的原文 + 我们观察到的到达元数据」，两者分开放，不混成一层：
    // 混起来之后就分不清某个字段是客户端声明的还是服务端加的。
    // 刻意不存 IP、不存 User-Agent、不存 CF geo：那是用户身份，而我们说了不收。
    const record = {
      schemaVersion: 1,
      receivedAt: now.toISOString(),
      route: url.pathname,
      receipt,
      ref,
      payload,
    }

    await env.INTAKE_BUCKET.put(key, JSON.stringify(record), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
    })

    if (wantsReceipt) return json(200, { ok: true, id: receipt, ref })
    const accepted = Array.isArray(payload.events) ? payload.events.length : 1
    return json(200, { ok: true, ref, accepted })
  },
}
