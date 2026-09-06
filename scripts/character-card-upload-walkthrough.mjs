// R13 真机走查：角色卡「+ 上传角色图」上传本地图片（2026-08-03 群2反馈「这上传不了本地图片吗」）。
// 根因（已修）：节点外壳 pointerdown 即 setPointerCapture → pointerup/click 被重定向到外壳，
// <label> 弹文件框的 click 默认行为整类死掉。修法=capture 推迟到拖拽阈值(2px)真跨过才抢。
// 双断言（「短按点、长按拖」两全，防修点击坏拖拽）：
//   ① 从 label 上长按拖动 → 节点必须真的移动，且不得弹 filechooser；
//   ② 短按 label → filechooser 必须弹 → 喂测试图 → 卡片必须出图。
// 用法：pnpm build 后 node scripts/character-card-upload-walkthrough.mjs
import { launchNomiApp, repoRoot } from '../tests/ux/_launchApp.mjs'
import { addCanvasNodeFromRail } from '../tests/ux/_canvasRail.mjs'
import path from 'node:path'
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'

const outDir = path.join(repoRoot, '.charcard-upload-walk')
mkdirSync(outDir, { recursive: true })
const shot = async (win, name) => {
  await win.screenshot({ path: path.join(outDir, name) })
  console.log('  📸 ' + name)
}

const isolatedSettings = path.join(os.tmpdir(), 'nomi-charup-walk-settings')
const isolatedProjects = path.join(os.tmpdir(), 'nomi-charup-walk-projects')
rmSync(isolatedSettings, { recursive: true, force: true })
rmSync(isolatedProjects, { recursive: true, force: true })
mkdirSync(isolatedSettings, { recursive: true })
mkdirSync(isolatedProjects, { recursive: true })

// 1x1 红色 PNG 测试图
const RED_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da62f80f0400009f01012f713ba40000000049454e44ae426082',
  'hex',
)
const testImagePath = path.join(outDir, 'test-face.png')
writeFileSync(testImagePath, RED_PNG)

const launchOptions = {
  name: 'character-card-upload',
  settingsDir: isolatedSettings,
  projectsDir: isolatedProjects,
  env: { NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html') },
}

const errors = []
let failed = false
const fail = (msg) => {
  failed = true
  console.error('  ❌ ' + msg)
}

// ── 第 1 程：UI 建项目 + 1 个图片节点，存盘 ────────────────────────────────
{
  const { app, win } = await launchNomiApp({ ...launchOptions, settleMs: 1800 })
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1600, height: 1000 })).catch(() => {})
  const skip = win.getByText('跳过', { exact: true }).first()
  if (await skip.isVisible().catch(() => false)) await skip.click()
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2200)
  await win.keyboard.press('Escape').catch(() => {})
  await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click()
  await win.waitForTimeout(1000)
  // 左缘点法收口在 ../tests/ux/_canvasRail.mjs：结构锚点，不认走 i18n 的 aria-label，找不到当场抛。
  await addCanvasNodeFromRail(win, 'image')
  await win.waitForTimeout(1500)
  await app.close()
}

// ── 改盘：把图片节点改成空角色卡 ──────────────────────────────────────────
const projectDirs = readdirSync(isolatedProjects, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => path.join(isolatedProjects, e.name))
const projectFile = projectDirs
  .flatMap((dir) => [path.join(dir, '.nomi', 'project.json'), path.join(dir, 'project.json')])
  .find((p) => existsSync(p))
if (!projectFile) {
  console.log('✗ 没找到 project.json，seed 失败；候选目录：' + projectDirs.join(', '))
  process.exit(1)
}
{
  const project = JSON.parse(readFileSync(projectFile, 'utf8'))
  const nodes = project.payload?.generationCanvas?.nodes || []
  if (nodes.length < 1) {
    console.log('✗ project.json 里没有节点，seed 失败')
    process.exit(1)
  }
  const n = nodes[0]
  n.kind = 'character'
  n.title = '主角'
  n.status = 'idle'
  delete n.result
  delete n.history
  writeFileSync(projectFile, JSON.stringify(project))
  console.log('  [seed] 已把节点 ' + n.id + ' 改成空角色卡')
}

// ── 第 2 程：点「+ 上传角色图」，验证 filechooser + 图显示 ─────────────────
{
  const { app, win } = await launchNomiApp({ ...launchOptions, settleMs: 2000 })
  try {
    const bw = await app.browserWindow(win)
    await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1600, height: 1000 })).catch(() => {})
    win.on('pageerror', (e) => errors.push(String(e)))
    win.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    const skip = win.getByText('跳过', { exact: true }).first()
    if (await skip.isVisible().catch(() => false)) await skip.click()
    const recent = win.getByText('继续创作', { exact: true }).first()
    if (await recent.isVisible().catch(() => false)) {
      await recent.click()
      await win.waitForTimeout(3000)
    }
    const canvasTab = win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true })
    if (await canvasTab.isVisible().catch(() => false)) {
      await canvasTab.click()
      await win.waitForTimeout(2000)
    }
    await shot(win, '01-empty-character-card.png')

    // filechooser 全局接管：意外弹出（拖拽时）计数，预期弹出（短按时）喂测试图。
    let expectFiles = null
    let chooserOpened = false
    let unexpectedChooser = 0
    win.on('filechooser', async (ch) => {
      if (expectFiles) {
        const files = expectFiles
        expectFiles = null
        chooserOpened = true
        await ch.setFiles(files).catch(() => {})
      } else {
        unexpectedChooser += 1
        await ch.setFiles([]).catch(() => {})
      }
    })

    const uploadCta = win.locator('label').filter({ hasText: '上传角色图' }).first()
    if (!(await uploadCta.isVisible().catch(() => false))) {
      fail('看不到「+ 上传角色图」CTA——角色卡没渲出来')
    } else {
      // ① 从 label 上长按拖动：节点必须移动，且不得弹 filechooser
      const article = win.locator('[data-kind="character"]').first()
      const boxBefore = await article.boundingBox()
      const ctaBox = await uploadCta.boundingBox()
      const startX = ctaBox.x + ctaBox.width / 2
      const startY = ctaBox.y + ctaBox.height / 2
      await win.mouse.move(startX, startY)
      await win.mouse.down()
      await win.mouse.move(startX + 90, startY + 50, { steps: 8 })
      await win.mouse.up()
      await win.waitForTimeout(600)
      const boxAfter = await article.boundingBox()
      const movedX = Math.abs(boxAfter.x - boxBefore.x)
      const movedY = Math.abs(boxAfter.y - boxBefore.y)
      if (movedX < 40 || movedY < 20) fail(`从 label 拖动节点没移动（Δx=${movedX} Δy=${movedY}）——修点击不能坏拖拽`)
      else console.log(`  ✅ 从 label 长按拖动节点正常移动（Δx=${movedX} Δy=${movedY}）`)
      if (unexpectedChooser > 0) fail('拖拽过程弹出了 filechooser——拖完误触上传')
      await shot(win, '02-after-drag.png')

      // ② 短按 → filechooser 必须弹 → 喂测试图 → 卡片出图
      expectFiles = testImagePath
      await uploadCta.click()
      const deadline = Date.now() + 4000
      while (!chooserOpened && Date.now() < deadline) await win.waitForTimeout(100)
      if (!chooserOpened) {
        fail('点了「+ 上传角色图」但 filechooser 没弹——click 被吞（复现群反馈）')
        await shot(win, '03-no-filechooser.png')
      } else {
        console.log('  ✅ filechooser 弹出')
        await win.waitForTimeout(2500)
        const img = win.locator('[data-kind="character"] img').first()
        const imgVisible = await img.isVisible().catch(() => false)
        if (!imgVisible) fail('选完图角色卡上没出现 <img>')
        else {
          const src = await img.getAttribute('src')
          console.log('  ✅ 角色卡出图 src=' + String(src).slice(0, 60))
        }
        await shot(win, '03-after-upload.png')
      }
    }
    if (errors.length) console.log('  ⚠️ console errors: ' + errors.slice(0, 5).join(' | '))
  } finally {
    await app.close().catch(() => {})
  }
}

console.log(failed ? '\n✗ 走查失败' : '\n✓ 走查通过')
process.exit(failed ? 1 : 0)
