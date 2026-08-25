// 真实用户操作走查：把一个**本地网关**接进 Nomi（issue #62 / 2026-08-11 群反馈现场复刻）。
//
// 复刻的现场：用户填 http://127.0.0.1:8080/v1（sub2api / 自建网关），测试连接显示「已连上」，
// 但接入结果是「0 / 13 个模型已有可用能力」+ 红字 Invalid URL。根因是 127.0.0.1 被当域名截成
// "0.1" 拼出 http://docs.0.1，new URL 直接抛。修复见 electron/providerAdapter/docsDiscovery.ts。
//
// 本走查不打真实上游、不花额度：自带一个假的 OpenAI 兼容网关跑在 127.0.0.1 随机端口。
// 用法: node tests/ux/local-gateway-onboarding.walk.mjs
// 产出: tests/ux/shots/local-gateway/*.png —— 人眼判断，不只看断言。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { screenshotSettled } from './_assert.mjs'

const shotsDir = path.join(repoRoot, 'tests/ux/shots/local-gateway')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })
const userData = path.join(repoRoot, '.tmp', 'nomi-local-gateway-userdata')
fs.rmSync(userData, { recursive: true, force: true })
fs.mkdirSync(userData, { recursive: true })

// ── 假网关：模仿 sub2api / new-api 这类自建网关的 OpenAI 兼容口 ──
// 覆盖到「接入验证真的能通过」所需的全部线缆：模型列表、SSE 流式文本、同步出图、
// chat 多模态图生图、视频异步 create + 轮询、以及产物字节本身（验证会去下载产物）。
const MODELS = ['gpt-5.2', 'gpt-5.4-mini', 'gpt-image-2', 'kling-v2-master']
// 1x1 PNG / 极小 mp4 头：产物验证要能真的下载到字节。
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const MP4_STUB = Buffer.from('AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE=', 'base64')
const videoTasks = new Map()

const gateway = http.createServer((req, res) => {
  const url = req.url || ''
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    let body = {}
    try {
      body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
    } catch {
      body = {}
    }
    const send = (code, payload) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(payload))
    }

    if (url.startsWith('/asset/')) {
      const isVideo = url.endsWith('.mp4')
      res.writeHead(200, { 'Content-Type': isVideo ? 'video/mp4' : 'image/png' })
      return res.end(isVideo ? MP4_STUB : PNG_1X1)
    }
    if (url.startsWith('/v1/models')) {
      return send(200, { object: 'list', data: MODELS.map((id) => ({ id, object: 'model', owned_by: 'local' })) })
    }
    if (url.startsWith('/v1/chat/completions')) {
      // 图生图：请求里带了参考图 → 回 message.images[0].url（通用中转的图生图口径）。
      const hasImage = JSON.stringify(body.messages || []).includes('image_url')
      if (hasImage && !body.stream) {
        if (body.model === 'gpt-image-2') {
          return send(422, { error: { message: 'deliberate image verification failure' } })
        }
        return send(200, { choices: [{ index: 0, message: { role: 'assistant', images: [{ url: `${assetBase()}/asset/edit.png` }] }, finish_reason: 'stop' }] })
      }
      // 文本验证走 AI SDK，默认要 SSE 流；非流式请求仍回普通 JSON。
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
        const id = 'chatcmpl-local'
        const model = body.model || 'gpt-5.2'
        const frame = (delta, finish) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
        res.write(frame({ role: 'assistant', content: '' }, null))
        res.write(frame({ content: 'ready' }, null))
        res.write(frame({}, 'stop'))
        res.write('data: [DONE]\n\n')
        return res.end()
      }
      return send(200, { id: 'c1', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: 'ready' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
    }
    if (url.startsWith('/v1/images/generations')) {
      if (body.model === 'gpt-image-2') {
        return send(422, { error: { message: 'deliberate image verification failure' } })
      }
      return send(200, { created: 1, data: [{ url: `${assetBase()}/asset/a.png` }] })
    }
    // 视频轮询：GET /v1/video/generations/<task_id>
    const pollMatch = url.match(/^\/v1\/video\/generations\/([^/?]+)/)
    if (pollMatch) {
      const id = pollMatch[1]
      const seen = (videoTasks.get(id) || 0) + 1
      videoTasks.set(id, seen)
      if (seen < 2) return send(200, { task_id: id, status: 'processing' })
      return send(200, { task_id: id, status: 'succeeded', data: [{ url: `${assetBase()}/asset/v.mp4` }] })
    }
    if (url.startsWith('/v1/video/generations')) {
      const id = `task-${videoTasks.size + 1}`
      videoTasks.set(id, 0)
      return send(200, { task_id: id, status: 'processing' })
    }
    return send(404, { error: { message: `no such endpoint: ${url}` } })
  })
})
function assetBase() {
  return gatewayBase.replace(/\/v1$/, '')
}
await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve))
const gatewayBase = `http://127.0.0.1:${gateway.address().port}/v1`
console.log(`— 假网关就绪: ${gatewayBase} —`)

let n = 0
async function snap(win, name) {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  await screenshotSettled(win, { path: path.join(shotsDir, `${tag}.png`) })
  console.log(`  · shot ${tag}`)
}

// 统一启动器（tests/ux/_launchApp.mjs）：必需 env 由它钉死，手抄样板漏一条就是静默挂死。
const { app, win } = await launchNomiApp({ name: 'local-gateway-onboarding', userDataDir: userData })
// 清场：跳过 splash / 引导。
await win.evaluate(() => {
  for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
    window.localStorage.setItem(k, 'seen')
  }
})
await win.reload()
await win.waitForTimeout(1500)
for (let i = 0; i < 5; i += 1) {
  const skip = win.locator('button, [role="button"], a', { hasText: /跳过|开始创作|进入|完成/ }).first()
  if (await skip.count()) await skip.click({ timeout: 1000 }).catch(() => {})
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(300)
}
await snap(win, 'app-ready')

async function clickFirst(patterns, label) {
  for (const pattern of patterns) {
    const target = win.locator('button, [role="button"], a, div[role="menuitem"]', { hasText: pattern }).first()
    if (await target.count()) {
      await target.click({ timeout: 3000 }).catch(() => {})
      await win.waitForTimeout(900)
      console.log(`  → 点了「${label}」(${pattern})`)
      return true
    }
  }
  console.log(`  ! 没找到「${label}」`)
  return false
}

async function dumpClickables(label) {
  const texts = await win.evaluate(() => {
    const nodes = document.querySelectorAll('button, [role="button"], a, summary, [role="menuitem"]')
    return [...nodes]
      .filter((el) => el.offsetParent !== null)
      .map((el) => (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 40)
  })
  console.log(`  [可点元素 @${label}] ${JSON.stringify(texts)}`)
}

// 1. 进入模型接入
await clickFirst([/接入模型/, /模型接入/], '接入模型入口')
await snap(win, 'model-access-panel')
await dumpClickables('面板打开')

// 2. 展开「接入生成模型」分组
await clickFirst([/接入生成模型/], '展开接入生成模型')
await snap(win, 'expanded-generation-models')
await dumpClickables('展开后')

// 3. 选「自定义 / 其他」走自建网关
await clickFirst([/添加模型 ?\/ ?中转站/, /添加模型/, /中转站/, /自定义/], '添加模型 / 中转站')
await snap(win, 'add-model-dialog')
await dumpClickables('对话框')

// 3. 填地址 + key —— 复刻用户填本地网关的操作
const baseInput = win.locator('input').filter({ hasNot: win.locator('[type="password"]') })
const inputs = win.locator('input')
const count = await inputs.count()
console.log(`  · 对话框里有 ${count} 个输入框`)
for (let i = 0; i < count; i += 1) {
  const box = inputs.nth(i)
  const placeholder = (await box.getAttribute('placeholder')) || ''
  const type = (await box.getAttribute('type')) || ''
  if (/搜索/.test(placeholder)) continue // 项目库搜索框，不是接入表单
  if (/http|地址|url|base/i.test(placeholder)) {
    await box.fill(gatewayBase).catch(() => {})
    console.log(`  → 输入框#${i} 填地址 ${gatewayBase} (placeholder="${placeholder}")`)
  } else if (type === 'password' || /key|密钥/i.test(placeholder)) {
    await box.fill('sk-local-probe').catch(() => {})
    console.log(`  → 输入框#${i} 填 key (placeholder="${placeholder}")`)
  }
}
void baseInput
await win.waitForTimeout(500)
await snap(win, 'filled-base-url')

// 4. 拉取模型
await dumpClickables('填完表单')
await clickFirst([/拉取可用模型/, /拉取模型/, /重新拉取/, /拉取/], '拉取模型')
await win.waitForTimeout(2500)
await snap(win, 'fetched-models')

// 5. 进选择模型屏 → 全选 → 接入并验证
await clickFirst([/选择模型/, /还没选/], '选择模型')
await win.waitForTimeout(1200)
await snap(win, 'pick-models')
await dumpClickables('选择模型屏')
const groupAll = win.locator('button', { hasText: /全选本组/ })
const initialGroups = await groupAll.count()
console.log(`  · 有 ${initialGroups} 个「全选本组」`)
for (let g = 0; g < initialGroups; g += 1) {
  // 点击后按钮会变成「取消本组」，locator 会立即缩短，所以每轮都点当前 first。
  await groupAll.first().click({ timeout: 2000 })
  await win.waitForTimeout(250)
}
const remainingGroups = await groupAll.count()
if (remainingGroups !== 0) throw new Error(`仍有 ${remainingGroups} 个模型分组没有选中`)
await win.waitForTimeout(600)
await snap(win, 'picked-all')
await clickFirst([/接入并验证 [1-9]/, /接入并验证/], '接入并验证')
await win.waitForTimeout(8000)
await snap(win, 'verify-result')
await win.waitForTimeout(12000)
await snap(win, 'verify-result-late')

// ── 断言：屏幕上不许再出现 Invalid URL ──
const bodyText = await win.evaluate(() => document.body.innerText)
fs.writeFileSync(path.join(shotsDir, 'body-text.txt'), bodyText)
const hasInvalidUrl = /Invalid URL/i.test(bodyText)
console.log(`\n— 断言 —`)
console.log(`  屏幕含 "Invalid URL": ${hasInvalidUrl}`)
const docsHostLeak = /docs\.\d/.test(bodyText)
console.log(`  屏幕含 "docs.<数字>" 畸形域名: ${docsHostLeak}`)

// 失败不能再是准入闸：故意失败的图片模型仍需启用、出现在 kind=image 列表；
// 同时，排在它后面的视频模型必须完成验证并落下可执行 mapping。
const catalog = await win.evaluate((baseUrl) => {
  const bridge = window.nomiDesktop.modelCatalog
  const vendor = (bridge.listVendors() || []).find((item) => item.baseUrlHint === baseUrl)
  if (!vendor) return { vendor: null, models: [], imageModels: [], videoModels: [], mappings: [] }
  const own = (rows) => (rows || []).filter((item) => item.vendorKey === vendor.key)
  return {
    vendor,
    models: bridge.listModels({ vendorKey: vendor.key }) || [],
    imageModels: own(bridge.listModels({ kind: 'image', enabled: true })),
    videoModels: own(bridge.listModels({ kind: 'video', enabled: true })),
    mappings: bridge.listMappings({ vendorKey: vendor.key, enabled: true }) || [],
  }
}, gatewayBase)
fs.writeFileSync(path.join(shotsDir, 'catalog.json'), JSON.stringify(catalog, null, 2))

const failedImage = catalog.models.find((model) => model.modelKey === 'gpt-image-2')
const laterVideo = catalog.models.find((model) => model.modelKey === 'kling-v2-master')
const checks = {
  resultCopyMatchesUnlockedBehavior: bodyText.includes('所选模型都已开启，也会出现在画布的模型列表里'),
  allFourModelsCommitted: MODELS.every((id) => catalog.models.some((model) => model.modelKey === id)),
  failedImageEnabled: failedImage?.enabled === true,
  failedImageMarkedFailed: failedImage?.meta?.adapter?.state === 'failed',
  failedImageVisibleByKind: catalog.imageModels.some((model) => model.modelKey === 'gpt-image-2'),
  laterVideoVerified: laterVideo?.meta?.adapter?.state === 'verified',
  laterVideoVisibleByKind: catalog.videoModels.some((model) => model.modelKey === 'kling-v2-master'),
  laterVideoHasMapping: catalog.mappings.some((mapping) =>
    mapping.modelKey === 'kling-v2-master' && mapping.taskKind === 'text_to_video'),
}
for (const [name, passed] of Object.entries(checks)) console.log(`  ${passed ? '✓' : '✗'} ${name}`)

await app.close()
await new Promise((resolve) => gateway.close(resolve))

if (hasInvalidUrl || docsHostLeak || Object.values(checks).some((passed) => !passed)) {
  console.error('\nWALK FAIL: 本地网关接入或失败后继续验证回归')
  process.exit(1)
}
console.log('\nWALK DONE：HTTP 本地网关、失败后继续验证、失败模型仍可选均通过。')
