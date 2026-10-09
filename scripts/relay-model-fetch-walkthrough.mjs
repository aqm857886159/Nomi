import { makeTempDir } from './_test-temp.mjs'
// R13 真机走查：中转站接入的两条根因（都由「用户接了个只有视频模型的 new-api 中转」暴露）。
//
// 根因 1｜拉模型：new-api/one-api 的后台是 SPA，**未知路径一律 200 + index.html**。旧实现只看
//   HTTP 200 就算命中，把那页 HTML 当「没有模型」，探测提前收工，真正的 /v1/models 永远轮不到
//   → 填裸地址（不带 /v1）的用户永远拉不到模型，且界面零线索。
// 根因 2｜测试连接：协议探测发的是**文字聊天**请求，却拿「所选的第一个模型」去发。上游只接了
//   图片/视频模型时，那就是拿视频模型发 chat/completions，必被拒 → 一律误报「连不上」，还把用户
//   往「换个接口协议试试」上引（协议只管文本，跟视频毫无关系）。
//
// 走查跑两轮：
//   A. 本地假中转（形状照抄用户那家）：验「裸地址能拉到视频模型」+「测试连接说地址和 Key 没问题」。
//   B. 用户报障的真实中转 + 故意写错的 key：验「越过 200 HTML 走到 /v1/models」+ 报出的是上游
//      人话（Invalid token）而不是整坨裸 JSON。
// 用法：node scripts/relay-model-fetch-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.relay-fetch-walk')
mkdirSync(outDir, { recursive: true })
const settingsDir = makeTempDir('relay-fetch-walk-')
const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }

const REAL_URL = 'https://sd.dawnloadai.com:8443' // 用户报障的真实中转（裸地址）
const BAD_KEY = 'sk-intentionally-wrong-key-for-walkthrough'

// 假 new-api：/models 回后台 SPA 首页（200 HTML，就是那个坑），/v1/models 才是真接口。
const SPA_HTML = '<!doctype html>\n<html lang="en"><head><title>Dawnload</title></head><body><div id="root"></div></body></html>'
const VIDEO_MODELS = ['doubao-seedance-2-0-mini-260615', 'doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128']
let chatHits = 0
const mock = http.createServer((req, res) => {
  const url = (req.url || '').split('?')[0]
  if (url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ object: 'list', data: VIDEO_MODELS.map(id => ({ id, object: 'model' })) }))
    return
  }
  if (url.endsWith('/chat/completions') || url.endsWith('/responses') || url.endsWith('/messages')) {
    // 若还有人拿视频模型来发聊天，这里会被打中 → 走查会报出来（不该再发生）。
    chatHits += 1
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'model not supported for chat', type: 'new_api_error' } }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(SPA_HTML)
})
await new Promise((r) => mock.listen(8899, '127.0.0.1', r))
const MOCK_URL = 'http://127.0.0.1:8899'
console.log('  🟢 假 new-api（/models 回 SPA 网页，/v1/models 回 3 个视频模型）on ' + MOCK_URL)

const { app, win } = await launchNomiApp({
  name: 'relay-model-fetch',
  settingsDir,
  env: { NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html') },
})
const errors = []

/** 在已打开的接入表单里填地址+key，触发拉取，返回界面文本。 */
async function fillAndFetch(win, baseUrl, apiKey, waitMs) {
  const urlField = win.getByPlaceholder('api.openai.com', { exact: false }).first()
  await urlField.waitFor({ timeout: 8000 })
  await urlField.fill(baseUrl)
  const keyField = win.getByPlaceholder('sk-', { exact: false }).first()
  await keyField.fill(apiKey)
  await keyField.blur().catch(() => {})
  const fetchBtn = win.getByRole('button', { name: '拉取模型', exact: false })
  if (await fetchBtn.count()) { await fetchBtn.first().click() }
  await win.waitForTimeout(waitMs)
  return win.locator('body').innerText()
}

try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await win.waitForTimeout(1800)

  await win.getByRole('button', { name: '接入模型', exact: false }).first().click()
  await win.waitForTimeout(1200)
  const relayGroup = win.getByText('接入生成模型', { exact: false }).first()
  await relayGroup.waitFor({ timeout: 8000 })
  await relayGroup.click()
  await win.waitForTimeout(900)
  await win.mouse.move(1200, 700)
  for (let i = 0; i < 8; i += 1) { await win.mouse.wheel(0, 400); await win.waitForTimeout(150) }
  const customEntry = win.getByText('添加模型 / 中转站', { exact: false }).first()
  await customEntry.waitFor({ timeout: 8000 })
  await customEntry.click()
  await win.waitForTimeout(1200)
  const nameField = win.getByPlaceholder('TOAPI', { exact: false }).first()
  if (await nameField.count()) { await nameField.fill('Seedance 2.0 视频生成') }
  await shot(win, '01-wizard-open.png')

  // ── A 轮：真实中转 + 错 key → 该越过 200 HTML 走到 /v1/models，报上游人话 ─────
  const textA = await fillAndFetch(win, REAL_URL, BAD_KEY, 16000)
  await shot(win, '02-real-relay-bad-key.png')
  const line = (textA.split('\n').find(l => l.includes('没自动拉到模型')) || '').trim()
  console.log('  [A] 界面原文：', line || '（未找到）')
  console.log(`  [A] 说的是上游人话而非裸 JSON = ${line.includes('Invalid token') && !line.includes('{"error"')}`)

  // ── B 轮：假中转（裸地址，形状照抄用户那家）→ 该拉到 3 个视频模型 ────────────
  // 承接 A 轮：拉取失败会清空候选池，所以这里的失焦自动拉取能正常触发。
  await fillAndFetch(win, MOCK_URL, 'sk-any-key-mock-accepts', 6000)
  await shot(win, '03-mock-fetched.png')

  // 进「选择模型」第二屏 → 全选本组（3 个全是视频）→ 添加回主屏
  await win.getByText('选择模型', { exact: false }).first().click()
  await win.waitForTimeout(900)
  await win.getByText('全选本组', { exact: false }).first().click()
  await win.waitForTimeout(400)
  const pickerText = await win.locator('body').innerText()
  const gotAll = VIDEO_MODELS.every(id => pickerText.includes(id))
  console.log(`  [B] 裸地址拉到全部 3 个视频模型 = ${gotAll}`)
  await shot(win, '04-picker-all-video.png')
  await win.getByRole('button', { name: `添加 ${VIDEO_MODELS.length} 个模型`, exact: false }).first().click()
  await win.waitForTimeout(900)

  // 已选中的 3 个全是视频模型 → 测连接（旧实现会拿视频模型去发聊天，必误报「连不上」）
  await win.getByRole('button', { name: '测试连接', exact: false }).first().click()
  await win.waitForTimeout(6000)
  await shot(win, '05-mock-test-connection.png')
  const textB2 = await win.locator('body').innerText()
  const reachabilityLine = (textB2.split('\n').find(l => l.includes('地址和 Key')) || '').trim()
  console.log(`  [B] 测试连接文案：${reachabilityLine || '（未出现可达性文案）'}`)
  console.log(`  [B] 被误发的聊天请求次数 = ${chatHits}（应为 0）`)

  console.log(errors.length ? ('  ⚠️ console/page errors:\n' + errors.slice(0, 8).join('\n')) : '  ✅ 无 console/page error')
} catch (e) {
  console.error('  ❌ 走查失败：', e)
  try { const w = await app.firstWindow(); await shot(w, 'ERROR.png') } catch { /* noop */ }
  process.exitCode = 1
} finally {
  await app.close()
  mock.close()
}
