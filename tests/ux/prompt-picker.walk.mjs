// 2026-08-18 提示词选择器的真机走查（R13）。用户原话：「得留自定义的口子，而且得可以被调用，
// 我们现在的找不到调用的地方」。这份要证明的正是「调得起来」：
//   1 选择器在 composer 发送键左边，头部那颗已删（一功能一个家）
//   2 7 个内置提示词**全部**在列 —— 尤其原来 UI 上根本不存在的那 5 个
//   3 选中后 chip 标签跟着变（读起来像选择器，不是静态徽标）
//   4 设置页能新建自定义提示词 → 它出现在选择器的「我的」组里 → 选得中
//   5 选中自定义后，带「镜头」的话不被拆分镜劫走（承接 08-17 的 dedicatedJob）
import { launchNomiApp } from './_launchApp.mjs'
import { expectVisible, expectCount, expectAbsent, proveProbe, scopedText, screenshotSettled } from './_assert.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-prompt-picker-'))
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/prompt-picker')
fs.mkdirSync(shotsDir, { recursive: true })

const projDir = path.join(projectsDir, 'promptpicker-0001')
fs.mkdirSync(path.join(projDir, '.nomi'), { recursive: true })
const project = {
  id: 'promptpicker-0001', name: '提示词选择器走查', version: 2,
  createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projDir,
  payload: {
    workbenchDocument: {
      version: 1, title: '走查', updatedAt: 1,
      // 必须 ≥60 字（STORYBOARD_NUDGE_MIN_CHARS）：⑦ 要验的是「选了自定义提示词后拆分镜卡不浮」，
      // 而正文不够长时这张卡**本来就不可能浮** —— 在那种现场断言「没浮卡」是空洞的通过。
      // 旧版正文只有 43 字，⑦ 报绿但什么都没验到（proveProbe 基线一上就把它照出来了）。
      contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '林薇在雨夜的老码头被人追赶，她穿过一条又一条积水的巷子，霓虹灯牌在水面上碎成一片一片。她知道对方要的是那只旧铁盒，可她还没想明白，铁盒里那张照片究竟意味着什么。' }] }] },
    },
    timeline: null,
    generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
    storyboardPlan: null, storyboardPlanCommitted: false,
  },
}
for (const t of [path.join(projDir, 'project.json'), path.join(projDir, '.nomi', 'project.json')]) {
  fs.writeFileSync(t, JSON.stringify(project, null, 2))
}

const { app, win } = await launchNomiApp({ name: 'prompt-picker', tempRoot, settingsDir, projectsDir, settleMs: 1200 })

const findings = []
const record = (name, ok, detail) => {
  findings.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name} — ${detail}`)
}
const snap = async (n) => { await screenshotSettled(win, { path: path.join(shotsDir, `${n}.png`) }) }
async function closeApp() {
  const child = app.process()
  await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 8000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}

const picker = () => win.locator('[data-creation-prompt-picker="true"]')

try {
  await win.evaluate(() => {
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen')
  })
  await win.reload()
  await win.waitForTimeout(1500)
  for (let i = 0; i < 5; i += 1) {
    await win.keyboard.press('Escape').catch(() => {})
    const s = win.locator('button,[role="button"],a', { hasText: /跳过|完成|知道了|开始创作/ }).first()
    if (await s.isVisible().catch(() => false)) await s.click({ timeout: 1000 }).catch(() => {})
  }
  const card = win.locator('[data-project-card]', { hasText: project.name }).first()
  await expectVisible(card, `项目库里找不到项目卡「${project.name}」`)
  await card.hover()
  const cont = card.getByText('继续创作', { exact: false }).first()
  if (await cont.isVisible().catch(() => false)) await cont.click(); else await card.dblclick()
  // 「项目开好了」的真信号 = 顶部「创作」导航出现，不是等够 1.8 秒。
  const creation = win.getByRole('button', { name: '创作', exact: true })
  await expectVisible(creation, '打开项目后没等到顶部「创作」导航')
  await creation.click()
  await expectVisible(win.getByLabel('创作区', { exact: true }), '点了「创作」但创作区没出现')
  // composer 是创作区里最后挂的一块：等选择器本身出现，别用 sleep 赌它挂好了
  // （赌短了 count 读到 0，而 0 会让①直接判负，看起来像功能坏了）。
  await expectCount(picker(), 1, 'composer 里应当有且只有 1 个提示词选择器（一功能一个家）')
  await snap('01-composer')

  // ⑦ 的基线（proveProbe 形式①：目标本身可证）——必须**趁现在**证，而且只能在这里证：
  // 此刻还停在默认的「通用」档，文稿够长（≥60 字）又没拆过，拆分镜动作卡本就会浮。
  // 一旦下面 ③ 切到「写剧本」（dedicatedJob），modeAllowsIntentRouting 就把这张卡永久关掉了——
  // 那之后再取基线必然取不到，而「取不到基线」和「功能真的坏了」在观测上无法区分。
  const nudgeCard = win.locator('[data-action-card="storyboard"]')
  const nudgeProof = await proveProbe(nudgeCard, '默认「通用」档下确实会浮拆分镜动作卡').catch(() => null)
  record('⑦ 基线：通用档下确实会浮拆分镜卡', nudgeProof !== null,
    nudgeProof !== null ? '通用档下浮出了拆分镜动作卡（说明⑦这条检查测得到东西）'
      : '通用档下也没浮卡 —— ⑦ 的基线不成立，那条「没被劫走」不算数')

  // ① 位置：在 composer（footer）里，不在 header 里。
  const count = await picker().count()
  const inFooter = await picker().first().evaluate((el) => Boolean(el.closest('footer')))
  const inHeader = await picker().first().evaluate((el) => Boolean(el.closest('header')))
  record('① 选择器在 composer、不在头部', count === 1 && inFooter && !inHeader,
    `找到 ${count} 个选择器；在 footer=${inFooter}，在 header=${inHeader}（期望 1 / true / false）`)

  // ② 7 个内置提示词全部在列 —— 这是用户报的「找不到调用的地方」的正面证明。
  await picker().first().click()
  const options = win.locator('[data-prompt-option]')
  // 下拉是点开后异步挂的：等第一条出现再数，别拿 sleep 赌
  // （赌短了读到空数组，7 个内置全部「缺失」，假红）。
  await expectVisible(options.first(), '点开选择器后没渲染出任何提示词条目')
  await snap('02-picker-open')

  const BUILTIN = ['general', 'story', 'script', 'assets', 'storyboard', 'seedance', 'review']
  // 逐个用自动重试断言钉「这一档在列」——比一次性 querySelectorAll 快照稳，
  // 且哪一档缺了，失败信息直接指名道姓。
  const missing = []
  for (const id of BUILTIN) {
    const ok = await expectCount(win.locator(`[data-prompt-option="${id}"]`), 1, `内置提示词「${id}」应当在选择器里`)
      .then(() => true).catch(() => false)
    if (!ok) missing.push(id)
  }
  const shown = await options.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-prompt-option')))
  record('② 7 个内置提示词全部可选', missing.length === 0,
    missing.length === 0 ? `全部在列：${shown.join('、')}` : `仍缺 ${missing.join('、')}（这 5 个正是原来调不起来的）`)

  // ③ 选中「写剧本」→ chip 标签跟着变。
  const before = await scopedText(picker().first())
  await win.locator('[data-prompt-option="script"]').first().click()
  // chip 标签换成「剧本」= 选中真的生效了。等这个信号，不等 800ms。
  await expectVisible(picker().filter({ hasText: '剧本' }), '点了「写剧本」但 chip 标签没跟着变')
    .catch(() => {})
  const after = await scopedText(picker().first())
  await snap('03-picked-script')
  record('③ chip 标签跟当前选择走', before !== after && after.includes('剧本'),
    `点「写剧本」前「${before}」→ 后「${after}」`)

  // ④ 设置页新建自定义提示词 → 回到对话里能选到。
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'ai' } })))
  const heading = win.getByText('系统提示词', { exact: true }).first()
  // 设置面板异步挂载：等标题出现，不拿 sleep 赌（赌短了「新建」读不到，④ 直接假红）。
  await expectVisible(heading, '设置 → AI 里找不到「系统提示词」区').catch(() => {})
  await heading.scrollIntoViewIfNeeded().catch(() => {})
  // Scope the action to the settings prompt section. A generic "新建" query
  // can resolve to the always-mounted creation toolbar behind the modal and
  // make Playwright report a false interaction failure.
  const newChip = win.locator('[data-settings-prompt-create]').first()
  const canCreate = await expectVisible(newChip, '设置页里找不到「新建」自定义提示词的入口')
    .then(() => true).catch(() => false)
  if (canCreate) {
    await newChip.click()
    const nameInput = win.locator('[data-settings-field="system-prompt-name"]').first()
    // 新建后名字输入框出现 = 真的进了「新建一条」的状态。
    await expectVisible(nameInput, '点了「新建」但名字输入框没出现').catch(() => {})
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill('口播带货体')
    }
    const body = win.locator('[data-settings-field="system-prompt"]').first()
    await body.fill('本轮任务：写口播带货脚本。前三秒必须给钩子，中段讲一个具体痛点场景，结尾给促单理由。')
    await win.waitForTimeout(1400)
    await snap('04-settings-created')
  }
  record('④ 设置页能新建自定义提示词', canCreate, canCreate ? '「新建」可点并已填入名字+正文' : '设置页里找不到「新建」')

  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(900)
  await picker().first().click()
  const customOption = win.locator('[data-prompt-option]').filter({ hasText: '口播带货体' })
  // 等它自己出现，不用 sleep 赌下拉挂没挂好。
  const hasCustom = await expectCount(customOption, 1, '新建的「口播带货体」应当出现在选择器的「我的」组里')
    .then(() => true).catch(() => false)
  await snap('05-picker-with-custom')
  const labels = await win.locator('[data-prompt-option]').evaluateAll((nodes) =>
    nodes.map((n) => n.textContent?.trim() || ''))
  record('⑤ 自定义提示词出现在选择器里（能被调用）', hasCustom,
    hasCustom ? '「口播带货体」已出现在「我的」组，可点选' : `没找到；当前条目：${labels.join('、')}`)

  if (hasCustom) {
    await customOption.first().click()
    // chip 换成自定义名 = 选中生效了，这也是⑥要验的那件事本身。
    const chipShowsCustom = await expectVisible(picker().filter({ hasText: '口播带货体' }),
      '点了「口播带货体」但 chip 没显示它').then(() => true).catch(() => false)
    const chip = await scopedText(picker().first())
    await snap('06-custom-selected')
    record('⑥ 选中自定义后 chip 显示它', chipShowsCustom, `chip 现在显示「${chip}」`)

    // ⑦ 选了自定义（dedicatedJob）→ 说带「镜头」的话不该被拆分镜动作卡劫走。
    const input = win.getByLabel(/输入|对话/).first()
    await input.fill('帮我把这段写成一个个画面').catch(async () => {
      await win.locator('textarea').last().fill('帮我把这段写成一个个画面')
    })
    await win.waitForTimeout(600)
    let noHijack = true
    let hijackDetail = '输入含「画面」也没弹拆分镜动作卡'
    try {
      if (!nudgeProof) throw new Error('基线不成立（内置模式下都没浮过卡），这条无从判定')
      await expectAbsent(nudgeCard, { provenBy: nudgeProof, message: '选了自定义提示词后不该再被拆分镜劫走' })
    } catch (error) {
      noHijack = false
      hijackDetail = `冒出了 ${await nudgeCard.count()} 张拆分镜卡：${String(error).split('\n')[0]}`
    }
    await snap('07-no-hijack')
    record('⑦ 自定义提示词不被拆分镜劫走', noHijack, hijackDetail)
  }

  console.log('\n──────── 小结 ────────')
  const failed = findings.filter((f) => !f.ok)
  await closeApp()
  if (failed.length > 0) {
    console.error(`${failed.length} 项未通过：${failed.map((f) => f.name).join('、')}`)
    process.exit(1)
  }
  console.log(`全部 ${findings.length} 项通过。截图在 ${shotsDir}`)
} catch (error) {
  console.error(error)
  await win.screenshot({ path: path.join(shotsDir, 'failure.png') }).catch(() => {})
  console.log(JSON.stringify(findings, null, 2))
  await closeApp()
  process.exit(1)
}
