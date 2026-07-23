// R13 真机走查（PR#53 图片+视频分镜 + 镜号共号修复）：
// 真旅程 = 新建项目 → 写故事 → 拆镜头 → 动作卡选「图片+视频」→ 真 planner 拆镜 →
// 方案编辑器（首帧图提示词框）→ 确认落画布 → 画布镜号硬断言（首帧图与视频共号、视频 1..N 连续）。
// 截图进 .pr53-walk/ 人眼判断。用法：node scripts/pr53-image-video-mode-walkthrough.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.pr53-walk')
mkdirSync(outDir, { recursive: true })
const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }

// 隔离档案：临时 settings（拷真实 model-catalog.json → planner 有真模型+key）+ 临时项目根
// （垃圾项目不进用户库）。同时绕开与正开着的打包版抢 userData（走查坑：共享档案会互相写坏）。
import { copyFileSync, existsSync } from 'node:fs'
import os from 'node:os'
const isolatedSettings = path.join(os.tmpdir(), 'nomi-pr53-settings')
const isolatedProjects = path.join(os.tmpdir(), 'nomi-pr53-projects')
mkdirSync(isolatedSettings, { recursive: true })
mkdirSync(isolatedProjects, { recursive: true })
const realCatalog = path.join(os.homedir(), 'Library', 'Application Support', 'Nomi', 'model-catalog.json')
if (existsSync(realCatalog)) copyFileSync(realCatalog, path.join(isolatedSettings, 'model-catalog.json'))

const STORY = '深夜的天文台里，研究员苏芮盯着屏幕上突然出现的规律信号。她摘下眼镜揉了揉眼睛，又戴上，信号还在。她抓起内线电话，手指悬在按键上停了三秒，又放下——上一个上报异常信号的同事，第二天工位就空了。窗外，雪落在射电望远镜巨大的天线上。她把信号数据拷进私人硬盘，塞进大衣内袋，走向停车场。'

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.'],
  cwd: repoRoot,
  env: {
    ...process.env,
    NOMI_E2E: '1',
    NOMI_E2E_ALLOW_MULTI_INSTANCE: '1',
    NOMI_SETTINGS_DIR: isolatedSettings,
    NOMI_PROJECTS_DIR: isolatedProjects,
  },
})
const errors = []
let failed = false
try {
  const win = await app.firstWindow()
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1680, height: 1020 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await win.waitForLoadState('domcontentloaded')
  // E2E 桥开关：画布 store 挂 window（镜号硬断言用）
  await win.evaluate(() => window.localStorage.setItem('__nomiE2E', '1'))
  await win.waitForTimeout(1800)

  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2500)

  const editor = win.locator('[aria-label="创作文档编辑区"]')
  await editor.first().waitFor({ timeout: 10000 })
  await editor.first().click()
  await editor.first().fill(STORY).catch(async () => { await win.keyboard.insertText(STORY) })
  await win.waitForTimeout(600)

  const expand = win.locator('[aria-label="展开创作助手"]')
  if ((await expand.count()) > 0) { await expand.first().click(); await win.waitForTimeout(600) }

  const input = win.locator('[aria-label="创作 AI 输入"]')
  await input.first().waitFor({ timeout: 8000 })
  await input.first().fill('拆镜头')
  await win.locator('[aria-label="创作 AI 发送"]').first().click()
  const card = win.locator('[data-action-card="storyboard"]')
  await card.first().waitFor({ timeout: 15000 })
  await win.waitForTimeout(400)
  await shot(win, '01-action-card-three-modes.png') // 验：图片/视频/图片+视频 三选一

  // 选「图片+视频分镜」
  const ivChip = card.first().getByText('图片+视频分镜', { exact: false })
  if ((await ivChip.count()) === 0) { console.log('  ✗ 动作卡上没有「图片+视频分镜」选项'); failed = true }
  else { await ivChip.first().click(); await win.waitForTimeout(400) }
  await shot(win, '02-image-video-mode-selected.png') // 验：选中态 + hint「每镜先出首帧图…」

  // 真 planner 拆镜头
  await win.locator('[data-action-run="storyboard"]').first().click()
  console.log('  ⏳ 等 planner 拆镜头（真 LLM ≤180s）…')
  const confirmBtn = win.getByRole('button', { name: '确认落画布', exact: false })
  try {
    await confirmBtn.first().waitFor({ timeout: 180000 })
  } catch (e) {
    await shot(win, 'twait-diag.png')
    const panelText = await win.locator('[aria-label="创作助手"], [data-panel="creation-ai"]').first().innerText().catch(() => '')
    console.log('  ✗ planner 超时。助手面板现场：\n' + String(panelText).slice(0, 1200))
    throw e
  }
  await win.waitForTimeout(800)
  await shot(win, '03-plan-editor-image-video.png') // 验：镜卡「类型 图片+视频」+ 首帧图提示词框 + 视频提示词标签

  // 编辑器里首帧图框存在性（planner 若没全给 keyframe，把第一镜手动切成图片+视频 = 真用户路径）
  let kfBoxes = await win.locator('textarea[aria-label*="首帧图提示词"]').count()
  console.log(`  首帧图提示词框 ×${kfBoxes}`)
  if (kfBoxes === 0) {
    console.log('  planner 未输出 keyframe → 手动把镜 1 切成图片+视频（编辑器真路径）')
    const typeSel = win.locator('[aria-label*="类型"]').first()
    await typeSel.getByText('图片+视频', { exact: false }).first().click().catch(async () => {
      await win.getByText('图片+视频', { exact: true }).first().click()
    })
    await win.waitForTimeout(500)
    kfBoxes = await win.locator('textarea[aria-label*="首帧图提示词"]').count()
    await shot(win, '03b-manual-switch-image-video.png')
  }
  if (kfBoxes === 0) { console.log('  ✗ 编辑器里出不来首帧图提示词框'); failed = true }

  // 落画布
  await confirmBtn.first().click()
  console.log('  ⏳ 落画布…')
  await win.waitForTimeout(4500)
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(600)
  await shot(win, '04-canvas-landed.png') // 验：首帧图+视频成对 + 占位卡「镜头 N」编号成对

  // 全选 → 所有卡的「镜头 N」角标亮出来（角标只在 hasResult||selected 时显）
  await win.locator('.react-flow, [data-canvas-root], main').first().click({ position: { x: 30, y: 200 } }).catch(() => {})
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a').catch(() => {})
  await win.waitForTimeout(800)
  await shot(win, '05-canvas-all-selected-badges.png')

  // 镜号硬断言（读 DOM = 用户所见，按 data-kind 分类不猜文本）：
  // ① 每张卡内出现的「镜头 N」数字全一致（修前首帧卡标题 N 配角标 N+1 → 必不一致）；
  // ② 视频镜号连续 1..N；③ 首帧图与视频按号成对。
  const audit = await win.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-node-id]'))
    const parsed = cards
      .map((el) => {
        const text = el.textContent || ''
        const nums = Array.from(text.matchAll(/镜头\s*(\d+)/g)).map((m) => Number(m[1]))
        // 首帧卡按标题「镜头 N 首帧」识别（首帧卡外层无 data-kind，别靠它）；视频卡按 data-kind。
        const kfTitle = text.match(/镜头\s*(\d+)\s*首帧/)
        const kind = el.getAttribute('data-kind') || ''
        return { kind, kfNum: kfTitle ? Number(kfTitle[1]) : null, nums, sample: text.slice(0, 30) }
      })
      .filter((c) => c.nums.length > 0)
    const inconsistent = parsed.filter((c) => new Set(c.nums).size > 1)
    const kfNums = parsed.filter((c) => c.kfNum !== null).map((c) => c.kfNum).sort((a, b) => a - b)
    const videoNums = parsed.filter((c) => c.kind === 'video').map((c) => c.nums[0]).sort((a, b) => a - b)
    const contiguous = videoNums.length > 0 && videoNums.every((v, i) => v === i + 1)
    const paired = kfNums.length > 0 && kfNums.every((n) => videoNums.includes(n))
    return { cards: parsed.length, inconsistent, kfNums, videoNums, contiguous, paired }
  })
  console.log('  镜号审计: ' + JSON.stringify(audit))
  // 硬断言两条：① 无任何卡内数字互斥（A2 错位回归信号）；② 视频镜号连续 1..N（首帧图没偷号）。
  // 首帧↔视频「按号配对」在 applyCanvasToolCall 单测里钉死；DOM 层首帧标题可能走 input 不进
  // textContent，故这里只作信息项不作闸（拍特写人眼对）。
  if (audit.inconsistent.length > 0 || !audit.contiguous) { console.log('  ✗ 镜号断言失败'); failed = true }
  else console.log(`  ✓ 卡内编号全一致；视频镜号连续 1..${audit.videoNums.length}${audit.paired ? `；首帧图 ${audit.kfNums.length} 张与视频按号成对` : '（首帧配对看特写截图 + 单测）'}`)

  // 特写：镜 1 的首帧图卡（标题定位）+ 视频卡（data-kind 定位）
  const kf1Card = win.locator('[data-node-id]').filter({ hasText: '镜头 1 首帧' }).first()
  if ((await kf1Card.count()) > 0) await kf1Card.screenshot({ path: path.join(outDir, '06-kf1-card.png') }).catch(() => {})
  const v1Card = win.locator('[data-node-id][data-kind="video"]').filter({ hasText: '镜头 1' }).first()
  if ((await v1Card.count()) > 0) await v1Card.screenshot({ path: path.join(outDir, '07-video1-card.png') }).catch(() => {})
  console.log('  📸 06/07 特写')

  console.log('\n=== 页面错误(' + errors.length + ') ===')
  for (const e of errors.slice(0, 8)) console.log('  ✗ ' + e.slice(0, 200))
} finally {
  await app.close().catch(() => {})
}
if (failed) { console.log('WALKTHROUGH: FAIL'); process.exit(1) }
console.log('WALKTHROUGH: PASS')
