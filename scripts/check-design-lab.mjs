#!/usr/bin/env node
// 设计实验室门岗（2026-09-06）。
//
// 背景：用户当天拍板——**以后 UI 交付的定义 = 「实验室截图拍板 + 视觉基线绿」**，
// 不再靠手写 HTML 样张 + 人眼对比。样张与实现是两套代码描述同一个东西，中间靠人脑翻译，
// 漂移是结构性的。实验室把翻译层删掉了；本门岗守住实验室自己不腐坏。
//
// 它查五件事（逐屏，屏的登记在 tests/ux/design-lab/labStates.mjs 的 LAB_SCREENS）：
//   1. **注册表可解析、id 唯一**——`labStates.mjs` 那把源码正则一旦解析不出东西就当场红，
//      而不是静默地少截一张图（漏项在 CI 输出里和「本来就没有这个状态」长得一模一样）。
//   2. **设计文档的形态覆盖**——agent-panel 屏：21 形态 + P0 16 件索引里的每一件，
//      注册表里必须有对应状态。设计文档新加一个形态而实验室没跟上 = 红。
//   3. **两份屏登记一致**——页面侧（src/devlab/designLab/labScreens.ts）与测试侧（labStates.mjs）
//      必须列同一批屏、同一个 pendingApproval。只改一处 = 那屏截不出图或留下孤儿基线。
//   4. **基线 ↔ 注册表一一对应**——多一张孤儿 PNG（状态删了图没删）或少一张（状态加了没录基线）都红。
//      待拍板的屏反过来查：它**必须一张基线都没有**——录一张没人认可过的图钉住，
//      等于把「待定」伪装成「已定」，以后谁改它都会被一张从没被拍板过的图拦住。
//   5. **视觉基线本身**——在已校准平台上真跑 Playwright `toHaveScreenshot`（待拍板的屏由 spec 跳过）。
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
const { readLabStates, readCalibration, baselineDirFor, screenIsPendingApproval, LAB_SCREEN_IDS, CALIBRATION_FILE } = await import(
  path.join(repoRoot, 'tests/ux/design-lab/labStates.mjs')
)

const UPDATE = process.argv.includes('--update')
const SKIP_VISUAL = process.argv.includes('--structure-only')

const errors = []
const fail = (message) => errors.push(message)

// ── 1. 注册表 ────────────────────────────────────────────────────────────────

const statesByScreen = new Map(LAB_SCREEN_IDS.map((screen) => [screen, readLabStates(screen)]))

// ── 2. 设计文档覆盖（agent-panel 屏） ─────────────────────────────────────────
//
// 真相源是两份拍板文档的编号，不是这份脚本里的一句 magic number：
// 形态 1–21 出自 2026-09-01 定稿 §4；P0 件 1–16 出自 2026-09-03 走读附录索引
// （件 17 = 形态 18 与件 5 共用一张，文档明写「不独立画」，故这里是 16 不是 17）。
const FORM_COUNT = 21
const P0_PIECE_COUNT = 16

const agentPanelIds = new Set((statesByScreen.get('agent-panel') ?? []).map((state) => state.id))
for (let form = 1; form <= FORM_COUNT; form += 1) {
  const prefix = `form-${String(form).padStart(2, '0')}`
  if (![...agentPanelIds].some((id) => id.startsWith(prefix))) {
    fail(`设计定稿 §4 形态 ${form} 在实验室里没有对应状态（期待 id 以 ${prefix} 开头）`)
  }
}
for (let piece = 1; piece <= P0_PIECE_COUNT; piece += 1) {
  const prefix = `p0-${String(piece).padStart(2, '0')}`
  if (![...agentPanelIds].some((id) => id.startsWith(prefix))) {
    fail(`P0 异常态件 ${piece} 在实验室里没有对应状态（期待 id 以 ${prefix} 开头）`)
  }
}

// ── 3. 两份屏登记一致 ────────────────────────────────────────────────────────
//
// 页面侧那份是 .ts（带类型，node 直接 import 不了），所以照 labStates.mjs 的既有做法用源码正则读。
// 只对「有哪几屏」「哪几屏待拍板」两件事——它们正是漏改一处会静默出错的两件事。
const SCREEN_ENTRY_RE = /\bid:\s*'([a-z0-9-]+)',\s*\n\s*label:/g
const screensSource = fs.readFileSync(path.join(repoRoot, 'src/devlab/designLab/labScreens.ts'), 'utf8')
const screenEntries = [...screensSource.matchAll(SCREEN_ENTRY_RE)]
const pageScreens = screenEntries.map((match) => match[1])
if (pageScreens.join(',') !== LAB_SCREEN_IDS.join(',')) {
  fail(`屏登记对不上：页面侧 [${pageScreens.join(', ')}] / 测试侧 [${LAB_SCREEN_IDS.join(', ')}]`)
}
screenEntries.forEach((match, index) => {
  // 从这一屏的注册项起，到下一屏为止——跨条找会把别人的 pendingApproval 记到自己头上。
  // 先剥掉行注释再匹配：注释掉的 `// pendingApproval: true` 长得和生效的一模一样，
  // 不剥的话「注释掉它」这种改法这道门岗看不见（实测过，确实漏）。
  const segment = screensSource
    .slice(match.index, screenEntries[index + 1]?.index ?? screensSource.length)
    .replace(/^\s*\/\/.*$/gm, '')
  const pageSaysPending = /\bpendingApproval:\s*true/.test(segment)
  const screen = match[1]
  if (LAB_SCREEN_IDS.includes(screen) && pageSaysPending !== screenIsPendingApproval(screen)) {
    fail(`屏 ${screen} 的 pendingApproval 两处不一致：页面侧 ${pageSaysPending} / 测试侧 ${screenIsPendingApproval(screen)}`)
  }
})

// ── 4. 生产不可达 ────────────────────────────────────────────────────────────
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
    if (/from\s+['"][^'"]*devlab\//.test(code)) productionImports[productionImports.length] = path.relative(repoRoot, full)
  }
}
walkSrc(path.join(repoRoot, 'src'))
if (productionImports.length) {
  fail(`生产代码 import 了 devlab：${productionImports.join(', ')} —— 实验室会被打进生产包`)
}

// ── 5. 基线 ↔ 注册表 ─────────────────────────────────────────────────────────

const calibration = readCalibration()
let baselineTotal = 0
let stateTotal = 0
for (const [screen, states] of statesByScreen) {
  stateTotal += states.length
  const baselineDir = baselineDirFor(screen)
  const ids = new Set(states.map((state) => state.id))
  const baselineFiles = fs.existsSync(baselineDir)
    ? fs.readdirSync(baselineDir).filter((name) => name.endsWith('.png'))
    : []
  baselineTotal += baselineFiles.length
  const baselineIds = new Set(baselineFiles.map((name) => name.replace(/\.png$/, '')))
  if (screenIsPendingApproval(screen)) {
    // 待拍板：一张都不该有。有了 = 要么该把 pendingApproval 摘掉，要么这张图不该录。
    for (const id of baselineIds) {
      fail(`屏 ${screen} 还标着待拍板，却已经有基线 ${id}.png —— 拍板了就把 pendingApproval 摘掉，没拍板就别录`)
    }
    continue
  }
  // `--update` 就是来补基线的，这时候「缺基线」是它的输入而不是错误（否则新状态永远补不上）。
  // 孤儿基线仍然照查：update 从来不删图，删状态没删图的欠账必须在这一次就暴露。
  if (!UPDATE) {
    for (const id of ids) {
      if (!baselineIds.has(id)) fail(`屏 ${screen} 的状态 ${id} 没有视觉基线；拍板后跑 pnpm run design-lab:update`)
    }
  }
  for (const id of baselineIds) {
    if (!ids.has(id)) fail(`孤儿基线 ${screen}/${id}.png：注册表里已经没有这个状态了，删掉它`)
  }
}

if (errors.length) {
  console.error('❌ 设计实验室门岗：')
  for (const message of errors) console.error(`   · ${message}`)
  process.exit(1)
}

console.log(
  `✅ 设计实验室结构检查：${LAB_SCREEN_IDS.length} 屏、${stateTotal} 个状态、${baselineTotal} 张基线，一一对应`
  + (LAB_SCREEN_IDS.some(screenIsPendingApproval)
    ? `（待拍板、暂不录基线的屏：${LAB_SCREEN_IDS.filter(screenIsPendingApproval).join(', ')}）`
    : ''),
)

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
