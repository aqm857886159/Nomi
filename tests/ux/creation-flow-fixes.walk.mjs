// 2026-08-17 创作链路五修的真机走查（R13：截图 + 人眼判断，不是只跑 expect）。
//
// 覆盖用户实测反馈的五条：
//   A 分镜方案「全部镜头」批量条 —— 一次把 12 个图片镜改成视频镜（原来要逐镜改十几次）
//   B 素材库「智能分组」tab 已删干净
//   C 分镜方案卡锚在产出它的那条消息上，不再跟着对话跑到最底下
//   D 选了「素材规划」专职模式 → 不再被拆分镜劫持（浮现卡也不冒出来）
//   E 设置 → AI → 系统提示词：全文可见、可改、可恢复默认（不再是 64px 小框）
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectVisible, expectCount, expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-creation-flow-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const projectId = 'creation-flow-fixes'
const projectRoot = path.join(projectsDir, `creation-flow-${projectId}`)
const shotsDir = path.join(repoRoot, 'tests/ux/shots/creation-flow-fixes')

fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(shotsDir, { recursive: true })

const SHOT_COUNT = 12
// 复刻用户遇到的现场：拆出来一整套**图片**镜（shotKind='image'），这正是要逐镜改十几次的那个状态。
const shots = Array.from({ length: SHOT_COUNT }, (_, index) => ({
  index: index + 1,
  shotKind: 'image',
  durationSec: 0,
  anchorIds: ['anchor-lin'],
  prompt: `第 ${index + 1} 镜：雨夜追逐，霓虹在积水里碎开。`,
}))

const storyboardPlan = {
  title: '雨夜追逐',
  anchors: [{
    id: 'anchor-lin',
    kind: 'character',
    name: '林薇',
    description: '短发女性，黑色风衣，雨夜',
    carrier: 'visual',
    scope: 'selective',
  }],
  shots,
}

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
            // 够长（≥60 字）才会触发 StoryboardNudge 的浮现条件——D 要验的正是「够长但也不该浮」。
            text: '林薇在雨夜的老码头被人追赶，她穿过一条又一条积水的巷子，霓虹灯牌在水面上碎成一片一片。她知道对方要的是那只旧铁盒，可她还没想明白，铁盒里那张照片究竟意味着什么。',
          }],
        }],
      },
      updatedAt: 1,
    },
    timeline: null,
    generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
    storyboardPlan,
    storyboardPlanCommitted: false,
  },
}

for (const target of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) {
  fs.writeFileSync(target, JSON.stringify(project, null, 2))
}

// C 要验「卡片锚在产出它的那条消息上」：得有一条带 storyboardPlan 标的助手消息，
// 后面还跟着更晚的对话——卡片必须留在中间那条下面，而不是被顶到列表最底下。
const conversations = {
  v: 2,
  creation: {
    activeId: 'thread-1',
    threads: [{
      id: 'thread-1',
      title: '雨夜追逐',
      createdAt: 1,
      updatedAt: 5,
      messages: [
        { id: 'u1', role: 'user', content: '把这个故事拆成镜头' },
        { id: 'a1', role: 'assistant', content: '已经拆成 12 个镜头。', storyboardPlan: true },
        { id: 'u2', role: 'user', content: '这条是拆完之后我又说的话' },
        { id: 'a2', role: 'assistant', content: '收到，这条在方案卡后面。' },
      ],
    }],
  },
  generation: { activeId: null, threads: [] },
}
fs.writeFileSync(path.join(projectRoot, '.nomi', 'conversations.json'), JSON.stringify(conversations, null, 2))

// D 要验的是「还没拆过、故事够长」时的浮现卡：这个状态下卡片本该出现（通用模式），
// 而选了专职模式就该消失。项目 1 已经有方案了（storyboardPlan≠null → 卡片天然不显示），
// 在那里测等于什么都没测——所以另起一个干净项目。
const nudgeProjectId = 'creation-flow-nudge'
const nudgeProjectRoot = path.join(projectsDir, `creation-flow-${nudgeProjectId}`)
fs.mkdirSync(path.join(nudgeProjectRoot, '.nomi'), { recursive: true })
const nudgeProject = {
  ...project,
  id: nudgeProjectId,
  name: '专职模式不被劫持',
  lastKnownRootPath: nudgeProjectRoot,
  payload: { ...project.payload, storyboardPlan: null, storyboardPlanCommitted: false },
}
for (const target of [path.join(nudgeProjectRoot, 'project.json'), path.join(nudgeProjectRoot, '.nomi', 'project.json')]) {
  fs.writeFileSync(target, JSON.stringify(nudgeProject, null, 2))
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
  const backToLibrary = win.getByRole('button', { name: '项目库', exact: false }).first()
  if (await backToLibrary.isVisible().catch(() => false)) {
    await backToLibrary.click().catch(() => {})
    await win.waitForTimeout(1400)
  }
  const card = win.locator('[data-project-card]', { hasText: name }).first()
  await expectVisible(card, `项目库里找不到项目卡「${name}」`)
  await card.hover()
  const continueButton = card.getByText('继续创作', { exact: false }).first()
  if (await continueButton.isVisible().catch(() => false)) await continueButton.click()
  else await card.dblclick()
  // 「项目开好了」的真信号 = 顶部导航出现，不是等够 1.8 秒。
  const creationButton = win.getByRole('button', { name: '创作', exact: true })
  await expectVisible(creationButton, `打开项目「${name}」后没等到顶部「创作」导航`)
  await creationButton.click()
  await expectVisible(win.getByLabel('创作区', { exact: true }), '点了「创作」但创作区没出现')
}

// ───────────────────────── C 分镜卡锚定 ─────────────────────────
async function verifyPlanCardAnchored() {
  const card = win.locator('[data-storyboard-card]').first()
  await expectVisible(card, '对话里没渲染出分镜方案卡')
  const laterMessage = win.getByText('这条是拆完之后我又说的话').first()
  // 两个都得先在场才量得准，否则量到的是 null 边界框（第一版靠 sleep 赌它们都在）。
  await expectVisible(laterMessage, '找不到方案卡之后那条后续消息')
  const [cardBox, laterBox] = await Promise.all([card.boundingBox(), laterMessage.boundingBox()])
  await shot('C-plan-card-anchored')
  if (!cardBox || !laterBox) {
    record('C 分镜卡锚定', false, '拿不到方案卡或后续消息的边界框')
    return
  }
  // 锚定成立 = 卡片在「拆完那条」之后、但在「我又说的话」**之前**。
  const anchored = cardBox.y + cardBox.height <= laterBox.y + 4
  record('C 分镜卡锚定', anchored,
    anchored ? `卡片(y=${Math.round(cardBox.y)}) 留在后续消息(y=${Math.round(laterBox.y)}) 之前，没跟着对话跑`
      : `卡片(y=${Math.round(cardBox.y)}) 跑到了后续消息(y=${Math.round(laterBox.y)}) 下面 —— 仍在跟随对话`)
}

// ───────────────────────── A 批量条 ─────────────────────────
async function verifyBulkBar() {
  await win.locator('[data-storyboard-card]').first().getByRole('button', { name: /打开编辑器|编辑|继续编辑|再改改/ }).first()
    .click({ timeout: 5000 }).catch(async () => {
      await win.getByText('打开编辑器', { exact: false }).first().click({ timeout: 5000 })
    })

  const scope = win.getByText('全部镜头', { exact: true }).first()
  try {
    // 编辑器是点开后异步挂载的：一次性 isVisible() 会在挂载完成前取样。
    await expectVisible(scope, '编辑器里找不到「全部镜头」批量条')
  } catch (error) {
    await shot('A-bulk-bar-before')
    record('A 批量条存在', false, `编辑器里找不到「全部镜头」批量条：${String(error).split('\n')[0]}`)
    return
  }
  await shot('A-bulk-bar-before')
  record('A 批量条存在', true, '「全部镜头」批量条常驻在编辑器里，带作用域组名')

  const typeSelect = win.getByLabel('全部镜头的类型').first()
  // 只读镜卡自己的「镜头类型」选择器，不读全页文本 —— 全页文本会把批量条、
  // 我自己 seed 的对话文案一起算进去，数字对不上真实镜卡状态。
  const shotTypeSelects = win.getByLabel('镜头类型')
  const videoShots = shotTypeSelects.filter({ hasText: '视频' })
  const before = await videoShots.count()
  await typeSelect.selectOption({ label: '视频' }).catch(async () => {
    await typeSelect.click()
    await win.getByRole('option', { name: '视频' }).first().click()
  })

  // 全部改成视频后：每张镜卡都该出现「时长」选择器（图片镜没有时长）。
  // 用重试断言等这个结果，不用 sleep —— 12 张卡重渲染的耗时不是常数。
  let flipped = true
  let flipDetail = ''
  try {
    await expectCount(win.getByLabel(/^时长$/), SHOT_COUNT, `期望 ${SHOT_COUNT} 张镜卡都出现时长选择器（=全变视频镜）`)
    await expectCount(videoShots, SHOT_COUNT, `期望 ${SHOT_COUNT} 张镜卡的类型选择器都显示「视频」`)
  } catch (error) {
    flipped = false
    flipDetail = String(error).split('\n')[0]
  }
  await shot('A-bulk-bar-after-video')
  const after = await videoShots.count()
  const durationCount = await win.getByLabel(/^时长$/).count()
  record('A 一次改全部镜头', flipped,
    flipped ? `一次操作后 ${durationCount} 张镜卡都出现时长选择器（=全变视频镜），显示「视频」的镜卡 ${before}→${after}`
      : `只有 ${durationCount} 张镜卡变成视频镜，期望 ${SHOT_COUNT}：${flipDetail}`)
}

// ───────────────────────── D 素材规划不被劫持 ─────────────────────────
async function verifyAssetsModeNotHijacked() {
  await win.keyboard.press('Escape').catch(() => {})
  await openProject(nudgeProject.name)

  // 精确锚点：只数浮现的拆镜头动作卡本身，不数页面上出现的「拆成镜头」字样
  // （第一版就是被我自己 seed 的那句用户消息骗了，误报成产品 bug）。
  const nudgeCard = win.locator('[data-action-card="storyboard"]')

  // 基线（proveProbe 形式①：目标本身可证）——先在**它该出现**的现场证明一次。
  // 不先证明测得到，「没看到卡」和「探针根本没生效」在观测上完全一样。
  let proof = null
  let baselineCount = 0
  try {
    proof = await proveProbe(nudgeCard, '通用模式下确实会浮拆镜头卡')
    baselineCount = await nudgeCard.count()
  } catch (error) {
    await shot('D-baseline-general-mode')
    record('D 基线：通用模式确实会浮拆镜头卡', false,
      `通用模式下也没浮卡 —— 基线不成立，下面那条通过不算数：${String(error).split('\n')[0]}`)
    record('D 素材规划下不推拆分镜', false, '基线不成立，这条无从判定（不给假绿）')
    return
  }
  await shot('D-baseline-general-mode')
  record('D 基线：通用模式确实会浮拆镜头卡', true,
    `通用模式下浮现了 ${baselineCount} 张拆镜头卡（说明这条检查测得到东西）`)

  // 用选择器自己的锚点，别靠 hasText 模糊猜 —— 猜偏了会静默点空（click 外面还包着 catch），
  // 于是「模式压根没切」被当成「切了但卡还在」，两种结果在旧写法里长得一模一样。
  const chip = win.locator('[data-creation-prompt-picker="true"]').first()
  const assetsEntry = win.locator('[data-prompt-option="assets"]').first()

  let gone = true
  let goneDetail = '选中素材规划后浮现卡消失，没有抢用户已经指好的路'
  try {
    await expectVisible(chip, '创作 composer 里找不到提示词选择器')
    await chip.click()
    await expectVisible(assetsEntry, '选择器里找不到「素材规划」这一档')
    await assetsEntry.click()
    // 切档的真信号 = chip 标签跟着变，不是等够 600ms。
    // chip 上显示的是短名「素材」（creationAi.modes.assets.short），不是选项行里的全名「素材规划」。
    // 这一步必须硬验：切档失败和「切了但卡还在」在旧写法里长得一模一样，
    // 一旦分不清，这条检查就退化成「在通用模式下问有没有卡」——必假红或必假绿。
    await expectVisible(chip.filter({ hasText: '素材' }), '点了「素材规划」但 chip 标签没跟着变（模式其实没切过去）')
    await expectAbsent(nudgeCard, { provenBy: proof, message: '选了素材规划专职模式后不该再浮拆镜头卡' })
  } catch (error) {
    gone = false
    goneDetail = `仍有 ${await nudgeCard.count()} 张拆镜头卡冒出来：${String(error).split('\n')[0]}`
  }
  await shot('D-assets-mode-selected')
  record('D 素材规划下不推拆分镜', gone, goneDetail)
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

// ───────────────────────── E 系统提示词进设置 ─────────────────────────
async function verifySystemPromptSettings() {
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'ai' } })))
  const heading = win.getByText('系统提示词', { exact: true }).first()
  // 设置面板是异步挂载的：用重试断言等它出现，别拿 sleep 赌它挂好了。
  try {
    await expectVisible(heading, '设置 → AI 里找不到「系统提示词」区')
  } catch (error) {
    await shot('E-settings-missing')
    record('E 系统提示词进设置', false, `设置 → AI 里找不到「系统提示词」区：${String(error).split('\n')[0]}`)
    return
  }
  // 这一节在 AI 策略页的折叠线以下——先滚到它，否则量到的是别的控件（第一版就栽在这）。
  await heading.scrollIntoViewIfNeeded()
  await win.waitForTimeout(500)
  await shot('E-settings-system-prompt')
  record('E 系统提示词进设置', true, '设置 → AI 里有「系统提示词」区')

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
  await win.getByRole('button', { name: '素材', exact: true }).first().click().catch(() => {})
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

  await verifyPlanCardAnchored()
  await verifyBulkBar()
  await verifySmartGroupGone()
  await verifySystemPromptSettings()
  await verifyAssetsModeNotHijacked()

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
