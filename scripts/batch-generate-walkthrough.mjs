// R13 真机走查（批量生成现状核查·纯 UI 用户路径）：工具栏建 3 个图片节点 → 各打提示词 →
// ⌘A 全选 → 浮条「生成 3 个」→ 轻确认一次 → 真实并发生成到全部落定。
// 回答「我们现在能不能批量产出」。真花额度（3 张图，默认模型=用户同款路径）。
// 用法：pnpm build 后 node scripts/batch-generate-walkthrough.mjs
import { launchNomiApp, repoRoot } from '../tests/ux/_launchApp.mjs'
import { addCanvasNodeFromRail } from '../tests/ux/_canvasRail.mjs'
import path from 'node:path'
import { mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'

const outDir = path.join(repoRoot, '.batch-walk')
mkdirSync(outDir, { recursive: true })
const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }

// 隔离档案 + 拷 dev 目录真 catalog（小写 nomi = 本 dev electron 写的，keychain 同源能解密）
const isolatedSettings = path.join(os.tmpdir(), 'nomi-batch-walk-settings')
const isolatedProjects = path.join(os.tmpdir(), 'nomi-batch-walk-projects')
mkdirSync(isolatedSettings, { recursive: true })
mkdirSync(isolatedProjects, { recursive: true })
const devCatalog = path.join(os.homedir(), 'Library', 'Application Support', 'nomi', 'model-catalog.json')
if (!existsSync(devCatalog)) { console.log('✗ 缺 dev catalog（' + devCatalog + '）'); process.exit(1) }
const isolatedCatalog = path.join(isolatedSettings, 'model-catalog.json')
copyFileSync(devCatalog, isolatedCatalog)
// 诊断开关：NOMI_WALK_DISABLE_MODEL=<modelKey,modelKey> 在隔离 catalog 里停用指定模型
// （如上游挂掉的默认模型），让自动默认落到下一个健康模型，验证「换个模型批量是否全通」。
const disableKeys = String(process.env.NOMI_WALK_DISABLE_MODEL || '').split(',').map((s) => s.trim()).filter(Boolean)
if (disableKeys.length > 0) {
  const catalog = JSON.parse(readFileSync(isolatedCatalog, 'utf8'))
  for (const model of catalog.models || []) if (disableKeys.includes(model.modelKey)) model.enabled = false
  writeFileSync(isolatedCatalog, JSON.stringify(catalog))
  console.log('  [诊断] 已停用: ' + disableKeys.join(', '))
}

const PROMPTS = ['一只橘色小猫的特写，柔和自然光', '一杯冒热气的拿铁咖啡放在木桌上', '雨后城市街道的霓虹倒影']

const { app, win } = await launchNomiApp({
  name: 'batch-generate',
  settingsDir: isolatedSettings,
  projectsDir: isolatedProjects,
})
const errors = []
let failed = false
try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1680, height: 1020 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2500)
  await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click()
  await win.waitForTimeout(1500)

  // 工具栏建 3 个图片节点，逐个在 composer 打提示词（用户同款操作）
  for (let i = 0; i < PROMPTS.length; i += 1) {
    await addCanvasNodeFromRail(win, 'image')
    await win.waitForTimeout(1200)
    // 新建节点自动选中 → composer 浮层带唯一 contenteditable（生成区无文档编辑器）
    const editor = win.locator('div[contenteditable="true"]').last()
    await editor.click()
    await win.keyboard.type(PROMPTS[i], { delay: 10 })
    await win.waitForTimeout(400)
    await win.keyboard.press('Escape') // 收起选中态，防下一个节点的 composer 定位串台
    await win.waitForTimeout(400)
  }
  const nodeCount = await win.evaluate(() => document.querySelectorAll('[data-node-id]').length)
  console.log('  画布节点数: ' + nodeCount)
  if (nodeCount < 3) { console.log('  ✗ 节点没建齐'); failed = true }
  await shot(win, '01-three-nodes-with-prompts.png')

  // 全选 → 浮条「生成 3 个」
  await win.locator('.generation-canvas-v2, [aria-label="AI 影像创作画布"]').first().click({ position: { x: 60, y: 400 } }).catch(() => {})
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
  await win.waitForTimeout(900)
  const runAll = win.locator('[data-storyboard-run-all="true"]')
  if ((await runAll.count()) === 0) { console.log('  ✗ 多选浮条没出现'); failed = true; throw new Error('no selection toolbar') }
  await shot(win, '02-selection-toolbar.png') // 验：浮条「生成 3 个」
  await runAll.first().click()
  await win.waitForTimeout(1000)
  await shot(win, '03-spend-confirm.png') // 验：一次轻确认覆盖整批

  // 轻确认框是自绘卡片（无 role=dialog）：锚「开始生成」标题，点精确文本「生成」按钮
  await win.getByText('开始生成', { exact: true }).first().waitFor({ timeout: 8000 })
  const confirmBtn = win.locator('.fixed.inset-0').last().getByRole('button', { name: '生成', exact: true })
  if ((await confirmBtn.count()) > 0) await confirmBtn.first().click()
  else { console.log('  ✗ 轻确认框/生成按钮没找到'); failed = true; throw new Error('no confirm') }
  await win.waitForTimeout(3000)
  await shot(win, '04-batch-running.png') // 验：3 节点同时在跑（并发证据）

  // 轮询 DOM 到全部落定：节点内出结果图（img 解码成功）或错误文案
  const started = Date.now()
  let final = { done: 0, error: 0 }
  while (Date.now() - started < 300000) {
    final = await win.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-node-id]'))
      let done = 0
      let error = 0
      for (const card of cards) {
        const img = Array.from(card.querySelectorAll('img')).find((el) => el.complete && el.naturalWidth > 0)
        if (img) done += 1
        else if ((card.textContent || '').match(/失败|错误|Error/)) error += 1
      }
      return { done, error, total: cards.length }
    })
    if (final.done + final.error >= 3) break
    await win.waitForTimeout(4000)
  }
  console.log('  终态: ' + JSON.stringify(final) + '（耗时 ' + Math.round((Date.now() - started) / 1000) + 's）')
  await shot(win, '05-batch-final.png') // 验：3 张图都出来（或失败原因可见）

  // ── B1：失败汇总 toast 一键「重试失败的 N 个」（样张拍板 2026-07-29）──
  // 点击 → 只对失败节点重建波次 → 弹轻确认卡；这里点「取消」= 零调用零扣费，只验接线。
  if (final.error > 0) {
    const retryToast = win.getByText('重试失败的', { exact: false })
    if ((await retryToast.count()) === 0) {
      console.log('  ✗ [B1] 失败后没看到「重试失败的 N 个」toast')
      failed = true
    } else {
      await shot(win, '05b-retry-toast.png') // 验：失败 toast 尾部带重试动作
      await retryToast.first().click()
      await win.waitForTimeout(900)
      const retryConfirm = await win.getByText('开始生成', { exact: true }).count()
      await shot(win, '05c-retry-confirm.png') // 验：重试也走轻确认（不静默扣费）
      if (retryConfirm === 0) { console.log('  ✗ [B1] 点重试没弹出确认卡'); failed = true }
      else {
        console.log('  ✓ [B1] 失败 toast 一键重试 → 轻确认卡弹出（本走查点取消，零扣费）')
        await win.locator('.fixed.inset-0').last().getByRole('button', { name: '取消', exact: true }).first().click().catch(() => {})
      }
      await win.waitForTimeout(600)
    }
  } else {
    console.log('  ℹ [B1] 本轮批量全成功（默认模型上游已恢复），失败重试路径本轮无从验证')
  }

  // ── Phase 2：失败记忆避让闭环（2026-07-29 根治验证）──
  // 第一批若全败（默认模型上游挂）→ 健康记忆已记账 → 新建第 4 个节点的自动默认应避让坏模型，
  // 单发生成必须成功。第一批本就成功（上游恢复）→ 第 4 个照常成功。两种剧本 PASS 判据相同。
  console.log('  [Phase2] 新建第 4 个节点验证默认避让…')
  await win.keyboard.press('Escape')
  await win.waitForTimeout(400)
  await addCanvasNodeFromRail(win, 'image')
  await win.waitForTimeout(1500)
  const editor4 = win.locator('div[contenteditable="true"]').last()
  await editor4.click()
  await win.keyboard.type('一颗红苹果放在白色盘子里', { delay: 10 })
  await win.waitForTimeout(500)
  // C：×N 变体档位（样张拍板 2026-07-29）——点一次切到 ×2，一次确认连发两张堆同一节点
  const variantChip = win.locator('[aria-label="连发张数（点击在 1、2、4 之间切换）"]').last()
  if ((await variantChip.count()) === 0) { console.log('  ✗ [C] 连发档位芯片没找到'); failed = true }
  else { await variantChip.click(); await win.waitForTimeout(300); console.log('  [C] 档位切到 ×2') }
  await shot(win, '06-fourth-node-default-model.png') // 验：composer 模型位不再是坏默认 + ×2 芯片点亮
  await win.locator('[aria-label="生成素材"]').last().click()
  await win.waitForTimeout(900)
  const confirm4 = win.locator('.fixed.inset-0').last().getByRole('button', { name: '生成', exact: true })
  if ((await confirm4.count()) > 0) await confirm4.first().click()
  const started4 = Date.now()
  let fourth = { done: 0, error: 0 }
  while (Date.now() - started4 < 240000) {
    fourth = await win.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-node-id]'))
      const card = cards[cards.length - 1]
      const img = card ? Array.from(card.querySelectorAll('img')).find((el) => el.complete && el.naturalWidth > 0) : null
      const error = card ? Boolean((card.textContent || '').match(/失败|错误|Error/)) : false
      return { done: img ? 1 : 0, error: error ? 1 : 0 }
    })
    if (fourth.done + fourth.error >= 1) break
    await win.waitForTimeout(4000)
  }
  await shot(win, '07-fourth-node-final.png') // 验：第 4 节点出图（避让生效）
  if (fourth.done !== 1) { console.log('  ✗ [Phase2] 第 4 节点没出图（避让未生效或新默认也坏）'); failed = true }
  else console.log('  ✓ [Phase2] 第 4 节点出图——失败记忆避让闭环生效')

  // C 断言：×2 连发 = 第二张也落进同一节点（persist 每跑一次写盘 → 轮询项目文件看 history 堆叠）
  const newestProjectJson = () => {
    const dirs = readdirSync(isolatedProjects)
      .map((name) => path.join(isolatedProjects, name))
      .filter((p) => { try { return statSync(p).isDirectory() } catch { return false } })
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    return dirs.length ? path.join(dirs[0], '.nomi', 'project.json'): null
  }
  const startedC = Date.now()
  let stacked = -1
  while (Date.now() - startedC < 180000) {
    try {
      const pj = newestProjectJson()
      const nodes = pj ? JSON.parse(readFileSync(pj, 'utf8'))?.payload?.generationCanvas?.nodes || [] : []
      const target = nodes.find((n) => String(n.prompt || '').includes('红苹果'))
      stacked = target ? (target.result ? 1 : 0) + (Array.isArray(target.history) ? target.history.length : 0) : -1
      if (stacked >= 2) break
    } catch { /* 写盘瞬间读到半截 → 下轮再读 */ }
    await win.waitForTimeout(4000)
  }
  await shot(win, '08-variant-stacked.png')
  if (stacked >= 2) console.log(`  ✓ [C] ×2 连发落定：同节点共 ${stacked} 张（主图+历史堆叠）`)
  else { console.log(`  ✗ [C] 连发第二张没出现（累计 ${stacked} 张）`); failed = true }

  if (final.done === 3) console.log('  ✓ 批量产出 3/3 成功')
  else console.log(`  ℹ 第一批 ${final.done}/3（默认模型上游坏时的预期剧本，看 Phase2 避让）`)

  console.log('\n=== 页面错误(' + errors.length + ') ===')
  for (const e of errors.slice(0, 8)) console.log('  ✗ ' + e.slice(0, 200))
} finally {
  await app.close().catch(() => {})
}
if (failed) { console.log('WALKTHROUGH: FAIL'); process.exit(1) }
console.log('WALKTHROUGH: PASS')
