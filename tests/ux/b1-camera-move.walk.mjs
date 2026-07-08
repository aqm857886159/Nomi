// R13 走查（B1 参数化运镜轻入口）：视频镜头 composer 底栏的「运镜」芯片 + 弹层。
// 用法: node tests/ux/b1-camera-move.walk.mjs
// 隔离 userData + 临时 projects；构造 1 视频(seedance omni) + 1 图片节点。
// 人眼判据（截图在 tests/ux/shots/b1-camera-move/）：
//   ① 选中视频节点 → composer 底栏出现「运镜 · 推近 中」芯片
//   ② 点芯片 → 弹层：标题「运镜」+「不用搭 3D 场景」+ 10 运镜网格 + 速度 + 景别 + 读出 + 应用
//   ③ 改运镜/速度 → 读出与芯片实时更新
//   ④ 点「应用」→ 画布出现「运镜参考」scene3d 节点、无 console error
//   ⑤ 选中图片节点 → composer 无「运镜」芯片（video-only 门）
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/b1-camera-move')
fs.mkdirSync(shotsDir, { recursive: true })

const base = '/tmp/nomi-b1cammove'
const settingsDir = path.join(base, 'settings')
const projectsDir = path.join(base, 'projects')
fs.rmSync(base, { recursive: true, force: true })
fs.mkdirSync(settingsDir, { recursive: true })

const projectId = 'walk-b1cam-0001'
const projDir = path.join(projectsDir, `b1-cam-walk-${projectId}`)
fs.mkdirSync(path.join(projDir, '.nomi'), { recursive: true })

const image = {
  id: 'gen-v2-image', kind: 'image', title: '角色图（图片节点·不该有运镜芯片）',
  position: { x: 120, y: 200 }, size: { width: 300, height: 240 }, prompt: '',
  references: [], history: [], status: 'idle', categoryId: 'shots', shotIndex: 1, renderKind: 'shot-frame',
  meta: {},
}
const video = {
  id: 'gen-v2-video-omni', kind: 'video', title: '镜头（视频节点·该有运镜芯片）',
  position: { x: 560, y: 200 }, size: { width: 360, height: 280 }, prompt: '',
  references: [], history: [], status: 'idle', categoryId: 'shots', shotIndex: 2, renderKind: 'shot-frame',
  meta: {
    modelKey: 'doubao-seedance-2.0', modelLabel: 'Seedance 2.0', modelVendor: 'apimart',
    archetype: { id: 'seedance-2-apimart', modeId: 'omni' },
    size: '16:9', resolution: '720p', duration: 5, generate_audio: true,
  },
}
const generationCanvas = { nodes: [image, video], edges: [], selectedNodeIds: [], groups: [] }
const project = {
  id: projectId, name: 'B1 运镜芯片走查', version: 2,
  createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projDir,
  // 顶层平铺一份（legacy 发现/加载路径读顶层 generationCanvas；缺则抛「payload 缺少必要字段」）。
  workbenchDocument: null, timeline: null, generationCanvas,
  // categories 省略（可选；normalizer 补内置默认分类）——手写残缺 category 会让 record schema 校验失败。
  payload: {
    workbenchDocument: null, timeline: null,
    generationCanvas,
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

const consoleErrors = []
const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', `--user-data-dir=${settingsDir}`],
  cwd: repoRoot,
  env: { ...process.env, NOMI_SETTINGS_DIR: settingsDir, NOMI_PROJECTS_DIR: projectsDir, NOMI_E2E: '1' },
})
const win = await app.firstWindow()
win.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
win.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1500)
await win.evaluate(() => {
  for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(k, 'seen')
  window.localStorage.setItem('__nomiE2E', '1')
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

const card = win.getByText('B1 运镜芯片走查', { exact: false }).first()
console.log('  project card count:', await card.count())
const inCanvas = async () => win.evaluate(() => /生成方式|全能参考|导出|时间轴|预览/.test(document.body.innerText) && !/Nomi 项目库|新建空白项目/.test(document.body.innerText))
if (await card.count()) {
  await card.click({ timeout: 4000 }).catch(() => {})
  await win.waitForTimeout(400)
  for (const [how, act] of [
    ['继续创作', async () => { const b = win.getByText('继续创作', { exact: false }).first(); if (await b.count()) await b.click({ timeout: 3000 }).catch(() => {}) }],
    ['dblclick-card', async () => { await card.dblclick({ timeout: 3000 }).catch(() => {}) }],
  ]) {
    await act()
    await win.waitForTimeout(2500)
    if (await inCanvas()) { console.log(`  → 进画布 via ${how}`); break }
  }
}
await win.keyboard.press('Escape').catch(() => {})
await win.waitForTimeout(500)
await snap(win, 'canvas')

// 选中节点：点节点 DOM 外壳（带 data-node-id={node.id}）近顶部标题区（避开卡内启动按钮/连接手柄）。
const selectNode = async (id) => {
  const el = win.locator(`[data-node-id="${id}"]`).first()
  if (!(await el.count())) { console.log(`  ✗ 找不到节点 DOM [data-node-id=${id}]`); return false }
  await el.click({ timeout: 3000, position: { x: 40, y: 14 } }).catch((e) => console.log('  节点点击 err', e.message))
  await win.waitForTimeout(900)
  return true
}
// 先点空白收起「上手 4 步」引导浮层，免得挡住/拦截。
await win.mouse.click(60, 520).catch(() => {})
await win.waitForTimeout(300)

// —— ① 选中视频节点 → composer 出现「运镜」芯片 ——
await selectNode('gen-v2-video-omni')
await win.waitForTimeout(500)
const videoChip = await win.evaluate(() => {
  const chip = document.querySelector('[aria-label="运镜"]')
  return { present: !!chip, text: chip ? chip.textContent.trim() : null }
})
console.log(`  ① 视频节点运镜芯片 present=${videoChip.present} text=${JSON.stringify(videoChip.text)}`)
await snap(win, 'video-selected-chip')

// —— ② 点芯片 → 弹层 ——
let popover = { ok: false }
if (videoChip.present) {
  await win.locator('[aria-label="运镜"]').first().click({ timeout: 3000 }).catch((e) => console.log('  chip click err', e.message))
  await win.waitForTimeout(700)
  popover = await win.evaluate(() => {
    const t = document.body.innerText
    const moves = ['推近', '拉远', '左环绕', '右环绕', '升镜', '降镜', '左横移', '右横移', '左弧', '右弧', '变焦推', '变焦拉', '希区柯克变焦']
    return {
      ok: t.includes('不用搭 3D 场景'),
      moveCount: moves.filter((m) => t.includes(m)).length,
      hasSpeed: t.includes('速度') && t.includes('慢') && t.includes('快'),
      hasFraming: t.includes('景别') && t.includes('远') && t.includes('近'),
      hasReadout: t.includes('灰模运镜片自动接入 video_ref'),
      hasApply: t.includes('应用'),
    }
  })
  console.log('  ② 弹层:', JSON.stringify(popover))
}
await snap(win, 'popover-open')

// —— ③ 改运镜(左环绕) + 速度(慢) → 读出更新 ——
if (popover.ok) {
  const orbit = win.locator('button', { hasText: '左环绕' }).first()
  if (await orbit.count()) { await orbit.click({ timeout: 2000 }).catch(() => {}); await win.waitForTimeout(300) }
  const slow = win.locator('[role="group"][aria-label="速度"] button', { hasText: '慢' }).first()
  if (await slow.count()) { await slow.click({ timeout: 2000 }).catch(() => {}); await win.waitForTimeout(300) }
  const readout = await win.evaluate(() => {
    const t = document.body.innerText
    return { hasOrbit8s: /左环绕 · 慢 · 8s/.test(t), raw: (t.match(/[左右]?环?绕?[^\n]*· 8s[^\n]*/) || [''])[0].slice(0, 40) }
  })
  console.log('  ③ 读出更新:', JSON.stringify(readout))
  await snap(win, 'readout-updated')
}

// —— ④ 点「应用」→ 出「运镜参考」节点 + 无 error ——
let applied = { node: false }
if (popover.ok) {
  const applyBtn = win.locator('button', { hasText: /^应用$/ }).first()
  if (await applyBtn.count()) { await applyBtn.click({ timeout: 3000 }).catch((e) => console.log('  apply err', e.message)); await win.waitForTimeout(2500) }
  applied = await win.evaluate(() => ({ node: document.body.innerText.includes('运镜参考') }))
  console.log(`  ④ 应用后出现「运镜参考」节点=${applied.node}`)
  await snap(win, 'after-apply')
}

// —— ⑤ 选中图片节点 → 无「运镜」芯片 ——
await selectNode('gen-v2-image')
await win.waitForTimeout(500)
const imageChip = await win.evaluate(() => ({ present: !!document.querySelector('[aria-label="运镜"]') }))
console.log(`  ⑤ 图片节点运镜芯片 present=${imageChip.present}（应为 false）`)
await snap(win, 'image-selected-no-chip')

console.log('\n===== B1 走查判定 =====')
console.log(`  ① 视频节点有运镜芯片:        ${videoChip.present ? 'PASS' : 'FAIL'}`)
console.log(`  ② 弹层布局(≥8运镜+速度+景别+读出+应用): ${popover.ok && popover.moveCount >= 8 && popover.hasSpeed && popover.hasFraming && popover.hasReadout && popover.hasApply ? 'PASS' : 'FAIL'} (moves=${popover.moveCount})`)
console.log(`  ④ 应用出「运镜参考」节点:      ${applied.node ? 'PASS' : 'FAIL'}`)
console.log(`  ⑤ 图片节点无运镜芯片:         ${imageChip.present === false ? 'PASS' : 'FAIL'}`)
console.log(`  console errors: ${consoleErrors.length}`)
if (consoleErrors.length) console.log('   ' + consoleErrors.slice(0, 8).join('\n   '))
console.log(`\n截图在 ${shotsDir}`)
await app.close()
