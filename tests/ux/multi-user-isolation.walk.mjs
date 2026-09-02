#!/usr/bin/env node
// 并发多用户隔离走查 —— i18n 大改 + 多用户场景的核心保证（sequential 旅程覆盖不到的角度）。
//
// 同机两个隔离 Electron 实例「同时」在跑：User A（中文）与 User B（切英文），验证三件事：
//   ① 项目互不串台：各自 projectsDir 只见自己那 1 个项目，ID 无交叉。
//   ② 语言设置互不串台：同一 app build，A 停在 zh、B 切 en，靠 per-user-data-dir 的
//      localStorage 隔离（B 切语言绝不污染 A）。i18n 端到端在英文下也真的生效（工作台
//      tab 从 创作/生成/预览 翻成 Create/Generate/Preview）。
//   ③ 并发存活：两窗全程同时响应。
//
// 终态取证读落盘 project.json（不信 UI 自述）+ 截图供人眼判断（R13）。零真生成、确定性。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  prepareIsolation,
  launchIsolatedApp,
  dismissSplashIfPresent,
  createBlankProject,
} from '../../evals/lib/isoApp.mjs'
import { screenshotSettled, proveProbe, expectAbsent } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, '.multi-user-walk')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}
// expectAbsent 抛错、而本走查要收集全部结果 → 包一层保持 check() 风格。
// 用它而不是 count()===0：它带 hold 窗口，异步挂载的东西溜不过去（_assert.mjs 的设计意图）。
const checkAbsent = async (name, locator, provenBy, message) => {
  try {
    await expectAbsent(locator, { provenBy, message })
    check(name, true)
  } catch (error) {
    check(name, false, String(error.message).split('\n')[0])
  }
}

const projectsIn = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, '.nomi', 'project.json')))
    : []

async function skipOnboarding(win) {
  await dismissSplashIfPresent(win)
  await win.evaluate(() => {
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1'])
      localStorage.setItem(k, 'seen')
  })
  await win.reload()
  await win.waitForTimeout(1500)
  await dismissSplashIfPresent(win)
}

// 切语言的唯一入口：齿轮 → 设置「通用」→ 语言分段控件（feeb575b 按设计系统 §1.5 把语言
// 归位到设置，同 commit P1 删掉了原先的 LanguageMenuButton，所以别再找 [aria-label="语言"]）。
async function switchToEnglish(win) {
  await win.locator('[data-open-settings]').first().click({ timeout: 8000 })
  await win.waitForTimeout(800)
  await win.locator('[data-settings-tab-id="general"]').first().click({ timeout: 6000 })
  await win.waitForTimeout(600)
  await win.locator('[data-settings-locale="en"]').first().click({ timeout: 6000 })
  await win.waitForTimeout(800)
  await win.keyboard.press('Escape') // 关掉设置，回到被测界面本身
  await win.waitForTimeout(800)
}

const isoA = prepareIsolation(path.join(os.tmpdir(), 'nomi-mu-A'), { requireCatalog: false })
const isoB = prepareIsolation(path.join(os.tmpdir(), 'nomi-mu-B'), { requireCatalog: false })

console.log('▶ 并发启动 User A + User B 两个隔离实例…')
const [{ app: appA, win: winA }, { app: appB, win: winB }] = await Promise.all([
  launchIsolatedApp(repoRoot, isoA),
  launchIsolatedApp(repoRoot, isoB),
])

try {
  await Promise.all([skipOnboarding(winA), skipOnboarding(winB)])

  // ① 两用户「同时」各建一个项目（并发 → 各落各的隔离区）
  console.log('\n▶ A、B 并发各建一个项目…')
  const [projA, projB] = await Promise.all([
    createBlankProject(winA, isoA.projectsDir),
    createBlankProject(winB, isoB.projectsDir),
  ])
  check('A 项目落在 A 的 projectsDir', fs.existsSync(path.join(projA, '.nomi', 'project.json')), path.basename(projA))
  check('B 项目落在 B 的 projectsDir', fs.existsSync(path.join(projB, '.nomi', 'project.json')), path.basename(projB))
  await screenshotSettled(winA, { path: path.join(shotsDir, 'A-01-zh-workbench.png') })

  // A 是中文用户：工作台 tab 应为 创作/生成。
  // 语言态证据用**界面文案**，不用某颗按钮的 aria-label：文案就是用户真正看到的东西，
  // 而按钮会被 §1.5 那类归位重构搬走（原先钉 [aria-label="语言"]，组件删了就成了死锚点）。
  const aZhTab = winA.getByRole('button', { name: '创作', exact: true })
  const aEnTab = winA.getByRole('button', { name: 'Create', exact: true })
  // 基线（模式②）：先证「这套文本探针在 A 这一屏是活的」，否则「没看到 Create」可能只是探针没生效。
  const aProbeAlive = await proveProbe(aZhTab, 'A 窗口中文 tab「创作」能被文本探针找到')
  check('A 工作台是中文（tab=创作）', true, `创作=${await aZhTab.count()}`)
  await checkAbsent('A 没有英文 tab（Create 不存在）', aEnTab, aProbeAlive, 'A 是中文用户，不该出现 Create')

  // ② User B 切英文
  console.log('\n▶ User B 切换到 English…')
  await switchToEnglish(winB)
  const bCreateEn = await winB.getByRole('button', { name: 'Create', exact: true }).count()
  const bGenerateEn = await winB.getByRole('button', { name: 'Generate', exact: true }).count()
  const bZhTabGone = await winB.getByRole('button', { name: '创作', exact: true }).count()
  check('B 工作台 tab 翻成英文（Create/Generate 出现、创作消失）', bCreateEn > 0 && bGenerateEn > 0 && bZhTabGone === 0, `Create=${bCreateEn} Generate=${bGenerateEn} 创作=${bZhTabGone}`)
  await screenshotSettled(winB, { path: path.join(shotsDir, 'B-01-en-workbench.png') })

  // ③ 隔离交叉验证（多用户核心）
  console.log('\n▶ 隔离交叉验证…')
  const aProjects = projectsIn(isoA.projectsDir)
  const bProjects = projectsIn(isoB.projectsDir)
  check('A 恰好 1 个项目', aProjects.length === 1, `count=${aProjects.length}`)
  check('B 恰好 1 个项目', bProjects.length === 1, `count=${bProjects.length}`)
  check('A/B 项目 ID 无交叉（项目互不串台）', aProjects.every((id) => !bProjects.includes(id)), `A=${JSON.stringify(aProjects)} B=${JSON.stringify(bProjects)}`)

  // ④ 语言隔离：B 切英文后，A 仍是中文
  const aStillZh = await winA.getByRole('button', { name: '创作', exact: true }).count()
  const bStillEn = await winB.getByRole('button', { name: 'Create', exact: true }).count()
  check('B 切英文后 A 仍是中文', aStillZh > 0, `A 创作=${aStillZh}`)
  // 这条是语言隔离的核心：B 的切换绝不能漏到 A。基线沿用上面已证活的同一套探针。
  await checkAbsent('B 的英文没漏进 A（A 仍无 Create）', aEnTab, aProbeAlive, 'B 切英文不该污染 A')
  check('B 仍是英文', bStillEn > 0, `B Create=${bStillEn}`)

  // ⑤ 并发存活：两窗同时响应
  const [aAlive, bAlive] = await Promise.all([
    winA.evaluate(() => document.readyState === 'complete').catch(() => false),
    winB.evaluate(() => document.readyState === 'complete').catch(() => false),
  ])
  check('两实例并发存活（同时响应）', aAlive && bAlive, `A=${aAlive} B=${bAlive}`)
  await screenshotSettled(winA, { path: path.join(shotsDir, 'A-02-final-zh.png') })
  await screenshotSettled(winB, { path: path.join(shotsDir, 'B-02-final-en.png') })
} finally {
  await appA.close().catch(() => {})
  await appB.close().catch(() => {})
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length ? '❌' : '✅'} 多用户隔离走查：${results.length - failed.length}/${results.length} 通过`)
console.log(`截图：${shotsDir}`)
if (failed.length) {
  console.log('失败项：', failed.map((r) => r.name).join('; '))
  process.exit(1)
}
