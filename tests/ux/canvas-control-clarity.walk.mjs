// 生成画布控件辨识与比例连续性 R13 走查。
//
// 真 Electron + 真构建产物，隔离 userData / projects，不触发任何生成请求（零额度）。
// 验证：9 个节点入口及 tooltip、15 档比例与多供应商始终显式分段、自动比例本地化、面积守恒、
//       composer/触发器/浮层不漂移、1–4 张显式选择、任务/辅助/配置/主动作分组，以及深浅色与紧凑宽度截图。
//
// 用法：pnpm run build && node tests/ux/canvas-control-clarity.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/canvas-control-clarity')
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nomi-canvas-control-clarity-'))
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
mkdirSync(projectsDir, { recursive: true })
mkdirSync(shotsDir, { recursive: true })

const { app, win: _initialWin } = await launchNomiApp({
  name: 'canvas-control-clarity',
  userDataDir,
  settingsDir: userDataDir,
  projectsDir,
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

function closeEnough(a, b, tolerance = 1) {
  return Math.abs(a - b) <= tolerance
}

function stableBox(a, b, tolerance = 1) {
  return ['x', 'y', 'width', 'height'].every((key) => closeEnough(a[key], b[key], tolerance))
}

function roundedBox(box) {
  return Object.fromEntries(Object.entries(box).map(([key, value]) => [key, Math.round(value * 10) / 10]))
}

let win = _initialWin
const getWin = () => {
  const live = app.windows().filter((candidate) => !candidate.isClosed())
  win = live.find((candidate) => /projectId=/.test(candidate.url())) || live[live.length - 1] || win
  return win
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
  await getWin().waitForTimeout(350)
}

async function snap(name, locator) {
  const file = path.join(shotsDir, name)
  if (locator) await screenshotSettled(locator, { path: file })
  else await screenshotSettled(getWin(), { path: file })
  console.log(`  · 截图 ${name}`)
  return file
}

async function dismissFirstRun() {
  for (let index = 0; index < 6; index += 1) {
    const action = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后/ }).first()
    if (await action.isVisible().catch(() => false)) await action.click({ timeout: 900 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(180)
  }
}

async function ensureGenerationWorkspace() {
  const generation = getWin().getByRole('button', { name: '生成', exact: true }).first()
  await generation.waitFor({ timeout: 8000 })
  await generation.click()
  await getWin().locator('.generation-canvas-v2-toolbar').waitFor({ timeout: 8000 })
}

async function ensureParameterPanel(composer) {
  let trigger = composer.getByRole('button', { name: '生成参数', exact: true }).first()
  if (!(await trigger.isVisible().catch(() => false))) {
    const model = composer.getByRole('button', { name: '模型', exact: true }).first()
    assert(await model.isVisible().catch(() => false), '图像节点存在模型选择器')
    await model.click()
    const firstOption = getWin().getByRole('option').first()
    await firstOption.waitFor({ timeout: 5000 })
    await firstOption.click()
    await getWin().waitForTimeout(500)
    trigger = composer.getByRole('button', { name: '生成参数', exact: true }).first()
  }
  await trigger.waitFor({ timeout: 5000 })
  const hitTest = await trigger.evaluate((element) => {
    const box = (rect) => ({
      x: Math.round(rect.x * 10) / 10,
      y: Math.round(rect.y * 10) / 10,
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
    })
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    const composer = element.closest('.generation-canvas-v2-node__composer')
    const stage = composer?.closest('.generation-canvas-v2__stage')
    const composerRect = composer?.getBoundingClientRect()
    const stageRect = stage?.getBoundingClientRect()
    const handle = document.querySelector('.workbench-generation__timeline-handle')
    const handleRect = handle?.getBoundingClientRect()
    const overlapWidth = handleRect ? Math.min(rect.right, handleRect.right) - Math.max(rect.left, handleRect.left) : 0
    const overlapHeight = handleRect ? Math.min(rect.bottom, handleRect.bottom) - Math.max(rect.top, handleRect.top) : 0
    return {
      clear: hit === element || Boolean(hit && element.contains(hit)),
      overlapsTimeline: overlapWidth > 0 && overlapHeight > 0,
      flipped: composer?.getAttribute('data-flipped'),
      composerWithinStage: Boolean(
        composerRect && stageRect && composerRect.top >= stageRect.top && composerRect.bottom <= stageRect.bottom,
      ),
      workspaceFound: Boolean(composer?.closest('.workbench-generation__canvas')),
      trigger: box(rect),
      handle: handleRect ? box(handleRect) : null,
      hitLabel: hit?.getAttribute('aria-label') || hit?.textContent?.trim().slice(0, 24) || hit?.tagName || 'none',
    }
  })
  assert(hitTest.clear, '生成参数按钮不被底部时间轴遮挡', JSON.stringify(hitTest))
  assert(!hitTest.overlapsTimeline, '生成参数按钮与底部时间轴没有视觉重叠', JSON.stringify(hitTest))
  assert(hitTest.flipped === 'false' && hitTest.composerWithinStage, '新建节点的编辑框在下方完整可见', JSON.stringify(hitTest))
  await trigger.click()
  const panel = getWin().getByRole('group', { name: '生成参数面板', exact: true }).first()
  await panel.waitFor({ timeout: 5000 })
  return { trigger, panel }
}

async function selectRatio(panel, ratio) {
  const segmented = panel.getByRole('radiogroup', { name: '比例', exact: true }).first()
  await expectVisible(segmented, '比例必须保持显式分段，不随模型选项数量变成下拉')
  await segmented.getByRole('radio', { name: ratio, exact: true }).click()
}

const pageErrors = []
getWin().on('pageerror', (error) => pageErrors.push(String(error)))

try {
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1700)
  await getWin().evaluate(() => {
    localStorage.setItem('__nomiE2E', '1')
    localStorage.setItem('nomi-color-scheme', 'dark')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      localStorage.setItem(key, 'seen')
    }
  })
  await getWin().reload()
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1800)
  await resize(1600, 1000)
  await dismissFirstRun()

  // 两家都只写占位 key：让同一个 Nano Banana 2 出现 15 档比例 + 多供应商选择；全程不点生成。
  const keyStatuses = await getWin().evaluate(() => Promise.all([
    window.nomiDesktop?.modelCatalog?.upsertVendorApiKey('kie', { apiKey: 'nomi-e2e-placeholder', enabled: true }),
    window.nomiDesktop?.modelCatalog?.upsertVendorApiKey('apimart', { apiKey: 'nomi-e2e-placeholder', enabled: true }),
  ]))
  assert(keyStatuses.every((status) => Boolean(status?.hasApiKey)), '隔离模型目录已启用两家图像供应商（不发生成请求）')
  await getWin().reload()
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1500)
  await dismissFirstRun()

  const blankProject = getWin().locator('button, [role="button"]', { hasText: '新建空白项目' }).first()
  await blankProject.waitFor({ timeout: 8000 })
  await blankProject.click()
  await getWin().waitForTimeout(2200)
  await dismissFirstRun()
  await resize(1600, 1000)
  await ensureGenerationWorkspace()
  await expectVisible(getWin().locator('.react-flow').first(), '生产生成画布必须挂载 React Flow renderer')

  // ① 左侧栏：9 个入口直接可见，没有省略号，悬浮名称完整。
  const toolbar = getWin().locator('.generation-canvas-v2-toolbar').first()
  const expectedTools = [
    ['text', '文本节点'],
    ['image', '图片节点'],
    ['video', '视频节点'],
    ['clip', '剪辑节点'],
    ['audio', '声音节点'],
    ['model3d', '3D 模型节点'],
    ['whiteboard', '画板节点'],
    ['panorama', '全景图节点'],
    ['scene3d', '3D 场景节点'],
  ]
  const toolButtons = toolbar.locator('[data-node-kind]')
  assert((await toolButtons.count()) === expectedTools.length, '左侧 9 个节点入口全部直接可见')
  // 用刚证过的 9 个真实入口当基线——工具栏确实渲染了内容，不是空壳/选择器打错，
  // 「没有省略号入口」这个断言才立得住。
  const toolbarProof = await proveProbe(toolButtons, '左侧栏 9 个节点入口确实渲染')
  await expectAbsent(toolbar.locator('[aria-label*="更多"], [aria-label*="省略"]'), { provenBy: toolbarProof, message: '左侧栏没有省略号创建入口' })
  assert(true, '左侧栏没有省略号创建入口')
  for (const [kind, tooltipText] of expectedTools) {
    const button = toolbar.locator(`[data-node-kind="${kind}"]`)
    assert(await button.isVisible(), `${tooltipText}入口可见`)
    await button.focus()
    const tooltip = getWin().locator('[role="tooltip"]', { hasText: tooltipText }).last()
    await tooltip.waitFor({ timeout: 2400 })
    assert((await tooltip.textContent())?.trim() === tooltipText, `${tooltipText}悬浮/聚焦名称正确`)
  }

  // ② 新建图像节点并打开真实参数面板。
  await toolbar.locator('[data-node-kind="image"]').click()
  const node = getWin().locator('[data-kind="image"][data-selected="true"]').first()
  const composer = getWin().locator('.generation-canvas-v2-node__composer-card').first()
  await node.waitFor({ timeout: 5000 })
  await composer.waitFor({ timeout: 5000 })
  const modelSelect = composer.getByRole('button', { name: '模型', exact: true }).first()
  await modelSelect.click()
  const nanoBanana2 = getWin().getByRole('option').filter({ hasText: /^Nano Banana 2(?:\s*\d+ 家)?$/ }).first()
  await expectVisible(nanoBanana2, '模型目录必须提供跨供应商 Nano Banana 2')
  await nanoBanana2.click()
  await getWin().waitForTimeout(400)
  const { trigger, panel } = await ensureParameterPanel(composer)
  const ratioGroup = panel.getByRole('radiogroup', { name: '比例', exact: true }).first()
  await expectVisible(ratioGroup, '15 档比例仍显示为图形分段组')
  assert((await ratioGroup.getByRole('radio').count()) === 15, 'Nano Banana 2 的 15 档比例全部显式可见')
  const automatic = ratioGroup.getByRole('radio', { name: '自动', exact: true }).first()
  assert(await automatic.isVisible(), 'Auto 在中文界面显示为“自动”')
  assert((await automatic.locator('svg').count()) === 1, '分段式自动比例项上方有自适应画幅图标')
  assert((await ratioGroup.locator('[aria-hidden] span').count()) > 0, '比例分段保留可扫描的宽高形状')
  const providerGroup = panel.getByRole('radiogroup', { name: '供应商', exact: true }).first()
  await expectVisible(providerGroup, '多供应商选择保持显式分段组')
  assert((await providerGroup.getByRole('radio').count()) >= 2, '同模型至少两家供应商并排可见')

  const geometries = []
  for (const ratio of ['1:1', '21:9', '9:16']) {
    await selectRatio(panel, ratio)
    await getWin().waitForTimeout(220)
    const [nodeBox, composerBox, triggerBox, panelBox, nodeLayout] = await Promise.all([
      node.boundingBox(),
      composer.boundingBox(),
      trigger.boundingBox(),
      panel.boundingBox(),
      node.evaluate((element) => ({ width: Number.parseFloat(element.style.width), height: Number.parseFloat(element.style.height) })),
    ])
    assert(Boolean(nodeBox && composerBox && triggerBox && panelBox), `${ratio} 四个几何对象均可测量`)
    geometries.push({ ratio, node: nodeBox, nodeLayout, composer: composerBox, trigger: triggerBox, panel: panelBox })
  }

  const reference = geometries[0]
  for (const current of geometries) {
    const [widthPart, heightPart] = current.ratio.split(':').map(Number)
    const targetRatio = widthPart / heightPart
    const visualRatio = current.node.width / current.node.height
    assert(Math.abs(visualRatio - targetRatio) < 0.025, `${current.ratio} 节点外形符合目标比例`, visualRatio.toFixed(3))
    assert(stableBox(reference.composer, current.composer), `${current.ratio} 编辑框不漂移`, JSON.stringify(roundedBox(current.composer)))
    assert(stableBox(reference.trigger, current.trigger), `${current.ratio} 比例触发器不漂移`)
    assert(stableBox(reference.panel, current.panel), `${current.ratio} 已打开浮层不漂移`)
  }
  const areas = geometries.map((item) => item.node.width * item.node.height)
  const areaSpread = (Math.max(...areas) - Math.min(...areas)) / areas[0]
  const touchesInteractionMinimum = geometries.some(
    (item) => item.nodeLayout.width <= 240.5 || item.nodeLayout.height <= 120.5,
  )
  const allowedSpread = touchesInteractionMinimum ? 0.1 : 0.035
  assert(
    areaSpread < allowedSpread,
    '1:1 / 21:9 / 9:16 视觉面积近似守恒',
    `spread=${(areaSpread * 100).toFixed(2)}%, min-bound=${touchesInteractionMinimum}`,
  )
  assert(Math.min(...areas) >= areas[0] * 0.965, '连续切换不会把节点越切越小')

  const gaps = geometries.map((item) => {
    const flipped = getWin().locator('.generation-canvas-v2-node__composer').first()
    return flipped.getAttribute('data-flipped').then((value) =>
      value === 'true' ? item.node.y - (item.composer.y + item.composer.height) : item.composer.y - (item.node.y + item.node.height),
    )
  })
  const resolvedGaps = await Promise.all(gaps)
  assert(resolvedGaps.every((gap) => closeEnough(gap, resolvedGaps[0], 1)), '节点与编辑框连接间距保持一致')
  await snap('02-dark-canvas-ratio-panel.png')

  // ③ 生成数量是明确的 1–4 选择，不再循环跳数；3 张是真选项。
  await getWin().keyboard.press('Escape')
  const countSelect = composer.getByRole('button', { name: '每次生成张数', exact: true }).first()
  await countSelect.click()
  const countOptions = getWin().getByRole('option')
  const labels = (await countOptions.allTextContents()).map((text) => text.trim())
  assert(['1 张', '2 张', '3 张', '4 张'].every((label) => labels.includes(label)), '数量菜单明确包含 1、2、3、4 张')
  await getWin().getByRole('option', { name: '3 张', exact: true }).click()
  assert((await countSelect.textContent())?.includes('3 张'), '可直接选择 3 张并在触发器显示')

  // ④ 顶栏语义分组与任务按钮：任务独立，设置和模型接入相邻，主组只负责去出片。
  const actionGroups = await getWin().evaluate(() => ({
    assist: document.querySelector('.nomi-appbar__group--assist')?.getAttribute('data-actions'),
    config: document.querySelector('.nomi-appbar__group--config')?.getAttribute('data-actions'),
    primary: document.querySelector('.nomi-appbar__group--primary')?.getAttribute('data-actions'),
    idleTaskVisible: Boolean(document.querySelector('[data-task-center-trigger="true"]')),
  }))
  assert(actionGroups.assist === 'onboarding browser', '上手与浏览器归入创作辅助组')
  assert(actionGroups.config === 'settings modelAccess', '设置与模型接入归入配置组')
  assert(actionGroups.primary === 'goToProduce', '去出片是唯一主动作')
  assert(actionGroups.idleTaskVisible, '完全无任务历史时仍保留“任务”入口')

  const nodeId = await node.getAttribute('data-node-id')
  const queueReady = await getWin().evaluate(() => Boolean(window.__nomiQueueStore))
  assert(queueReady && Boolean(nodeId), '任务走查桥与真实节点 ID 就绪')
  await getWin().evaluate((id) => {
    const queue = window.__nomiQueueStore
    queue.setState({ entries: [], batches: {} })
    const batch = queue.getState().enqueueBatch([[id, `${id}-second`]])
    queue.getState().markRunning(batch, id)
  }, nodeId)
  await getWin().waitForTimeout(450)
  const taskButton = getWin().locator('[data-task-center-trigger="true"]').first()
  assert(await taskButton.isVisible(), '有任务时显示“任务”入口')
  assert((await taskButton.textContent())?.replace(/\s+/g, '').includes('任务2'), '任务入口显示名称与待处理数量 2')

  const darkTopbar = getWin().locator('.nomi-appbar').first()
  await snap('01-dark-topbar.png', darkTopbar)

  // ⑤ 紧凑宽度：文字折叠后仍有统一 styled tooltip，不出现无名图标。
  await resize(1280, 820)
  const settingsButton = getWin().getByRole('button', { name: '设置', exact: true }).first()
  await settingsButton.focus()
  const settingsTooltip = getWin().locator('[role="tooltip"]', { hasText: '设置' }).last()
  await settingsTooltip.waitFor({ timeout: 1800 })
  assert(await settingsTooltip.isVisible(), '紧凑宽度设置图标悬浮显示名称')
  await snap('03-dark-compact-tooltip.png')

  await taskButton.focus()
  const taskTooltip = getWin().locator('[role="tooltip"]', { hasText: '任务' }).last()
  await taskTooltip.waitFor({ timeout: 1800 })
  assert(await taskTooltip.isVisible(), '紧凑宽度任务图标悬浮显示名称')

  // ⑥ 浅色同一 DOM 结构复查。
  await getWin().evaluate(() => localStorage.setItem('nomi-color-scheme', 'light'))
  await getWin().reload()
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1700)
  await resize(1600, 1000)
  await ensureGenerationWorkspace()
  const lightNode = getWin().locator(`[data-node-id="${nodeId}"]`).first()
  if (await lightNode.isVisible().catch(() => false)) await lightNode.click()
  await getWin().waitForTimeout(350)
  await snap('04-light-canvas.png')
  const resolvedTheme = await getWin().evaluate(() => document.documentElement.dataset.theme || document.documentElement.className)
  assert(String(resolvedTheme).toLowerCase().includes('light'), '浅色模式真实生效', String(resolvedTheme))

  assert(pageErrors.length === 0, '走查期间无渲染层异常', pageErrors.join(' | '))
  console.log(`\nCANVAS CONTROL CLARITY WALK PASS: ${passed} assertions`)
  console.log(`截图：${shotsDir}`)
  await finish(0)
} catch (error) {
  console.error(`\n${error?.stack || error}`)
  await snap('99-failure.png').catch(() => {})
  await finish(1)
}

async function finish(code) {
  await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 3000))])
  process.exit(code)
}
