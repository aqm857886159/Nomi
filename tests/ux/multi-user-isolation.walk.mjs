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
import { screenshotSettled } from './_assert.mjs'
import { setAppLanguage, readAppLanguage } from './_shell.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, '.multi-user-walk')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
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

// 语言只住设置「通用」里（顶栏没有语言钮了）：经 _shell.mjs 切。
async function switchToEnglish(win) {
  await setAppLanguage(win, 'en', '切到 English')
  await win.waitForTimeout(1000)
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

  // A 是中文用户：设置里语言=简体中文、tab=创作/生成
  const aLangZh = await readAppLanguage(winA, 'A 读语言')
  const aCreateZh = await winA.getByRole('button', { name: '创作', exact: true }).first().waitFor({ state: 'visible' }).then(() => true, () => false)
  check('A 工作台是中文（语言分段=zh-CN、tab=创作）', aLangZh === 'zh-CN' && aCreateZh, `lang=${aLangZh} 创作=${aCreateZh ? 1 : 0}`)

  // ② User B 切英文
  console.log('\n▶ User B 切换到 English…')
  await switchToEnglish(winB)
  const bLangEn = await readAppLanguage(winB, 'B 读语言')
  const bCreateEn = await winB.getByRole('button', { name: 'Create', exact: true }).first().waitFor({ state: 'visible' }).then(() => true, () => false)
  const bGenerateEn = await winB.getByRole('button', { name: 'Generate', exact: true }).first().waitFor({ state: 'visible' }).then(() => true, () => false)
  const bZhTabGone = await winB.getByRole('button', { name: '创作', exact: true }).count()
  check('B 切到英文（语言分段=en）', bLangEn === 'en', `lang=${bLangEn}`)
  check('B 工作台 tab 翻成英文（Create/Generate 出现、创作消失）', bCreateEn && bGenerateEn && bZhTabGone === 0, `Create=${bCreateEn ? 1 : 0} Generate=${bGenerateEn ? 1 : 0} 创作=${bZhTabGone}`)
  await screenshotSettled(winB, { path: path.join(shotsDir, 'B-01-en-workbench.png') })

  // ③ 隔离交叉验证（多用户核心）
  console.log('\n▶ 隔离交叉验证…')
  const aProjects = projectsIn(isoA.projectsDir)
  const bProjects = projectsIn(isoB.projectsDir)
  check('A 恰好 1 个项目', aProjects.length === 1, `count=${aProjects.length}`)
  check('B 恰好 1 个项目', bProjects.length === 1, `count=${bProjects.length}`)
  check('A/B 项目 ID 无交叉（项目互不串台）', aProjects.every((id) => !bProjects.includes(id)), `A=${JSON.stringify(aProjects)} B=${JSON.stringify(bProjects)}`)

  // ④ 语言隔离：B 切英文后，A 仍是中文
  const aStillZh = await readAppLanguage(winA, 'A 再读语言')
  const bStillEn = await readAppLanguage(winB, 'B 再读语言')
  check('B 切英文没污染 A（A 仍中文）', aStillZh === 'zh-CN', `A 语言=${aStillZh}`)
  check('B 仍是英文', bStillEn === 'en', `B 语言=${bStillEn}`)

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
