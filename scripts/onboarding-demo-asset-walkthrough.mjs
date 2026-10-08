import { makeTempDir } from './_test-temp.mjs'
// R13 真机走查：引导示例项目的预置成图（2026-07-30 根因修复验证）。
// 场景：**用 dist 产物**起 Electron（打包版走的就是这条 file:// 路径）→ 项目库点「看 Nomi 怎么出片」
// → 引导落画布并注入 10 张成图。此前注入的是构建产物 URL（dev server 地址落进了 project.json），
// 打包版打开即 CSP 拒载 + 裂图。断言：console 无 CSP 报错、图 URL 全是 nomi-local、图真解码出来了、
// 落盘的 project.json 里没有构建产物地址。截图人眼判定。
// 用法：node scripts/onboarding-demo-asset-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

import { fileURLToPath } from 'node:url'
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.onboarding-demo-lab')
fs.mkdirSync(outDir, { recursive: true })
const settingsDir = makeTempDir('demo-s-')
const projectsDir = makeTempDir('demo-p-')

const { app, win } = await launchNomiApp({
  name: 'onboarding-demo-asset',
  env: {
    // 关键：走 dist 产物，不是 dev server——本次事故只在这条路径上暴露。
    NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html'),
  },
  settingsDir,
  projectsDir,
  settleMs: 2000,
})

let failed = false
const fail = (msg) => {
  failed = true
  console.error('❌ ' + msg)
}

try {
  const consoleLines = []
  win.on('console', (msg) => consoleLines.push(msg.text()))
  win.on('pageerror', (err) => consoleLines.push('pageerror: ' + err.message))

  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1600, height: 1000 })).catch(() => {})

  await win.getByText('看 Nomi 怎么出片', { exact: false }).first().click()

  // 打字回放 + 拆分镜 + 落画布要几十秒；等到画布节点真的带上图为止。
  let imgs = []
  for (let i = 0; i < 120; i += 1) {
    await win.waitForTimeout(1000)
    imgs = await win.evaluate(() =>
      Array.from(document.querySelectorAll('[data-node-id] img')).map((el) => ({
        src: el.currentSrc || el.src,
        w: el.naturalWidth,
        h: el.naturalHeight,
      })),
    )
    if (imgs.length >= 10 && imgs.every((img) => img.w > 0)) break
  }

  console.log(`画布上的成图：${imgs.length} 张`)
  for (const img of imgs.slice(0, 3)) console.log(`  ${img.w}x${img.h}  ${img.src.slice(0, 90)}`)

  if (imgs.length < 10) fail(`画布成图只有 ${imgs.length} 张，预期 10 张`)
  const badScheme = imgs.filter((img) => !img.src.startsWith('nomi-local://'))
  if (badScheme.length) fail(`有 ${badScheme.length} 张不是 nomi-local：${badScheme[0]?.src}`)
  const undecoded = imgs.filter((img) => !(img.w > 0 && img.h > 0))
  if (undecoded.length) fail(`有 ${undecoded.length} 张没解码出来（裂图）：${undecoded[0]?.src}`)

  const cspLines = consoleLines.filter((line) => /Content Security Policy|127\.0\.0\.1:5273/.test(line))
  if (cspLines.length) fail(`console 仍有 CSP / dev-server 报错：\n    ${cspLines.slice(0, 3).join('\n    ')}`)

  // 落盘对账：项目文件里不许再有构建产物地址。
  const projectFile = fs
    .readdirSync(projectsDir)
    .map((name) => path.join(projectsDir, name, '.nomi', 'project.json'))
    .find((file) => fs.existsSync(file))
  if (!projectFile) {
    fail('没找到落盘的 project.json')
  } else {
    // 落盘是防抖的，节点结果不会立刻出现在文件里——轮询等它刷下去再对账。
    let raw = ''
    for (let i = 0; i < 30; i += 1) {
      raw = fs.readFileSync(projectFile, 'utf8')
      if (raw.includes('nomi-local://asset/')) break
      await win.waitForTimeout(1000)
    }
    if (/127\.0\.0\.1:5273|dist\/assets\//.test(raw)) fail('project.json 里仍写着构建产物 URL')
    if (!raw.includes('nomi-local://asset/')) fail('project.json 里没有 nomi-local 资产 URL')
    else console.log('project.json 对账通过：只含 nomi-local 资产 URL')
  }

  // 幂等对账：重看引导会再 seed 一次——必须复用已落盘那份，不能每看一次就多存 10 张。
  const projectId = imgs[0] ? decodeURIComponent(new URL(imgs[0].src).pathname.split('/').filter(Boolean)[0]) : ''
  const countFiles = (dir) =>
    fs.existsSync(dir)
      ? fs.readdirSync(dir, { withFileTypes: true }).reduce(
          (sum, entry) => sum + (entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1),
          0,
        )
      : 0
  const assetsDir = path.join(path.dirname(projectFile ?? ''), '..', 'assets')
  const seedAgain = () =>
    win.evaluate((id) => window.nomiDesktop?.assets?.seedOnboardingDemo?.({ projectId: id }), projectId)
  const before = countFiles(assetsDir)
  const first = await seedAgain()
  const second = await seedAgain()
  const after = countFiles(assetsDir)
  let idempotent = true
  if (after !== before) {
    fail(`重复 seed 多写了文件：${before} → ${after}（应幂等）`)
    idempotent = false
  }
  if (JSON.stringify(first) !== JSON.stringify(second) || !Object.keys(first || {}).length) {
    fail('重复 seed 返回了不同的 URL（应复用已落盘那份）')
    idempotent = false
  }
  if (idempotent) console.log(`幂等对账通过：资产文件数 ${before} 不变，${Object.keys(first).length} 个 clientId 的 URL 全复用`)

  const shot = path.join(outDir, 'canvas.png')
  await win.screenshot({ path: shot })
  console.log('截图：' + shot)
} catch (error) {
  fail(String(error))
} finally {
  await app.close().catch(() => {})
}

console.log(failed ? '\n走查未通过' : '\n✅ 走查通过')
process.exit(failed ? 1 : 0)
