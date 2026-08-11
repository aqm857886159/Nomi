// R13 走查：创作区「拆镜头」触发改版（2026-06-26）——
//  ① 治脆：用「旧正则必漏」的措辞（把故事整成一段段画面）发送，仍被识别；
//  ② 治隐形：识别后不静默开跑，而是冒一张可见「拆成镜头·落画布」动作卡；
//  ③ 点按钮才真正触发规划师（出 pending / 计划 / 错误卡之一，证明已 launch）；
//  ④ 控制组：普通改写措辞不出动作卡。
// 用法: node tests/ux/storyboard-trigger.walk.mjs
// 隔离 userData + NOMI_PROJECTS_DIR，构造一个含故事正文的项目，不碰真实数据。
// 产出: tests/ux/shots/storyboard-trigger/*.png —— 人眼判断动作卡的出现/点击转场。
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/storyboard-trigger')
fs.mkdirSync(shotsDir, { recursive: true })

const base = '/tmp/nomi-storyboard-trigger'
const settingsDir = path.join(base, 'settings')
const projectsDir = path.join(base, 'projects')
fs.rmSync(base, { recursive: true, force: true })
fs.mkdirSync(settingsDir, { recursive: true })

const projectId = 'walk-sbtrigger-0001'
const projDir = path.join(projectsDir, `sbtrigger-walk-${projectId}`)
fs.mkdirSync(path.join(projDir, '.nomi'), { recursive: true })
const STORY = '清晨，戴金丝眼镜的咖啡馆老板林夏打开店门，擦拭吧台。常客陈默推门而入，两人相视一笑，窗外的梧桐叶被风吹落。'
const workbenchDocument = {
  version: 1,
  title: '咖啡馆的清晨',
  contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: STORY }] }] },
  updatedAt: 1,
}
const project = {
  id: projectId, name: '拆镜头触发走查', version: 2,
  createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projDir,
  payload: {
    workbenchDocument, timeline: null,
    generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
    storyboardPlan: null, storyboardPlanCommitted: false,
  },
}
fs.writeFileSync(path.join(projDir, 'project.json'), JSON.stringify(project, null, 2))
fs.writeFileSync(path.join(projDir, '.nomi', 'project.json'), JSON.stringify(project, null, 2))

let n = 0
const snap = async (win, name) => {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  await win.screenshot({ path: path.join(shotsDir, `${tag}.png`) })
  console.log(`  · shot ${tag}`)
}
const bodyHas = (win, re) => win.evaluate((src) => new RegExp(src).test(document.body.innerText), re.source)

const { app, win } = await launchNomiApp({
  name: 'storyboard-trigger',
  userDataDir: settingsDir,
  settingsDir: settingsDir,
  projectsDir: projectsDir,
  settleMs: 0,
})
win.on('console', (m) => { const t = m.text(); if (/error|fail|载|open|project|打不开|无法/i.test(t)) console.log('  [console]', t.slice(0, 160)) })
win.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 160)))
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1500)
await win.evaluate(() => {
  for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(k, 'seen')
})
await win.reload()
await win.waitForTimeout(1500)
for (let i = 0; i < 6; i++) {
  const skip = win.locator('button,[role="button"],a', { hasText: /跳过|开始创作|进入|完成/ }).first()
  if (await skip.count()) await skip.click({ timeout: 1200 }).catch(() => {})
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(350)
}
await snap(win, 'library')

// 打开项目
const card = win.getByText('拆镜头触发走查', { exact: false }).first()
console.log('  project card count:', await card.count())
const inProject = async () => win.evaluate(() => !/Nomi 项目库|新建空白项目/.test(document.body.innerText))
if (await card.count()) {
  // 缩略图中心的「继续创作」是 hover 浮层按钮 → 取卡片 bbox，hover 后点缩略图中心。
  const box = await card.boundingBox().catch(() => null)
  if (box) {
    const cx = box.x + box.width / 2
    const cy = box.y - 40 // 标题在下，缩略图在标题上方
    await win.mouse.move(cx, Math.max(cy, box.y - 80)).catch(() => {})
    await win.waitForTimeout(500)
    await win.mouse.click(cx, Math.max(cy, box.y - 80)).catch(() => {})
    await win.waitForTimeout(2500)
  }
  if (!(await inProject())) {
    const cont = win.getByText('继续创作', { exact: false }).first()
    if (await cont.count()) { await cont.click({ force: true, timeout: 3000 }).catch(() => {}) }
    await win.waitForTimeout(2500)
  }
  if (!(await inProject())) { await card.dblclick({ force: true, timeout: 3000 }).catch(() => {}); await win.waitForTimeout(2500) }
}
console.log('  inProject:', await inProject())
// 切到「创作」工作区（NomiStepper）
const creationTab = win.locator('button,[role="button"]', { hasText: /^创作$/ }).first()
if (await creationTab.count()) { await creationTab.click({ timeout: 3000 }).catch(() => {}) }
await win.waitForTimeout(1500)
console.log('  body head:', (await win.evaluate(() => document.body.innerText.slice(0, 140))).replace(/\n/g, ' '))
await snap(win, 'creation-area')

// 定位创作 AI 输入框（placeholder 含「拆成镜头、做成视频」）。可能要先展开助手。
async function findComposer() {
  const sel = 'textarea[placeholder*="拆成镜头"], textarea[placeholder*="问我"]'
  let byPlaceholder = win.locator(sel).first()
  if (await byPlaceholder.count()) return byPlaceholder
  // 助手收起为右上「Nomi 创作」胶囊 → 点开
  const pill = win.locator('button,[role="button"]', { hasText: /Nomi\s*创作/ }).first()
  if (await pill.count()) { await pill.click({ timeout: 2000 }).catch(() => {}); await win.waitForTimeout(900) }
  byPlaceholder = win.locator(sel).first()
  if (await byPlaceholder.count()) return byPlaceholder
  const opener = win.locator('button,[role="button"]', { hasText: /创作助手|助手|问我/ }).first()
  if (await opener.count()) { await opener.click({ timeout: 2000 }).catch(() => {}); await win.waitForTimeout(800) }
  return win.locator(sel).first()
}
let composer = await findComposer()
console.log('  composer count:', await composer.count())
if (!(await composer.count())) {
  // 兜底：任意 textarea
  composer = win.locator('textarea').last()
  console.log('  fallback textarea count:', await composer.count())
}

async function sendPhrase(phrase, label) {
  await composer.click({ timeout: 3000 }).catch(() => {})
  await win.waitForTimeout(300)
  await composer.fill(phrase).catch(async () => { await win.keyboard.type(phrase, { delay: 25 }) })
  await win.waitForTimeout(300)
  await win.keyboard.press('Enter').catch(() => {})
  await win.waitForTimeout(1200)
  await snap(win, label)
}

// —— 治脆+治隐形：旧正则必漏的措辞 → 应出动作卡 ——
await sendPhrase('把这个故事整成一段段画面', 'paraphrase-sent')
const cardShown = await bodyHas(win, /看起来你想把故事拆成镜头|拆成镜头/)
console.log(`  → 动作卡出现(含「看起来你想把故事拆成镜头/拆成镜头」) = ${cardShown}`)

// —— 点按钮才落画布：点「拆成镜头·落画布」——
const runBtn = win.locator('[data-action-run="storyboard"], button', { hasText: /拆成镜头/ }).first()
console.log('  run button count:', await runBtn.count())
if (await runBtn.count()) {
  await runBtn.click({ timeout: 3000 }).catch(() => {})
  await win.waitForTimeout(2500)
}
const launched = await bodyHas(win, /正在拆镜头|整理分镜方案|分镜方案|拆镜头失败|大脑|模型/)
console.log(`  → 点击后触发规划师(pending/计划/错误卡之一) = ${launched}`)
await snap(win, 'after-run-click')

// —— 控制组：普通改写措辞 → 不应出动作卡 ——
await sendPhrase('帮我把这段写得更生动一点', 'control-normal-phrase')

console.log('\n  RESULT cardShown=%s launched=%s', cardShown, launched)
await app.close()
console.log('  ✓ done. shots →', shotsDir)
