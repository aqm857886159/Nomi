// 「被收窄模式指路提示」R13 真机走查（2026-09-03）。
//
// 走查对象：生成画布上，某模型在这家供应商被藏掉了某个模式时，节点参考区多出的那一行指路提示
// —— `Runway Dev 上没有「首尾帧」—— KIE.AI 上有  [换到 KIE.AI]`，点按钮直接把该节点换到那家。
//
// ⚠️ 「可 Cmd+Z 撤销」这条**实测不成立**：换模型本来就不进撤销栈（手动换也一样撤不回），
//    详见下面 ④ 的对照实验记录。本走查如实记录，不假装通过。
//
// 真 Electron + 真构建产物 + 真实 model-catalog（隔离拷贝），全程不发任何生成请求（零额度）。
//
// 为什么样本是 runway/seedance2 而不是 runway/veo3.1：
//   两者都是货真价实的收窄命中（seedance2 藏「首尾帧」→ KIE.AI；veo3.1 藏「参考图」→ APIMart）。
//   但 **runway/veo3.1 一选中就会把「节点生成面板」整块打崩**（React #185 Maximum update depth
//   exceeded），面板换成错误边界，参数面板根本渲染不出来——这个崩溃在**本功能的代码被 stash 掉、
//   仅 origin 基线重新 build 后照样复现**，是先于本功能存在的独立 bug（详见交付报告）。
//   为了不让「指路提示到底对不对」被一个无关崩溃挡住视线，主用例改用同样真实、但面板不崩的
//   runway/seedance2。veo3.1 那条崩溃本走查最后单独钉一条断言，防止它被悄悄忘掉。
//
// 用法：pnpm run build && node tests/ux/narrowed-mode-guidance.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { prepareIsolation } from '../../evals/lib/isoApp.mjs'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectVisible, expectAbsent, proveProbe, screenshotSettled, waitForVisualQuiescence } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/narrowed-mode-guidance')
mkdirSync(shotsDir, { recursive: true })

// 隔离区拷入真实 catalog：runway / kie / apimart 的那些行只存在于真 catalog 里，
// 内置种子目录凑不出任何一个收窄命中。projects/settings/chromium/capability 全部隔离，不碰用户资料库。
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nomi-narrowed-mode-guidance-'))
const iso = prepareIsolation(path.join(tempRoot, 'iso'), { requireCatalog: true })

const { app, win: initialWin } = await launchNomiApp({
  name: 'narrowed-mode-guidance',
  userDataDir: iso.chromiumDir,
  settingsDir: iso.settingsDir,
  projectsDir: iso.projectsDir,
  capabilityDir: iso.capabilityDir,
  syntheticCredentialStorage: true,
  args: ['--no-proxy-server'],
  settleMs: 0,
})

let passed = 0
function assert(condition, label, detail = '') {
  if (!condition) throw new Error(`WALK FAIL: ${label}${detail ? ` — ${detail}` : ''}`)
  passed += 1
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
}

let win = initialWin
const getWin = () => {
  const live = app.windows().filter((candidate) => !candidate.isClosed())
  win = live.find((candidate) => /projectId=/.test(candidate.url())) || live[live.length - 1] || win
  return win
}

const consoleErrors = []
function watchErrors() {
  getWin().on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 400))
  })
}

async function dismissFirstRun() {
  for (let index = 0; index < 6; index += 1) {
    const action = getWin()
      .locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后/ })
      .first()
    if (await action.isVisible().catch(() => false)) await action.click({ timeout: 900 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(180)
  }
}

async function resize(width, height) {
  const browserWindow = await app.browserWindow(getWin())
  await browserWindow.evaluate(
    (target, size) => {
      target.setBounds({ x: 0, y: 0, width: size.width, height: size.height })
      target.center()
    },
    { width, height },
  )
  await getWin().waitForTimeout(320)
}

const guidance = () => getWin().locator('[data-testid="narrowed-mode-guidance"]').first()
const composerCard = () => getWin().locator('.generation-canvas-v2-node__composer-card').first()
/** 面板崩了会被这个错误边界接住；它出现 = 参数面板整块没了。 */
const panelBoundary = () => getWin().locator('text=节点生成面板加载失败').first()

/**
 * 关掉「生成参数」浮层。它是 fixed 定位的 role=group，开着时会挡住左侧工具栏的建节点按钮
 * （Playwright 报 "…subtree intercepts pointer events"）——每次建新节点前必须先关。
 */
async function closeParameterPanel() {
  const panel = getWin().locator('[role="group"][aria-label="生成参数面板"]').first()
  for (let index = 0; index < 4 && (await panel.count()) > 0; index += 1) {
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(300)
  }
}

/** 新建一个视频节点并选中指定模型（选完 composer 会收起，重新点节点叫回来）。 */
async function newVideoNodeWithModel(optionLabel) {
  await closeParameterPanel()
  const existingNodeIds = await getWin().locator('.react-flow__node[data-id]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-id')).filter(Boolean),
  )
  await getWin().locator('.generation-canvas-v2-toolbar [data-node-kind="video"]').click()
  await getWin().waitForTimeout(800)
  await getWin().waitForFunction(
    (knownIds) => [...document.querySelectorAll('.react-flow__node[data-id]')]
      .some((node) => !knownIds.includes(node.getAttribute('data-id'))),
    existingNodeIds,
    { timeout: 6000 },
  )
  const newNodeId = await getWin().locator('.react-flow__node[data-id]').evaluateAll((nodes, knownIds) =>
    nodes.map((node) => node.getAttribute('data-id')).find((id) => id && !knownIds.includes(id)) || null,
    existingNodeIds,
  )
  assert(Boolean(newNodeId), `新建视频节点「${optionLabel}」后能定位新增节点`, String(newNodeId))
  const node = getWin().locator(`.react-flow__node[data-id="${newNodeId}"]`).first()
  await node.getByRole('button', { name: '模型', exact: true }).first().click()
  await getWin().waitForTimeout(500)
  const option = getWin()
    .getByRole('option')
    .filter({ hasText: new RegExp(`^${optionLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })
    .first()
  assert((await option.count()) > 0, `模型下拉里找得到「${optionLabel}」`)
  await option.click()
  await getWin().waitForTimeout(1200)
}

// 注：指路提示住在节点卡片的**参考素材区**（探针实测 note.parentElement 的 aria-label = 「参考素材」），
// 它**不在**「生成参数」浮层里。所以本走查不需要打开那个浮层；而且打开它反而有害——
// 浮层是 fixed 定位、盖在节点卡片上，正好压住这一行（见下面 ③ 记录的遮挡实测）。

/**
 * 模式栏上现在有哪几个模式（用于证明「换一家后被藏的模式真的出现了」）。
 * 真实锚点是 ModeBar.tsx 的 `role="group" aria-label="生成方式"`——探针实测过，
 * 它没有 data-testid，模式项是普通 button（带 aria-pressed），不是 radio。
 */
async function modeTerms() {
  return getWin().evaluate(() => {
    const bar = document.querySelector('[role="group"][aria-label="生成方式"]')
    if (!bar) return null
    return [...bar.querySelectorAll('button')].map((el) => el.textContent?.trim()).filter(Boolean)
  })
}

/**
 * 等「壳已经挂起来了」——用真实信号（项目库入口或工作台外壳出现）代替长 sleep。
 * 长 sleep 的问题不是慢，是**耗时会变**：机器一忙就读到空 DOM，于是断言在空页面上假绿。
 */
async function waitForShell() {
  await getWin().waitForLoadState('domcontentloaded')
  await getWin()
    .locator('button, [role="button"]')
    .filter({ hasText: /新建空白项目|项目库|生成|创作/ })
    .first()
    .waitFor({ timeout: 30_000 })
}

try {
  await waitForShell()
  await getWin().evaluate(() => {
    localStorage.setItem('__nomiE2E', '1')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      localStorage.setItem(key, 'seen')
    }
  })
  await getWin().reload()
  await waitForShell()
  await dismissFirstRun()

  // 只写占位 key + 打开 vendor 开关：选项管道按 vendor.enabled && hasApiKey 双闸
  // （src/config/modelCatalogCache.ts getEnabledVendorKeys），只写 key 模型不会出现在下拉里。
  // 假 key 足够——本走查全程不点生成，不会有任何请求出站。
  const seeded = await getWin().evaluate(async () => {
    const catalog = window.nomiDesktop?.modelCatalog
    const out = []
    for (const vendorKey of ['runway', 'kie', 'apimart']) {
      const status = await catalog?.upsertVendorApiKey(vendorKey, { apiKey: 'nomi-walk-placeholder', enabled: true })
      await catalog?.upsertVendor({ key: vendorKey, enabled: true })
      out.push({ vendorKey, hasApiKey: Boolean(status?.hasApiKey) })
    }
    return out
  })
  assert(seeded.every((row) => row.hasApiKey), '隔离目录已接入 Runway / KIE / APIMart 三家（占位 key，不发请求）', JSON.stringify(seeded))
  await getWin().reload()
  await waitForShell()
  await dismissFirstRun()

  const blankProject = getWin().locator('button, [role="button"]', { hasText: '新建空白项目' }).first()
  await blankProject.waitFor({ timeout: 8000 })
  await blankProject.click()
  // 等真实信号：项目建好会切到工作台（URL 带 projectId）并出现「生成」tab，不靠 sleep 猜。
  await getWin().waitForFunction(() => /projectId=/.test(window.location.href), null, { timeout: 30_000 })
  await getWin().getByRole('button', { name: '生成', exact: true }).first().waitFor({ timeout: 30_000 })
  await dismissFirstRun()
  await resize(1600, 1000)
  watchErrors()

  const generation = getWin().getByRole('button', { name: '生成', exact: true }).first()
  await generation.waitFor({ timeout: 8000 })
  await generation.click()
  await getWin().locator('.generation-canvas-v2-toolbar').waitFor({ timeout: 8000 })
  await expectVisible(getWin().locator('.react-flow').first(), '生成画布已挂载')

  // ① 阴性对照：先选一个**没有任何模式被藏**的模型，证明这时提示不该出现。
  //    （直接对没提示的状态断言「不存在」= 首次采样即过的假绿，所以先在 ② 拿到阳性基线再回头断言。）
  await newVideoNodeWithModel('Gemini Omni 1.1 FlashKie')
  const cleanModelGuidanceCount = await guidance().count()

  // ② 主用例（样张 B）：Runway 的 Seedance 2 —— 「首尾帧」在 Runway 这条线上发不出，KIE.AI 能做。
  await getWin().keyboard.press('Escape')
  await newVideoNodeWithModel('DRunway Seedance 2Runway Dev')
  assert((await panelBoundary().count()) === 0, 'Runway Seedance 2 的参数面板正常渲染（没落进错误边界）')
  const proof = await proveProbe(guidance(), '被收窄模型上指路提示会出现')
  await expectVisible(guidance(), '被收窄的模式给出了指路提示')
  const guidanceText = (await guidance().textContent())?.trim()
  assert(/Runway/.test(guidanceText || ''), '提示里点名了当前这家（Runway）', guidanceText)
  assert(/首尾帧/.test(guidanceText || ''), '提示里点名了被藏掉的那个模式（首尾帧）', guidanceText)
  assert(/KIE/i.test(guidanceText || ''), '提示里点名了能做的那家（KIE.AI）', guidanceText)
  const switchButton = guidance().getByRole('button').first()
  await expectVisible(switchButton, '提示带一个「换到 X」的行内按钮')
  const switchLabel = (await switchButton.textContent())?.trim()
  assert(/换到/.test(switchLabel || ''), '按钮文案是「换到 …」', switchLabel)
  const firstNodeId = await guidance().evaluate((note) => note.closest('.react-flow__node')?.getAttribute('data-id') || null)
  assert(Boolean(firstNodeId), '提示属于一个可定位的生成节点', String(firstNodeId))
  const dismissButton = guidance().getByRole('button', { name: '关闭模式提示', exact: true })
  await expectVisible(dismissButton, '提示带有低调的关闭按钮，并提供 aria-label')
  await dismissButton.click()
  await expectAbsent(guidance(), { provenBy: proof, message: '关闭后当前节点不再显示指路提示' })
  const projectId = await getWin().evaluate(() => {
    const match = /[?&#]projectId=([^&#]+)/.exec(window.location.href)
    return match ? decodeURIComponent(match[1]) : ''
  })
  assert(Boolean(projectId), '当前工作台 URL 带有可读的项目 ID', projectId)
  const readPersistedDismissal = (projectIdValue, nodeIdValue) => getWin().evaluate(async ({ projectIdValue: projectId, nodeIdValue: nodeId }) => {
    const projects = window.nomiDesktop?.projects
    if (!projects || !projectId || !nodeId) return false
    const record = projects.readAsync ? await projects.readAsync(projectId) : projects.read(projectId)
    const nodes = record?.payload?.generationCanvas?.nodes
    return Array.isArray(nodes) && nodes.some((node) => node?.id === nodeId && node?.meta?.narrowedModeGuidanceDismissed === true)
  }, { projectIdValue, nodeIdValue })
  await getWin().waitForFunction(async ({ projectId: id, nodeId }) => {
    const projects = window.nomiDesktop?.projects
    if (!projects || !id || !nodeId) return false
    const record = projects.readAsync ? await projects.readAsync(id) : projects.read(id)
    const nodes = record?.payload?.generationCanvas?.nodes
    return Array.isArray(nodes) && nodes.some((node) => node?.id === nodeId && node?.meta?.narrowedModeGuidanceDismissed === true)
  }, { projectId, nodeId: firstNodeId }, { timeout: 10_000 })
  const persistedDismissal = await readPersistedDismissal(projectId, firstNodeId)
  assert(persistedDismissal, '关闭标记已落到当前项目的节点快照', String(persistedDismissal))
  await screenshotSettled(getWin(), { path: path.join(shotsDir, '02-dismissed-on-first-node.png') })
  console.log('  · 截图 02（当前节点关闭后，提示消失）')

  // 当前节点的关闭不应扩散到其它节点：新建第二个同款 Runway 节点，提示仍应出现。
  await newVideoNodeWithModel('DRunway Seedance 2Runway Dev')
  await expectVisible(guidance(), '另一个节点仍显示同一条收窄提示（关闭状态不跨节点）')
  const secondNodeId = await guidance().evaluate((note) => note.closest('.react-flow__node')?.getAttribute('data-id') || null)
  assert(Boolean(secondNodeId) && secondNodeId !== firstNodeId, '第二个提示属于不同的生成节点', JSON.stringify({ firstNodeId, secondNodeId }))
  const secondGuidance = getWin().locator(`.react-flow__node[data-id="${secondNodeId}"] [data-testid="narrowed-mode-guidance"]`).first()
  await expectVisible(secondGuidance, '第二个节点的提示定位与节点边界一致')
  const firstNodeBeforeReopen = getWin().locator(`.react-flow__node[data-id="${firstNodeId}"]`).first()
  await firstNodeBeforeReopen.click({ force: true })
  await waitForVisualQuiescence(getWin())
  const firstNodeAfterSecond = await getWin().evaluate((nodeId) => {
    const node = [...document.querySelectorAll('.react-flow__node[data-id]')]
      .find((candidate) => candidate.getAttribute('data-id') === nodeId)
    return {
      chipText: node?.querySelector('button[aria-label="模型"]')?.textContent?.trim() || null,
      guidance: Boolean(node?.querySelector('[data-testid="narrowed-mode-guidance"]')),
    }
  }, firstNodeId)
  assert(!firstNodeAfterSecond.guidance, '第二个节点出现提示后第一个节点仍保持关闭', JSON.stringify(firstNodeAfterSecond))

  // ④ 重新打开同一个项目：第一个节点的关闭标记来自项目快照，不依赖组件 state。
  const projectName = await getWin().evaluate(async (id) => {
    const projects = window.nomiDesktop?.projects
    const rows = projects?.listAsync ? await projects.listAsync() : projects?.list() || []
    return rows.find((row) => row?.id === id)?.name || ''
  }, projectId)
  const backToLibrary = getWin().getByRole('button', { name: '项目库', exact: false }).first()
  await backToLibrary.click()
  const reopenedCard = getWin().locator('[data-project-card]', { hasText: projectName }).first()
  await reopenedCard.waitFor({ timeout: 10_000 })
  await reopenedCard.click()
  await getWin().waitForFunction((id) => window.location.href.includes(`projectId=${encodeURIComponent(id)}`), projectId, { timeout: 30_000 })
  await getWin().getByRole('button', { name: '生成', exact: true }).first().click()
  const firstNode = getWin().locator(`.react-flow__node[data-id="${firstNodeId}"]`).first()
  await firstNode.waitFor({ timeout: 10_000 })
  await firstNode.click({ force: true })
  await waitForVisualQuiescence(getWin())
  const reopenedFirstState = await getWin().evaluate(() => {
    const card = document.querySelector('.generation-canvas-v2-node__composer-card')
    return {
      nodeId: card?.closest('.react-flow__node')?.getAttribute('data-id') || null,
      chipText: card?.querySelector('button[aria-label="模型"]')?.textContent?.trim() || null,
    }
  })
  assert(reopenedFirstState.nodeId === firstNodeId, '重开后重新选中了第一个节点', JSON.stringify(reopenedFirstState))
  await expectAbsent(guidance(), { provenBy: proof, message: '重开项目后第一个节点仍记得关闭状态' })
  console.log('  · 重开项目后第一个节点提示仍关闭')

  // ⑤ 另建一个未关闭的节点，继续验证原有「换到 X」动作；不把范围外的多节点换家行为混入关闭验收。
  await newVideoNodeWithModel('DRunway Seedance 2Runway Dev')
  await expectVisible(guidance(), '第三个节点仍可显示收窄提示')
  const switchNodeId = await guidance().evaluate((note) => note.closest('.react-flow__node')?.getAttribute('data-id') || null)
  assert(Boolean(switchNodeId) && switchNodeId !== firstNodeId, '换家用例使用未关闭的第三个节点', String(switchNodeId))
  const switchGuidance = getWin().locator(`.react-flow__node[data-id="${switchNodeId}"] [data-testid="narrowed-mode-guidance"]`).first()
  const guidanceNodeBeforeSwitch = await switchGuidance.evaluate((note) => note.closest('.react-flow__node')?.getAttribute('data-id') || null)
  assert(guidanceNodeBeforeSwitch === switchNodeId, '换家按钮来自第三个节点', guidanceNodeBeforeSwitch)
  const secondSwitchButton = switchGuidance.getByRole('button', { name: /换到/ }).first()

  const termsBefore = await modeTerms()
  await screenshotSettled(getWin(), { path: path.join(shotsDir, '01-narrowed-guidance-runway-seedance2.png') })
  console.log(`  · 截图 01（提示原文：${guidanceText}）`)

  // 回头补 ①：现在有了阳性基线，「干净模型上不出提示」这条断言才立得住。
  assert(cleanModelGuidanceCount === 0, '没有模式被藏的模型上不出现提示（零噪音）', `count=${cleanModelGuidanceCount}`)

  // ③ 点「换到 KIE.AI」：模型换家 + 原本被藏的「首尾帧」应当出现在模式栏上。
  //
  // 这里**必须是真点击**（不加 force）：`force: true` 会绕过 actionability 检查，
  // 于是「按钮被别的东西盖住、真人根本点不到」这类缺陷会被测试自己抹平成绿。
  // 实测记录（探针 6）：提示行住在节点卡片的参考素材区；**开着「生成参数」浮层时**，
  // 那个 fixed 浮层（x578-898 / y280-688）正好压住按钮所在的 (710, 571)，
  // elementFromPoint 命中的是浮层里的「比例」radiogroup —— 那种状态下真人点不到。
  // 本走查因此不开浮层；下面的命中测试把这条不变量钉死，将来若有别的东西盖上来会立刻红。
  const overlapReport = await switchGuidance.evaluate((note) => {
    const button = note.querySelector('button')
    if (!button) return { found: false }
    const rect = button.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const topmost = document.elementFromPoint(cx, cy)
    return {
      found: true,
      hitIsButton: topmost === button || button.contains(topmost),
      hitLabel:
        topmost?.getAttribute?.('aria-label') ||
        topmost?.textContent?.trim().slice(0, 40) ||
        topmost?.tagName ||
        'none',
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    }
  })
  assert(
    overlapReport.hitIsButton,
    '「换到 X」按钮在它自己的位置上真的点得到（没有被别的控件盖住）',
    JSON.stringify(overlapReport),
  )
  // 真点击，不加 force：这一步同时验证「点得到」和「点了有反应」。
  await secondSwitchButton.click()
  await getWin().waitForTimeout(1400)
  // 模型芯片 = 节点卡片上那个 aria-label="模型" 的按钮。**不能**用「文本里含 KIE/Runway」去找：
  // 指路提示自己的「换到 KIE.AI」按钮也含 KIE，会先命中，造成「切换成功」的假绿（实测踩到过）。
  const modelChipAfter = await getWin().evaluate((nodeId) => {
    const card = [...document.querySelectorAll('.react-flow__node[data-id]')]
      .find((node) => node.getAttribute('data-id') === nodeId)
      ?.querySelector('.generation-canvas-v2-node__composer-card')
    const chip = card?.querySelector('button[aria-label="模型"]')
    const guidanceNote = document.querySelector('[data-testid="narrowed-mode-guidance"]')
    return {
      chipText: chip?.textContent?.trim() || null,
      chipFound: Boolean(chip),
      guidanceNow: guidanceNote?.textContent?.trim() || null,
      allButtons: [...(card?.querySelectorAll('button') || [])].map((b) => ({
        aria: b.getAttribute('aria-label'),
        text: b.textContent?.trim().slice(0, 30),
      })),
    }
  }, switchNodeId)
  console.log(`  · 切换后节点状态：${JSON.stringify(modelChipAfter)}`)
  const termsAfter = await modeTerms()
  // 芯片显示的是**模型名**不是供应商名：Runway 那条叫「DRunway Seedance 2」，KIE 那条叫「DSeedance 2.0」。
  // 所以判据是「不再是 Runway 那条」+「模式栏多出了原本被藏的那个」，而不是去芯片里找 "KIE" 三个字母
  // （早先那版就是这么写的，结果匹配到了提示自己的「换到 KIE.AI」按钮，假绿）。
  assert(
    !/Runway/i.test(modelChipAfter.chipText || '') && Boolean(modelChipAfter.chipText),
    '模型芯片已经不是 Runway 那条了（换成了 KIE.AI 的同款模型）',
    String(modelChipAfter.chipText),
  )
  assert(!modelChipAfter.guidanceNow, '换过去之后提示自己收起来了（该说话时才说话）', String(modelChipAfter.guidanceNow))
  assert(Array.isArray(termsAfter) && termsAfter.some((t) => /首尾帧/.test(t)), '换家之后「首尾帧」真的出现在模式栏上', JSON.stringify(termsAfter))
  await expectAbsent(guidance(), { provenBy: proof, message: '换到能做的那家之后，指路提示自己消失（它只在该说话时说话）' })
  await screenshotSettled(getWin(), { path: path.join(shotsDir, '02-after-switch-to-kie.png') })
  console.log(`  · 截图 02（模式栏 ${JSON.stringify(termsBefore)} → ${JSON.stringify(termsAfter)}）`)

  // ⑥ Cmd+Z 撤销。
  //
  // 实测结论（探针 7 的对照实验）：**换模型这件事本来就不进撤销栈**——
  //   对照组 A：用模型下拉手动把 Runway Seedance 2 换成 Gemini Omni，再 Cmd+Z → 没回来；
  //   实验组 B：用指路按钮换到 KIE，再 Cmd+Z（连按 4 次）→ 同样没回来。
  // 两条路径行为**完全一致**，所以这不是本功能的回归：指路按钮复用的就是 handleModelChange，
  // 和用户手动换模型是同一条写入路径。真正缺的是「换模型」这一族本身没有撤销支持，
  // 是先于本功能存在的产品缺口——已写进交付报告，不在本走查里伪装成通过。
  //
  // 这里如实记录事实，不做「应该回到 Runway」的断言（那会是一条永远红的假期待）。
  await getWin().keyboard.press('Meta+z')
  // 这一步要观察的是「撤销**有没有**发生」，没有可等的正向信号；用共享的视觉静默helper
  // 等界面稳定下来，而不是拍脑袋 sleep 一个数字。
  await waitForVisualQuiescence(getWin())
  if ((await composerCard().count()) === 0) {
    await getWin().locator('[data-node-id]').first().click({ force: true }).catch(() => {})
    await getWin().waitForTimeout(900)
  }
  const afterUndo = await getWin().evaluate(() => {
    const card = document.querySelector('.generation-canvas-v2-node__composer-card')
    return {
      chipText: card?.querySelector('button[aria-label="模型"]')?.textContent?.trim() || null,
      guidance: document.querySelector('[data-testid="narrowed-mode-guidance"]')?.textContent?.trim() || null,
    }
  })
  const undoRestoredRunway = /Runway/i.test(afterUndo.chipText || '')
  assert(
    Boolean(afterUndo.chipText),
    'Cmd+Z 之后节点仍是完好的（没有被撤销弄坏 / 弄没）',
    JSON.stringify(afterUndo),
  )
  if (undoRestoredRunway) {
    console.log('  · Cmd+Z 撤回到了 Runway —— 若确认「换模型」已支持撤销，请更新本走查与交付报告。')
  } else {
    console.log(`  ⚠️ 已知缺口复现：Cmd+Z 撤不回换模型（现在仍是 ${afterUndo.chipText}）。手动换模型同样撤不回，非本功能引入——见交付报告。`)
  }
  await screenshotSettled(getWin(), { path: path.join(shotsDir, '03-after-undo-attempt.png') })
  console.log('  · 截图 03')

  // ⑤ 样张 D（模式栏整条不显示时提示仍在）——本机真实目录里凑不出这一情形：
  //    全目录 10 个收窄命中里，被藏之后**剩余模式都 ≥ 2 个**（最少的是 3 个模式藏 1 个 = 剩 2 个），
  //    没有任何一个模型会落到「只剩 ≤1 个模式 → 模式栏整条不显示」。这条如实记为「凑不出」，
  //    不伪造。referencesSectionIsEmpty 里 hasModeGuidance 那一项由单测钉住（narrowedModeGuidance.test.ts）。
  console.log('  ⚠️ 样张 D（模式栏整条不显示）在本机真实目录里凑不出：10 个收窄命中剩余模式均 ≥2，模式栏都会显示。')

  // ⑥ 把先于本功能存在的那条崩溃钉下来：runway/veo3.1 一选中就打崩「节点生成面板」。
  //    这里只**记录**，不让它把本走查判红——它不是本功能引入的（stash 掉本功能重 build 照样复现）。
  await getWin().keyboard.press('Escape')
  await newVideoNodeWithModel('Runway Veo 3.1Runway Dev')
  await getWin().waitForTimeout(1200)
  const veoBoundary = await panelBoundary().count()
  const veo185 = consoleErrors.some((line) => /error #185/.test(line))
  if (veoBoundary > 0 || veo185) {
    // 崩掉的那块落在视口下沿之外，整窗截图只拍得到「节点没了」，看不出所以然。
    // 用画布自己的「适应视图」（Fit view）把所有节点收进视口，再整窗截——这样人眼能同时看到
    // 崩掉的那张卡片和它上面那句「节点生成面板加载失败」。
    // 取景说明：错误边界在画布坐标里落在视口下沿之外，而**窗口拉不高**（macOS 把窗口高度
    // 夹在屏幕高度内，resize(1600,1400) 之后 innerHeight 仍是 856）。scrollIntoViewIfNeeded
    // 也没用——画布是 transform 平移的，不是滚动容器。所以这里用画布自己的平移：
    // 按住空白处往上拖，把那张崩掉的卡片拖进视野，再整窗截。
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const box = await panelBoundary().boundingBox().catch(() => null)
      const viewportHeight = await getWin().evaluate(() => window.innerHeight)
      if (box && box.y >= 80 && box.y + box.height <= viewportHeight - 40) break
      if (!box) break
      const dragBy = Math.min(360, Math.max(120, box.y + box.height - (viewportHeight - 120)))
      await getWin().mouse.move(300, 620)
      await getWin().mouse.down()
      await getWin().mouse.move(300, 620 - dragBy, { steps: 12 })
      await getWin().mouse.up()
      await getWin().waitForTimeout(500)
    }
    const boundaryBox = await panelBoundary().boundingBox().catch(() => null)
    const viewport = await getWin().evaluate(() => ({ h: window.innerHeight, w: window.innerWidth }))
    const fullyInView = Boolean(boundaryBox && boundaryBox.y >= 0 && boundaryBox.y + boundaryBox.height <= viewport.h)
    console.log(`  · 崩溃截图取景：boundary=${JSON.stringify(boundaryBox)} viewport=${JSON.stringify(viewport)} 完整入镜=${fullyInView}`)
    await screenshotSettled(getWin(), { path: path.join(shotsDir, '04-preexisting-veo31-panel-crash.png') })
    console.log(`  ⚠️ 已知的既有缺陷复现：runway/veo3.1 选中后「节点生成面板」崩溃（错误边界=${veoBoundary} React#185=${veo185}）——非本功能引入，见交付报告。`)
  } else {
    console.log('  · runway/veo3.1 这次没有崩——若确认已修，请更新本走查与交付报告。')
  }

  console.log(`\n✅ 走查通过：${passed} 条断言。截图目录 ${shotsDir}`)
} catch (error) {
  console.error(`\n❌ ${String(error)}`)
  await screenshotSettled(getWin(), { path: path.join(shotsDir, 'failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}
