import { makeTempDir } from './_test-temp.mjs'
// R13 真机走查：模板库 + 任意格式（T 轨）。**打真 ComfyUI**（不是 mock）——
// 这条链的价值全靠"真的能读到你机器上的模板、真的能把界面格式转过来"，mock 证明不了。
// 前置：真 ComfyUI 跑在 127.0.0.1:8188（`/tmp/comfyui-venv/bin/python main.py --cpu --port 8188`）。
// 验：① 模板库列出几百个 + 分类 chip ② 点开一条 → 当场对账缺件（本机空 models 目录 → 应报缺）
//     ③ 贴一张**界面格式**工作流 → 自动转换 → 识别出绑定（此前会被拒）
// 用法：pnpm build && node scripts/comfyui-template-library-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.comfyui-template-walk')
mkdirSync(outDir, { recursive: true })
const settingsDir = makeTempDir('comfyui-template-walk-')
const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }

const BASE = 'http://127.0.0.1:8188'
// 预启用 comfyui-local，省掉走查里的启用步骤（那条路已被别的走查覆盖）。
writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: 8,
  vendors: [{ key: 'comfyui-local', name: '本地 ComfyUI', enabled: true, baseUrlHint: BASE, authType: 'none', authHeader: null, createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z' }],
  models: [], mappings: [], apiKeysByVendor: {},
}))

// 先确认真服务器在，并取一张真实的界面格式模板当"用户手上的文件"。
const idx = await (await fetch(`${BASE}/templates/index.json`)).json()
const total = idx.reduce((n, g) => n + (g.templates?.length ?? 0), 0)
console.log(`  真 ComfyUI 模板总数：${total}`)
const uiWorkflowText = await (await fetch(`${BASE}/templates/default.json`)).text()
console.log(`  取到界面格式模板 default.json（${uiWorkflowText.length} 字节，含 nodes[]）`)

const projectsDir = makeTempDir('comfyui-template-proj-')
const { app, win } = await launchNomiApp({
  name: 'comfyui-template-library',
  settingsDir,
  projectsDir,
  env: { NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html') },
  settleMs: 1800,
})
const errors = []
try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1440, height: 1040 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  // 转换窗口加载 ComfyUI 网页时可能弹原生框（beforeunload 等）；Playwright 不处理会整体卡死。
  // 生产侧已在 comfyuiGraphConvert 注入 no-op 覆盖，这里是走查侧的双保险。
  win.on('dialog', (d) => { console.log('  (自动关掉对话框: ' + d.type() + ')'); void d.dismiss().catch(() => {}) })
  app.on('window', (w) => { w.on('dialog', (d) => void d.dismiss().catch(() => {})) })
  await win.getByRole('button', { name: '接入模型', exact: false }).first().click()
  await win.waitForTimeout(1200)
  await win.getByText('本地 ComfyUI', { exact: true }).first().click()
  await win.waitForTimeout(3000) // 等模板库拉清单

  // ── ① 模板库列出来了吗 ──
  const listedText = await win.evaluate(() => document.body.innerText)
  const listed = /自带\s*\d+\s*个官方模板/.test(listedText)
  console.log('  模板库列出: ' + (listed ? '✓ ' + (listedText.match(/自带\s*\d+\s*个官方模板/) || [''])[0] : '✗'))
  await shot(win, '01-template-library-listed.png')
  if (!listed) throw new Error('模板库没列出来')

  // ── ② 点开一条 → 当场对账缺件（本机 models 是空的 → 必报缺）──
  await win.getByPlaceholder('搜模板', { exact: false }).fill('Image to Video')
  await win.waitForTimeout(700)
  const firstRow = win.locator('button[aria-expanded]').filter({ hasText: 'Image to Video' }).first()
  if (await firstRow.count()) {
    await firstRow.click()
    await win.waitForTimeout(20000) // 转换要加载 ComfyUI 前端（首次几秒~十几秒）+ 对账
    await shot(win, '02-template-detail-missing.png')
    const detailText = await win.evaluate(() => document.body.innerText)
    // 2026-08-11：缺件不再是死门，所以判据是「对账结果说清楚了」而不是「按钮被锁了」。
    const reconciled = detailText.includes('缺文件只提示') || detailText.includes('这条在你机器上能跑') || detailText.includes('缺节点')
    console.log('  点开当场对账（缺件提示/就绪）: ' + (reconciled ? '✓' : '✗'))
    // 非阻断实证：缺件时按钮必须是可点的「仍要启用」，不是置灰。
    const anyway = win.getByRole('button', { name: '仍要启用', exact: true }).first()
    if (await anyway.count()) {
      if (await anyway.isDisabled()) throw new Error('缺件时模板库按钮仍被置灰——非阻断口径没生效')
      await anyway.click()
      await win.waitForTimeout(400)
      await shot(win, '02b-template-armed-risk.png') // 验：风险话术 + 按钮变「确认启用」
      console.log('  缺件时按钮可点（仍要启用 → 确认启用）: ✓')
    }
  } else {
    console.log('  ⚠️ 没找到 Image to Video 模板行')
  }

  // ── ③ 贴界面格式 → 自动转换（此前会被直接拒）──
  await win.getByRole('button', { name: '导入自定义工作流', exact: false }).first().click()
  await win.waitForTimeout(400)
  await win.getByRole('textbox', { name: 'ComfyUI 工作流 JSON' }).fill(uiWorkflowText)
  await win.getByRole('button', { name: '分析工作流', exact: true }).click()
  await win.waitForTimeout(25000) // 借前端转换
  await shot(win, '03-ui-format-auto-converted.png')
  const afterText = await win.evaluate(() => document.body.innerText)
  // ⚠️ 别拿 'Export (API)' 判被拒——那是面板上**常驻的引导文案**（"在 ComfyUI 里 Workflow → Export (API)"），
  // 必然误报。真正的"被拒"是那句红色错误：「这是 ComfyUI 的「界面保存」格式」。
  const stillRejected = afterText.includes('「界面保存」格式')
  // 转换成功的硬证据：编辑框里的文本已被换成 API 格式（含 class_type），且绑定区出现了。
  const boxIsApi = await win.evaluate(() => {
    const el = document.querySelector('textarea[aria-label*="workflow_api"]')
    return Boolean(el && el.value.includes('class_type'))
  })
  const hasBinding = afterText.includes('已识') || afterText.includes('成品输出') || afterText.includes('提示词接')
  const ok = boxIsApi && hasBinding && !stillRejected
  console.log(`  界面格式自动转换: ${ok ? '✓ 已转成 API 并识别出绑定' : '✗'}` +
    `（编辑框已是API=${boxIsApi} 绑定区=${hasBinding} 仍被拒=${stillRejected}）`)
  if (!ok) throw new Error('界面格式没能自动转换')

  console.log(errors.length ? ('  ⚠️ console/page errors:\n' + errors.slice(0, 6).join('\n')) : '  ✅ 无 console/page error')
} catch (e) {
  console.error('  ❌ 走查失败：', e)
  try { const w = await app.firstWindow(); await shot(w, 'ERROR.png') } catch { /* noop */ }
  process.exitCode = 1
} finally {
  await app.close()
}
