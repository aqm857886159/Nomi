// 暗色「完整用户旅途」R13 走查 —— J1-J5：项目库 → 创作 → 生成画布 → 预览时间轴 → 导出。
// 用法: pnpm run build && node tests/ux/dark-journey.walk.mjs
// 产出: tests/ux/shots/dark-journey/*.png（每段一张，人眼对账暗色下的层次/对比/可读性）。
//
// ── 这份走查为什么被重写（2026-08-18）──
//
// 它此前**根本没在导航**，却每次都报绿。真机跑出来的样子：
//   · stdout 印 `opened example: false` —— 「打开示例项目」的两个候选定位器 count 都是 0；
//   · 01-J1-library / 02-J2-creation / 03-J3-generation-canvas 三张 PNG **字节完全相同**
//     （各 102303 字节），全是那张空库页「这个分类下还没有项目 · 全部 0」；
//   · 只有 04-J4-preview 里项目是开着的——而那是引导 tour 自己跑到了那儿，不是脚本点出来的。
//
// 三个根因，逐个治，而不是把定位器改对了事：
//
//  ① **库是空的，压根没有项目可点。** 隔离 profile 里没有任何项目，示例项目是引导 tour 现建的。
//     → 治法：起飞前按落盘格式**自己种一个做完的项目**（tests/ux/fixtures/journey-project-fixture.mjs），
//       三个工作区各有真实内容。旅程从此不依赖引导 tour，也不依赖用户本机有什么。
//
//  ② **点击失败长得和成功一模一样。** 旧 clickText 用 `count() > 0` 当成功判据、
//     再用 `.catch(() => {})` 吞掉真实点击失败——定位器一过期，那一步就静默跳过，脚本继续截图。
//     → 治法：所有点击走 `_assert.mjs` 的 clickOrFail（可见才点、点不到就抛）。
//       同理删掉 dismissTour：它拿 /跳过|完成|知道了|开始创作/ 在全页乱点，是这份脚本里
//       唯一会**自己制造导航**的东西，而它同样吞掉所有失败。tour 只由首页那张卡片显式触发
//       （NomiStudioApp.tsx:423 playJourneyTour 是唯一入口，没有自动播放路径），
//       本走查不点它，就没有 tour 要压。
//
//  ③ **每段只管截图，不管到没到。** 截图是产出，不是判据——截到什么都算数。
//     → 治法：每段先断言「我到了这儿」（工作台的 data-workspace-mode + 本段独有的锚点），
//       断言过了才截图；收尾再做一次**截图两两不同**的结构检查（见 assertStagesAreDistinct）。
//       字节相同的两段截图 = 中间那步没发生，这正是上面那次假绿的形状，现在它会报红。
//
// 顺手删掉的两段：X1「模型接入」与 X2「技能库」。两段都是无断言的顺手截图，
// 且 X2 等的 `[aria-label*="技能"]` 在工作台外壳里没有触发入口（SkillLibraryPanel 未挂载），
// 属于永不命中的死步骤。模型接入面另有 model-onboarding.walk.mjs 专门走。
// 留半步能跑不能验的东西 = 下一次假绿（P1：加新必删旧，不留逃生口）。
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectVisible, expectCount, clickOrFail, DEFAULT_TIMEOUT_MS, screenshotSettled } from './_assert.mjs'
import { seedFinishedJourneyProject } from './fixtures/journey-project-fixture.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/dark-journey')

// 每次跑清空产出目录：上一轮的 PNG 留在盘里，会被当成这一轮的产出去对账
// （「截图有吗」问的是**这次**跑出来的截图）。
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

// 一次性隔离 profile：不碰用户真实项目库/设置，也保证库里**只有**我们种的那一个项目
// ——「库里恰好 1 个项目」于是成为一条测得准的断言。
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-dark-journey-'))
const userDataDir = path.join(tempRoot, 'user-data')
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
for (const dir of [userDataDir, settingsDir, projectsDir]) fs.mkdirSync(dir, { recursive: true })

const seeded = seedFinishedJourneyProject({ projectsDir })
console.log(`种下走查项目「${seeded.projectName}」：${seeded.shotCount} 个镜头节点 / ${seeded.clipCount} 条时间轴 clip`)

/** 已完成的段落：tag + 截图路径 + 内容指纹（指纹用于收尾的「两两不同」检查）。 */
const stages = []

/**
 * 走完一段：**先断言到了，再截图**。顺序是刻意的——截图只是给人眼看的产出，
 * 判据必须在它之前独立成立，否则又回到「截到什么算什么」。
 */
async function stage(win, name, arrive) {
  await arrive()
  const tag = `${String(stages.length + 1).padStart(2, '0')}-${name}`
  const file = path.join(shotsDir, `${tag}.png`)
  await screenshotSettled(win, { path: file })
  const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  stages.push({ tag, file, digest })
  console.log(`  ✓ ${tag}`)
}

/**
 * 收尾结构检查：任意两段的截图不能字节相同。
 *
 * 这是把「上一次那种假绿」钉死成结构不变量：五段各是不同的界面，
 * 出现两张一模一样的 PNG，只有一种解释——中间那几步压根没发生。
 * 逐段断言已经能挡住绝大多数，但它们各自只看一个锚点；这条从**产出**这一侧再兜一次底，
 * 且它正是当初唯一暴露问题的证据形态（三张 102303 字节的同款空库页）。
 */
function assertStagesAreDistinct() {
  const byDigest = new Map()
  for (const item of stages) {
    const same = byDigest.get(item.digest)
    if (same) {
      throw new Error(
        `WALK FAIL: 「${same}」与「${item.tag}」的截图字节完全相同。\n`
          + '两段不同的界面不可能截出同一张图——中间那步没有真正发生。\n'
          + `对照：${path.relative(repoRoot, shotsDir)}/`,
      )
    }
    byDigest.set(item.digest, item.tag)
  }
  console.log(`\n✅ ${stages.length} 段截图两两不同（内容指纹校验通过）`)
}

/** 切到某个工作区，并断言真的切过去了（步骤条点了 ≠ 工作台换了）。 */
async function gotoWorkspace(win, mode, label) {
  await clickOrFail(win.locator(`.nomi-stepper__step[data-mode="${mode}"]`), `顶栏步骤条「${label}」`)
  await expect(
    win.locator('[data-workspace-mode]'),
    `点了「${label}」，但工作台外壳仍不在 ${mode}——这一步没生效，后面的截图不能算数`,
  ).toHaveAttribute('data-workspace-mode', mode, { timeout: DEFAULT_TIMEOUT_MS })
}

const { app, win } = await launchNomiApp({
  name: 'dark-journey',
  userDataDir,
  settingsDir,
  projectsDir,
  settleMs: 2000,
})

try {
  // 暗色是这份走查的主题，钉死存储再 reload（存了就不再走「天黑自动暗」的时间策略）。
  // 同时压掉开屏动画——它会盖住首屏。
  // 不再写 nomi:journey-tour:v1：那个键只切换首页卡片的文案（看一遍/重看一遍），
  // 从来不阻止 tour 运行，写它会让人误以为 tour 被压住了（onboardingState.ts:94）。
  await win.evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'dark')
    localStorage.setItem('nomi:splash:v1', 'seen')
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await expect(win.locator('html'), '暗色没生效——这份走查看的就是暗色，浅色下截图没有意义')
    .toHaveAttribute('data-theme', 'dark', { timeout: DEFAULT_TIMEOUT_MS })

  // ── J1 项目库 ──
  const projectCard = win.locator('[data-project-card="true"]')
  await stage(win, 'J1-library', async () => {
    // 隔离 profile 里只该有我们种的那一个：既证明库渲染出来了，也证明种的项目被发现了。
    await expectCount(projectCard, 1, '项目库里应当恰好有 1 个走查项目（隔离 profile，只种了一个）')
    await expectVisible(
      projectCard.filter({ hasText: seeded.projectName }),
      `项目卡「${seeded.projectName}」`,
    )
  })

  // ── 打开项目 ──
  await clickOrFail(projectCard.filter({ hasText: seeded.projectName }), `项目卡「${seeded.projectName}」`)
  await expectVisible(win.locator('[data-workspace-mode]'), '打开项目后的工作台外壳')

  // ── J2 创作区 ──
  await stage(win, 'J2-creation', async () => {
    await gotoWorkspace(win, 'creation', '创作')
    const surface = win.locator('[data-creation-surface="source"]')
    await expectVisible(surface, '创作区文稿编辑面')
    // 读种下去的正文：证明打开的是**这个**项目、且 payload 真的 hydrate 进来了，
    // 而不是停在一个空编辑器上（空编辑器同样能让「编辑面可见」成立）。
    await expect(surface, '创作区没有种下去的文稿正文——项目内容没恢复').toContainText(seeded.firstParagraph, {
      timeout: DEFAULT_TIMEOUT_MS,
    })
  })

  // ── J3 生成画布 ──
  const canvasNodes = win.locator('[data-node-id]')
  await stage(win, 'J3-generation-canvas', async () => {
    await gotoWorkspace(win, 'generation', '生成')
    await expectVisible(win.locator('[data-nomi-generation-canvas-import-target="true"]'), '生成画布')
    await expectCount(canvasNodes, seeded.shotCount, `画布上应当有 ${seeded.shotCount} 个镜头节点`)
  })

  // ── J3b 选中一个节点：浮动工具栏 ──
  await stage(win, 'J3b-node-selected', async () => {
    await clickOrFail(win.locator('[data-node-id="shot-1"]'), '第一个镜头节点', { force: true })
    await expectVisible(win.locator('[role="toolbar"][aria-label="图片操作"]'), '选中节点后的图片操作工具栏')
  })

  // ── J4 预览时间轴 ──
  await stage(win, 'J4-preview-timeline', async () => {
    await gotoWorkspace(win, 'preview', '预览')
    await expectCount(
      win.locator('[data-testid="timeline-clip"]'),
      seeded.clipCount,
      `时间轴上应当有 ${seeded.clipCount} 条 clip`,
    )
    await expectVisible(win.locator('.workbench-preview-player__image'), '预览播放器画面')
  })

  // ── J5 导出 ──
  // 只走到「导出真的启动了」为止：断言进度条浮出来就截图收工，不等它跑完
  // （跑完会弹 Finder——真机走查不该在收尾时劫持用户桌面）。
  await stage(win, 'J5-export-running', async () => {
    await clickOrFail(win.locator('.workbench-preview-player__export-button'), '导出 MP4')
    await expectVisible(win.locator('.workbench-preview-player__export-progress'), '导出进度条')
  })

  assertStagesAreDistinct()
  console.log(`\nDone. ${stages.length} 段 → ${path.relative(repoRoot, shotsDir)}`)
} catch (error) {
  // 失败现场留一张图：报红时最想知道的就是「那一刻屏幕上到底是什么」。
  await win.screenshot({ path: path.join(shotsDir, '99-failure.png') }).catch(() => {})
  console.error(`\n❌ 走查失败，失败现场已截图 → ${path.relative(repoRoot, shotsDir)}/99-failure.png`)
  throw error
} finally {
  await app.close()
}
