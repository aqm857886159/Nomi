import { expectComposerFooterHit } from './_composerFixedFooter.mjs'
// Real Electron journey for canvas batch production — the only batch entrance is the group toolbar's「生成整组」.
// Each node runs with the model it already carries (no bulk model picker, no concurrency picker). The UI, spend gate, IPC, queue, HTTP transport,
// persistence, retry, and screenshots are real; only the remote vendor is replaced by a loopback fixture.
import { launchNomiApp, ACCEPTANCE_WIDE_VIEWPORT } from './_launchApp.mjs'
import { findCanvasBlankPoint, findConnectionStartPoint, findNodeHitPoint, panCanvasUntilInside, waitForCanvasViewportSettled } from './_canvasHit.mjs'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/canvas-batch-production')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-canvas-batch-'))
const userDataDir = path.join(tempRoot, 'user-data')
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
for (const dir of [shotsDir, userDataDir, settingsDir, projectsDir]) fs.mkdirSync(dir, { recursive: true })

const NOW = '2026-08-08T00:00:00.000Z'
const VENDOR = 'batch-mock'
const IMAGE_A = 'batch-image-a'
const IMAGE_B = 'batch-image-b'
const imageBytes = fs.readFileSync(path.join(repoRoot, 'resources/onboarding-demo/shot-4.jpg'))
const imageDataUrl = `data:image/jpeg;base64,${imageBytes.toString('base64')}`
const wireCalls = []
let failOncePending = true

function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { resolve({}) }
    })
  })
}

const vendorServer = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/images/generations') {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: `No route ${req.method} ${req.url}` } }))
    return
  }
  const body = await readJsonBody(req)
  const call = {
    model: String(body.model || ''),
    prompt: String(body.prompt || ''),
    hasImage: Boolean(body.extra_body?.image),
    startedAt: Date.now(),
    finishedAt: 0,
    status: 0,
  }
  wireCalls.push(call)
  const shouldFail = call.prompt.includes('重试') && failOncePending
  if (shouldFail) failOncePending = false
  setTimeout(() => {
    call.finishedAt = Date.now()
    // 当场明确拒绝（422：对方看完请求、亲口说不、没建任务）= 确定没受理、没扣钱，节点报原话、可以重试。
    // 5xx 是「结果未知」（可能已收下），画布付费生成进了 Run 之后按设计锁住先核对（outboundDispatchEvidence F3），不再拿来演「失败可重试」。
    call.status = shouldFail ? 422 : 200
    res.writeHead(call.status, { 'content-type': 'application/json' })
    res.end(shouldFail
      ? JSON.stringify({ error: { message: 'mock fail once' } })
      : JSON.stringify({ data: [{ url: imageDataUrl }] }))
  }, 900)
})
await new Promise((resolve) => vendorServer.listen(0, '127.0.0.1', resolve))
const port = vendorServer.address().port

function imageMapping(modelKey, taskKind) {
  return {
    id: `${modelKey}-${taskKind}`,
    vendorKey: VENDOR,
    taskKind,
    modelKey,
    name: `${modelKey} ${taskKind}`,
    enabled: true,
    create: {
      method: 'POST',
      path: '/v1/images/generations',
      headers: { 'Content-Type': 'application/json' },
      body: {
        model: '{{model.modelKey}}',
        prompt: '{{request.prompt}}',
        size: '{{request.params.size}}',
        extra_body: {
          response_format: 'url',
          ...(taskKind === 'image_edit' ? { image: '{{request.params.image}}' } : {}),
        },
      },
      response_mapping: { image_url: 'data.0.url' },
      defaultParams: { size: '1024x1024' },
    },
    createdAt: NOW,
    updatedAt: NOW,
  }
}

fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: 8,
  vendors: [{
    key: VENDOR,
    name: 'Batch Mock',
    enabled: true,
    baseUrlHint: `http://127.0.0.1:${port}`,
    // The loopback fixture accepts the upstream image inline. Declaring this
    // keeps the real runtime from falling back to public anonymous upload
    // hosts during the dependency-wave assertion.
    assetIngestion: { strategy: 'inline-base64', accepts: ['image'] },
    authType: 'none',
    authHeader: null,
    authQueryParam: null,
    providerKind: 'openai-compatible',
    createdAt: NOW,
    updatedAt: NOW,
  }],
  models: [
    { modelKey: IMAGE_A, vendorKey: VENDOR, labelZh: '批量图片 A', kind: 'image', enabled: true, meta: { archetypeId: 'agnes-image' }, createdAt: NOW, updatedAt: NOW },
    { modelKey: IMAGE_B, vendorKey: VENDOR, labelZh: '批量图片 B', kind: 'image', enabled: true, meta: { archetypeId: 'agnes-image' }, createdAt: NOW, updatedAt: NOW },
  ],
  mappings: [
    ...[IMAGE_A, IMAGE_B].flatMap((modelKey) => [
      imageMapping(modelKey, 'text_to_image'),
      imageMapping(modelKey, 'image_edit'),
    ]),
  ],
  apiKeysByVendor: {},
}, null, 2))

let shotIndex = 0
async function snap(win, name) {
  shotIndex += 1
  const file = path.join(shotsDir, `${String(shotIndex).padStart(2, '0')}-${name}.png`)
  await screenshotSettled(win, { path: file })
  console.log(`  screenshot: ${path.basename(file)}`)
  return file
}

function check(condition, message, details = '') {
  if (!condition) throw new Error(`${message}${details ? `: ${details}` : ''}`)
  console.log(`  ok: ${message}`)
}

async function addNodeWithPrompt(win, kind, prompt) {
  await win.locator(`[aria-label="添加${kind}节点"]`).first().click({ timeout: 5000 })
  await win.waitForTimeout(900)
  // 2026-09-25 起程序不替人挪画布：舞台放不下时新卡落在屏外、画布边缘出一颗「新节点在…」提示（1800 宽窗口里
  // Agent 面板开着，两张大卡并排就放不下第二张）。人会点提示过去——走查照做。
  const arrivalHint = win.locator('[data-canvas-arrival-hint]')
  if (await arrivalHint.count()) {
    await arrivalHint.first().click()
    await expect(arrivalHint).toHaveCount(0)
  }
  const nodes = win.locator(`[data-kind="${kind === '图片' ? 'image' : 'video'}"][data-node-id]`)
  const target = nodes.last()
  await target.waitFor({ timeout: 5000 })
  const id = await target.getAttribute('data-node-id')
  // 卡贴着舞台边时浮框（钉在正下方、定宽 560、被挡就挡）会伸出舞台；先把卡整张拖进来。
  const cardPan = await panCanvasUntilInside(win, win.locator(`.generation-canvas-v2-node[data-node-id="${id}"]`))
  check(cardPan.ok, `${kind}卡整张拖进舞台`, JSON.stringify(cardPan))
  const editor = win.locator(`[data-node-id="${id}"] div[contenteditable="true"]`).last()
  // The editor's own box can remain tall while its flex scrollport collapses to zero.
  // Assert the actual visible input region for both image and video composers.
  await expect.poll(() => editor.evaluate(element => element.closest('[data-prompt-box]').parentElement.clientHeight), { message: `${kind}提示词区保留三行可输入空间` }).toBeGreaterThanOrEqual(72)
  await editor.click({ timeout: 5000 })
  const composerCard = editor.locator('xpath=ancestor::*[contains(@class, "generation-canvas-v2-node__composer-card")]')
  const composerPan = await panCanvasUntilInside(win, composerCard)
  check(composerPan.ok, `${kind}浮框整张拖进舞台`, JSON.stringify(composerPan))
  await expectComposerFooterHit(composerCard, `${kind}生成`)
  await editor.fill(prompt)
  await win.waitForTimeout(500)
  return id
}

async function clickCanvasBlank(win) {
  const point = await findCanvasBlankPoint(win)
  if (!point) throw new Error('No unobstructed canvas pane for selection')
  await win.mouse.click(point.x, point.y)
}

async function clearSelection(win) {
  const clear = win.locator('button[aria-label="清除选择"]').first()
  if (await clear.count()) {
    await clear.click()
  } else {
    await clickCanvasBlank(win)
  }
  await win.waitForTimeout(500)
}

async function spendDialog(win) {
  const dialog = win.locator('div.fixed.inset-0').filter({ hasText: /开始生成/ }).last()
  await dialog.waitFor({ timeout: 8000 })
  return dialog
}

function findProjectJson(root) {
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name === 'project.json' && full.includes(`${path.sep}.nomi${path.sep}`)) return full
    }
  }
  return null
}

const pageErrors = []
const consoleErrors = []
const { app, win } = await launchNomiApp({
  name: 'canvas-batch-production',
  ...(process.argv.includes('--wide') ? { viewportSize: ACCEPTANCE_WIDE_VIEWPORT } : {}),
  userDataDir,
  settingsDir,
  projectsDir,
  settleMs: 0,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', __nomiE2E: '1' },
  env: {
    NOMI_RENDERER_URL: `file://${path.join(repoRoot, 'dist/index.html')}`,
  },
})

try {
  console.log('GL_RENDERER', await win.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable'
  }))
  win.on('pageerror', (error) => pageErrors.push(String(error)))
  win.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
    if (message.text().startsWith('CANVAS_CLICK_DIAGNOSTIC')) console.log(message.text())
  })
  await win.evaluate(() => document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('.react-flow__node, [data-timeline-strip]')) {
      console.log('CANVAS_CLICK_DIAGNOSTIC', JSON.stringify({
        tag: target.tagName, label: target.closest('[aria-label]')?.getAttribute('aria-label'),
        nodeId: target.closest('.react-flow__node')?.getAttribute('data-id'), x: event.clientX, y: event.clientY,
      }))
    }
  }, true))

  await win.getByText('新建空白项目', { exact: false }).first().click({ timeout: 5000 })
  await win.waitForTimeout(2200)
  await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click({ timeout: 5000 })
  await win.waitForTimeout(1400)

  // 模型接入入口现在是应用栏的「打开模型设置」，打开的是统一「设置」弹窗里的模型区
  // （main 的 8d54ad4a「unify model management in settings」把独立的「模型设置」弹窗并进了「设置」，
  //  并撤掉了旧的按能力上色的 chip / 连通小绿点 UI）。这里只作为前置：确认种子进去的 Batch Mock
  //  供应商已在设置里出现（= 可被批量模型选择器选到），能力 chip 的配色是设置面板的事、与本走查无关。
  await win.getByRole('button', { name: /打开模型设置/ }).first().click({ timeout: 5000 })
  const modelPanel = win.locator('[data-settings-dialog]').first()
  await modelPanel.waitFor({ state: 'visible', timeout: 5000 })
  await win.waitForTimeout(900)
  const batchMockRow = modelPanel.locator('button').filter({ hasText: 'Batch Mock' }).first()
  await batchMockRow.waitFor({ state: 'visible', timeout: 5000 })
  check(await batchMockRow.count() === 1, '种子供应商 Batch Mock 已在模型设置里可见')
  await snap(win, 'light-model-settings')
  await modelPanel.getByRole('button', { name: '关闭', exact: true }).click()
  await win.waitForTimeout(400)

  const sourceId = await addNodeWithPrompt(win, '图片', '依赖波次源图')
  await clearSelection(win)
  const targetId = await addNodeWithPrompt(win, '图片', '依赖波次下游图')
  await win.waitForTimeout(1400)
  await clearSelection(win)

  const source = win.locator(`.react-flow__node[data-id="${sourceId}"]`)
  // 选中源节点：点哪儿现问一句「这点归谁」，不写死节点内偏移。写死的 (36,36) 在
  // 2026-09-11 之后永远点不到——main 把「文字」提成左缘工具条的常驻按钮，工具条高了
  // 一格，正好盖住这颗节点的左上角，Playwright 重试到 30s 超时（判据见 _canvasHit.mjs）。
  const sourceHit = await findNodeHitPoint(win, { nodeSelector: `.react-flow__node[data-id="${sourceId}"]` })
  check(Boolean(sourceHit), '源节点身上找得到一个没被画布浮层盖住的点')
  await win.mouse.click(sourceHit.x, sourceHit.y)
  await win.waitForTimeout(500)
  const target = win.locator(`.react-flow__node[data-id="${targetId}"]`)
  // 按人按的地方起线：卡外那颗「+」圈（见 _canvasHit.mjs findConnectionStartPoint 的根因注释）。
  const startPoint = await findConnectionStartPoint(win, { handleSelector: `.react-flow__node[data-id="${sourceId}"] .generation-canvas-react-flow__handle--source[data-side="right"]` })
  const targetBox = await target.boundingBox()
  check(Boolean(startPoint && targetBox), '连接点和目标节点都有可点击区域', JSON.stringify(startPoint))
  await win.mouse.move(startPoint.x, startPoint.y)
  await win.mouse.down()
  await win.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 })
  await win.waitForTimeout(300)
  await win.mouse.up()
  await win.waitForTimeout(900)
  check(await win.locator('.generation-canvas-v2__edge-path').count() === 1, '真实点击建立依赖边')
  await clearSelection(win)

  // ── 批量只走组：依赖波次的两张图 + 一张会先失败的图，编成一组，用节点自己的模型生成 ──
  const retryImageId = await addNodeWithPrompt(win, '图片', '批量生成失败后重试')
  await clearSelection(win)
  check(Boolean(retryImageId), '真实点击新增第三张图片节点')
  // 三个节点各自已选好的模型（A / B / A）——「生成整组」不许改它、也不许弹模型选择。
  const MODEL_OF = { [sourceId]: IMAGE_A, [targetId]: IMAGE_B, [retryImageId]: IMAGE_A }
  await win.evaluate(({ models, vendor }) => {
    const store = window.__nomiCanvasStore.getState()
    store.updateNodes(Object.entries(models).map(([nodeId, modelKey]) => ({
      nodeId,
      patch: { meta: { ...(store.nodes.find((node) => node.id === nodeId)?.meta ?? {}), modelKey, modelVendor: vendor } },
    })))
  }, { models: MODEL_OF, vendor: VENDOR })
  await win.getByRole('button', { name: '适应视图', exact: true }).first().click()
  await waitForCanvasViewportSettled(win)
  await clickCanvasBlank(win)
  await win.keyboard.press('Control+a')
  await expect.poll(() => win.evaluate(() => window.__nomiCanvasStore.getState().selectedNodeIds.length)).toBe(3)
  await win.locator('[aria-label^="创建分组"]').first().click()
  const groupToolbar = win.locator('[data-group-toolbar="true"]')
  await groupToolbar.waitFor()
  const groupToolbarProof = await proveProbe(groupToolbar, '编组后组工具条在屏上（证明同屏探针是活的）')
  // 旧的批量入口一个都不剩：底部批量栏、框选浮条上的「生成选中 N 个」、按类型统一换模型、并发下拉。
  for (const [selector, message] of [
    ['[data-batch-dock]', '没有底部批量生成栏'],
    ['[data-batch-scope]', '没有「生成全部 / 生成选中」按钮'],
    ['[data-storyboard-run-all]', '没有旧的批量生成按钮标记'],
  ]) {
    await expectAbsent(win.locator(selector), { provenBy: groupToolbarProof, message })
  }
  await snap(win, 'light-group-toolbar')
  await win.locator('button[aria-label="设置"]').first().click()
  await win.getByRole('button', { name: '通用', exact: true }).click()
  await win.locator('button[aria-label="切换到深色模式"], button[aria-label="切换到浅色模式"]').click()
  await win.getByRole('dialog', { name: '设置' }).getByRole('button', { name: '关闭', exact: true }).click()
  await win.waitForTimeout(700)
  await snap(win, 'dark-group-toolbar')

  const generateGroup = groupToolbar.getByRole('button', { name: '生成整组', exact: true })
  const modelsBefore = await win.evaluate(() => window.__nomiCanvasStore.getState().nodes.map((node) => [node.id, node.meta?.modelKey, node.meta?.modelVendor]))
  await generateGroup.click()
  let dialog = await spendDialog(win)
  check(/3\s*(张|个|项|次|份)/.test(await dialog.innerText()), '确认卡覆盖整组 3 张', await dialog.innerText())
  await snap(win, 'spend-confirm-before-cancel')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await win.waitForTimeout(700)
  check(wireCalls.length === 0, '取消付费确认后 vendor 零调用')

  await generateGroup.click()
  dialog = await spendDialog(win)
  // 先给「会失败的那张」的 DOM 打个标：从排队 / 生成中走到失败再到重试成功，必须始终是同一个节点 DOM。
  await win.locator(`[data-node-id="${retryImageId}"]`).evaluate((element) => { element.dataset.batchStable = 'true' })
  await dialog.getByRole('button', { name: '生成', exact: true }).click()
  await win.waitForFunction(() => document.querySelectorAll('[data-kind="image"][data-status="success"]').length >= 2, null, { timeout: 30000 })
  await snap(win, 'generate-group-completed')
  const sourceCall = wireCalls.find((call) => call.prompt.includes('源图'))
  const targetCall = wireCalls.find((call) => call.prompt.includes('下游图'))
  const retryCall = wireCalls.find((call) => call.prompt.includes('重试'))
  check(Boolean(sourceCall && targetCall && retryCall), '整组三个节点的请求都发出了')
  check(targetCall.startedAt >= sourceCall.finishedAt, '下游在上游完成后才开始')
  check(targetCall.hasImage, '下游请求收到上游图片参考')
  // 本条的要点：每个节点发出去的请求里的模型 = 节点自己已选好的模型，没有被统一成同一个。
  check(sourceCall.model === IMAGE_A && targetCall.model === IMAGE_B && retryCall.model === IMAGE_A, '每个节点请求里的模型 = 节点自己的模型', JSON.stringify(wireCalls.map((call) => [call.prompt, call.model])))
  check(new Set(wireCalls.map((call) => call.model)).size === 2, '同一组里两种模型各用各的（没被统一）')
  check(JSON.stringify(await win.evaluate(() => window.__nomiCanvasStore.getState().nodes.map((node) => [node.id, node.meta?.modelKey, node.meta?.modelVendor]))) === JSON.stringify(modelsBefore), '生成整组没有改任何节点的模型')
  check(await win.evaluate(() => window.localStorage.getItem('nomi.canvas.batch-concurrency')) === null, '不再有用户可选的并发偏好')

  // 失败的那张在整组里先报错，通知里给「重试失败的」。
  const notificationRoot = win.locator('.mantine-Notifications-root[data-position="top-right"]')
  const retryNode = win.locator(`[data-node-id="${retryImageId}"]`)
  const failedAlert = retryNode.and(win.locator('[data-status="error"]'))
  await failedAlert.waitFor({ timeout: 15000 })
  check(await retryNode.getAttribute('data-batch-stable') === 'true', '进度到失败复用同一个节点 DOM')
  await expect(retryNode).toContainText('mock fail once')
  const batchFailureAlert = notificationRoot.getByRole('alert').filter({ hasText: /已完成 2 个，1 个失败/ }).first()
  const notificationProof = await proveProbe(batchFailureAlert, '同一通知容器确实能测到本批失败反馈')
  await expectAbsent(notificationRoot.getByRole('alert').filter({ hasText: /开始生成/ }), {
    provenBy: notificationProof, message: '节点已承担进度，不再弹开始生成通知',
  })
  check(await notificationRoot.getByRole('alert').filter({ hasText: /已完成 2 个，1 个失败/ }).count() === 1, '失败后只有一条批量重试通知')
  const runningBox = await batchFailureAlert.boundingBox()
  check(Boolean(runningBox && Math.abs(runningBox.width - 344) <= 1), '通知宽度为 344px', JSON.stringify(runningBox))
  const notificationRootTop = await notificationRoot.evaluate((element) => Number.parseFloat(getComputedStyle(element).top))
  const expectedNotificationTop = process.platform === 'win32' ? 100 : 68
  check(Math.abs(notificationRootTop - expectedNotificationTop) <= 1, `通知容器避开窗口栏和顶栏（top=${expectedNotificationTop}px）`, JSON.stringify({ notificationRootTop, runningBox }))
  check(Boolean(runningBox && runningBox.y >= notificationRootTop), '堆叠通知不会越过通知容器顶部', JSON.stringify({ notificationRootTop, runningBox }))
  const retryAction = batchFailureAlert.getByRole('button', { name: /重试失败的/ })
  check(await retryAction.count() === 1, '失败通知提供独立的重试按钮')
  await retryAction.waitFor({ timeout: 15000 })
  await snap(win, 'failed-with-retry-action')
  // 「重试失败的」这里只有 1 张：同上，不弹卡、直接开始。
  await retryAction.click()
  await expect(retryNode).toHaveAttribute('data-status', /queued|running/)
  await expectAbsent(notificationRoot.getByRole('alert').filter({ hasText: /开始生成/ }), {
    provenBy: notificationProof, message: '重试确已运行时持续观测，不允许进度 toast 短暂出现',
  })
  await win.waitForFunction((id) => document.querySelector(`[data-node-id="${id}"]`)?.getAttribute('data-status') === 'success', retryImageId, { timeout: 30000 })
  const completedAlert = retryNode.and(win.locator('[data-status="success"]'))
  await completedAlert.waitFor({ timeout: 5000 })
  check(await retryNode.getAttribute('data-batch-stable') === 'true', '失败到重试成功仍为同一个节点 DOM')
  await expectAbsent(notificationRoot.getByRole('alert').filter({ hasText: /已完成/ }), {
    provenBy: notificationProof, message: '节点已成功，普通完成不重复弹通知',
  })
  check(wireCalls.filter((call) => call.prompt.includes('重试')).map((call) => call.status).join(',') === '422,200', '失败节点通过一键重试成功')
  await snap(win, 'retry-completed-dark')

  // 底部批量栏已删：画布底部只剩时间轴入口，且点得开。
  await clearSelection(win)
  const timelineHandle = win.getByRole('button', { name: '展开生成时间轴' })
  await expect(win.locator('[data-batch-dock]')).toHaveCount(0)
  check(await timelineHandle.count() === 1, '底部没有批量栏盖住时间轴展开入口')
  await timelineHandle.click()
  await win.waitForTimeout(700)
  check(await win.locator('section[aria-label="生成时间轴"]').count() === 1, '时间轴可从底部入口正常展开')
  await snap(win, 'timeline-unblocked')

  const unexpectedConsoleErrors = consoleErrors.filter((message) => !/mock fail once|HTTP 422|生成失败/i.test(message))
  check(pageErrors.length === 0, '页面运行无 pageerror', pageErrors.join(' | '))
  check(unexpectedConsoleErrors.length === 0, '控制台无意外 error', unexpectedConsoleErrors.join(' | '))
  console.log(`  expected console errors from fail-once path: ${consoleErrors.length - unexpectedConsoleErrors.length}`)
  console.log(`  screenshots: ${shotsDir}`)
  console.log('CANVAS BATCH PRODUCTION WALK: PASS')
} catch (error) {
  console.error('BATCH_FAILURE', error)
  const failureDir = path.join(repoRoot, 'outputs/canvas-batch-production')
  fs.mkdirSync(failureDir, { recursive: true })
  await win.screenshot({ path: path.join(failureDir, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await app.close().catch(() => {})
  await new Promise((resolve) => vendorServer.close(resolve))
}
