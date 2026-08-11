// Real Electron journey for canvas batch production. The UI, spend gate, IPC, queue, HTTP transport,
// persistence, retry, and screenshots are real; only the remote vendor is replaced by a loopback fixture.
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
const VIDEO_A = 'batch-video-a'
const VIDEO_B = 'batch-video-b'
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
    call.status = shouldFail ? 500 : 200
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
      headers: { Authorization: 'Bearer {{user_api_key}}', 'Content-Type': 'application/json' },
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
    authType: 'bearer',
    authHeader: null,
    authQueryParam: null,
    providerKind: 'openai-compatible',
    createdAt: NOW,
    updatedAt: NOW,
  }],
  models: [
    { modelKey: IMAGE_A, vendorKey: VENDOR, labelZh: '批量图片 A', kind: 'image', enabled: true, meta: { archetypeId: 'agnes-image' }, createdAt: NOW, updatedAt: NOW },
    { modelKey: IMAGE_B, vendorKey: VENDOR, labelZh: '批量图片 B', kind: 'image', enabled: true, meta: { archetypeId: 'agnes-image' }, createdAt: NOW, updatedAt: NOW },
    { modelKey: VIDEO_A, vendorKey: VENDOR, labelZh: '批量视频 A', kind: 'video', enabled: true, createdAt: NOW, updatedAt: NOW },
    { modelKey: VIDEO_B, vendorKey: VENDOR, labelZh: '批量视频 B', kind: 'video', enabled: true, createdAt: NOW, updatedAt: NOW },
  ],
  mappings: [IMAGE_A, IMAGE_B].flatMap((modelKey) => [
    imageMapping(modelKey, 'text_to_image'),
    imageMapping(modelKey, 'image_edit'),
  ]),
  apiKeysByVendor: {
    [VENDOR]: { apiKey: 'sk-batch-mock', vendorKey: VENDOR, enabled: true, enc: 'plain', createdAt: NOW, updatedAt: NOW },
  },
}, null, 2))

let shotIndex = 0
async function snap(win, name) {
  shotIndex += 1
  const file = path.join(shotsDir, `${String(shotIndex).padStart(2, '0')}-${name}.png`)
  await win.screenshot({ path: file })
  console.log(`  screenshot: ${path.basename(file)}`)
  return file
}

function check(condition, message, details = '') {
  if (!condition) throw new Error(`${message}${details ? `: ${details}` : ''}`)
  console.log(`  ok: ${message}`)
}

async function matchesCssVariable(locator, property, variable) {
  return locator.evaluate((element, { property, variable }) => {
    const probe = document.createElement('span')
    probe.style.setProperty(property, `var(${variable})`)
    document.body.appendChild(probe)
    const actual = getComputedStyle(element).getPropertyValue(property)
    const expected = getComputedStyle(probe).getPropertyValue(property)
    probe.remove()
    return actual === expected
  }, { property, variable })
}

async function hasPaintedClass(locator, className, property = 'background-color') {
  return locator.evaluate((element, { className, property }) => {
    const value = getComputedStyle(element).getPropertyValue(property)
    return element.classList.contains(className) && value !== '' && value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)'
  }, { className, property })
}

async function dismissFirstRun(win) {
  await win.evaluate(() => {
    window.localStorage.setItem('__nomiE2E', '1')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1', 'nomi-onboarding-checklist:v1']) {
      window.localStorage.setItem(key, 'seen')
    }
  })
  await win.reload()
  await win.waitForTimeout(1200)
  for (let index = 0; index < 5; index += 1) {
    const skip = win.locator('button,[role="button"],a', { hasText: /跳过|开始创作|进入|完成|先逛逛/ }).first()
    if (await skip.count()) await skip.click({ timeout: 800 }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(200)
  }
}

async function addNodeWithPrompt(win, kind, prompt) {
  await win.locator(`[aria-label="添加${kind}节点"]`).first().click({ timeout: 5000 })
  await win.waitForTimeout(900)
  const nodes = win.locator(`[data-kind="${kind === '图片' ? 'image' : 'video'}"][data-node-id]`)
  const target = nodes.last()
  await target.waitFor({ timeout: 5000 })
  const id = await target.getAttribute('data-node-id')
  const editor = win.locator('div[contenteditable="true"]').last()
  await editor.click({ timeout: 5000 })
  await win.keyboard.insertText(prompt)
  await win.waitForTimeout(500)
  return id
}

async function clearSelection(win) {
  const clear = win.locator('button[aria-label="清除选择"]').first()
  if (await clear.count()) {
    await clear.click()
  } else {
    const stage = win.locator('.generation-canvas-v2__stage').first()
    const box = await stage.boundingBox()
    if (box) await stage.click({ position: { x: Math.max(20, box.width - 80), y: 80 } })
  }
  await win.waitForTimeout(500)
}

async function chooseSelectOption(win, ariaLabel, optionText) {
  await win.locator(`button[aria-label="${ariaLabel}"]`).first().click({ timeout: 5000 })
  const option = win.getByRole('option').filter({ hasText: optionText }).first()
  await option.waitFor({ timeout: 5000 })
  await option.click()
  await win.waitForTimeout(600)
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
  userDataDir,
  settingsDir,
  projectsDir,
  settleMs: 1200,
  env: {
    NOMI_RENDERER_URL: `file://${path.join(repoRoot, 'dist/index.html')}`,
  },
})

try {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((window) => window.setBounds({ x: 0, y: 0, width: 1680, height: 1020 }))
  win.on('pageerror', (error) => pageErrors.push(String(error)))
  win.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  await dismissFirstRun(win)

  await win.getByText('新建空白项目', { exact: false }).first().click({ timeout: 5000 })
  await win.waitForTimeout(2200)
  await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click({ timeout: 5000 })
  await win.waitForTimeout(1400)

  await win.getByRole('button', { name: /模型接入/ }).first().click({ timeout: 5000 })
  const modelPanel = win.getByRole('dialog', { name: '模型设置' })
  await modelPanel.waitFor({ state: 'visible', timeout: 5000 })
  await win.waitForTimeout(900)
  const imageCapability = modelPanel.locator('span').filter({ hasText: /^图片\s*\d+$/ }).first()
  const connectedDot = modelPanel.locator('button').filter({ hasText: 'Batch Mock' }).first().locator('span.bg-workbench-success').first()
  const connectedPill = connectedDot.locator('..')
  await imageCapability.waitFor({ state: 'visible', timeout: 5000 })
  await connectedDot.waitFor({ state: 'visible', timeout: 5000 })
  check(await matchesCssVariable(imageCapability, 'color', '--nomi-accent'), '已启用图片能力使用 Nomi 强调蓝')
  check(await hasPaintedClass(imageCapability, 'bg-nomi-accent-soft'), '能力 chip 使用强调色浅底')
  check(await hasPaintedClass(connectedPill, 'bg-nomi-ink-10'), '已连通胶囊使用中性表面')
  check(await hasPaintedClass(connectedDot, 'bg-workbench-success'), '已连通只保留小绿点')
  await snap(win, 'light-model-status-colors')
  await modelPanel.getByRole('button', { name: '关闭', exact: true }).click()
  await win.waitForTimeout(400)

  const sourceId = await addNodeWithPrompt(win, '图片', '依赖波次源图')
  await clearSelection(win)
  const targetId = await addNodeWithPrompt(win, '图片', '依赖波次下游图')
  await win.waitForTimeout(1400)
  await clearSelection(win)

  const source = win.locator(`[data-node-id="${sourceId}"]`)
  await source.click({ position: { x: 36, y: 36 } })
  await win.waitForTimeout(500)
  const target = win.locator(`[data-node-id="${targetId}"]`)
  const handleBox = await source.locator('[data-side="right"]').boundingBox()
  const targetBox = await target.boundingBox()
  check(Boolean(handleBox && targetBox), '连接点和目标节点都有可点击区域')
  await win.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await win.mouse.down()
  await win.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 })
  await win.waitForTimeout(300)
  await win.mouse.up()
  await win.waitForTimeout(900)
  check(await win.locator('.generation-canvas-v2__edge-path').count() === 1, '真实点击建立依赖边')
  await clearSelection(win)

  const generateAll = win.locator('[data-batch-scope="all"]')
  await generateAll.waitFor({ timeout: 5000 })
  check((await generateAll.textContent())?.includes('2'), '无选择入口显示两个待生成节点')
  await chooseSelectOption(win, '并发', '2')
  check(await win.evaluate(() => window.localStorage.getItem('nomi.canvas.batch-concurrency')) === '2', '并发偏好写入本地存储')
  await snap(win, 'light-generate-all')

  await generateAll.click()
  let dialog = await spendDialog(win)
  await snap(win, 'spend-confirm-before-cancel')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await win.waitForTimeout(700)
  check(wireCalls.length === 0, '取消付费确认后 vendor 零调用')

  await generateAll.click()
  dialog = await spendDialog(win)
  await dialog.getByRole('button', { name: '生成', exact: true }).click()
  await win.waitForFunction(() => document.querySelectorAll('[data-kind="image"][data-status="success"]').length >= 2, null, { timeout: 30000 })
  await snap(win, 'generate-all-completed')
  await win.waitForTimeout(400)
  check(await generateAll.count() === 0, '全部节点完成后批量生成底栏退出，不显示“生成全部 0 个”')
  const sourceCall = wireCalls.find((call) => call.prompt.includes('源图'))
  const targetCall = wireCalls.find((call) => call.prompt.includes('下游图'))
  check(Boolean(sourceCall && targetCall), '依赖波次两个请求都完成')
  check(targetCall.startedAt >= sourceCall.finishedAt, '下游在上游完成后才开始')
  check(targetCall.hasImage, '下游请求收到上游图片参考')

  await clearSelection(win)
  const retryImageId = await addNodeWithPrompt(win, '图片', '批量生成失败后重试')
  await clearSelection(win)
  const videoId = await addNodeWithPrompt(win, '视频', '批量视频模型切换验证')
  check(Boolean(retryImageId && videoId), '真实点击新增图片和视频节点')
  await clearSelection(win)
  await win.locator('.generation-canvas-v2__stage').click({ position: { x: 900, y: 100 } }).catch(() => {})
  await win.keyboard.press('Meta+a')
  await win.waitForTimeout(900)

  const selectedGenerate = win.locator('[data-batch-scope="selection"]')
  await selectedGenerate.waitFor({ timeout: 5000 })
  check((await selectedGenerate.textContent())?.includes('2'), '混合选择只统计两个待生成节点')
  await chooseSelectOption(win, '图片 ×3', '批量图片 B')
  await chooseSelectOption(win, '视频 ×1', '批量视频 B')
  await win.waitForTimeout(1200)
  const projectFile = findProjectJson(projectsDir)
  check(Boolean(projectFile), '批量模型更新已触发项目持久化')
  const persistedNodes = JSON.parse(fs.readFileSync(projectFile, 'utf8')).payload.generationCanvas.nodes
  check(persistedNodes.filter((node) => node.kind === 'image').every((node) => node.meta?.modelKey === IMAGE_B), '三个图片节点统一切到图片 B')
  check(persistedNodes.find((node) => node.id === videoId)?.meta?.modelKey === VIDEO_B, '视频节点切到视频 B')
  await snap(win, 'light-mixed-selection-models')

  await win.locator('button[aria-label="设置"]').first().click()
  await win.getByRole('button', { name: '通用', exact: true }).click()
  await win.locator('button[aria-label="切换到深色模式"], button[aria-label="切换到浅色模式"]').click()
  await win.getByRole('dialog', { name: '设置' }).getByRole('button', { name: '关闭', exact: true }).click()
  await win.waitForTimeout(700)
  await snap(win, 'dark-mixed-selection-models')

  await win.getByRole('button', { name: /模型接入/ }).first().click({ timeout: 5000 })
  await modelPanel.waitFor({ state: 'visible', timeout: 5000 })
  await win.waitForTimeout(900)
  check(await matchesCssVariable(modelPanel.locator('span').filter({ hasText: /^图片\s*\d+$/ }).first(), 'color', '--nomi-accent'), '暗色下能力强调蓝 token 生效')
  check(await hasPaintedClass(connectedPill, 'bg-nomi-ink-10'), '暗色下已连通胶囊保持中性')
  const modelPanelBox = await modelPanel.boundingBox()
  const modelNotificationBoxes = await win
    .locator('.mantine-Notifications-root[data-position="top-right"]')
    .getByRole('alert')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect()).map(({ x, width }) => ({ x, width })))
  check(modelNotificationBoxes.length > 0, '模型切换反馈通知仍然可见')
  check(
    Boolean(modelPanelBox && modelNotificationBoxes.every((box) => box.x + box.width <= modelPanelBox.x - 8)),
    '模型面板打开时通知不会遮挡面板',
    JSON.stringify({ modelPanelBox, modelNotificationBoxes })
  )
  await snap(win, 'dark-model-status-colors')
  await modelPanel.getByRole('button', { name: '关闭', exact: true }).click()
  await win.waitForTimeout(400)

  const callsBeforeSelectedCancel = wireCalls.length
  await selectedGenerate.click()
  dialog = await spendDialog(win)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await win.waitForTimeout(700)
  check(wireCalls.length === callsBeforeSelectedCancel, '混合选中生成取消后 vendor 零新增调用')

  await win.locator('button[aria-label="清除选择"]').click()
  await win.locator(`[data-node-id="${retryImageId}"]`).click({ position: { x: 40, y: 40 } })
  await win.locator(`[data-node-id="${sourceId}"]`).click({ position: { x: 40, y: 40 }, modifiers: ['Shift'] })
  await win.waitForTimeout(800)
  const retrySelectionGenerate = win.locator('[data-batch-scope="selection"]')
  check((await retrySelectionGenerate.textContent())?.includes('1'), '选中批量只生成一个失败待测节点')
  await retrySelectionGenerate.click()
  dialog = await spendDialog(win)
  await dialog.getByRole('button', { name: '生成', exact: true }).click()
  const notificationRoot = win.locator('.mantine-Notifications-root[data-position="top-right"]')
  const runningAlert = notificationRoot.getByRole('alert').filter({ hasText: /开始生成/ }).first()
  await runningAlert.waitFor({ timeout: 5000 })
  await runningAlert.evaluate((element) => { element.dataset.batchStable = 'true' })
  check(await notificationRoot.getByRole('alert').filter({ hasText: /开始生成/ }).count() === 1, '批量开始时只有一条对应通知')
  const runningBox = await runningAlert.boundingBox()
  check(Boolean(runningBox && Math.abs(runningBox.width - 344) <= 1), '通知宽度为 344px', JSON.stringify(runningBox))
  const notificationRootTop = await notificationRoot.evaluate((element) => Number.parseFloat(getComputedStyle(element).top))
  const expectedNotificationTop = process.platform === 'win32' ? 100 : 68
  check(Math.abs(notificationRootTop - expectedNotificationTop) <= 1, `通知容器避开窗口栏和顶栏（top=${expectedNotificationTop}px）`, JSON.stringify({ notificationRootTop, runningBox }))
  check(Boolean(runningBox && runningBox.y >= notificationRootTop), '堆叠通知不会越过通知容器顶部', JSON.stringify({ notificationRootTop, runningBox }))
  const failedAlert = notificationRoot.getByRole('alert').filter({ hasText: /生成失败/ }).first()
  await failedAlert.waitFor({ timeout: 15000 })
  check(await failedAlert.getAttribute('data-batch-stable') === 'true', '开始到失败原位更新同一个通知 DOM')
  check(await notificationRoot.getByRole('alert').filter({ hasText: /生成失败/ }).count() === 1, '失败后没有堆叠第二条批量通知')
  const retryAction = failedAlert.getByRole('button', { name: /重试失败的/ })
  check(await retryAction.count() === 1, '失败通知提供独立的重试按钮')
  await retryAction.waitFor({ timeout: 15000 })
  await snap(win, 'failed-with-retry-action')
  await retryAction.click()
  dialog = await spendDialog(win)
  await dialog.getByRole('button', { name: '生成', exact: true }).click()
  await win.waitForFunction((id) => document.querySelector(`[data-node-id="${id}"]`)?.getAttribute('data-status') === 'success', retryImageId, { timeout: 30000 })
  const completedAlert = notificationRoot.getByRole('alert').filter({ hasText: /已完成/ }).first()
  await completedAlert.waitFor({ timeout: 5000 })
  check(await notificationRoot.getByRole('alert').filter({ hasText: /已完成/ }).count() === 1, '重试完成后仍只有一条对应通知')
  check(wireCalls.filter((call) => call.prompt.includes('重试')).map((call) => call.status).join(',') === '500,200', '失败节点通过一键重试成功')
  check(await win.evaluate(() => window.localStorage.getItem('nomi.canvas.batch-concurrency')) === '2', '重试后并发偏好仍为 2')
  await snap(win, 'retry-completed-dark')

  const unexpectedConsoleErrors = consoleErrors.filter((message) => !/mock fail once|HTTP 500|生成失败/i.test(message))
  check(pageErrors.length === 0, '页面运行无 pageerror', pageErrors.join(' | '))
  check(unexpectedConsoleErrors.length === 0, '控制台无意外 error', unexpectedConsoleErrors.join(' | '))
  console.log(`  expected console errors from fail-once path: ${consoleErrors.length - unexpectedConsoleErrors.length}`)
  console.log(`  screenshots: ${shotsDir}`)
  console.log('CANVAS BATCH PRODUCTION WALK: PASS')
} finally {
  await app.close().catch(() => {})
  await new Promise((resolve) => vendorServer.close(resolve))
}
