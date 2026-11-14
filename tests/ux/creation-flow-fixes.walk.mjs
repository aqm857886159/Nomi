import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 2026-08-17 创作链路五修的真机走查（R13：截图 + 人眼判断，不是只跑 expect）。
//
// 覆盖用户实测反馈的五条：
//   A（已退役）分镜方案「全部镜头」批量条——分镜页瘦身（#1505）把批量条连同类型 / 模型 / 时长的整片入口一起删了，没有现役对应物
//   B 素材库「智能分组」tab 已删干净
//   C（已退役）分镜方案卡锚在对话消息上——方案卡与「直达分镜」入口已从对话里移除（805096d41），方案改从左栏「文稿」抽屉进入，没有现役对应物
//   D（已退役）选了「素材规划」专职模式 → 不再被拆分镜劫持——拆分镜浮现卡（StoryboardNudge）在 Agent 宿主迁移时就没人挂了，没有现役对应物
//   E Agent 面板 → 档位弹层 → 系统提示词：全文可见、可改、可恢复默认（不再是 64px 小框）
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectVisible, expectCount, expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'
import { openSystemPromptEditor } from './_systemPromptEditor.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureAgentPanelOpen, leaveProjectIfOpen, switchWorkspace } from './_shell.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = makeTempDir('nomi-creation-flow-')
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const projectId = 'creation-flow-fixes'
const projectRoot = path.join(projectsDir, `creation-flow-${projectId}`)
const shotsDir = path.join(repoRoot, 'tests/ux/shots/creation-flow-fixes')

fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(shotsDir, { recursive: true })

const project = {
  id: projectId,
  name: '创作链路五修走查',
  version: 2,
  createdAt: 1,
  updatedAt: 1,
  savedAt: 1,
  revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocument: {
      version: 1,
      title: '雨夜追逐',
      contentJson: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{
            type: 'text',
            text: '林薇在雨夜的老码头被人追赶，她穿过一条又一条积水的巷子，霓虹灯牌在水面上碎成一片一片。她知道对方要的是那只旧铁盒，可她还没想明白，铁盒里那张照片究竟意味着什么。',
          }],
        }],
      },
      updatedAt: 1,
    },
    timeline: null,
    generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
    storyboardPlan: null,
    storyboardPlanCommitted: false,
  },
}

for (const target of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) {
  fs.writeFileSync(target, JSON.stringify(project, null, 2))
}

const { app, win } = await launchNomiApp({
  name: 'creation-flow-fixes',
  tempRoot,
  settingsDir,
  projectsDir,
  settleMs: 1200,
})

const findings = []
function record(name, ok, detail) {
  findings.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name} — ${detail}`)
}

async function shot(name) {
  await screenshotSettled(win, { path: path.join(shotsDir, `${name}.png`) })
}

async function closeApp() {
  const child = app.process()
  await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 8000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function dismissOnboarding() {
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      localStorage.setItem(key, 'seen')
    }
  })
  await win.reload()
  await win.waitForTimeout(1400)
  for (let i = 0; i < 5; i += 1) {
    await win.keyboard.press('Escape').catch(() => {})
    const skip = win.locator('button,[role="button"],a', { hasText: /跳过|完成|知道了|开始创作/ }).first()
    if (await skip.isVisible().catch(() => false)) await skip.click({ timeout: 1000 }).catch(() => {})
  }
}

async function openProject(name) {
  // 已经在某个项目里 → 先回项目库，再开目标项目。
  if (await leaveProjectIfOpen(win)) await win.waitForTimeout(1400)
  const card = win.locator('[data-project-card]', { hasText: name }).first()
  await expectVisible(card, `项目库里找不到项目卡「${name}」`)
  await card.hover()
  const continueButton = card.getByText('继续创作', { exact: false }).first()
  if (await continueButton.isVisible().catch(() => false)) await continueButton.click()
  else await card.dblclick()
  // 「项目开好了」的真信号 = 顶部导航出现，不是等够 1.8 秒。
  await switchWorkspace(win, 'creation', `进「${name}」的创作页`)
  await expectVisible(win.getByLabel('创作区', { exact: true }), '点了「创作」但创作区没出现')
}

// ───────────────────────── B 智能分组已删 ─────────────────────────
async function verifySmartGroupGone() {
  // 智能分组过去住在生成区的素材库面板里 —— 得真的走到那个面才算查过。
  const generation = win.getByRole('button', { name: '生成', exact: true })
  if (await generation.isVisible().catch(() => false)) await generation.click()
  // 生成区是懒挂载的：等素材库入口自己出现，不拿 sleep 赌它已经挂好
  // （赌短了 isVisible() 读到 false，就会**跳过点开素材库**，然后在一片没渲染的地方「没搜到智能分组」= 假绿）。
  const assetEntry = win.getByRole('button', { name: /素材库|素材/ }).first()
  await expectVisible(assetEntry, '切到生成区后没等到素材库入口').catch(() => {})
  if (await assetEntry.isVisible().catch(() => false)) await assetEntry.click().catch(() => {})

  // 智能分组曾是素材库来源 tab 里的一个，所以把探针限定在那条 tablist 上，
  // 而不是全页搜文本（全页搜会把别处偶然同名的字样也算进来）。
  const sourceTabs = win.getByRole('tablist', { name: '素材来源筛选' }).first()
  const smartGroup = sourceTabs.getByText('智能分组', { exact: false })

  // 基线（proveProbe 形式②：目标已被彻底删除、无从证明）——这个功能已经从源码里删干净了，
  // 没有任何现场能让它出现。于是改证「同一套探针在这一屏是活的」：
  // 用同一条 tablist 里必然存在的兄弟 tab「全部素材」。这排除的正是
  // 「素材库压根没渲染出来 / 选择器写错了」这种让「没看到」恒真的情形。
  let ok = true
  let detail = '走到生成区素材库，来源 tab 里搜不到「智能分组」入口'
  try {
    const proof = await proveProbe(
      sourceTabs.getByText('全部素材', { exact: false }),
      '素材库来源 tab 里找得到对照物「全部素材」（证明探针在这一屏是活的）',
    )
    await expectAbsent(smartGroup, { provenBy: proof, message: '素材库来源 tab 里不该还有「智能分组」' })
  } catch (error) {
    ok = false
    detail = String(error).split('\n')[0]
  }
  await shot('B-asset-library-no-smart-group')
  record('B 智能分组已删干净', ok, detail)
}

// ───────────────────────── E 系统提示词在 Agent 面板里能编辑 ─────────────────────────
async function verifySystemPromptSettings() {
  // 2026-09-14 搬家：编辑器从设置 → AI 策略搬到 Agent 面板的档位弹层底部，走真人路径打开。
  try {
    // 前一步 B 停在生成区，常驻 Agent 面板在那里收成小球——先叫出来，再点档位钮。
    await ensureAgentPanelOpen(win)
    await openSystemPromptEditor(win)
  } catch (error) {
    await shot('E-settings-missing')
    record('E 系统提示词可达', false, `Agent 面板档位弹层里打不开「编辑系统提示词」：${String(error).split('\n')[0]}`)
    return
  }
  await win.waitForTimeout(500)
  await shot('E-settings-system-prompt')
  record('E 系统提示词可达', true, 'Agent 面板 → 档位弹层 → 「编辑系统提示词」打开了编辑器')

  // 量这一节自己的编辑框，不是页面上第一个 textarea。
  const box = win.locator('[data-settings-field="system-prompt"]').first()
  const scoped = await box.isVisible().catch(() => false)
  const height = (await box.boundingBox().catch(() => null))?.height ?? 0
  // 原来那个只读框是 max-h-16 = 64px。要明显比它大，才算真解决「局限在很小的框里」。
  const roomy = height >= 120
  record('E 提示词框够大', roomy && scoped,
    `提示词编辑框高 ${Math.round(height)}px（原来的只读小框 64px）${scoped ? '' : ' · 找不到 data-settings-field="system-prompt"'}`)

  // 默认选中的是「通用」，它的提示词本来就只有 ~48 字 —— 拿它验「不截断」等于没验。
  // 换成「素材」：那份是用户 2026-08-12 提供的全资产大师规范，上万字，旧小框硬截在 360 字。
  // 限定在编辑器弹窗里找：页面左栏也有一个叫「素材」的按钮，排在弹窗前面，不限定会点到它。
  await win.locator('[data-system-prompt-editor]').getByRole('button', { name: '素材', exact: true }).first().click().catch(() => {})
  // 切档后编辑框内容是异步换的：轮询等它换成长文，别拿固定 sleep 赌（切太慢会读到「通用」那 48 字，假红）。
  await expect
    .poll(async () => ((await box.inputValue().catch(() => '')) || '').length, {
      message: '切到「素材」档后，编辑框应当载入那份长提示词',
      timeout: 8000,
    })
    .toBeGreaterThan(360)
    .catch(() => {})
  const full = ((await box.inputValue().catch(() => '')) || '').length
  record('E 提示词不截断', full > 360,
    `素材规划的提示词在编辑框里有 ${full} 字，完整可读（旧的只读小框硬截断在 360 字）`)
  await shot('E-settings-system-prompt-assets')

  // 「可改 + 可恢复」是这次拍板的核心诉求，光有个大框不算数。
  const reset = win.locator('[data-settings-prompt-reset]').first()
  const resetFallback = win.getByRole('button', { name: '恢复默认' }).first()
  const resetBtn = (await reset.isVisible().catch(() => false)) ? reset : resetFallback
  const disabledBefore = await resetBtn.isDisabled().catch(() => null)
  record('E 未改动时「恢复默认」置灰', disabledBefore === true,
    disabledBefore === true ? '没有覆盖时按钮是 disabled（§1.6 C1 可点即有效）' : `按钮 disabled=${disabledBefore}`)

  await box.click()
  await box.press('End')
  await box.type('\n【走查追加的一行】')
  // 「已自定义」徽标是 debounce 落盘后才出现的：等徽标本身，不猜落盘要多久。
  // 用 toHaveCount(1) 而不是 toBeVisible()：这一节的 footer 常被滚出设置面板的可视区，
  // 「渲染了但被裁掉」不等于「没渲染」——我们要验的是前者（第一版用 isVisible 在这误报过）。
  const badge = win.locator('[data-settings-prompt-customized]')
  const badgeShown = await expectCount(badge, 1, '改了提示词后应当出现「已自定义」徽标', 8000)
    .then(() => true).catch(() => false)
  const enabledAfter = await expect(resetBtn, '改了提示词后「恢复默认」应可点').toBeEnabled({ timeout: 8000 })
    .then(() => true).catch(() => false)
  const disabledAfter = await resetBtn.isDisabled().catch(() => null)
  await shot('E-settings-prompt-customized')
  record('E 改完标「已自定义」且可恢复', badgeShown && enabledAfter,
    `已自定义徽标 ${badgeShown ? '出现' : '没出现'}，恢复默认按钮 disabled=${disabledAfter}`)

  await resetBtn.click().catch(() => {})
  // 恢复默认是把内容写回内置默认：等「已自定义」徽标从 DOM 里摘掉 = 覆盖真的被清掉了。
  await expectCount(badge, 0, '点了「恢复默认」后，「已自定义」徽标应当消失', 8000).catch(() => {})
  const restored = ((await box.inputValue().catch(() => '')) || '').length
  await shot('E-settings-prompt-reset')
  record('E 恢复默认真的还原', restored === full,
    restored === full ? `恢复后字数回到 ${restored}，与内置默认一致` : `恢复后 ${restored} 字，期望 ${full} 字`)
}

try {
  await dismissOnboarding()
  await openProject(project.name)
  await shot('00-creation-workspace')

  await verifySmartGroupGone()
  await verifySystemPromptSettings()

  console.log('\n──────── 走查小结 ────────')
  console.log(JSON.stringify(findings, null, 2))
  const failed = findings.filter((f) => !f.ok)
  await closeApp()
  if (failed.length > 0) {
    console.error(`\n${failed.length} 项未通过：${failed.map((f) => f.name).join('、')}`)
    process.exit(1)
  }
  console.log(`\n全部 ${findings.length} 项通过。截图在 ${shotsDir}`)
} catch (error) {
  console.error(error)
  await win.screenshot({ path: path.join(shotsDir, 'failure.png') }).catch(() => {})
  console.log(JSON.stringify(findings, null, 2))
  await closeApp()
  process.exit(1)
}
