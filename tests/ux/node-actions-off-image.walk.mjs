// R13 走查：画布节点「动作不许压在内容上」落地取证（2026-08-04）。
// 零额度——只用本地 ffmpeg 造的色块图，绝不触发任何生成。
//
// 要验的：
//   ① 成功态节点的**画面区域上不存在浮动按钮**（改前卡片右上角常驻两颗半透明的：放大 + 生成记录）
//   ② 「生成记录」没被删掉，迁进了 hover 浮条（它是 ProvenancePanel 的唯一入口）
//   ③ 放大只剩一个入口，且点得开
//   ④ 双击画面 = 放大（新增手势）
// 断言用几何/属性，不靠人眼——「按钮压在图上」这件事恰恰是几何问题。
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const outDir = path.join(repoRoot, 'docs/design/mockups/2026-08-04-node-after')
fs.mkdirSync(outDir, { recursive: true })

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-node-walk-'))
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })

const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const still = path.join(root, 'still.png')
if (spawnSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2E6E6B:s=640x360', '-frames:v', '1', still]).status !== 0) {
  throw new Error('夹具编码失败')
}

let { app, win } = await launchNomiApp({
  name: 'node-actions-off-image',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
  args: ['--no-proxy-server'],
  settleMs: 0,
})
const getWin = () => {
  const live = app.windows().filter((w) => !w.isClosed())
  win = live.find((w) => { try { return /projectId=/.test(w.url()) } catch { return false } }) || live[live.length - 1] || win
  return win
}
const resize = async () => {
  const bw = await app.browserWindow(getWin())
  await bw.evaluate((w) => { w.setBounds({ x: 0, y: 0, width: 1680, height: 1050 }); w.center() })
  await getWin().waitForTimeout(400)
}
const snap = async (name) => {
  await getWin().screenshot({ path: path.join(outDir, name) })
  console.log(`  · 截图 ${name}`)
}

const verdicts = []
const check = (name, ok, detail = '') => { verdicts.push([name, ok, detail]); console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`) }

win.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 160)}`))

try {
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(2200)
  await win.evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen')
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1800)
  await resize()
  for (let i = 0; i < 5; i++) {
    const skip = getWin().locator('button:has-text("跳过")').first()
    if (await skip.isVisible().catch(() => false)) await skip.click({ timeout: 800 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(200)
  }
  await getWin().locator('button, [role="button"]', { hasText: '新建空白项目' }).first().click({ timeout: 8000 }).catch(() => {})
  await getWin().waitForTimeout(3000)
  for (let i = 0; i < 5; i++) { await getWin().keyboard.press('Escape').catch(() => {}); await getWin().waitForTimeout(180) }
  await resize()

  await getWin().getByRole('button', { name: '生成', exact: false }).first().click({ timeout: 5000 }).catch(() => {})
  await getWin().locator('.generation-canvas-v2__stage').first().waitFor({ state: 'visible', timeout: 30000 })
  await getWin().waitForTimeout(1200)
  const b64 = fs.readFileSync(still).toString('base64')
  await getWin().evaluate(async (png) => {
    const stage = document.querySelector('.generation-canvas-v2__stage')
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], 'still.png', { type: 'image/png' }))
    const opts = { bubbles: true, cancelable: true, clientX: rect.x + 420, clientY: rect.y + 260, dataTransfer: dt }
    stage.dispatchEvent(new DragEvent('dragover', opts))
    stage.dispatchEvent(new DragEvent('drop', opts))
  }, b64)
  let nodes = 0
  for (let i = 0; i < 30; i++) {
    nodes = await getWin().evaluate(() => document.querySelectorAll('[data-node-id]').length)
    if (nodes >= 1) break
    await getWin().waitForTimeout(600)
  }
  console.log(`  · 画布节点数 ${nodes}`)
  if (nodes === 0) throw new Error('画布投放失败：0 个节点')

  // ========== ① 未选中：画面区域上不能有浮动按钮 ==========
  await getWin().waitForTimeout(1500)
  const overlayIdle = await getWin().evaluate(() => {
    const node = document.querySelector('[data-node-id]')
    if (!node) return null
    const img = node.querySelector('img')
    if (!img) return { why: 'no-img' }
    const r = img.getBoundingClientRect()
    // 画面矩形内、position 非 static 的按钮 = 压在内容上的动作
    const over = [...node.querySelectorAll('button')].filter((b) => {
      const br = b.getBoundingClientRect()
      if (br.width === 0 || br.height === 0) return false
      const inside = br.left >= r.left - 2 && br.right <= r.right + 2 && br.top >= r.top - 2 && br.bottom <= r.bottom + 2
      return inside && getComputedStyle(b).position !== 'static'
    })
    return { count: over.length, labels: over.map((b) => b.getAttribute('aria-label') || b.textContent?.trim() || '?') }
  })
  console.log('  · 画面上的浮动按钮:', JSON.stringify(overlayIdle))
  check('未选中时画面上零遮挡', overlayIdle?.count === 0, JSON.stringify(overlayIdle))
  await snap('01-node-idle.png')

  // ========== ②③ 选中：浮条上有「生成记录」，放大只一个入口 ==========
  await getWin().locator('[data-node-id]').first().click({ timeout: 5000 }).catch(() => {})
  await getWin().waitForTimeout(1200)
  const selectedState = await getWin().evaluate(() => {
    const node = document.querySelector('[data-node-id]')
    const img = node?.querySelector('img')
    const r = img?.getBoundingClientRect()
    const over = r
      ? [...(node?.querySelectorAll('button') || [])].filter((b) => {
          const br = b.getBoundingClientRect()
          if (br.width === 0 || br.height === 0) return false
          return br.left >= r.left - 2 && br.right <= r.right + 2 && br.top >= r.top - 2 && br.bottom <= r.bottom + 2 &&
            getComputedStyle(b).position !== 'static'
        }).map((b) => b.getAttribute('aria-label') || '?')
      : []
    const all = [...document.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.getAttribute('title') || '')
    return {
      overlayOnImage: over,
      provenance: all.filter((l) => /生成记录/.test(l)).length,
      enlarge: all.filter((l) => /放大|全屏查看|查看大图/.test(l)).length,
    }
  })
  console.log('  · 选中态:', JSON.stringify(selectedState))
  check('选中时画面上仍零遮挡（浮条在卡片上方）', selectedState.overlayOnImage.length === 0, JSON.stringify(selectedState.overlayOnImage))
  check('「生成记录」没丢，迁到了浮条', selectedState.provenance >= 1, `${selectedState.provenance} 个入口`)
  check('放大入口收敛到 1 个', selectedState.enlarge === 1, `${selectedState.enlarge} 个`)
  await snap('02-node-selected.png')

  // ========== ④ 双击画面 = 放大 ==========
  const img = getWin().locator('[data-node-id] img').first()
  await img.dblclick({ timeout: 5000 }).catch(() => {})
  await getWin().waitForTimeout(1000)
  const previewOpen = await getWin().evaluate(() =>
    Boolean(document.querySelector('[role="dialog"]') || document.querySelector('[class*="preview-dialog"]')) ||
    [...document.querySelectorAll('div')].some((d) => {
      const cs = getComputedStyle(d)
      return cs.position === 'absolute' && d.querySelector('img') && d.getBoundingClientRect().width > 700
    }))
  check('双击画面能放大', previewOpen, String(previewOpen))
  await snap('03-node-dblclick-preview.png')

  console.log('\n=== 判据 ===')
  const failed = verdicts.filter(([, ok]) => !ok).length
  for (const [name, ok, detail] of verdicts) console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  console.log(`\n截图目录：${outDir}`)
  process.exitCode = failed ? 1 : 0
} catch (error) {
  console.error('走查失败:', error)
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}
