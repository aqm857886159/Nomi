// R13 真机走查：同名 modelKey 跨厂商互吞/翻家修复（2026-07-31 群反馈）。
// 场景照抄用户报障：先接「中转甲」再接「中转乙」，两家都提供 gpt-image-2。
// 修前：甲的选项被乙整条吞掉（picker 只剩乙）、锁定下拉两项撞值锁不住、vendor 同步 effect
// 把存量节点派发翻到乙。修后应看到：
//   ① 模型下拉一条「… · 2 家」（dedupe 聚合，两家都活着）
//   ② 参数面板「供应商」分段控件两项可选、能锁非默认那家
//   ③ 锁定甲后等 vendor 同步 effect 跑过，仍是甲（不被翻回乙）；project.json 落的 modelVendor=甲
// 用法：node scripts/model-vendor-dedup-walkthrough.mjs（需先 pnpm build）
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import { addCanvasNodeFromRail } from '../tests/ux/_canvasRail.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.model-dedup-walk')
fs.mkdirSync(outDir, { recursive: true })
const NOW = new Date().toISOString()

// 两个中转站，同名 gpt-image-2。数组顺序=store 顺序（乙在前 = 「最新添加的厂商」）。
function catalogFixture() {
  const model = (vendorKey) => ({
    modelKey: 'gpt-image-2', vendorKey, modelAlias: 'gpt-image-2',
    labelZh: 'GPT Image 2', kind: 'image', enabled: true,
    meta: { parameters: [{ key: 'size', label: '尺寸', type: 'select', options: [{ value: '1024x1024', label: '1024x1024' }] }] },
    onboarding: { addedVia: 'manual', trialId: '', docsUrl: '', addedAt: NOW, fields: [] },
    createdAt: NOW, updatedAt: NOW,
  })
  const vendor = (key, name, host) => ({
    key, name, enabled: true, hasApiKey: true,
    baseUrlHint: `https://${host}`, authType: 'bearer', authHeader: null, authQueryParam: null,
    providerKind: 'openai-compatible', createdAt: NOW, updatedAt: NOW,
  })
  const mapping = (vendorKey) => ({
    id: `mapping-${vendorKey}-t2i`, vendorKey, taskKind: 'text_to_image', name: '文生图', enabled: true,
    create: {
      method: 'POST', path: '/v1/images/generations',
      headers: { Authorization: 'Bearer {{user_api_key}}', 'Content-Type': 'application/json' },
      body: { model: '{{model.modelKey}}', prompt: '{{request.prompt}}', response_format: 'url' },
      response_mapping: { image_url: 'data[*].url' },
    },
    createdAt: NOW, updatedAt: NOW,
  })
  const key = (vendorKey) => ({ apiKey: 'sk-walkthrough-fake', vendorKey, enabled: true, enc: 'plain', createdAt: NOW, updatedAt: NOW })
  return {
    version: 5,
    vendors: [vendor('relay-yi', '中转乙', 'relay-yi.example.com'), vendor('relay-jia', '中转甲', 'relay-jia.example.com')],
    models: [model('relay-yi'), model('relay-jia')],
    mappings: [mapping('relay-yi'), mapping('relay-jia')],
    apiKeysByVendor: { 'relay-yi': key('relay-yi'), 'relay-jia': key('relay-jia') },
  }
}

const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-dedup-walk-settings-'))
const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-dedup-walk-projects-'))
fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify(catalogFixture(), null, 2))

const { app, win } = await launchNomiApp({
  name: 'model-vendor-dedup',
  env: { NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html') },
  settingsDir,
  projectsDir,
  settleMs: 1800,
})
const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }
const errors = []
let failed = false

try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1600, height: 1000 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2200)
  await win.keyboard.press('Escape').catch(() => {})
  await win.getByText('生成', { exact: true }).first().click()
  await win.waitForTimeout(1200)
  // 左缘点法收口在 ../tests/ux/_canvasRail.mjs：结构锚点，不认走 i18n 的 aria-label，找不到当场抛。
  await addCanvasNodeFromRail(win, 'image')
  await win.waitForTimeout(1200)
  const node = win.locator('[data-kind="image"][data-node-id]').first()
  await node.waitFor({ timeout: 8000 })
  // 底部时间轴浮把手会压住 composer 参数栏 → 先把节点往上拖开再交互。
  const box = await node.boundingBox()
  if (box) {
    await win.mouse.move(box.x + box.width / 2, box.y + 12)
    await win.mouse.down()
    await win.mouse.move(box.x + box.width / 2, Math.max(80, box.y - 240), { steps: 12 })
    await win.mouse.up()
    await win.waitForTimeout(600)
  }
  await node.click({ position: { x: 40, y: 40 } })
  await win.waitForTimeout(1500)

  // ① 模型下拉：应只有一条 gpt-image-2 且标「2 家」（两家都活着、被聚合）。
  const modelTrigger = win.locator('button[aria-label="模型"]').first()
  await modelTrigger.waitFor({ timeout: 8000 })
  await modelTrigger.click()
  await win.waitForTimeout(600)
  const optionTexts = await win.getByRole('option').allInnerTexts()
  console.log('  [①] 模型下拉选项：', JSON.stringify(optionTexts))
  const dedupRow = optionTexts.find((t) => /GPT Image 2/i.test(t))
  const okTwoProviders = Boolean(dedupRow && dedupRow.includes('2 家'))
  console.log(`  [①] 一条聚合行且标「2 家」= ${okTwoProviders}`)
  if (!okTwoProviders) failed = true
  await shot(win, '01-model-dropdown-two-providers.png')
  await win.getByRole('option', { name: /GPT Image 2/i }).first().click()
  await win.waitForTimeout(1200)

  // ② 打开参数面板 → 「供应商」分段控件两项（中转甲 / 中转乙），值互不相同（撞值就锁不住）。
  await win.locator('button[aria-label="生成参数"]').first().click()
  await win.waitForTimeout(700)
  const providerSeg = win.locator('[aria-label="供应商"]').first()
  await providerSeg.waitFor({ timeout: 6000 })
  const segText = await providerSeg.innerText()
  console.log('  [②] 供应商分段控件：', JSON.stringify(segText))
  const okBothListed = segText.includes('中转甲') && segText.includes('中转乙')
  console.log(`  [②] 两家都可选 = ${okBothListed}`)
  if (!okBothListed) failed = true
  await shot(win, '02-provider-segmented-both.png')

  // ③ 锁定「中转甲」（非默认那家）→ 等 vendor 同步 effect 跑 → 仍是甲，没被翻回乙。
  await providerSeg.getByText('中转甲', { exact: false }).first().click()
  await win.waitForTimeout(2000)
  const checkedLabel = await providerSeg.locator('input:checked ~ *, [data-active]').first().innerText().catch(() => '')
  const segTextAfter = await providerSeg.innerText()
  console.log('  [③] 锁定后分段控件文本：', JSON.stringify(segTextAfter), ' 选中：', JSON.stringify(checkedLabel))
  await shot(win, '03-locked-jia-after-sync.png')

  // 磁盘断言：autosave 后 project.json 的 modelVendor 应是 relay-jia（锁定生效且未被翻家）。
  await win.waitForTimeout(4500)
  const projFiles = fs.readdirSync(projectsDir, { recursive: true }).filter((f) => String(f).endsWith('project.json'))
  let vendorOnDisk = ''
  for (const f of projFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(projectsDir, String(f)), 'utf8'))
    const gc = data?.payload?.generationCanvas || data?.generationCanvas || {}
    const nodes = Array.isArray(gc.nodes) ? gc.nodes : []
    const imageNode = nodes.find((n) => n?.kind === 'image')
    if (imageNode) vendorOnDisk = String(imageNode?.meta?.modelVendor || imageNode?.meta?.vendor || '')
  }
  console.log(`  [③] project.json 落盘 modelVendor = 「${vendorOnDisk}」（期望 relay-jia）`)
  const okLocked = vendorOnDisk === 'relay-jia'
  if (!okLocked) failed = true

  console.log(failed ? '\n❌ 走查有断言失败' : '\n✅ 走查三关全过（截图在 .model-dedup-walk/）')
  if (errors.length) console.log('  ⚠️ 页面错误：', errors.slice(0, 5))
} catch (e) {
  failed = true
  console.error('❌ 走查异常：', e)
  try { const w = await app.firstWindow(); await shot(w, 'ERROR.png') } catch { /* noop */ }
} finally {
  await app.close()
}
process.exit(failed ? 1 : 0)
