// R13 真机走查：token 色透明度修饰符（Issue #32「部分 UI 看不清」根治验证）。
// 场景：深色分镜图滚到画布手势提示条正下 → 提示条必须有真实玻璃底（此前 bg-nomi-paper/95
// 被 Tailwind JIT 静默丢弃 = 透明裸字）。断言 computed background 非透明 + 截图人眼判定。
// 用法：node scripts/token-alpha-walkthrough.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import zlib from 'node:zlib'
const require = createRequire(import.meta.url)
// 运行时手写一张 420x280 纯深色 PNG（issue #32 场景：深色分镜图压在提示条下）
function darkPng(){const w=420,h=280;const crc=(b)=>{let c=~0;for(const x of b){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^(0xEDB88320&-(c&1))}return~c>>>0}
const chunk=(t,d)=>{const c=Buffer.concat([Buffer.from(t),d]);const len=Buffer.alloc(4);len.writeUInt32BE(d.length);const cc=Buffer.alloc(4);cc.writeUInt32BE(crc(c));return Buffer.concat([len,c,cc])}
const row=Buffer.concat([Buffer.from([0]),Buffer.alloc(w*3).fill(Buffer.from([11,11,16]))])
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2
return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(Buffer.concat(Array(h).fill(row)))),chunk('IEND',Buffer.alloc(0))])}
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const outDir = path.join(repoRoot, '.token-alpha-lab'); fs.mkdirSync(outDir, { recursive: true })
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i32-s-'))
const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i32-p-'))
const app = await electron.launch({ executablePath: require('electron'), args: ['.'], cwd: repoRoot,
  env: { ...process.env, NOMI_E2E: '1', NOMI_E2E_ALLOW_MULTI_INSTANCE: '1', NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html'), NOMI_SETTINGS_DIR: settingsDir, NOMI_PROJECTS_DIR: projectsDir } })
let failed = false
try {
  const win = await app.firstWindow()
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1600, height: 1000 })).catch(() => {})
  await win.waitForLoadState('domcontentloaded'); await win.waitForTimeout(1800)
  // 重置手势提示已读（共享 localStorage 可能已标读）
  await win.evaluate(() => localStorage.removeItem('nomi:canvas-gesture-hint:v1'))
  await win.getByText('新建空白项目', { exact: false }).first().click(); await win.waitForTimeout(2400)
  await win.keyboard.press('Escape')
  await win.getByText('生成', { exact: true }).first().click(); await win.waitForTimeout(1600)

  const hint = win.locator('aside[aria-label="画布手势提示"]')
  await hint.waitFor({ timeout: 6000 })

  // 上传深色图 → 画布节点
  await win.getByText('素材库', { exact: true }).first().click(); await win.waitForTimeout(900)
  const fileInput = win.locator('input[aria-label="素材文件选择器"]')
  const darkPath = path.join(os.tmpdir(), `i32-dark-${Date.now()}.png`); fs.writeFileSync(darkPath, darkPng())
  await fileInput.setInputFiles(darkPath); await win.waitForTimeout(2200)
  await win.keyboard.press('Escape'); await win.waitForTimeout(500)

  // 调试：画布上有哪些节点 kind
  const kinds = await win.evaluate(() => Array.from(document.querySelectorAll('[data-node-id]')).map((n) => n.getAttribute('data-kind')))
  console.log('画布节点 kinds:', JSON.stringify(kinds))
  // 用滚轮平移画布，把深色节点滚到提示条正下方（hint 固定 overlay 不随画布动）
  const anyNode = win.locator('[data-node-id]').first()
  await anyNode.waitFor({ timeout: 8000 })
  const hb = await hint.boundingBox()
  for (let i = 0; i < 30; i++) {
    const nb2 = await anyNode.boundingBox()
    if (!nb2 || !hb) break
    const dx = (nb2.x + nb2.width / 2) - (hb.x + hb.width / 2)
    const dy = (nb2.y + 40) - (hb.y + hb.height / 2)
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) break
    await win.mouse.move(hb.x + hb.width / 2, hb.y + 300)
    await win.mouse.wheel(Math.sign(dx) * Math.min(80, Math.abs(dx)), Math.sign(dy) * Math.min(80, Math.abs(dy)))
    await win.waitForTimeout(120)
  }
  await win.waitForTimeout(500)

  // 断言：提示条背景已非透明（此前 bg-nomi-paper/95 被丢弃 = rgba(0,0,0,0)）
  const bg = await hint.evaluate((el) => getComputedStyle(el).backgroundColor)
  console.log(`手势提示条 computed background: ${bg}`)
  if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') { failed = true; console.error('❌ 背景仍透明') }
  await win.screenshot({ path: path.join(outDir, 'gesture-hint-over-dark.png') })
  console.log('📸 gesture-hint-over-dark.png')
} catch (e) { failed = true; console.error('❌', e); try { const w = await app.firstWindow(); await w.screenshot({ path: path.join(outDir, 'ERROR.png') }) } catch {} }
finally { await app.close() }
console.log(failed ? '❌ 走查失败' : '✅ 走查通过')
process.exitCode = failed ? 1 : 0
