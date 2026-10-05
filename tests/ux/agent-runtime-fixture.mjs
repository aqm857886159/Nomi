// Only the remote vendor is synthetic. Walks still use the real SDK, IPC, renderer and storage.
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import http from 'node:http'
import path from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

import { withLinuxNoSandbox, withLinuxSyntheticCredentialStorage } from './_launchApp.mjs'

const require = createRequire(import.meta.url)

/**
 * 「供应商说成功、给的字节却有毛病」的两种样本（全功能走查用）。它们对「坏」的定义必须和宿主的落地判据是同一个
 * （electron/assets/generatedMediaDecode.ts：解码器把第一帧拿出来、宽高为正 = 能解码），否则夹具和宿主各说各话：
 *   · corruptResult —— JPEG 魔数后面全是随机字节，解码器一帧都出不来（真·读不出来）。旧夹具给的是「截掉后半段的 JPEG」，
 *     可截断的 JPEG 解码器仍解得出上半张图，宿主按定义判它能解码——它就不再是「读不出来」的样本了，监视器却还把这一笔记成失败。
 *   · trailingBytesResult —— 一张完整的 PNG，IEND 之后多了 100 个字节。真编码器 / 加水印 / CDN 补丁的产物里常见，
 *     图完好可显示；旧判据（-xerror）把它整张拒收。
 */
function undecodableJpegBytes() {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(Array.from({ length: 5000 }, (_, index) => (index * 131 + 7) & 255))])
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([length, body, checksum])
}

function pngWithTrailingBytes() {
  const width = 256
  const height = 256
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // 位深
  header[9] = 2 // RGB
  const stride = width * 3 + 1
  const rows = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * stride + 1 + x * 3
      rows[at] = x
      rows[at + 1] = y
      rows[at + 2] = (x + y) & 255
    }
  }
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(rows)), pngChunk('IEND', Buffer.alloc(0)),
  ])
  return Buffer.concat([png, Buffer.alloc(100, 0x41)])
}

export const FIXTURE_VENDOR = 'agent-runtime-loopback'
/** 这家在目录里的显示名——界面（失败提示）点名它用的是这个，不是上面那个 key。 */
export const FIXTURE_VENDOR_NAME = 'Agent Runtime Loopback'
export const FIXTURE_TEXT_MODEL = 'agent-runtime-text'
export const FIXTURE_IMAGE_MODEL = 'agent-runtime-image'
// v4 的模型弹层每行只印**显示名**（`labelZh || modelKey`），没有 per-row 挂点，
// 所以走查按名字选模型。名字与下面的 catalog 共用同一个常量，两边不会各写一份。
export const FIXTURE_TEXT_MODEL_LABEL = 'Fixture 文本'
export const FIXTURE_IMAGE_MODEL_LABEL = 'Fixture 图片'
export const FIXTURE_API_KEY = 'sk-agent-runtime-fixture'
/**
 * 第二家回环供应商（全功能走查用，`extraImageVendor: true` 才种）：同一个档案（agnes-image）、同一个 modelKey，
 * 另一家、另一把钥匙。「这家失败了，要不要切到那家」这条提示只有在目录里真有另一家时才会出现。
 */
export const FIXTURE_IMAGE_VENDOR_B = 'agent-runtime-loopback-b'
export const FIXTURE_IMAGE_MODEL_B_LABEL = 'Fixture 图片 B'
export const FIXTURE_API_KEY_B = 'sk-agent-runtime-fixture-b'
// ── 真实生成供应商那一档（`generationProvider: 'apimart'`）──
//
// `generationProviderBootstrap.ts` 全仓**只**把 apimart 装成可提交的生成供应商，别的供应商一律
// `providerReady:false`。所以在 `agent-runtime-loopback` 这个自造供应商上按下付费卡的确认键，
// 宿主必然在供应商就绪那一步停下——**Agent 面板那颗确认键从来没有在任何一条真机走查里真的生成过**
// （2026-09-21 查明：main / PR #828 / 本分支三处 bootstrap 是同一个 blob，不是谁改坏的）。
// 这一档把走查接到**真实那条生产路径**上：内置 apimart 档案 + 内置 curated mapping +
// `NOMI_E2E_PRODUCTION_FIXTURE` 那个只认 loopback 的口子，供应商换成本机这台夹具服务器。
// 于是「确认 → 封印 → 铸收据 → 决门 → 真的发出去 → 产物落回节点」整条链在**真实界面上**可断言。
export const FIXTURE_APIMART_VENDOR = 'apimart'
export const FIXTURE_APIMART_MODEL = 'gpt-image-2'
export const FIXTURE_APIMART_MODEL_LABEL = 'GPT Image 2'
export const FIXTURE_APIMART_API_KEY = 'agent-runtime-apimart-fixture'
/**
 * 非 APIMart 的那一档（BL-1 验收面）：内置 Higgsfield。
 * 选它是因为它**处处与 APIMart 不同**——鉴权方案词是 `Key` 不是 `Bearer`、create 路径是模型 slug
 * 本身、受理回的是 `request_id` 而不是 `data[0].task_id`、轮询是 `/requests/<id>/status`、
 * 产物键是 `images[0].url`。执行器要是还留着任何一处写死的 APIMart 形状，这条走查就过不去。
 */
export const FIXTURE_NON_APIMART_VENDOR = 'higgsfield'
export const FIXTURE_NON_APIMART_MODEL = 'higgsfield-ai/soul/v2/standard'
/**
 * 目录里的一行价目（基价 0.30，无规格加价）。
 *
 * 它代表的是「**用户这台机器的目录里填了价**」那一档，不是当年那种为了绕过价格闸编出来的 ¥0
 * （见 `_mcpL2Fixture.mjs` 2026-09-21 的注释）：0 是三种可能里唯一会被读成「免费」的那一种，
 * 非零基价没有这个歧义。`NOMI_WALK_UNPRICED_MODEL=1` 时整行不种，于是这台机器和今天干净装机
 * 一模一样（内置 204 个生成模型一条价都没有）。
 */
const APIMART_FIXTURE_PRICING = Object.freeze({
  cost: 0.3, enabled: true,
  // 规格加价挂在这个档案真正暴露的参数上（`resolution` 三档 1K/2K/4K）：
  // 「在卡上改一个参数 → 宿主按目录重新算钱」这条只有靠它才取得到证。
  specCosts: [{ specKey: 'resolution:2K', cost: 0.2, enabled: true }],
})
export const FIXTURE_USAGE = Object.freeze({
  prompt_tokens: 11, completion_tokens: 7, total_tokens: 18,
  prompt_tokens_details: Object.freeze({ cached_tokens: 3 }),
})

/**
 * `usage: 'measured'` 那一档报的用量：按**这一次请求真正发出来的内容**估，不是固定的 11 个 token。
 *
 * 为什么要它（全功能走查的铁律 8「不白烧 token」）：固定用量下 pi 的压缩判据（它读上一条回复的
 * provider usage）永远觉得上下文只有十几个 token，长对话在夹具里**永远不会压缩**——走查量到的
 * 就不是用户那台机器上的样子。估的对象是模型真正收到的 `messages + tools`，按真实分词器的量级估：
 * 中日韩字符每字约 1 个 token，其余字符约 4 个 1 个 token。只按「字符数 / 4」估（pi 自己的保守估计
 * `compaction.js estimateTokens` 就是这么算的）会把中文剧本少算三四倍——而真供应商报回来的是真分词数。
 */
export function estimateFixtureTokens(text) {
  const value = String(text ?? '')
  const cjk = (value.match(/[　-鿿가-힯＀-￯]/g) ?? []).length
  return cjk + Math.ceil((value.length - cjk) / 4)
}

export function measuredFixtureUsage(body, reply) {
  const prompt = estimateFixtureTokens(JSON.stringify({ messages: body?.messages ?? [], tools: body?.tools ?? [] }))
  const spoken = `${reply?.reasoning ?? ''}${reply?.text ?? ''}${reply?.type === 'tool' ? `${reply.name}${JSON.stringify(reply.args)}` : ''}`
  const completion = Math.max(1, estimateFixtureTokens(spoken))
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion, prompt_tokens_details: { cached_tokens: 0 } }
}

const NOW = '2026-08-26T00:00:00.000Z'

/** Text-only matching helper: never copies image data URLs into expectation diagnostics. */
export function flattenRequestText(body) {
  return (Array.isArray(body?.messages) ? body.messages : []).flatMap((message) => {
    if (typeof message?.content === 'string') return [message.content]
    return (Array.isArray(message?.content) ? message.content : [])
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
  }).filter(Boolean).join('\n')
}

function imageMapping(taskKind, vendorKey = FIXTURE_VENDOR) {
  return {
    id: `${FIXTURE_IMAGE_MODEL}-${taskKind}${vendorKey === FIXTURE_VENDOR ? '' : `-${vendorKey}`}`,
    vendorKey, modelKey: FIXTURE_IMAGE_MODEL, taskKind,
    name: `Fixture ${taskKind}`, enabled: true,
    create: {
      method: 'POST', path: '/v1/images/generations',
      headers: { Authorization: 'Bearer {{user_api_key}}', 'Content-Type': 'application/json' },
      body: {
        model: '{{model.modelKey}}', prompt: '{{request.prompt}}', size: '{{request.params.size}}',
        extra_body: {
          response_format: 'url',
          ...(taskKind === 'image_edit' ? { image: '{{request.params.image}}' } : {}),
        },
      },
      response_mapping: { image_url: 'data.0.url' }, defaultParams: { size: '1024x1024' },
    },
    createdAt: NOW, updatedAt: NOW,
  }
}

/**
 * apimart 的钥匙必须是**真的 safeStorage 密文**，不能是 `enc:'plain'`。
 *
 * 为什么：`catalogModelAvailability` 判「这行模型能不能用」时会去解这家的钥匙，plain 只算
 * `needs_resave`——于是主进程那边生成跑得好好的，渲染层却认定模型不可用，画布上冒出一句
 * 「Agent 选的模型当前不可用」。**同一件事两个答案**，而两边读的本来就是同一个判据函数。
 * 加密身份 = app 名（macOS 上是 Keychain 里的 `<appName> Safe Storage`）：开发态走查跑的是
 * 仓库目录，app 名就是 package.json 的 `nomi`；`--packaged` 那档是 `Nomi`。传错只会得到
 * `locked`（不是 `ok`），所以这里由调用方按真实启动形态给。
 */
function withLinuxHeadless(args, platform = process.platform) {
  const normalized = [...args]
  if (platform === 'linux' && !normalized.includes('--headless')) normalized.push('--headless')
  return normalized
}

function encryptApimartKey({ rootDir, userDataDir, appName }) {
  const script = path.join(rootDir, 'tests/ux/_encryptFixtureKey.cjs')
  const result = spawnSync(require('electron'), withLinuxSyntheticCredentialStorage(
    withLinuxHeadless(withLinuxNoSandbox([script, FIXTURE_APIMART_API_KEY])), true,
  ), {
    cwd: rootDir,
    env: {
      ...process.env, NOMI_E2E: '1', NOMI_APP_NAME: appName,
      NOMI_ELECTRON_USER_DATA_DIR: userDataDir, NOMI_E2E_SYNTHETIC_CREDENTIAL_STORAGE: '1',
    },
    encoding: 'utf8',
  })
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`safeStorage fixture key failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}

/**
 * 内置 apimart 档案原样搬进这台夹具的目录（`vendors`/`models`/`mappings` 一个字不改——
 * 改 `baseUrlHint` 会**正确地**踩中直连 key 的 scope 闸，供应商地址只能走那个 loopback 口子）。
 * 只做一件加法：给要生成的那个模型种一行价目（未知价档不种）。
 */
async function builtinApimartSlice(priced) {
  const { require: tsxRequire } = await import('tsx/cjs/api')
  const { currentCatalogVersion } = await import('./_launchApp.mjs')
  const { applyBuiltinSeeds } = tsxRequire('../../electron/catalog/seedBuiltins.ts', import.meta.url)
  const seeded = applyBuiltinSeeds(
    { version: currentCatalogVersion(), vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, NOW,
  ).state
  return {
    version: seeded.version,
    vendors: seeded.vendors,
    models: seeded.models.map((model) => (
      model.vendorKey === FIXTURE_APIMART_VENDOR && model.modelKey === FIXTURE_APIMART_MODEL && priced
        ? { ...model, pricing: { ...APIMART_FIXTURE_PRICING } }
        : model
    )),
    mappings: seeded.mappings,
  }
}

async function modelCatalog(baseURL, { generationProvider, apimartKey, extraImageVendor = false }) {
  const common = { vendorKey: FIXTURE_VENDOR, enabled: true, createdAt: NOW, updatedAt: NOW }
  const priced = process.env.NOMI_WALK_UNPRICED_MODEL !== '1'
  const builtinVendorKey = generationProvider === 'higgsfield' ? FIXTURE_NON_APIMART_VENDOR : FIXTURE_APIMART_VENDOR
  const builtin = generationProvider === 'apimart' || generationProvider === 'higgsfield'
    ? await builtinApimartSlice(priced)
    : null
  return {
    version: builtin?.version ?? 8,
    // 顺序有意义：`resolveOnboardingAgentFromCatalog` 按目录顺序取**第一个**可用的文本大脑。
    // 内置 apimart 排在前面，走查的 SDK 就会去连 apimart 的真实地址而不是这台 loopback 夹具
    // （表现是 `textRequests: 0`、整条走查干等到超时）。夹具这家必须排第一。
    vendors: [{
      key: FIXTURE_VENDOR, name: FIXTURE_VENDOR_NAME, enabled: true, baseUrlHint: baseURL,
      authType: 'none', authHeader: null, authQueryParam: null, providerKind: 'openai-compatible',
      createdAt: NOW, updatedAt: NOW,
    }, ...(extraImageVendor ? [{
      key: FIXTURE_IMAGE_VENDOR_B, name: 'Agent Runtime Loopback B', enabled: true, baseUrlHint: baseURL,
      authType: 'none', authHeader: null, authQueryParam: null, providerKind: 'openai-compatible',
      createdAt: NOW, updatedAt: NOW,
    }] : []), ...(builtin?.vendors ?? [])],
    models: [
      { ...common, modelKey: FIXTURE_TEXT_MODEL, labelZh: FIXTURE_TEXT_MODEL_LABEL, kind: 'text', published: true, meta: { supportsImageInput: true } },
      // 价目是**目录里的一行**，不是走查编的数：`pricing.cost` 是基价，`specCosts` 是命中某个
      // 参数选择时的加价（`shotPricing.ts` 的唯一判据）。付费确认卡上的价格由主进程按它算出来，
      // 所以没有这一行，卡就只能诚实地印「暂时算不出价格」——那样「改参数 → 价格变」这条
      // 走查根本无从取证。加价键选 size 是因为它就是这个夹具模型真正暴露的那个参数。
      { ...common, modelKey: FIXTURE_IMAGE_MODEL, labelZh: FIXTURE_IMAGE_MODEL_LABEL, kind: 'image', published: true,
        meta: { archetypeId: 'agnes-image' },
        // NOMI_WALK_UNPRICED_MODEL=1：**不种这一行**，于是这个夹具模型和今天内置目录里 204 个
        // 生成模型处境一模一样（一条 pricing 都没有）。未知价开闸走查要的就是这台「干净装机」。
        ...(process.env.NOMI_WALK_UNPRICED_MODEL === '1'
          ? {}
          : { pricing: { cost: 0.3, enabled: true, specCosts: [{ specKey: 'size:1536x1024', cost: 0.2, enabled: true }] } }) },
      ...(extraImageVendor ? [{ ...common, vendorKey: FIXTURE_IMAGE_VENDOR_B, modelKey: FIXTURE_IMAGE_MODEL, labelZh: FIXTURE_IMAGE_MODEL_B_LABEL, kind: 'image', published: true, meta: { archetypeId: 'agnes-image' } }] : []),
      ...(builtin?.models ?? []),
    ],
    mappings: [
      ...(builtin?.mappings ?? []),
      ...['text_to_image', 'image_edit'].map((taskKind) => imageMapping(taskKind)),
      ...(extraImageVendor ? ['text_to_image', 'image_edit'].map((taskKind) => imageMapping(taskKind, FIXTURE_IMAGE_VENDOR_B)) : []),
    ],
    apiKeysByVendor: {
      [FIXTURE_VENDOR]: { ...common, apiKey: FIXTURE_API_KEY, enc: 'plain' },
      ...(extraImageVendor ? { [FIXTURE_IMAGE_VENDOR_B]: { ...common, vendorKey: FIXTURE_IMAGE_VENDOR_B, apiKey: FIXTURE_API_KEY_B, enc: 'plain' } } : {}),
      // 主进程那条生成路走的是 `NOMI_E2E_PRODUCTION_FIXTURE` 的 key；这一行是给**渲染层的
      // 可用性判据**看的（见 `encryptApimartKey` 的注释），两边必须对同一家给同一个答案。
      ...(builtin && apimartKey
        ? { [builtinVendorKey]: { vendorKey: builtinVendorKey, enabled: true, createdAt: NOW, updatedAt: NOW, apiKey: apimartKey, enc: 'safeStorage' } }
        : {}),
    },
  }
}

function validateReply(reply, allowHold = true) {
  if (reply?.reasoning !== undefined && typeof reply.reasoning !== 'string') throw new TypeError('reasoning must be text')
  if (reply?.type === 'text' && typeof reply.text === 'string') return
  // 供应商整条回 HTTP 错误（带原始 JSON 体）：用来走「服务商报错 → Agent 面板那一行」。
  if (reply?.type === 'http-error' && Number.isInteger(reply.status) && reply.status >= 400 && JSON.stringify(reply.json) !== undefined) return
  if (allowHold && reply?.type === 'hold' && (reply.text === undefined || typeof reply.text === 'string')) return
  if (reply?.type === 'tool' && typeof reply.id === 'string' && reply.id
    && typeof reply.name === 'string' && reply.name && reply.args !== undefined
    && (reply.text === undefined || typeof reply.text === 'string')) {
    if (JSON.stringify(reply.args) !== undefined) return
  }
  throw new TypeError('Expected a text/tool reply, or a hold with optional text')
}

function canWrite(response) {
  return !response.destroyed && !response.writableEnded
}

function jsonResponse(response, status, value) {
  if (!canWrite(response)) return
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(value))
}

function frame(state, delta, finishReason = null, usage) {
  return `data: ${JSON.stringify({
    id: state.id, object: 'chat.completion.chunk', created: 1, model: state.model,
    choices: usage ? [] : [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  })}\n\n`
}

function beginStream(state) {
  if (state.started) return ''
  state.started = true
  state.response.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive',
  })
  return frame(state, { role: 'assistant', content: '' })
}

function sendReply(state, reply) {
  if (!canWrite(state.response)) return
  if (reply.type === 'http-error') { jsonResponse(state.response, reply.status, reply.json); return }
  let wire = beginStream(state)
  if (reply.reasoning) wire += frame(state, { reasoning_content: reply.reasoning })
  if (reply.type === 'hold') {
    state.response.write(wire + frame(state, { content: reply.text }))
    return
  }
  if (reply.type === 'text') wire += frame(state, { content: reply.text })
  else {
    // 真实模型常在**同一条消息**里既说话又调工具（「让我修正…」+ 下一次调用）。
    // 少了这一路，走查就复现不出「工具失败之间夹着模型自言自语」那个形状——
    // 而那正是 2026-09-06 打包版上用户看到的东西。
    if (reply.text) wire += frame(state, { content: reply.text })
    wire += frame(state, { tool_calls: [{
      index: 0, id: reply.id, type: 'function',
      function: { name: reply.name, arguments: JSON.stringify(reply.args) },
    }] })
  }
  wire += frame(state, {}, reply.type === 'tool' ? 'tool_calls' : 'stop')
  wire += frame(state, {}, null, typeof state.usage === 'function' ? state.usage(reply) : FIXTURE_USAGE)
  state.response.end(`${wire}data: [DONE]\n\n`)
}

/**
 * @typedef {{path:string, body:unknown, authorization:string, headers:object}} RequestRecord
 * @typedef {({type:'text', text:string}|{type:'tool', id:string, name:string, args:unknown, text?:string}
 *   |{type:'hold', text?:string}|{type:'http-error', status:number, json:unknown}) & {reasoning?:string}} Reply
 *
 * Seed only a new, caller-isolated settings directory. Existing catalogs are never overwritten.
 * expectText consumes the first unconsumed matching expectation, exactly once. Matchers are sync.
 * Its received promise resolves on request arrival; a hold does not emit headers unless text is set.
 * release(text/tool) also works before arrival and is harmless after cancellation/close/completion.
 * close owns server connections, not caller directories. Call assertClean before closing a walk.
 *
 * `videoResultPath`：apimart 档出片地址的路径段（缺省 `/fixture/video.mp4`）。真供应商的产物地址常带一个很长的
 * basename（签名段 / 哈希段），落盘时怎么起名要靠它复现（2026-09-26 长文件名被截成 `.bin`）。
 */
export async function createAgentRuntimeFixture({ rootDir, settingsDir, generationProvider = 'loopback', userDataDir, appName, videoResultPath = '/fixture/video.mp4', usage = 'fixed', extraImageVendor = false, contextLimitTokens = null }) {
  if (!/^\/fixture\/[^/?#]+$/.test(videoResultPath)) throw new TypeError('videoResultPath must be /fixture/<name>')
  if (!['fixed', 'measured'].includes(usage)) throw new TypeError("usage must be 'fixed' or 'measured'")
  if (!path.isAbsolute(rootDir) || !path.isAbsolute(settingsDir)) {
    throw new TypeError('Fixture rootDir and settingsDir must be absolute paths')
  }
  if (!['loopback', 'apimart', 'higgsfield'].includes(generationProvider)) {
    throw new TypeError("generationProvider must be 'loopback', 'apimart' or 'higgsfield'")
  }
  const apimartMode = generationProvider === 'apimart'
  // 非 APIMart 的那一档（BL-1 的验收面）：内置 Higgsfield，鉴权方案词是 `Key` 不是 `Bearer`，
  // 端点、轮询路径、产物键全都与 APIMart 不同——正因为处处不同，它才证得了「执行器与供应商无关」。
  const higgsfieldMode = generationProvider === 'higgsfield'
  const builtinMode = apimartMode || higgsfieldMode
  if (builtinMode && (!userDataDir || !appName)) {
    throw new TypeError(`generationProvider '${generationProvider}' needs the launch userDataDir and app name (safeStorage identity)`)
  }
  const imageBytes = await readFile(path.join(rootDir, 'resources/onboarding-demo/shot-4.jpg'))
  const imageURL = `data:image/jpeg;base64,${imageBytes.toString('base64')}`
  const corruptImageBytes = undecodableJpegBytes()
  const corruptImageURL = `data:image/jpeg;base64,${corruptImageBytes.toString('base64')}`
  const trailingBytesPngURL = `data:image/png;base64,${pngWithTrailingBytes().toString('base64')}`
  // 视频产物用一段**真的供应商出片**（2026-08-20 L3 全旅程审计里真模型生成的 mp4），不是合成色块：
  // 宿主要把它下载、校验、落进项目素材库，再投成画布节点的 nomi-local:// 结果。
  // 只在真有人来取视频时才读（非视频走查不必把近 1MB 读进内存）。
  let videoBytes
  const readVideoBytes = async () => (videoBytes ??= await readFile(path.join(rootDir, 'docs/audit/2026-08-20-l3-f1-full-journey/08-video-1787216968985.mp4')))
  /** apimart 是**异步**协议：create 回 task_id，query 轮询到 completed 才给出图的 URL。 */
  const tasks = new Map()
  let taskSequence = 0
  /** true → apimart 轮询一律回 `processing`：让「已派出、还在供应商那边」这一态停得住，走查才拍得到它。 */
  let holdTasks = false
  /**
   * 非空 → apimart 图片 / 视频 create 先不回：制作流程逐镜顺序派发，下一镜就停在「已授权、还没轮到」= 排队中；
   * 也是「提交还在供应商门口时用户按了暂停」的那个窗口（全功能走查 pb05），用放开来收，不靠计时。
   */
  let submitsHeld = null
  let releaseSubmits = () => {}
  let fixtureOrigin = ''
  const requests = []
  const images = []
  /** 视频生成的 create 请求（apimart `/v1/videos/generations`）。 */
  const videos = []
  // 真视频要跑**几分钟**：受理之后供应商一直回 `processing`，直到走查说「供应商那边出片了」。
  // 默认就压着——一条走查若不 release，它看到的正是用户看到的「还在生成」。
  let videosHeld = true
  const unexpected = []
  /** 启动对账发来的只读模型清单请求（见 handleRequest）；走查想核时可读。 */
  const modelListProbes = []
  const expectations = []
  /**
   * 常驻应答（全功能走查用）：App 自己在后台发起、次数不定的文本调用（出图后的镜级审片等）。
   * 一次性期望（`expectText`）优先；都不匹配才轮到它们。它们**不会**被消费，也不计入 `assertClean` 的「没用上」。
   */
  const standing = []
  /**
   * 逐笔的失败注入（全功能走查用，缺省 = 老样子：受理并出片）。压着 / 放开不在这里——那是 holdSubmits / holdTasks /
   * releaseVideos 的事，一件事只有一个开关。
   * `({ kind: 'image'|'video', body, index }) => undefined | { reject: { status, json } } | { fail: { message } } | { corruptResult: true } | { trailingBytesResult: true }`
   *   · reject：受理那一步就回错（没有任务号）；
   *   · fail：受理成功、轮询回 failed（apimart 形状）/ 同步那一档直接回 500；
   *   · corruptResult：受理、出图都「成功」，给的图却是读不出来的字节（JPEG 魔数 + 随机字节；apimart 异步档与回环同步档都认）；
   *   · trailingBytesResult：出图「成功」，给的是一张完整的 PNG、IEND 之后带了尾数据（回环同步档认）——宿主应当照常落地。
   */
  let mediaBehavior = null
  const sockets = new Set()
  let closed = false
  let closing

  function rejectRequest(record, response, message) {
    if (!unexpected.includes(record)) unexpected.push(record)
    if (response.headersSent) response.destroy()
    else jsonResponse(response, 400, { error: { message } })
  }

  async function handleRequest(request, response, record) {
    // 产物本体：真实出片那一步会由宿主把它下载下来落进项目目录（`generationOutputMaterializer`）。
    if (record.path === '/fixture/image.jpg') {
      if (!canWrite(response)) return
      response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': imageBytes.length })
      response.end(imageBytes)
      return
    }
    // 供应商说「成功」、给的字节却读不出来（JPEG 魔数 + 随机字节，解码器一帧都出不来）：宿主判 decode_failed。
    // 只有 `mediaBehavior` 回了 `{ corruptResult: true }` 的那一笔任务才会拿到这个地址。
    if (record.path === '/fixture/corrupt.jpg') {
      if (!canWrite(response)) return
      response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': corruptImageBytes.length })
      response.end(corruptImageBytes)
      return
    }
    if (record.path === '/fixture/video.mp4' || record.path === videoResultPath) {
      const bytes = await readVideoBytes()
      if (!canWrite(response)) return
      response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': bytes.length })
      response.end(bytes)
      return
    }
    // Higgsfield 轮询：`GET /requests/<id>/status`，产物键是 `images[0].url`（与 apimart 不对称）。
    const higgsfieldStatus = /^\/requests\/([^/?]+)\/status/.exec(record.path)
    if (higgsfieldStatus) {
      const task = tasks.get(higgsfieldStatus[1])
      if (!task) { jsonResponse(response, 404, { detail: 'unknown request' }); return }
      jsonResponse(response, 200, {
        request_id: higgsfieldStatus[1], status: 'completed',
        images: [{ url: `${fixtureOrigin}/fixture/image.jpg` }],
      })
      return
    }
    const taskQuery = /^\/v1\/tasks\/([^/?]+)/.exec(record.path)
    if (taskQuery) {
      const task = tasks.get(taskQuery[1])
      if (!task) { jsonResponse(response, 404, { code: 404, data: { status: 'failed', error: { message: 'unknown task' } } }); return }
      task.polls = (task.polls ?? 0) + 1
      if (task.behavior?.fail) {
        jsonResponse(response, 200, { code: 200, data: { id: taskQuery[1], status: 'failed', error: { message: String(task.behavior.fail.message ?? 'fixture failure') } } })
        return
      }
      if (task.kind === 'video') {
        // apimart 视频：结果在 data.result.videos[0].url[0]（url 本身是数组，见 APIMART_VIDEO_QUERY_OP）。
        jsonResponse(response, 200, { code: 200, data: videosHeld
          ? { id: taskQuery[1], status: 'processing' }
          : { id: taskQuery[1], status: 'completed', result: { videos: [{ url: [`${fixtureOrigin}${videoResultPath}`] }] } } })
        return
      }
      if (holdTasks) { jsonResponse(response, 200, { code: 200, data: { id: taskQuery[1], status: 'processing' } }); return }
      jsonResponse(response, 200, { code: 200, data: {
        id: taskQuery[1], status: 'completed',
        result: { images: [{ id: taskQuery[1], url: [`${fixtureOrigin}/fixture/${task.behavior?.corruptResult ? 'corrupt' : 'image'}.jpg`], filename: 'fixture.jpg' }] },
      } })
      return
    }
    if (record.path === '/v1/chat/completions') requests.push(record)
    else if (record.path === '/v1/images/generations' || record.path.startsWith('/higgsfield-ai/')) images.push(record)
    else if (record.path === '/v1/videos/generations') videos.push(record)
    // APIMart 参考图上传（POST /v1/uploads/images，multipart）。上传端点现在跟着用户的 base 走，夹具口把 base
    // 指到本机，所以它会落到这里；收下字节、回一个本机取得到的图地址（走查据此证明「没出门」）。
    if (apimartMode && request.method === 'POST' && record.path === '/v1/uploads/images') {
      for await (const chunk of request) void chunk
      record.upload = true
      jsonResponse(response, 200, { url: `${fixtureOrigin}/fixture/image.jpg` })
      return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    record.body = Buffer.concat(chunks).toString('utf8')
    try {
      record.body = JSON.parse(record.body || '{}')
    } catch {
      rejectRequest(record, response, 'Invalid JSON request body')
      return
    }
    // App 启动时的零额度模型清单对账（startCatalogReconciliation）会对有钥匙的文本供应商发只读 GET /models 或 /v1/models。
    // 这是常驻应答，不算意外请求；清单照夹具目录里的模型原样回（对账看到「都在」就不会改目录）。其余路径仍照样判红。
    if (request.method === 'GET' && (record.path === '/models' || record.path === '/v1/models')) {
      const listed = JSON.parse(await readFile(path.join(settingsDir, 'model-catalog.json'), 'utf8')).models ?? []
      modelListProbes.push(record)
      jsonResponse(response, 200, { object: 'list', data: [...new Set(listed.map((model) => model.modelKey))].map((id) => ({ id, object: 'model' })) })
      return
    }
    if (request.method !== 'POST') {
      rejectRequest(record, response, `Unexpected route: ${request.method} ${record.path}`)
      return
    }
    if (record.path === '/v1/images/generations') {
      const behavior = mediaBehavior?.({ kind: 'image', body: record.body, index: images.indexOf(record) }) ?? null
      record.behavior = behavior
      if (behavior?.reject) { jsonResponse(response, behavior.reject.status ?? 400, behavior.reject.json ?? { error: { message: 'fixture rejected' } }); return }
      // 回环那两家是 openai 兼容的同步出图（目录里没有查询接口）：夹具开着 apimart 档时，它们的请求也按同步形状回。
      // 否则画布直生成拿到一个「已受理、没产物」的异步回执，宿主只能判失败——全功能走查 pb02 A 路（对照组）就这么假失败过。
      // 认调用方靠请求体里的模型名（回环两家的映射固定发 FIXTURE_IMAGE_MODEL）；鉴权头认不了：回环那家 authType 是 none。
      const loopbackCaller = record.body?.model === FIXTURE_IMAGE_MODEL
      if (!apimartMode || loopbackCaller) {
        if (behavior?.fail) { jsonResponse(response, 500, { error: { message: String(behavior.fail.message ?? 'fixture failure') } }); return }
        jsonResponse(response, 200, { data: [{ url: behavior?.corruptResult ? corruptImageURL : behavior?.trailingBytesResult ? trailingBytesPngURL : imageURL }] })
        return
      }
      if (submitsHeld) await submitsHeld
      if (!canWrite(response)) return
      const taskId = `agent-runtime-${++taskSequence}`
      tasks.set(taskId, { body: record.body, behavior })
      record.taskId = taskId
      jsonResponse(response, 200, { code: 200, data: [{ status: 'submitted', task_id: taskId }] })
      return
    }
    if (apimartMode && record.path === '/v1/videos/generations') {
      const behavior = mediaBehavior?.({ kind: 'video', body: record.body, index: videos.indexOf(record) }) ?? null
      record.behavior = behavior
      if (behavior?.reject) { jsonResponse(response, behavior.reject.status ?? 400, behavior.reject.json ?? { error: { message: 'fixture rejected' } }); return }
      if (submitsHeld) await submitsHeld
      if (!canWrite(response)) return
      const taskId = `agent-runtime-video-${++taskSequence}`
      tasks.set(taskId, { body: record.body, kind: 'video', behavior })
      record.taskId = taskId
      jsonResponse(response, 200, { code: 200, data: [{ status: 'submitted', task_id: taskId }] })
      return
    }
    // Higgsfield 的 create：路径是模型 slug 本身，受理回的是 `request_id`（不是 `data[0].task_id`）。
    if (higgsfieldMode && record.path.startsWith('/higgsfield-ai/')) {
      const taskId = `higgsfield-${++taskSequence}`
      tasks.set(taskId, { body: record.body })
      jsonResponse(response, 200, { request_id: taskId, status: 'queued' })
      return
    }
    if (record.path !== '/v1/chat/completions') {
      rejectRequest(record, response, `Unexpected route: ${request.method} ${record.path}`)
      return
    }
    // 真供应商的上下文窗口：一次请求的输入超过它就整条回 400（与 OpenAI 兼容端点的措辞一致，pi 据此判「上下文溢出」）。
    // 用户反馈「Assistant request exceeded the context window」就是这条路；夹具不设窗口时永远不会复现它。
    if (contextLimitTokens) {
      const promptTokens = estimateFixtureTokens(JSON.stringify({ messages: record.body?.messages ?? [], tools: record.body?.tools ?? [] }))
      if (promptTokens > contextLimitTokens) {
        record.contextOverflow = promptTokens
        jsonResponse(response, 400, { error: { message: `Requested token count exceeds the model's maximum context length of ${contextLimitTokens} tokens (this request: ${promptTokens}).`, code: 'context_length_exceeded', type: 'invalid_request_error' } })
        return
      }
    }
    const measure = usage === 'measured' ? { usage: (reply) => measuredFixtureUsage(record.body, reply) } : {}
    const expectation = expectations.find((entry) => !entry.consumed && entry.match(record.body, record))
    if (!expectation) {
      const responder = standing.find((entry) => entry.match(record.body, record))
      if (responder) {
        responder.hits += 1
        record.standing = responder.label
        const reply = typeof responder.reply === 'function' ? responder.reply(record.body, record) : responder.reply
        validateReply(reply, false)
        sendReply({ response, started: false, model: record.body?.model ?? FIXTURE_TEXT_MODEL, id: `chatcmpl-fixture-${requests.length}`, ...measure }, reply)
        return
      }
      rejectRequest(record, response, 'Unexpected text request: no unconsumed expectation matched')
      return
    }
    expectation.consumed = true
    record.expectation = expectation.label
    const state = { response, started: false, model: record.body?.model ?? FIXTURE_TEXT_MODEL, id: `chatcmpl-fixture-${requests.length}`, ...measure }
    expectation.state = state
    response.once('close', () => { expectation.state = undefined })
    expectation.resolveReceived(record)
    const reply = expectation.releasedReply ?? expectation.reply
    if (reply.type !== 'hold' || reply.text !== undefined || reply.reasoning !== undefined) sendReply(state, reply)
  }

  const server = http.createServer((request, response) => {
    const record = {
      path: request.url ?? '', body: null,
      authorization: request.headers.authorization ?? '', headers: { ...request.headers },
      // 到达时刻：全功能走查按它把一笔供应商提交对到「是哪一步惹出来的」。
      at: Date.now(),
    }
    // A peer may disappear while a held reply is being released; never emit an unhandled error.
    response.on('error', () => response.destroy())
    void handleRequest(request, response, record).catch((error) => {
      if (!closed && !request.aborted && !response.destroyed) {
        rejectRequest(record, response, `Fixture request failed: ${error.message}`)
      }
    })
  })
  // Node 默认 5s 就关闲置 keep-alive 连接；宿主（undici）恰在那一刻复用它发付费提交，会读到 ECONNRESET，
  // 而付费提交「回执未知不重试」是有意的 fail-closed。真供应商网关的闲置超时是分钟级，夹具取 30s（< headersTimeout 60s），
  // 否则走查里任何一次「等画面停稳再点确认」的正常停顿都会撞上这个 5s 窗口。
  server.keepAliveTimeout = 30_000
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })

  function close() {
    if (closing) return closing
    closed = true
    closing = new Promise((resolve, reject) => {
      server.close((error) => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve())
      for (const socket of sockets) socket.destroy()
    })
    return closing
  }

  try {
    await new Promise((resolve, reject) => {
      const onError = (error) => { server.off('listening', onListening); reject(error) }
      const onListening = () => { server.off('error', onError); resolve() }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(0, '127.0.0.1')
    })
    const baseURL = `http://127.0.0.1:${server.address().port}`
    fixtureOrigin = baseURL
    await mkdir(settingsDir, { recursive: true })
    const catalog = await modelCatalog(baseURL, {
      generationProvider, extraImageVendor,
      ...(builtinMode ? { apimartKey: encryptApimartKey({ rootDir, userDataDir, appName }) } : {}),
    })
    await writeFile(path.join(settingsDir, 'model-catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`, { flag: 'wx' })
    return {
      baseURL, requests, images, videos, unexpected, modelListProbes, close, generationProvider,
      /** 已受理的 apimart 图片任务先停在 `processing`（true），放开后下一次轮询照常出图（false）。 */
      holdTasks(on) { holdTasks = Boolean(on) },
      /** apimart 图片 / 视频 create 先压着不回（true），放开后压着的那几笔照常受理（false）。 */
      holdSubmits(on) {
        if (on) submitsHeld ??= new Promise((resolve) => { releaseSubmits = resolve })
        else { releaseSubmits(); submitsHeld = null }
      },
      /** 供应商那边出片了：此后每次查询都回 completed + 真 mp4 的地址。 */
      releaseVideos() { videosHeld = false },
      /** 每个视频任务被查询过几次（证「宿主一直在问」而不是停手了）。 */
      videoTaskPolls() { return [...tasks.values()].filter((task) => task.kind === 'video').map((task) => task.polls ?? 0) },
      /** 设逐笔的失败注入（见 `mediaBehavior` 的注释）；传 null 回到缺省。 */
      setMediaBehavior(fn) {
        if (fn !== null && typeof fn !== 'function') throw new TypeError('setMediaBehavior expects a function or null')
        mediaBehavior = fn
      },
      /** 常驻应答（见 `standing` 的注释）。`reply` 可以是函数：`(body, record) => Reply`。 */
      respond({ label, match, reply }) {
        if (closed) throw new Error('Fixture is closed')
        if (typeof label !== 'string' || !label || typeof match !== 'function') throw new TypeError('respond needs a label and a synchronous matcher')
        if (typeof reply !== 'function') validateReply(reply, false)
        const entry = { label, match, reply, hits: 0 }
        standing.push(entry)
        return entry
      },
      standingHits() { return standing.map((entry) => ({ label: entry.label, hits: entry.hits })) },
      /** @param {{label:string, match?:(body:unknown, record:RequestRecord)=>boolean, reply:Reply}} options */
      expectText({ label, match = () => true, reply }) {
        if (closed) throw new Error('Fixture is closed')
        if (typeof label !== 'string' || !label || typeof match !== 'function') {
          throw new TypeError('expectText needs a label and a synchronous matcher')
        }
        validateReply(reply)
        let resolveReceived
        const received = new Promise((resolve) => { resolveReceived = resolve })
        const expectation = { label, match, reply, consumed: false, resolveReceived, releasedReply: undefined, state: undefined }
        expectations.push(expectation)
        return {
          received,
          release(actualReply) {
            if (closed || expectation.releasedReply || (expectation.consumed && !expectation.state)
              || (expectation.state && !canWrite(expectation.state.response))) return
            const nextReply = actualReply ?? reply
            validateReply(nextReply, false)
            expectation.releasedReply = nextReply
            if (expectation.state) sendReply(expectation.state, nextReply)
          },
        }
      },
      assertClean() {
        const unused = expectations.filter((entry) => !entry.consumed).map((entry) => entry.label)
        const problems = []
        if (unexpected.length) problems.push(`${unexpected.length} unexpected request(s): ${unexpected.map((record) => record.path).join(', ')}`)
        if (unused.length) problems.push(`Unconsumed expectations: ${unused.join(', ')}`)
        if (problems.length) throw new Error(problems.join('; '))
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}

/** Real renderer projection; callers provide catalog DTOs, never a hand-authored prompt block. */
export async function projectAgentRuntimeModels(rootDir, models) {
  const { createServer } = await import('vite')
  const server = await createServer({ root: rootDir, server: { middlewareMode: true }, appType: 'custom' })
  try {
    const { toCatalogModelOptions } = await server.ssrLoadModule('/src/config/modelOptionMappers.ts')
    const { buildAgentModelEntries } = await server.ssrLoadModule('/src/workbench/generationCanvas/agent/availableModels.ts')
    return buildAgentModelEntries(toCatalogModelOptions(models))
  } finally { await server.close() }
}
