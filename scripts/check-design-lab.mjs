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
//
// 关于第 4 条**失败了怎么说**（2026-09-06 重修）：
//   在此之前，Playwright 只要非零退出，这里就一律说「视觉基线不符，差异图在 test-results/ 下」。
//   那句话有两个没被验证过的断言。实测反例：46 条用例全体 ERR_CONNECTION_REFUSED、
//   一张 -diff.png 都没有，门岗照旧那么说，于是人被指去找一批不存在的图。
//   现在结论由证据定（tests/ux/design-lab/failureTriage.mjs）：
//   有 -diff.png 才说像素不符；连接类错误单独、大声地报成基础设施失败。
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { readLabStates, readCalibration, baselineDirFor, pendingApprovalScreens, LAB_SCREEN_IDS, CALIBRATION_FILE } = await import(
  path.join(repoRoot, 'tests/ux/design-lab/labStates.mjs')
)

const { triageLabRun, collectDiffImages, formatLabFailure } = await import(
  path.join(repoRoot, 'tests/ux/design-lab/failureTriage.mjs')
)
const { inspectLabPort, formatForeignHolder } = await import(path.join(repoRoot, 'tests/ux/design-lab/labServer.mjs'))
const { LAB_ORIGIN, LAB_RESULTS_DIR } = await import(path.join(repoRoot, 'tests/ux/design-lab/playwright.config.mjs'))

const UPDATE = process.argv.includes('--update')
const SKIP_VISUAL = process.argv.includes('--structure-only')

const errors = []
const fail = (message) => errors.push(message)

// ── 0. 实验室代码本身的类型检查 ───────────────────────────────────────────────
//
// `tsconfig.json` 只 include `src/main.tsx` 并顺着 import 图走，而实验室**刻意**不在那张图里
// （那正是它进不了安装包的原因）。副作用是：实验室代码此前一行都没被类型检查覆盖——
// 一处少了一层 `../` 的相对路径能一路静默到 Playwright 跑十几分钟后整屏白屏。
// 防线建在最早能拦住的那层（R28）：先跑一遍 tsconfig.devlab.json，再谈截图。
{
  const typecheck = spawnSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.devlab.json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (typecheck.status !== 0) {
    fail(`实验室代码类型检查未通过（tsconfig.devlab.json）：\n${(typecheck.stdout || typecheck.stderr || '').trim()}`)
  }
}

// ── 1. 注册表 + 2. 设计文档覆盖 ────────────────────────────────────────────────
//
// 覆盖的真相源是**拍板文档的编号**，不是这份脚本里的一句 magic number：
// - agent-panel：形态 1–21 出自 2026-09-01 定稿 §4；P0 件 1–16 出自 2026-09-03 走读附录索引
//   （件 17 = 形态 18 与件 5 共用一张，文档明写「不独立画」，故是 16 不是 17）。
// - editing：剪辑面这一族形态出自「关闭剪辑面浮层被祖先 overflow 裁掉」那次根因修复
//   （docs/lessons/overlay-clipped-by-ancestor-overflow.md）。它还没有编号化的覆盖真相源，
//   所以这里只查注册表可解析 + 基线一一对应；等设计合同落定再补编号覆盖。
// - storyboard：分镜表 v6 设计合同的章节号。合同里每一条**有形态的**章节都必须在实验室里
//   至少有一个状态认领它（认领方式 = 该状态的 `source` 里写着这个章节号）。
//   新加一节而实验室没跟上 = 红；这正是"设计改了但没人画出来"最容易漏掉的地方。
const FORM_COUNT = 21
const P0_PIECE_COUNT = 16
const STORYBOARD_SECTIONS = [
  '§2.1', '§2.2', '§2.3', '§2.4', '§2.4.1', '§2.6', '§2.7',
  '§2.9', '§2.10', '§3.1', '§3.2', '§3.3', '§4.1', '§4.2', '§4.3', '§4.4',
]
const statesByScreen = new Map()
for (const screen of LAB_SCREEN_IDS) statesByScreen.set(screen, readLabStates(screen))

const agentIds = new Set(statesByScreen.get('agent-panel').map((state) => state.id))
for (let form = 1; form <= FORM_COUNT; form += 1) {
  const prefix = `form-${String(form).padStart(2, '0')}`
  if (![...agentIds].some((id) => id.startsWith(prefix))) {
    fail(`设计定稿 §4 形态 ${form} 在实验室里没有对应状态（期待 id 以 ${prefix} 开头）`)
  }
}
for (let piece = 1; piece <= P0_PIECE_COUNT; piece += 1) {
  const prefix = `p0-${String(piece).padStart(2, '0')}`
  if (![...agentIds].some((id) => id.startsWith(prefix))) {
    fail(`P0 异常态件 ${piece} 在实验室里没有对应状态（期待 id 以 ${prefix} 开头）`)
  }
}

const storyboardSources = statesByScreen.get('storyboard').map((state) => state.source).join(' | ')
for (const section of STORYBOARD_SECTIONS) {
  // 加边界：`§2.4` 不该被 `§2.4.1` 顶掉（前者讲几何、后者讲作用域，是两件事）。
  const matcher = new RegExp(`${section.replace('.', '\\.')}(?![0-9.])`)
  if (!matcher.test(storyboardSources)) {
    fail(`分镜表 v6 合同 ${section} 在实验室里没有任何状态认领（在该状态的 source 里写上章节号）`)
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
// 「基线待用户拍板」的屏：见 calibration.json 的 why.pendingApprovalScreens。
// 没被人看过的屏没有可回归的对象，现在录基线只会把「今天碰巧长这样」钉成「应该长这样」。
const pending = pendingApprovalScreens()
let baselineTotal = 0
let stateTotal = 0
for (const screen of LAB_SCREEN_IDS) {
  const ids = new Set(statesByScreen.get(screen).map((state) => state.id))
  stateTotal += ids.size
  const baselineDir = baselineDirFor(screen)
  const baselineFiles = fs.existsSync(baselineDir)
    ? fs.readdirSync(baselineDir).filter((name) => name.endsWith('.png'))
    : []
  baselineTotal += baselineFiles.length
  const baselineIds = new Set(baselineFiles.map((name) => name.replace(/\.png$/, '')))
  // `--update` 就是来补基线的，这时候「缺基线」是它的输入而不是错误（否则新状态永远补不上）。
  // 孤儿基线仍然照查：update 从来不删图，删状态没删图的欠账必须在这一次就暴露；
  // 待拍板的屏也照查孤儿——登记豁免的只有「还没录」，不是「录错了不用管」。
  if (!UPDATE && !pending[screen]) {
    for (const id of ids) {
      if (!baselineIds.has(id)) fail(`${screen} 的状态 ${id} 没有视觉基线；拍板后跑 pnpm run design-lab:update`)
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

console.log(`✅ 设计实验室结构检查：${LAB_SCREEN_IDS.length} 屏、${stateTotal} 个状态、${baselineTotal} 张基线，一一对应`)

for (const [screen, why] of Object.entries(pending)) {
  if (!LAB_SCREEN_IDS.includes(screen)) {
    console.error(`❌ calibration.json 登记了不存在的屏 ${screen}——登记过期了，删掉它`)
    process.exit(1)
  }
  console.log(`\n⚠️  ${screen} 屏的视觉基线**尚未拍板**，本次没有比对它的像素。\n   ${why}`)
}

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

// 起跑前先问端口归属：这一口要是被别的 worktree 占着，跑出来的每一张图都是别人分支的 UI。
// 放在这里（结构检查之后、Playwright 之前）是为了在花掉十几分钟之前就说清楚。
const portVerdict = inspectLabPort('visual')
if (portVerdict.status === 'foreign') {
  console.error(`\n${formatForeignHolder(portVerdict)}`)
  process.exit(1)
}
if (portVerdict.status === 'unknown') {
  console.log(`↷ 端口 ${portVerdict.port} 的归属问不出来（${portVerdict.reason}）——继续跑，但这一趟没有归属证明。`)
}

// 之前留下的差异图会让「这一趟有没有产出图」这个判据失真——先清干净，判据才成立。
fs.rmSync(LAB_RESULTS_DIR, { recursive: true, force: true })

const playwrightArgs = ['playwright', 'test', '-c', 'tests/ux/design-lab/playwright.config.mjs']
// 输出既要**实时给人看**（跑十几分钟总得看见进度），又要留一份给分诊读，所以是 pipe + 转发，
// 不是 stdio:'inherit'。inherit 时脚本自己看不见任何输出，于是只剩一个退出码可判——
// 「所有失败都说成视觉基线不符」正是这么来的。
const transcript = []
const runStatus = await new Promise((resolve) => {
  const child = spawn('npx', playwrightArgs, {
    cwd: repoRoot,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env, ...(UPDATE ? { NOMI_DESIGN_LAB_UPDATE: '1' } : {}) },
  })
  const tee = (stream, sink) => stream.on('data', (chunk) => {
    transcript[transcript.length] = String(chunk)
    sink.write(chunk)
  })
  tee(child.stdout, process.stdout)
  tee(child.stderr, process.stderr)
  child.on('close', (code) => resolve(code ?? 1))
})

if (runStatus !== 0) {
  const triage = triageLabRun({
    output: transcript.join(''),
    diffImages: collectDiffImages(LAB_RESULTS_DIR),
    exitCode: runStatus,
  })
  console.error(formatLabFailure(triage, { resultsDir: LAB_RESULTS_DIR, origin: LAB_ORIGIN, updating: UPDATE }))
  process.exit(1)
}
console.log(UPDATE ? '\n✅ 基线已更新——记得在 PR 里附前后对比' : '\n✅ 视觉基线全绿')
