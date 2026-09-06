// R13 真机走查（终态失败原因是否说人话）：只留 apimart Imagen 4 一个图片模型（其上游 Google
// 确定性 404，见 2026-07-30 直连探针）→ 建图片节点 → 打提示词 → 生成 → 等失败 →
// 截图 + 打印错误卡的**真实 DOM 文案**，核对用户看到的是上游原话而不是「模型任务执行失败 (taskId=…)」。
// 失败不计费（apimart credits_cost: 0）。用法：pnpm build 后 node scripts/failure-message-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import { addCanvasNodeFromRail } from '../tests/ux/_canvasRail.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.failure-walk')
mkdirSync(outDir, { recursive: true })
const shot = async (win, name) => {
  await win.screenshot({ path: path.join(outDir, name) })
  console.log('  📸 ' + name)
}

// Imagen 4 已退役（不在目录里了），改用同家另一个上游确定性 404 的模型来验「上游取不到」这一类
// ——判据在错误类型，不在具体哪个模型。NOMI_WALK_DEAD_MODEL 可覆盖（换别的必死模型复验）。
const DEAD_MODEL = process.env.NOMI_WALK_DEAD_MODEL || 'imagen-4.0-apimart'
const isolatedSettings = path.join(os.tmpdir(), 'nomi-failure-walk-settings')
const isolatedProjects = path.join(os.tmpdir(), 'nomi-failure-walk-projects')
mkdirSync(isolatedSettings, { recursive: true })
mkdirSync(isolatedProjects, { recursive: true })
const devCatalog = path.join(os.homedir(), 'Library', 'Application Support', 'nomi', 'model-catalog.json')
if (!existsSync(devCatalog)) {
  console.log('✗ 缺 dev catalog（' + devCatalog + '）')
  process.exit(1)
}
const isolatedCatalog = path.join(isolatedSettings, 'model-catalog.json')
copyFileSync(devCatalog, isolatedCatalog)
// 只留那个确定性失败的图片模型 → 自动默认必然落它，不用去跟模型下拉 UI 搏斗。
{
  const catalog = JSON.parse(readFileSync(isolatedCatalog, 'utf8'))
  let kept = 0
  for (const model of catalog.models || []) {
    if (model.kind !== 'image') continue
    model.enabled = model.modelKey === DEAD_MODEL
    if (model.enabled) kept += 1
  }
  writeFileSync(isolatedCatalog, JSON.stringify(catalog))
  console.log('  [准备] 图片模型只留 ' + DEAD_MODEL + '（命中 ' + kept + ' 条）')
}

const { app, win } = await launchNomiApp({
  name: 'failure-message',
  settingsDir: isolatedSettings,
  projectsDir: isolatedProjects,
})
let failed = false
try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1680, height: 1020 })).catch(() => {})

  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2500)
  await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click()
  await win.waitForTimeout(1500)

  await addCanvasNodeFromRail(win, 'image')
  await win.waitForTimeout(1200)
  const editor = win.locator('div[contenteditable="true"]').last()
  await editor.click()
  await win.keyboard.type('一只棕灰色短毛猫侧身蜷卧在浅灰色平面上，柔和均匀光线', { delay: 8 })
  await win.waitForTimeout(500)
  await shot(win, '01-node-ready.png')

  // 提交（composer 的发送键）→ 轻确认卡「生成」
  await win.locator('[aria-label="生成素材"]').first().click()
  await win.waitForTimeout(1200)
  await win.getByText('开始生成', { exact: true }).first().waitFor({ timeout: 8000 })
  await win.locator('.fixed.inset-0').last().getByRole('button', { name: '生成', exact: true }).first().click()
  console.log('  已提交，等终态失败…')

  const started = Date.now()
  let card = null
  while (Date.now() - started < 180000) {
    card = await win.evaluate(() => {
      const el = document.querySelector('[role="alert"][aria-label*="生成失败"]')
      if (!el) return null
      return { aria: el.getAttribute('aria-label') || '', text: (el.textContent || '').trim() }
    })
    if (card) break
    await win.waitForTimeout(3000)
  }
  await shot(win, '02-failure-card.png')

  if (!card) {
    console.log('  ✗ 等了 ' + Math.round((Date.now() - started) / 1000) + 's 没等到失败卡')
    failed = true
  } else {
    console.log('\n  ── 用户实际看到的错误卡文案 ──')
    console.log('  aria: ' + card.aria)
    console.log('  text: ' + card.text)
    console.log('  ──────────────────────────────\n')
    // 判据：不再是「模型任务执行失败 (taskId=…)」那句空话；而是上游原话 + 换模型的行动建议。
    if (/模型任务执行失败/.test(card.text)) {
      console.log('  ✗ 还是那句兜底空话 —— 上游原因仍被吞')
      failed = true
    }
    if (!/取不到|not found|Requested entity/i.test(card.text)) {
      console.log('  ✗ 没看到上游真实原因')
      failed = true
    }
    if (!/换一个模型/.test(card.text)) {
      console.log('  ✗ 没给「换一个模型」这个能行动的建议')
      failed = true
    }
    if (/稍等重试|稍后再试/.test(card.text)) {
      console.log('  ✗ 仍在建议「稍等重试」—— 确定性失败重试必再撞，是误导')
      failed = true
    }
  }
} catch (error) {
  console.log('  ✗ 走查抛错: ' + String(error).slice(0, 400))
  failed = true
} finally {
  await app.close().catch(() => {})
}
console.log(failed ? '\n✗ 走查未通过' : '\n✓ 走查通过：失败原因说人话、给得出下一步动作')
process.exit(failed ? 1 : 0)
