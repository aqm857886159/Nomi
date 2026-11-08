// APIMart 文字大脑的两步核对，真跑（协调跑）和零花费演练共用这一份步骤，只有凭据来源和对端不一样：
//   ① 模型列表对账（免费）：GET /v1/models?expand=category&category=chat，和 electron/catalog/apimartTexts.ts 对两张表——
//      「我们声明了、列表里没有」「列表里最新一代、我们没声明」；列表的 Vision 标签算读图的一手依据。
//      在列表里 ≠ 调得通：能不能调只认第 ② 步的真调用（设计卡「按官方文档对齐」的口径）。
//   ② 一问一个（付费）：每个文字大脑走 Agent 真实的主进程大脑路（agentLane 的 single-shot：选型 → 装配 → appFetch），
//      不走 nomi:tasks:run 任务通道——创作者是在 Agent 里用文字大脑的。每个模型只问一次、不重试；失败记下接着问下一个；
//      读图候选再带一张最小的暗号图问一次。每一条一结束就写回执（sampleReceipts.ts），中途被杀前面的也留得下。
//
// Key：只以 safeStorage 密文经过本进程，解密和带 Key 的请求都在被测 App 的主进程里；返回值里只有状态码和响应 JSON，
// 不回请求头。响应 / 报错里万一回显了 Key，主进程里先按原串抹掉再交出来。
import fs from 'node:fs'
import path from 'node:path'
import { require as tsxRequire } from 'tsx/cjs/api'
import { ASK_CODE, renderCodeWordPng, scoreSawCodeWord } from './_agentImageInputScore.mjs'

const { runSamplesWithReceipts } = tsxRequire('./sampleReceipts.ts', import.meta.url)

export const CHAT_LIST_ROUTE = '/v1/models?expand=category&category=chat'
export const BALANCE_ROUTE = '/v1/user/balance'
/** 一问一个那句话：短、无歧义，回什么都算「有字回来」。 */
export const TEXT_ASK = '只回复一个字：好'

// ── 纯函数：对账（无网络，单测在 _apimartTextChecks.test.mjs） ──────────────────────────────────

/** 列表行只取对账用得上的三样；别的字段（价格、端点类型……）不进报告。 */
export function chatRowsOf(json) {
  const data = Array.isArray(json?.data) ? json.data : []
  return data.filter((row) => typeof row?.id === 'string' && row.id).map((row) => ({
    id: row.id,
    category: typeof row.category === 'string' ? row.category : null,
    capabilityTags: Array.isArray(row.capability_tags) ? row.capability_tags.filter((tag) => typeof tag === 'string') : [],
  }))
}

/**
 * 家族 + 代号：家族 = 第一个数字之前那段（去掉结尾的 - . _ 和版本前缀 v），代号 = 前两个数字（≥ 1000 的是日期快照，不算代号）。
 * `deepseek-v4-pro` → deepseek / [4]；`gpt-6.1-terra` → gpt / [6, 1]；`claude-opus-5-5-20261001` → claude-opus / [5, 5]。
 * 没有数字的 id 没有代号可比，返回 null。
 */
export function familyAndGeneration(id) {
  const lower = String(id).toLowerCase()
  const at = lower.search(/\d/)
  if (at < 0) return null
  const family = lower.slice(0, at).replace(/v$/, '').replace(/[-._]+$/, '')
  const generation = (lower.slice(at).match(/\d+/g) ?? []).map(Number).filter((value) => value < 1000).slice(0, 2)
  if (!family || generation.length === 0) return null
  return { family, generation }
}

function compareGeneration(a, b) {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference) return difference
  }
  return 0
}

/**
 * 两张表 + 读图事实。`declared` = APIMART_TEXT_MODELS（按 modelAlias || modelKey 认，与 modelListReconcile 同一把尺）。
 * 「最新一代」只看带 Text 标签（或没有标签）的行：Embedding / 纯音频不是文字大脑。
 */
export function compareTextList(declared, rows) {
  const idOf = (model) => model.modelAlias || model.modelKey
  const listed = new Map(rows.map((row) => [row.id, row]))
  const declaredIds = new Set(declared.map(idOf))
  const declaredButMissing = declared.filter((model) => !listed.has(idOf(model)))
    .map((model) => ({ modelKey: model.modelKey, promptRefineOnly: Boolean(model.meta?.promptRefineOnly) }))
  const brainRows = rows.filter((row) => row.capabilityTags.length === 0 || row.capabilityTags.includes('Text'))
  const families = new Map()
  const noGeneration = []
  for (const row of brainRows) {
    const parsed = familyAndGeneration(row.id)
    if (!parsed) { noGeneration.push(row.id); continue }
    const entry = families.get(parsed.family) ?? { newest: parsed.generation, rows: [] }
    if (compareGeneration(parsed.generation, entry.newest) > 0) entry.newest = parsed.generation
    entry.rows.push({ ...row, generation: parsed.generation })
    families.set(parsed.family, entry)
  }
  const newestUndeclared = [...families.entries()].flatMap(([family, entry]) => entry.rows
    .filter((row) => compareGeneration(row.generation, entry.newest) === 0 && !declaredIds.has(row.id))
    .map((row) => ({ family, generation: row.generation.join('.'), id: row.id, capabilityTags: row.capabilityTags })))
    .sort((a, b) => a.family.localeCompare(b.family) || a.id.localeCompare(b.id))
  const vision = (model) => listed.get(idOf(model))?.capabilityTags.includes('Vision') ?? false
  const claimsImage = (model) => model.meta?.supportsImageInput === true
  return {
    listedCount: rows.length,
    declaredCount: declared.length,
    declaredButMissing,
    newestUndeclared,
    noGenerationCount: noGeneration.length,
    /** 我们说能读图、列表却没给 Vision 标签（或不在列表里）。 */
    imageClaimWithoutVision: declared.filter((model) => claimsImage(model) && !vision(model)).map((model) => model.modelKey),
    /** 列表给了 Vision 标签、我们没声明读图：读图候选（带图真调用一次才封印）。 */
    visionNotClaimed: declared.filter((model) => !claimsImage(model) && vision(model)).map((model) => model.modelKey),
  }
}

export function renderTextListMarkdown(result, { fetchedAt, origin, status }) {
  const lines = [
    `# APIMart 文字模型列表对账（${fetchedAt}）`, '',
    `来源：\`GET ${origin}${CHAT_LIST_ROUTE}\`，HTTP ${status}；列表 ${result.listedCount} 个，我们声明 ${result.declaredCount} 个。`,
    '在列表里 ≠ 调得通：能不能调只认一问一个的真调用。', '',
    `## 我们声明了、列表里没有（${result.declaredButMissing.length}）`, '',
    '| 模型 | 备注 |', '|---|---|',
    ...result.declaredButMissing.map((row) => `| ${row.modelKey} | ${row.promptRefineOnly ? '提示词增强专用，不是聊天大脑' : ''} |`),
    '', `## 列表里最新一代、我们没声明（${result.newestUndeclared.length}；没有代号可比的 ${result.noGenerationCount} 个不进表）`, '',
    '| 家族 | 代 | 模型 | 标签 |', '|---|---|---|---|',
    ...result.newestUndeclared.map((row) => `| ${row.family} | ${row.generation} | ${row.id} | ${row.capabilityTags.join(' / ')} |`),
    '', '## 读图', '',
    `- 声明读图、列表没有 Vision 标签：${result.imageClaimWithoutVision.join('、') || '无'}`,
    `- 列表有 Vision 标签、我们没声明（读图候选）：${result.visionNotClaimed.join('、') || '无'}`, '',
  ]
  return lines.join('\n')
}

/** 一问一个的结果表（报告和终端都用它）。 */
export function renderBrainTable(receipts) {
  const lines = ['| 模型 | 带图 | HTTP | 请求数 | 有字回来 | 回答（截断） | 用量 in/out/缓存读 | 结论 |', '|---|---|---|---|---|---|---|---|']
  for (const receipt of receipts) {
    const usage = receipt.usage ? `${receipt.usage.inputTokens}/${receipt.usage.outputTokens}/${receipt.usage.cacheReadTokens ?? 0}` : '—'
    const verdict = receipt.ok ? '通' : `不通：${String(receipt.error ?? '').replace(/\|/g, '/').slice(0, 120)}`
    lines.push(`| ${receipt.modelKey ?? receipt.key} | ${receipt.image ? (receipt.sawImage?.saw ? '读出暗号' : '没读出') : ''} | ${(receipt.httpStatus ?? []).join(',') || '—'} | ${receipt.requests ?? '—'} | ${receipt.textReturned ? '是' : '否'} | ${String(receipt.text ?? '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 40)} | ${usage} | ${verdict} |`)
  }
  return lines.join('\n')
}

/** 回答 / 报错里像 Key 的串打码（渲染层拿不到 Key 原串，只能按形状抹）。 */
export function scrubKeyShapes(text) {
  return String(text ?? '').replace(/\b(sk|ak|key)-[A-Za-z0-9_-]{8,}/gi, '$1-***').replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer ***')
}

/**
 * 报错段的原话：主进程把供应商失败编成 `NOMI_VENDOR_ERR_B64::<base64 JSON>:: 人话` 穿 IPC（electron/shared/vendorFailure.ts）。
 * 这里解开成「HTTP 404 model_not_found：model_not_found」这样的一句；解不开就原样（打码后）给。
 */
export function readableLaneError(text) {
  const raw = String(text ?? '')
  const marker = 'NOMI_VENDOR_ERR_B64::'
  const at = raw.indexOf(marker)
  if (at < 0) return scrubKeyShapes(raw).slice(0, 300)
  const [payload, ...rest] = raw.slice(at + marker.length).split('::')
  try {
    const facts = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
    const head = [facts.httpStatus ? `HTTP ${facts.httpStatus}` : null, facts.upstreamCode ?? null].filter(Boolean).join(' ')
    return scrubKeyShapes(`${head}：${facts.upstreamMsg ?? rest.join('::').trim()}`).slice(0, 300)
  } catch { return scrubKeyShapes(raw).slice(0, 300) }
}

/** 从 model-catalog.json 读 APIMart 那家的对端（baseUrlHint 的 origin）。 */
export function apimartOriginOf(settingsDir) {
  const catalog = JSON.parse(fs.readFileSync(path.join(settingsDir, 'model-catalog.json'), 'utf8'))
  const vendor = (catalog.vendors ?? []).find((entry) => entry.key === 'apimart')
  if (!vendor?.baseUrlHint) throw new Error('隔离副本的目录里没有 APIMart 供应商（或没有地址）')
  return new URL(vendor.baseUrlHint).origin
}

/** 读图候选：在隔离副本的目录里给这几行补上 supportsImageInput（App 起来之前改；种子合并保留已有 meta）。 */
export function allowImageInputFor(settingsDir, modelKeys) {
  if (!modelKeys.length) return []
  const file = path.join(settingsDir, 'model-catalog.json')
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8'))
  const patched = []
  for (const model of catalog.models ?? []) {
    if (model.vendorKey !== 'apimart' || !modelKeys.includes(model.modelKey)) continue
    model.meta = { ...(model.meta ?? {}), supportsImageInput: true }
    patched.push(model.modelKey)
  }
  const missing = modelKeys.filter((key) => !patched.includes(key))
  if (missing.length) throw new Error(`读图候选不在隔离副本的目录里：${missing.join('、')}`)
  fs.writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`)
  return patched
}

// ── 主进程里的一次只读 GET（带 Key，Key 不出主进程） ──────────────────────────────────────────

/**
 * 用 App 自己的出站口（dist-electron/appFetch.js：系统代理、走查网络闸、凭据不跟跳转）对 APIMart 发一次 GET。
 * 返回 `{ status, json }`，或 `{ status: null, error }`；不回请求头。
 */
export async function getApimartJson(app, { settingsDir, origin, route }) {
  const catalog = JSON.parse(fs.readFileSync(path.join(settingsDir, 'model-catalog.json'), 'utf8'))
  const credential = catalog.apiKeysByVendor?.apimart
  if (credential?.enc !== 'safeStorage' || typeof credential.apiKey !== 'string') throw new Error('隔离副本里没有 APIMart 的 safeStorage 密文（明文 key fail-closed）')
  return app.evaluate(async ({ app: mainApp, safeStorage }, { cipher, url }) => {
    let key = ''
    const scrub = (text) => (key ? String(text).split(key).join('[key]') : String(text))
    try {
      const { appFetch } = process.mainModule.require(`${mainApp.getAppPath()}/dist-electron/appFetch.js`)
      key = safeStorage.decryptString(Buffer.from(cipher, 'base64'))
      const response = await appFetch(url, { headers: { authorization: `Bearer ${key}`, accept: 'application/json' } })
      const body = scrub(await response.text())
      try { return { status: response.status, json: JSON.parse(body) } }
      catch { return { status: response.status, json: null, bodyHead: body.slice(0, 200) } }
    } catch (error) {
      return { status: null, error: `${error?.name ?? 'Error'}: ${scrub(error?.message ?? error).slice(0, 200)}` }
    }
  }, { cipher: credential.apiKey, url: `${origin}${route}` })
}

/** 已用额度（/v1/user/balance 的 used_balance）；读不到返回 null，不当 0。 */
export async function readUsedBalance(app, options) {
  const answer = await getApimartJson(app, { ...options, route: BALANCE_ROUTE })
  const used = answer.json?.used_balance
  return typeof used === 'number' ? { usedBalance: used, remainBalance: answer.json.remain_balance ?? null } : null
}

/** 第 ① 步：拉列表、对两张表、写 text-list.md。返回对账结果。 */
export async function reconcileTextList({ app, settingsDir, origin, declared, outputDir, now = () => new Date() }) {
  const answer = await getApimartJson(app, { settingsDir, origin, route: CHAT_LIST_ROUTE })
  if (answer.status !== 200) throw new Error(`模型列表没拿到：HTTP ${answer.status ?? '无'} ${answer.error ?? JSON.stringify(answer.json ?? answer.bodyHead ?? '').slice(0, 200)}`)
  const rows = chatRowsOf(answer.json)
  const result = compareTextList(declared, rows)
  const markdown = renderTextListMarkdown(result, { fetchedAt: now().toISOString(), origin, status: answer.status })
  fs.writeFileSync(path.join(outputDir, 'text-list.md'), markdown)
  fs.writeFileSync(path.join(outputDir, 'text-list.rows.json'), `${JSON.stringify(rows, null, 2)}\n`)
  return { ...result, markdown, rows }
}

// ── 第 ② 步：一问一个 ─────────────────────────────────────────────────────────────────────

/** 主进程出站计数：数 /chat/completions 的 POST 与它们的 HTTP 状态（appFetch 走 undici，订 diagnostics_channel 就看得到）。 */
async function installWireRecorder(app) {
  await app.evaluate(() => {
    if (globalThis.__textCheckWire) return
    const wire = { posts: 0, statuses: [], errors: [] }
    globalThis.__textCheckWire = wire
    const channels = process.getBuiltinModule('node:diagnostics_channel')
    const isChat = (request) => request?.method === 'POST' && /\/chat\/completions/.test(String(request.path ?? ''))
    channels.subscribe('undici:request:create', ({ request }) => { if (isChat(request)) wire.posts += 1 })
    channels.subscribe('undici:request:headers', ({ request, response }) => { if (isChat(request)) wire.statuses.push(response?.statusCode ?? null) })
    channels.subscribe('undici:request:error', ({ request, error }) => { if (isChat(request)) wire.errors.push(String(error?.code ?? error?.name ?? 'error')) })
  })
}

async function takeWire(app) {
  return app.evaluate(() => {
    const wire = globalThis.__textCheckWire
    const taken = { posts: wire.posts, statuses: [...wire.statuses], errors: [...wire.errors] }
    wire.posts = 0; wire.statuses = []; wire.errors = []
    return taken
  })
}

/** 一问一个的样本单：先每个大脑一问，再读图候选各带图一问。`key` 是续跑用的名字（带图那问是 `<id>#image`）。 */
export function brainSamples(modelKeys, imageCandidates = []) {
  return [
    ...modelKeys.map((modelKey) => ({ key: modelKey, modelKey, image: false })),
    ...imageCandidates.map((modelKey) => ({ key: `${modelKey}#image`, modelKey, image: true })),
  ]
}

/**
 * 第 ② 步。`record(receipt, all)` 每条一结束就调用（写报告 / 追加 jsonl）。返回全部回执。
 * 失败（HTTP 错、没字回来、报错段、带图没读出暗号）记下接着问下一个；不重试。
 */
export async function askEachBrain({ win, app, projectId, samples, from, record, codeWord }) {
  await installWireRecorder(app)
  let imageClaim = null
  const importImage = async () => {
    if (imageClaim) return imageClaim
    const { png } = renderCodeWordPng(codeWord.text)
    const saved = await win.evaluate(async ({ b64, id }) => {
      const binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const result = await window.nomiDesktop.assets.importFile({ projectId: id, bytes: binary.buffer, contentType: 'image/png', fileName: 'code-word.png', kind: 'upload' })
      return result.ok ? { assetId: result.asset.id, version: result.asset.version ?? 1 } : { error: String(result.failure?.reason ?? 'unknown') }
    }, { b64: png.toString('base64'), id: projectId })
    if (!saved.assetId) throw new Error(`暗号图导入失败：${saved.error}`)
    imageClaim = { assetId: saved.assetId, version: saved.version }
    return imageClaim
  }
  const { receipts } = await runSamplesWithReceipts(samples, { keyOf: (sample) => sample.key, onFailure: 'continue', from, record },
    async (sample, note) => {
      note({ modelKey: sample.modelKey, image: sample.image })
      const attachments = sample.image ? [await importImage()] : undefined
      await takeWire(app)
      const response = await win.evaluate(async (input) => {
        try { return await window.nomiDesktop.agentLane.send(input) }
        catch (error) { return { ok: false, message: String(error?.message ?? error) } }
      }, {
        kind: 'single-shot', requestId: `text-check-${sample.key}-${Date.now()}`, projectId, featureKey: 'catalog-text-check',
        prompt: sample.image ? ASK_CODE : TEXT_ASK,
        context: { approvalPolicy: { mode: 'request' }, model: { vendorKey: 'apimart', modelKey: sample.modelKey }, ...(attachments ? { attachments } : {}) },
      })
      const wire = await takeWire(app)
      const projection = response?.ok ? response.singleShot : null
      const parts = projection?.parts ?? []
      const text = parts.filter((part) => part.kind === 'assistant-text').map((part) => part.text).join('').trim()
      const errorParts = parts.filter((part) => part.kind === 'error').map((part) => readableLaneError(part.text))
      const usage = projection?.usage
        ? { inputTokens: projection.usage.inputTokens, outputTokens: projection.usage.outputTokens, cacheReadTokens: projection.usage.cacheReadTokens ?? 0,
          cacheWriteTokens: projection.usage.cacheWriteTokens ?? 0, totalTokens: projection.usage.totalTokens, cost: projection.usage.cost ?? null }
        : null
      const sawImage = sample.image ? scoreSawCodeWord({ answer: text, codeWord }) : undefined
      const error = !response?.ok ? readableLaneError(response?.message ?? 'no response')
        : errorParts.length ? errorParts.join(' | ')
          : !text ? '没有字回来'
            : sample.image && !sawImage.saw ? '带图问了，没读出图里的暗号' : undefined
      return {
        ok: !error, ...(error ? { error } : {}),
        answeredBy: projection?.model?.modelId ?? null,
        httpStatus: wire.statuses, requests: wire.posts, ...(wire.errors.length ? { wireErrors: wire.errors } : {}),
        textReturned: text.length > 0, text: scrubKeyShapes(text).slice(0, 200), usage,
        ...(sawImage ? { sawImage } : {}),
      }
    })
  return receipts
}
