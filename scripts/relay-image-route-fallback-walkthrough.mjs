// R13 真机走查（wire 眼见链）：中转生图路由回退 + 档案模型参考不丢，打真 HTTP 到本地 mock 中转。
// mock 复刻 y7api 定案行为：/v1/images/generations|edits 恒 403 "Image generation is not enabled
// for this group"，/v1/chat/completions 正常出图（one-api 分组只开聊天路由的真实形态）。
// A：t2i → images 403 → 自动回退 chat → 画布出图（wire 断言：chat 收到 0 张图件）。
// B：i2i 上传参考 → edits 403 → 回退 chat → 出图（wire 断言：chat 收到 1 张 image_url 参考件
//    ——4dd0be1f「标准参考面不被档案吞」的线上实证）。
// C：mock 全路由 403 → 节点错误卡必须是「中转分组未开通生图路由」新文案（不再误报 API Key 无效）。
// 用法：node scripts/relay-image-route-fallback-walkthrough.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.relay-fallback-walk')
fs.mkdirSync(outDir, { recursive: true })
const NOW = new Date().toISOString()
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==', 'base64')
// 出图用一张真 PNG（有内容可人眼看）；找不到就退 1x1。
const OUT_PNG = (() => {
  try {
    const dir = path.join(os.homedir(), '.codex', 'generated_images')
    for (const t of fs.readdirSync(dir)) {
      for (const f of fs.readdirSync(path.join(dir, t))) {
        if (f.endsWith('.png')) return fs.readFileSync(path.join(dir, t, f))
      }
    }
  } catch { /* fallthrough */ }
  return TINY_PNG
})()

// ── mock 中转 ───────────────────────────────────────────────────────────────
const wireLog = []
let blockChatToo = false
const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    const url = String(req.url || '')
    if (url.startsWith('/out.png')) {
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(OUT_PNG)
      return
    }
    if (url.startsWith('/v1/images/')) {
      wireLog.push({ path: url, status: 403 })
      res.writeHead(403, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Image generation is not enabled for this group' } }))
      return
    }
    if (url.startsWith('/v1/chat/completions')) {
      if (blockChatToo) {
        wireLog.push({ path: url, status: 403 })
        res.writeHead(403, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Image generation is not enabled for this group' } }))
        return
      }
      let imageParts = -1
      let model = ''
      try {
        const parsed = JSON.parse(body.toString('utf8'))
        model = String(parsed.model || '')
        const content = parsed.messages?.[0]?.content
        imageParts = Array.isArray(content) ? content.filter((p) => p && p.type === 'image_url').length : -1
      } catch { /* keep -1 */ }
      wireLog.push({ path: url, status: 200, model, imageParts })
      res.writeHead(200, { 'content-type': 'application/json' })
      // 真实中转 chat 出图的主流形态就是 base64 内联（extractChatImageUrl 解析）；也避开
      // 产物取回的 private/loopback SSRF 闸（那闸对公网真中转不生效，是 mock 环境专属命中）。
      res.end(JSON.stringify({ choices: [{ message: { content: 'done', images: [{ url: `data:image/png;base64,${OUT_PNG.toString('base64')}` }] } }] }))
      return
    }
    res.writeHead(404); res.end('{}')
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const PORT = server.address().port
console.log(`mock 中转 http://127.0.0.1:${PORT}`)

// ── 种子：老中转形状（存量自愈会补 multipart 改图 + 参考槽，走的就是真实用户升级路）──
function seedCatalog(settingsDir) {
  fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
    version: 4,
    vendors: [{
      key: 'y7-mock', name: 'Y7 Mock 中转', enabled: true, hasApiKey: true,
      baseUrlHint: `http://127.0.0.1:${PORT}`, authType: 'bearer', authHeader: null, authQueryParam: null,
      providerKind: 'openai-compatible', createdAt: NOW, updatedAt: NOW,
    }],
    models: [{
      modelKey: 'gpt-image-2', vendorKey: 'y7-mock', modelAlias: 'gpt-image-2',
      labelZh: 'GPT Image 2（mock 中转）', kind: 'image', enabled: true,
      meta: { parameters: [{ key: 'size', label: '尺寸', type: 'select', options: [{ value: '1024x1024', label: '1024x1024' }] }] },
      onboarding: { addedVia: 'manual', trialId: '', docsUrl: '', addedAt: NOW, fields: [] },
      createdAt: NOW, updatedAt: NOW,
    }],
    mappings: [{
      id: 'mapping-mock-t2i', vendorKey: 'y7-mock', taskKind: 'text_to_image', name: '文生图', enabled: true,
      create: {
        method: 'POST', path: '/v1/images/generations',
        headers: { Authorization: 'Bearer {{user_api_key}}', 'Content-Type': 'application/json' },
        body: { model: '{{model.modelKey}}', prompt: '{{request.prompt}}', size: '{{request.params.size}}', response_format: 'url' },
        response_mapping: { image_url: 'data[*].url' },
      },
      createdAt: NOW, updatedAt: NOW,
    }],
    apiKeysByVendor: { 'y7-mock': { apiKey: 'sk-mock', vendorKey: 'y7-mock', enabled: true, enc: 'plain', createdAt: NOW, updatedAt: NOW } },
  }, null, 2))
}

const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }
const errors = []
let failed = false

async function launchApp() {
  const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-fb-settings-'))
  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-fb-projects-'))
  seedCatalog(settingsDir)
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env, NOMI_E2E: '1', NOMI_E2E_ALLOW_MULTI_INSTANCE: '1',
      NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html'),
      NOMI_SETTINGS_DIR: settingsDir, NOMI_PROJECTS_DIR: projectsDir,
    },
  })
  const win = await app.firstWindow()
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1600, height: 1000 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || /guard|拒发|image_edit|fallback|mapping|refus|reject/i.test(t)) errors.push(`[${m.type()}] ` + t) })
  app.process().stdout?.on('data', (d) => { const t = String(d); if (/guard|image_edit|fallback|mapping|403|chat/i.test(t)) console.log('  [main] ' + t.trim().slice(0, 200)) })
  app.process().stderr?.on('data', (d) => { console.log('  [main-err] ' + String(d).trim().slice(0, 200)) })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(2000)
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2600)
  await win.keyboard.press('Escape')
  await win.waitForTimeout(300)
  await win.getByText('生成', { exact: true }).first().click()
  await win.waitForTimeout(1500)
  const direct = win.locator('[aria-label="添加图片节点"]')
  if ((await direct.count()) === 0 || !(await direct.first().isVisible().catch(() => false))) {
    await win.locator('[aria-label="添加节点菜单"]').first().click()
    await win.waitForTimeout(400)
  }
  await win.locator('[aria-label="添加图片节点"]').first().click()
  await win.waitForTimeout(900)
  const node = win.locator('[data-kind="image"][data-node-id]').first()
  await node.waitFor({ timeout: 8000 })
  await node.click({ position: { x: 40, y: 40 } })
  await win.waitForTimeout(1400)
  return { app, win, node }
}

async function fillPrompt(win, text) {
  const zone = win.getByText('描述这一帧的画面', { exact: false }).first()
  if ((await zone.count()) > 0) await zone.click()
  else await win.locator('[contenteditable="true"]').last().click()
  await win.waitForTimeout(300)
  await win.keyboard.insertText(text)
  await win.waitForTimeout(400)
}

async function generateAndConfirm(win) {
  const btn = win.locator('button[aria-label="生成素材"], button[aria-label="重新生成"]').first()
  await btn.waitFor({ timeout: 8000 })
  for (let i = 0; i < 20 && (await btn.isDisabled().catch(() => true)); i++) await win.waitForTimeout(300)
  await btn.evaluate((el) => el.click()) // 出图后节点浮动工具条可能盖住 composer 生成钮：force 仍会把事件发给最上层元素，直接触发 handler
  // 付费确认弹层（z-[3500]「开始生成」，确认钮叫「生成」）异步弹出——先等它出现（不出现=免确认），
  // 再点到消失为止（至多 15s）。此前「首查 count=0 即 return」在弹层未及弹出时提前退出=竞态假通过。
  const dialog = win.locator('div[class*="z-[3500]"]')
  await dialog.first().waitFor({ timeout: 5000 }).catch(() => {})
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if ((await dialog.count()) === 0) return
    const confirm = dialog.getByRole('button', { name: /生成/ }).first() // 生成/重新生成/确认生成；「取消」不含「生成」
    if ((await confirm.count()) > 0) await confirm.click({ timeout: 2000 }).catch(() => {})
    await win.waitForTimeout(500)
  }
}

async function waitNodeImage(win, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await win.locator('[data-kind="image"] img').count().catch(() => 0)) > 0) return true
    await win.waitForTimeout(1200)
  }
  return false
}

// ── A + B：同一实例内 t2i 回退出图 → i2i 带参考回退出图 ─────────────────────
{
  console.log('▶ A t2i：images 403 → chat 回退出图')
  const { app, win } = await launchApp()
  try {
    // mock 是唯一图片模型，composer 自动选中（截图核实「GPT Image 2 (m…」）；提示词是 contenteditable。
    await fillPrompt(win, '一只在雪地里的橘猫')
    await generateAndConfirm(win)
    const ok = await waitNodeImage(win, 40000)
    const t2iHits = wireLog.filter((l) => l.path.startsWith('/v1/images/generations'))
    const chatHits = wireLog.filter((l) => l.path.startsWith('/v1/chat/completions'))
    console.log(`  wire: images/generations 403×${t2iHits.length}，chat×${chatHits.length}（imageParts=${chatHits[0]?.imageParts}）`)
    if (!ok) { failed = true; console.error('  ❌ t2i 回退没出图') }
    if (t2iHits.length !== 1 || chatHits.length !== 1 || chatHits[0].imageParts !== 0) { failed = true; console.error('  ❌ wire 轨迹不符') }
    await shot(win, 'A-t2i-fallback-image-on-canvas.png')

    console.log('▶ B i2i：上传参考 → edits 403 → chat 回退，参考件必须在 chat body 里')
    wireLog.length = 0
    // A 的生成完成弹层/确认卡可能还悬着——先清场再切模式。
    await win.keyboard.press('Escape')
    await win.waitForTimeout(600)
    await win.keyboard.press('Escape')
    await win.waitForTimeout(600)
    await win.getByRole('button', { name: '图生图', exact: true }).first().click()
    await win.waitForTimeout(800)
    // 决定性隔离：B 换提示词——若因此通 wire，说明 kind 未随模式切换、撞了 A 的 S8 指纹缓存。
    await fillPrompt(win, '，把它改成蓝色调')
    const tmpPng = path.join(os.tmpdir(), `relay-fb-ref-${Date.now()}.png`)
    fs.writeFileSync(tmpPng, OUT_PNG) // 可见 PNG（1x1 透明图连缩略图都看不出挂没挂上）
    await win.locator('button[aria-label="加参考"], button[aria-label="添加参考图"]').first().click()
    await win.waitForTimeout(500)
    await win.locator('input[type="file"]').last().setInputFiles(tmpPng)
    await win.waitForTimeout(2800)
    const genBtn = win.locator('button[aria-label="生成素材"], button[aria-label="重新生成"]').first()
    const disabledBeforeClick = await genBtn.isDisabled().catch(() => true)
    console.log(`  上传后生成钮 disabled=${disabledBeforeClick}`)
    await shot(win, 'B0-after-upload.png')
    if (disabledBeforeClick) { failed = true; console.error('  ❌ 参考没挂上（B1 护栏仍禁用）') }
    await generateAndConfirm(win)
    await shot(win, 'B-after-generate-debug.png')
    const dbg = await win.evaluate(() => {
      const d = document.querySelector('div[class*="z-[3500]"]')
      return {
        dialogs: document.querySelectorAll('div[class*="z-[3500]"]').length,
        dialogText: d ? d.innerText.replace(/\s+/g, ' ').slice(0, 200) : '',
        dialogButtons: d ? Array.from(d.querySelectorAll('button')).map((b) => b.innerText.trim()) : [],
      }
    })
    console.log('  debug: ' + JSON.stringify(dbg))
    await win.waitForTimeout(5000)
    const nodeState = await win.evaluate(() => {
      const el = document.querySelector('[data-kind="image"][data-node-id]')
      return el ? el.innerText.replace(/\s+/g, ' ').slice(0, 260) : 'NO NODE'
    })
    console.log('  nodeState: ' + nodeState)
    const okB = await waitNodeImage(win, 30000)
    const editHits = wireLog.filter((l) => l.path.startsWith('/v1/images/'))
    const chatB = wireLog.filter((l) => l.path.startsWith('/v1/chat/completions'))
    console.log(`  wire: images/* 403×${editHits.length}，chat×${chatB.length}（imageParts=${chatB[0]?.imageParts} model=${chatB[0]?.model}）`)
    if (!okB) { failed = true; console.error('  ❌ i2i 回退没出图') }
    if (chatB.length !== 1 || chatB[0].imageParts !== 1 || chatB[0].model !== 'gpt-image-2') {
      failed = true; console.error('  ❌ i2i wire 轨迹不符（参考件缺失=档案吞键回归 / model 名不对）')
    }
    await shot(win, 'B-i2i-fallback-with-reference.png')
  } catch (e) {
    failed = true; console.error('  ❌ A/B 异常：', e)
    try { await shot(win, 'AB-ERROR.png') } catch { /* noop */ }
  } finally {
    await app.close()
  }
}

// ── C：全路由 403 → 新错误文案（不再误报 API Key 无效）───────────────────────
{
  console.log('▶ C 全堵：chat 也 403 → 错误卡=「中转分组未开通生图路由」')
  blockChatToo = true
  wireLog.length = 0
  const { app, win } = await launchApp()
  try {
    await fillPrompt(win, '雪山日出')
    await generateAndConfirm(win)
    await win.waitForTimeout(9000)
    const bodyText = await win.locator('body').innerText()
    const hasNewCopy = bodyText.includes('中转分组未开通生图路由')
    const hasOldMisleading = bodyText.includes('API Key 无效')
    console.log(`  错误卡: 新文案=${hasNewCopy} 误报KeyInvalid=${hasOldMisleading}`)
    if (!hasNewCopy || hasOldMisleading) { failed = true; console.error('  ❌ 错误分类未生效') }
    await shot(win, 'C-route-disabled-error-card.png')
  } catch (e) {
    failed = true; console.error('  ❌ C 异常：', e)
    try { await shot(win, 'C-ERROR.png') } catch { /* noop */ }
  } finally {
    await app.close()
  }
}

server.close()
fs.writeFileSync(path.join(outDir, 'wire-log.json'), JSON.stringify(wireLog, null, 2))
console.log('\n=== 页面错误(' + errors.length + ') ===')
for (const e of errors.slice(0, 6)) console.log('  ✗ ' + e.slice(0, 180))
if (failed) { console.log('WALKTHROUGH: FAIL'); process.exit(1) }
console.log('WALKTHROUGH: PASS')
