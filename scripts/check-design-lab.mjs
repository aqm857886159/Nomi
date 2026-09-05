#!/usr/bin/env node
// 设计实验室门岗（2026-09-06）。
//
// 背景：用户当天拍板——**以后 UI 交付的定义 = 「实验室截图拍板 + 视觉基线绿」**，
// 不再靠手写 HTML 样张 + 人眼对比。样张与实现是两套代码描述同一个东西，中间靠人脑翻译，
// 漂移是结构性的。实验室把翻译层删掉了；本门岗守住实验室自己不腐坏。
//
// 它查四件事：
//   1. **注册表可解析、id 唯一**——`labStates.mjs` 那把源码正则一旦解析不出东西就当场红，
//      而不是静默地少截一张图（漏项在 CI 输出里和「本来就没有这个状态」长得一模一样）。
//   2. **设计文档的形态覆盖**——21 形态 + P0 17 件索引里的每一件，注册表里必须有对应状态。
//      设计文档新加一个形态而实验室没跟上 = 红。
//   3. **基线 ↔ 注册表一一对应**——多一张孤儿 PNG（状态删了图没删）或少一张（状态加了没录基线）都红。
//   4. **视觉基线本身**——在已校准平台上真跑 Playwright `toHaveScreenshot`。
//
// 关于第 4 条为什么要按平台开关（这不是逃生口，是诚实）：
//   基线 PNG 是在 macOS 上渲染、由用户在 macOS 上拍板的。字体栅格化在 macOS 与
//   ubuntu runner（xvfb 软渲染）上本来就不一样，把 darwin 的 PNG 拿去 linux 上逐像素比 = 必红，
//   而且红的是**平台**不是设计。仓库刚在画布性能预算上栽过同一个坑
//   （docs/lessons：canvas-perf-budget-calibrated-on-macos-fails-on-linux）。
//   所以：已校准平台上**硬跑**；未校准平台上**明说没跑**，既不假装绿也不制造假红。
//   想让 CI 也拦住视觉回归，正解是在那个平台上录一套基线并加进 calibration.json，
//   不是放宽容差（放宽容差 = 把门岗关掉还留个门框）。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { readLabStates, readCalibration, BASELINE_DIR, CALIBRATION_FILE } = await import(
  path.join(repoRoot, 'tests/ux/design-lab/labStates.mjs')
)

const UPDATE = process.argv.includes('--update')
const SKIP_VISUAL = process.argv.includes('--structure-only')

const errors = []
const fail = (message) => errors.push(message)

// ── 1. 注册表 ────────────────────────────────────────────────────────────────

const states = readLabStates()
const ids = new Set(states.map((state) => state.id))

// ── 2. 设计文档覆盖 ──────────────────────────────────────────────────────────
//
// 真相源是两份拍板文档的编号，不是这份脚本里的一句 magic number：
// 形态 1–21 出自 2026-09-01 定稿 §4；P0 件 1–16 出自 2026-09-03 走读附录索引
// （件 17 = 形态 18 与件 5 共用一张，文档明写「不独立画」，故这里是 16 不是 17）。
const FORM_COUNT = 21
const P0_PIECE_COUNT = 16

for (let form = 1; form <= FORM_COUNT; form += 1) {
  const prefix = `form-${String(form).padStart(2, '0')}`
  if (![...ids].some((id) => id.startsWith(prefix))) {
    fail(`设计定稿 §4 形态 ${form} 在实验室里没有对应状态（期待 id 以 ${prefix} 开头）`)
  }
}
for (let piece = 1; piece <= P0_PIECE_COUNT; piece += 1) {
  const prefix = `p0-${String(piece).padStart(2, '0')}`
  if (![...ids].some((id) => id.startsWith(prefix))) {
    fail(`P0 异常态件 ${piece} 在实验室里没有对应状态（期待 id 以 ${prefix} 开头）`)
  }
}

// ── 3. 生产不可达 ────────────────────────────────────────────────────────────
//
// 实验室进不了生产包，靠的是「它是另一个根 HTML 入口，而 vite build 只吃 index.html」。
// 这条只要被人不小心破坏（把 lab 接进 index.html 的模块图、或给 rollup 加 input），
// 实验室代码就会被打进安装包。三道静态断言把这三种破法都钉住。
const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8')
if (/design-lab/.test(indexHtml)) {
  fail('index.html 引到了 design-lab —— 实验室会被打进生产包')
}
const viteConfig = fs.readFileSync(path.join(repoRoot, 'vite.config.ts'), 'utf8')
if (/rollupOptions[\s\S]{0,400}?\binput\b/.test(viteConfig)) {
  fail('vite.config.ts 给 rollupOptions 加了 input —— 多入口一旦开启，design-lab.html 可能被打进生产包；改了这里就得同步改本门岗')
}
const productionImports = []
const walkSrc = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { walkSrc(full); continue }
    if (!/\.tsx?$/.test(entry.name)) continue
    if (full.includes(`${path.sep}devlab${path.sep}`)) continue
    const code = fs.readFileSync(full, 'utf8')
    if (/from\s+['"][^'"]*devlab\//.test(code)) productionImports.push(path.relative(repoRoot, full))
  }
}
walkSrc(path.join(repoRoot, 'src'))
if (productionImports.length) {
  fail(`生产代码 import 了 devlab：${productionImports.join(', ')} —— 实验室会被打进生产包`)
}

// ── 4. 基线 ↔ 注册表 ─────────────────────────────────────────────────────────

const calibration = readCalibration()
const baselineFiles = fs.existsSync(BASELINE_DIR)
  ? fs.readdirSync(BASELINE_DIR).filter((name) => name.endsWith('.png'))
  : []
const baselineIds = new Set(baselineFiles.map((name) => name.replace(/\.png$/, '')))
// `--update` 就是来补基线的，这时候「缺基线」是它的输入而不是错误（否则新状态永远补不上）。
// 孤儿基线仍然照查：update 从来不删图，删状态没删图的欠账必须在这一次就暴露。
if (!UPDATE) {
  for (const id of ids) {
    if (!baselineIds.has(id)) fail(`状态 ${id} 没有视觉基线；拍板后跑 pnpm run design-lab:update`)
  }
}
for (const id of baselineIds) {
  if (!ids.has(id)) fail(`孤儿基线 ${id}.png：注册表里已经没有这个状态了，删掉它`)
}

if (errors.length) {
  console.error('❌ 设计实验室门岗：')
  for (const message of errors) console.error(`   · ${message}`)
  process.exit(1)
}

console.log(`✅ 设计实验室结构检查：${states.length} 个状态、${baselineFiles.length} 张基线，一一对应`)

// ── 5. 视觉基线 ──────────────────────────────────────────────────────────────

if (SKIP_VISUAL) {
  console.log('↷ --structure-only：跳过视觉比对')
  process.exit(0)
}
if (!UPDATE && process.platform !== calibration.calibratedPlatform) {
  console.log(
    `↷ 视觉基线道在本平台（${process.platform}）**未校准**，本次没有比对像素。\n` +
    `   基线是 ${calibration.calibratedPlatform} 上渲染并拍板的；跨平台字体栅格化不同，逐像素比会红在平台上不是设计上。\n` +
    `   要让本平台也拦视觉回归：在本平台重录一套基线并写进 ${path.relative(repoRoot, CALIBRATION_FILE)}。`,
  )
  process.exit(0)
}

const args = ['playwright', 'test', '-c', 'tests/ux/design-lab/playwright.config.mjs']
const result = spawnSync('npx', args, {
  cwd: repoRoot,
  stdio: 'inherit',
  env: { ...process.env, ...(UPDATE ? { NOMI_DESIGN_LAB_UPDATE: '1' } : {}) },
})
if (result.status !== 0) {
  console.error(
    UPDATE
      ? '\n❌ 基线更新失败'
      : '\n❌ 视觉基线不符。差异图在 test-results/ 下（-expected/-actual/-diff 三张）。\n' +
        '   这是设计改动被拦住了，不是工具坏了：先看差异图确认改动是不是你要的，\n' +
        '   要的话先给用户看接触表拍板，再跑 pnpm run design-lab:update 更新基线并在 PR 里附前后对比。',
  )
  process.exit(1)
}
console.log(UPDATE ? '\n✅ 基线已更新——记得在 PR 里附前后对比' : '\n✅ 视觉基线全绿')
