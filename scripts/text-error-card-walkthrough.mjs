import { makeTempDir } from './_test-temp.mjs'
// R13 真机走查：文本侧结构化错误 → 对话错误卡（bb32ec56 修复验证）。
//
// 单测能证「分类对不对」，证不了**用户眼前那张卡长什么样**。这次改动往错误 message 里塞了
// 一段 base64 标记（NOMI_VENDOR_ERR_B64::），渲染层任何一处忘了 stripVendorErrorMarker，
// 用户就会当面吃到一坨乱码——单测抓不到，只有眼睛能抓。所以这条走查专盯两件事：
//   ① 错误卡标题给的是「服务商故障」（结构化 category=server），不是关键词猜不出时那句
//      「可能是服务商临时故障或额度问题，建议稍等重试」；
//   ② 卡上任何位置——包括展开的「技术详情」——都不能出现 NOMI_VENDOR_ERR_B64 乱码。
//
// 故障注入：本机起一个只会回 HTTP 500 的假端点，接成一个 authType=none 的文本模型。
// 零额度、不连外网、不碰用户真实配置（settings/projects 全隔离）。
// 用法：node scripts/text-error-card-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.text-error-lab')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
const settingsDir = makeTempDir('texterr-settings-')
const projectsDir = makeTempDir('texterr-projects-')

const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }

// ── 故障注入：只会回 500 的假上游 ────────────────────────────────────────────
let hits = 0
const server = http.createServer((req, res) => {
  req.resume()
  req.on('end', () => {
    hits++
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'upstream exploded (走查注入)' } }))
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
console.log(`  🎯 假上游已起：127.0.0.1:${port}（一律回 HTTP 500）`)

// ── 预置目录：一个 authType=none 的文本模型，指向假上游 ──────────────────────
const now = new Date().toISOString()
fs.writeFileSync(
  path.join(settingsDir, 'model-catalog.json'),
  JSON.stringify({
    version: 8,
    vendors: [{
      key: 'errverify', name: '走查假上游', enabled: true,
      baseUrlHint: `http://127.0.0.1:${port}`, authType: 'bearer', hasApiKey: true,
      providerKind: 'openai-compatible', createdAt: now, updatedAt: now,
    }],
    models: [{
      modelKey: 'errverify-text', vendorKey: 'errverify', modelAlias: 'errverify-text',
      labelZh: '走查文本模型', kind: 'text', enabled: true,
    }],
    mappings: [],
    // 必须给一把（哪怕是假的）钥匙：authType=none 时 apiKey 为空，buildAiSdkModel 会在
    // **发请求之前**就抛 "apiKey is required"，走查连上游都碰不到（第一版就栽在这）。
    // enc: 'plain' = 明文记录，safeStorage 不参与，跨机可复现。
    apiKeysByVendor: {
      errverify: { vendorKey: 'errverify', apiKey: 'sk-walkthrough-fake', enc: 'plain', enabled: true, createdAt: now, updatedAt: now },
    },
  }, null, 2),
)

const { app, win } = await launchNomiApp({
  name: 'text-error-card',
  settingsDir,
  projectsDir,
  env: { NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html') },
  settleMs: 2000,
})
const errors = []
let failed = false
const fail = (msg) => { failed = true; console.error('  ❌ ' + msg) }

try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1600, height: 1000 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2600)
  await win.keyboard.press('Escape')
  await shot(win, '01-project.png')

  // 创作区的 AI 助手 composer：找可编辑框，写一句话发出去。
  const composer = win.locator('[contenteditable="true"], textarea').last()
  await composer.waitFor({ timeout: 10_000 })
  await composer.click()
  // 措辞要避开本地意图路由（说「拆镜头」会被就地拦成分镜选择卡，压根不发请求 → 走查空转）。
  await win.keyboard.insertText('你好')
  await win.waitForTimeout(400)
  await shot(win, '02-composed.png')
  // 发送按钮（Enter 不发；composer 里 Enter 是换行）。
  await win.locator('button[aria-label="创作 AI 发送"]').first().click()
  console.log('  ▶️  已发送，等失败落地…')

  // 等错误卡（假上游立刻 500，但 SDK 生产配置 maxRetries=3 会退避重试 2+4+8s）。
  let seen = ''
  for (let i = 0; i < 20; i++) {
    await win.waitForTimeout(3000)
    const server故障 = await win.getByText('服务商故障', { exact: false }).count()
    const anyErr = await win.locator('[data-assistant-error="true"]').count()
    if (server故障 > 0 || anyErr > 0) { seen = `服务商故障=${server故障} errorCard=${anyErr} @${(i + 1) * 3}s`; break }
  }
  console.log(`  错误卡出现: ${seen || '（60s 内没出现!）'}`)
  if (!seen) fail('60s 内没等到错误卡')
  await shot(win, '03-error-card.png')

  // ① 标题必须是结构化给出的「服务商故障」，不是关键词猜不出时的兜底
  if ((await win.getByText('服务商故障', { exact: false }).count()) === 0) {
    fail('标题不是「服务商故障」——structured category 没被采信')
  }
  // 落进 unknown 的失败现在说的是「没能认出这次失败的原因」（F6 之前是「可能是…额度问题」）；500 有结构化分类，不该出现它。
  if ((await win.getByText('没能认出这次失败的原因', { exact: false }).count()) > 0) {
    fail('出现「没能认出这次失败的原因」——500 被当成 unknown 了（正是这次要修的病）')
  }

  // ② 展开「技术详情」——report.raw 就显示在这里，标记漏剥的话乱码在这一格现原形
  const detail = win.getByText('技术详情', { exact: false }).first()
  if (await detail.count()) {
    await detail.click()
    await win.waitForTimeout(600)
  } else {
    console.log('  ℹ️ 没有「技术详情」入口（raw 与 reason 相同时不显示）')
  }
  await shot(win, '04-detail-expanded.png')

  // 乱码总检：整页文本里绝不能出现标记/base64 残渣
  const bodyText = await win.locator('body').innerText()
  for (const bad of ['NOMI_VENDOR_ERR_B64', 'eyJ2ZW5kb3JLZXk']) {
    if (bodyText.includes(bad)) fail(`页面上出现了未剥离的标记残渣：${bad}`)
  }
  console.log(`  🔍 页面文本无标记残渣（假上游共被打 ${hits} 次 = 1 次 + 重试）`)
} catch (e) {
  fail('走查异常：' + e)
  try { const w = await app.firstWindow(); await shot(w, 'ERROR.png') } catch { /* noop */ }
} finally {
  await app.close()
  server.close()
}
console.log(errors.length ? ('  ⚠️ console/page errors:\n' + errors.slice(0, 6).join('\n')) : '  ✅ 无 console/page error')
console.log(failed ? '❌ 走查失败' : '✅ 走查通过')
process.exitCode = failed ? 1 : 0
