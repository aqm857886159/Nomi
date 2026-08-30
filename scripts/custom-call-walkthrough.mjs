// 真机走查：连接页 → 第三层模型弹窗 → 调用脚本 → 插入模板 → 试跑失败态 → 试跑成功。
// 试跑打到本脚本起的 mock 中转（先 400 再 200），验证 transcript 摊开与 AI 修复入口。截图人眼判断。
// 用法：node scripts/custom-call-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.custom-call-recon')
mkdirSync(outDir, { recursive: true })
const settingsDir = mkdtempSync(path.join(os.tmpdir(), 'custom-call-walk-'))
const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }

async function modelDialogState(win, pageSelector) {
  return win.evaluate((selector) => {
    const visible = (element) => element instanceof HTMLElement && element.getClientRects().length > 0 && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden'
    const highestLayer = (start) => {
      let current = start
      let highest = 0
      while (current) {
        const value = Number.parseInt(getComputedStyle(current).zIndex || '0', 10)
        if (Number.isFinite(value)) highest = Math.max(highest, value)
        current = current.parentElement
      }
      return highest
    }
    const toRect = (element) => {
      if (!(element instanceof HTMLElement)) return null
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }
    }
    const settings = document.querySelector('[data-settings-dialog]')
    const modelRoot = document.querySelector('[data-model-settings-dialog]')
    const modelPanel = modelRoot?.closest('[role="dialog"]')
    const page = document.querySelector(selector)
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      visibleDialogs: [...document.querySelectorAll('[role="dialog"]')].filter(visible).length,
      settingsVisible: visible(settings),
      modelVisible: visible(modelRoot) && visible(modelPanel),
      pageInsideModel: page instanceof HTMLElement && Boolean(modelRoot?.contains(page)),
      pageInsideSettings: page instanceof HTMLElement && Boolean(settings?.contains(page)),
      focusInsideModel: document.activeElement instanceof Element && Boolean(modelRoot?.contains(document.activeElement)),
      settingsLayer: settings ? highestLayer(settings) : 0,
      modelLayer: modelPanel ? highestLayer(modelPanel) : 0,
      settingsRect: toRect(settings),
      modelRect: toRect(modelPanel),
      horizontalOverflow: [modelPanel, page].some((element) => element instanceof HTMLElement && element.scrollWidth > element.clientWidth + 2),
      documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
    }
  }, pageSelector)
}

function assertModelDialog(state, label, narrow = false) {
  if (state.visibleDialogs !== 2) throw new Error(`${label}: expected Settings plus model dialog, got ${state.visibleDialogs}`)
  if (!state.settingsVisible || !state.modelVisible) throw new Error(`${label}: Settings or model dialog is hidden`)
  if (!state.pageInsideModel || state.pageInsideSettings) throw new Error(`${label}: page is not owned by the model dialog`)
  if (!state.focusInsideModel) throw new Error(`${label}: keyboard focus escaped the model dialog`)
  if (state.modelLayer <= state.settingsLayer) throw new Error(`${label}: model dialog is not above Settings (${state.modelLayer} <= ${state.settingsLayer})`)
  if (state.horizontalOverflow || state.documentOverflow) throw new Error(`${label}: horizontal overflow ${JSON.stringify(state)}`)
  if (narrow) {
    if (state.modelRect.x < 0 || state.modelRect.y < 0 || state.modelRect.right > state.viewport.width + 1 || state.modelRect.bottom > state.viewport.height + 1) {
      throw new Error(`${label}: model dialog extends beyond the viewport ${JSON.stringify(state.modelRect)}`)
    }
    if (state.modelRect.width < state.viewport.width - 32 || state.modelRect.height < state.viewport.height - 32) {
      throw new Error(`${label}: model dialog is not near full-screen ${JSON.stringify(state)}`)
    }
    return
  }
  if (Math.abs(state.settingsRect.width - 760) > 1 || Math.abs(state.settingsRect.height - 560) > 1) {
    throw new Error(`${label}: Settings shell changed size ${JSON.stringify(state.settingsRect)}`)
  }
  if (Math.abs(state.modelRect.width - 880) > 1 || Math.abs(state.modelRect.height - 640) > 1) {
    throw new Error(`${label}: model dialog is not 880x640 ${JSON.stringify(state.modelRect)}`)
  }
}

// mock 中转：第一发 /images/generations 返回 400（unknown field），第二发起返回 200 图。
let hits = 0
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const mock = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    if (req.method !== 'POST' || !req.url?.endsWith('/images/generations')) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }
    hits += 1
    if (hits === 1) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'unknown field: image_url, did you mean first_frame_image?' }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [{ b64_json: PNG }] }))
  })
})
await new Promise((resolve, reject) => {
  mock.once('error', reject)
  mock.listen(0, '127.0.0.1', resolve)
})
const mockAddress = mock.address()
if (!mockAddress || typeof mockAddress === 'string') throw new Error('mock relay did not expose a TCP port')
const mockBaseUrl = `http://127.0.0.1:${mockAddress.port}/v1`
console.log(`  🟢 mock relay on ${mockBaseUrl}`)

const { app, win } = await launchNomiApp({
  name: 'custom-call',
  settingsDir,
  env: { NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html') },
  settleMs: 1600,
  syntheticCredentialStorage: true,
})
const errors = []
try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  const skip = win.getByRole('button', { name: /跳过|Skip/ }).first()
  if (await skip.isVisible().catch(() => false)) await skip.click()
  await win.waitForTimeout(300)

  // 种一个自定义中转家（地址=mock，一个图像模型 seedream，一个文本模型当 AI 帮写脑）。
  await win.evaluate((baseUrl) => {
    const b = window.nomiDesktop
    b.modelCatalog.upsertVendor({ key: 'custom-mock-relay', name: '我的中转站', baseUrlHint: baseUrl, protocol: 'openai', authType: 'bearer' })
    b.modelCatalog.upsertVendorApiKey('custom-mock-relay', { apiKey: 'sk-mock', enabled: true })
    b.modelCatalog.upsertModel({ vendorKey: 'custom-mock-relay', modelKey: 'seedream-4', labelZh: 'seedream-4', kind: 'image', enabled: true })
    window.dispatchEvent(new CustomEvent('nomi-model-catalog-changed'))
  }, mockBaseUrl)
  await win.waitForTimeout(300)

  // 打开模型设置，依次进入连接页和模型页。
  const openBtn = win.getByRole('button', { name: /模型接入|模型设置/ }).first()
  if (await openBtn.isVisible().catch(() => false)) await openBtn.click()
  else await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-model-catalog')))
  await win.waitForTimeout(700)
  const settings = win.locator('[data-settings-dialog]')
  await settings.waitFor({ state: 'visible' })
  await win.getByText('我的中转站', { exact: false }).first().click()
  await win.waitForSelector('[data-model-settings-page="connection"]')
  await win.getByRole('button', { name: 'seedream-4', exact: true }).click()
  const modelDialog = win.locator('[data-model-settings-dialog]')
  await modelDialog.waitFor({ state: 'visible' })
  await win.waitForSelector('[data-model-settings-page="model"]')
  assertModelDialog(await modelDialogState(win, '[data-model-settings-page="model"]'), 'model detail')
  await shot(win, 'w1-model-row-with-customcall-icon.png')

  // 具体模型发起的脚本继续留在同一个第三层弹窗中。
  await win.getByRole('button', { name: /调用脚本|Custom call/, exact: true }).click()
  await win.waitForSelector('[data-model-settings-page="script"]')
  const scriptPage = win.locator('[data-model-settings-page="script"]')
  assertModelDialog(await modelDialogState(win, '[data-model-settings-page="script"]'), 'custom call editor')
  await win.getByText('返回要求', { exact: true }).waitFor()
  await win.getByText('可用变量', { exact: true }).waitFor()
  await shot(win, 'w2-editor-opened.png')

  // 插入「OpenAI 图」模板。
  const tplBtn = win.getByRole('button', { name: /OpenAI 图/ }).first()
  if (await tplBtn.isVisible().catch(() => false)) await tplBtn.click()
  const scriptInput = win.locator('[data-model-settings-page="script"] textarea[aria-label*="seedream-4"]')
  await scriptInput.fill(`${await scriptInput.inputValue()}\n// draft-survives-cancelled-close`)
  await win.waitForTimeout(300)
  await shot(win, 'w3-template-inserted.png')

  // 第三层弹窗拥有 Escape 与未保存保护；取消后弹窗和脚本草稿都必须保留。
  await win.keyboard.press('Escape')
  const discardPromptRoot = win.locator('[data-confirm-dialog="confirm"]')
  const discardPrompt = discardPromptRoot.locator('[role="dialog"]')
  await discardPrompt.waitFor({ state: 'visible' })
  const layers = await win.evaluate(() => {
    const highestLayer = (start) => {
      let current = start
      let highest = 0
      while (current) {
        const value = Number.parseInt(getComputedStyle(current).zIndex || '0', 10)
        if (Number.isFinite(value)) highest = Math.max(highest, value)
        current = current.parentElement
      }
      return highest
    }
    return {
      settings: highestLayer(document.querySelector('[data-settings-dialog]')),
      model: highestLayer(document.querySelector('[data-model-settings-dialog]')),
      confirmation: highestLayer(document.querySelector('[data-confirm-dialog="confirm"] [role="dialog"]')),
    }
  })
  if (!(layers.confirmation > layers.model && layers.model > layers.settings)) throw new Error(`Incorrect dialog layer order: ${JSON.stringify(layers)}`)
  await discardPromptRoot.locator('[data-confirm-dialog-cancel="true"]').click()
  await scriptPage.waitFor({ state: 'visible' })
  await modelDialog.waitFor({ state: 'visible' })
  if (!(await scriptInput.inputValue()).includes('draft-survives-cancelled-close')) throw new Error('Script draft was lost after cancelling dialog close')

  // 真正的移动宽度：测试时临时解除 BrowserWindow 最小尺寸，不改产品默认值。
  await bw.evaluate((window) => {
    window.setMinimumSize(320, 500)
    window.setBounds({ x: 0, y: 0, width: 390, height: 844 })
  }).catch(() => {})
  await win.waitForTimeout(250)
  const mobileLayout = await win.locator('[data-model-settings-page="script"]').evaluate((page) => {
    const sidebar = page.querySelector('[data-custom-call-contract-sidebar]')
    const editor = page.querySelector('[data-custom-call-editor-main]')
    if (!(sidebar instanceof HTMLElement) || !(editor instanceof HTMLElement)) return null
    return {
      editorBeforeContract: editor.getBoundingClientRect().top < sidebar.getBoundingClientRect().top,
      horizontalOverflow: page.scrollWidth > page.clientWidth + 1,
    }
  })
  if (!mobileLayout?.editorBeforeContract || mobileLayout.horizontalOverflow) throw new Error(`Narrow script layout failed: ${JSON.stringify(mobileLayout)}`)
  assertModelDialog(await modelDialogState(win, '[data-model-settings-page="script"]'), 'narrow custom call editor', true)
  await shot(win, 'w3b-mobile-contract-stack.png')
  await bw.evaluate((window) => window.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })).catch(() => {})
  await win.waitForTimeout(250)

  // 试跑（第一发 400 → 失败态摊开 transcript + AI 修复入口）。
  await win.getByRole('button', { name: /试跑一次/ }).first().click()
  await win.waitForTimeout(2500)
  await shot(win, 'w4-testrun-failed.png')

  // 再试跑（第二发 200 → 成功 + 缩略图）。
  await win.getByRole('button', { name: /试跑一次/ }).first().click()
  await win.waitForTimeout(2500)
  await shot(win, 'w5-testrun-ok.png')

  // Discarding the draft closes only the third layer and reveals its owning connection.
  await win.keyboard.press('Escape')
  await discardPrompt.waitFor({ state: 'visible' })
  await discardPromptRoot.locator('[data-confirm-dialog-confirm="true"]').click()
  await discardPrompt.waitFor({ state: 'hidden' })
  await modelDialog.waitFor({ state: 'detached' })
  const connectionPage = win.locator('[data-model-settings-page="connection"]')
  await connectionPage.waitFor({ state: 'visible' })
  const returnState = await win.evaluate(() => {
    const visible = (element) => element instanceof HTMLElement && element.getClientRects().length > 0 && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden'
    const settingsFrame = document.querySelector('[data-settings-dialog]')
    const connection = document.querySelector('[data-model-settings-page="connection"]')
    return {
      settingsVisible: visible(settingsFrame),
      connectionVisible: visible(connection),
      connectionInsideSettings: connection instanceof HTMLElement && Boolean(settingsFrame?.contains(connection)),
      modelDialogVisible: visible(document.querySelector('[data-model-settings-dialog]')),
      confirmationVisible: visible(document.querySelector('[data-confirm-dialog="confirm"] [role="dialog"]')),
    }
  })
  if (!returnState.settingsVisible || !returnState.connectionVisible || !returnState.connectionInsideSettings || returnState.modelDialogVisible || returnState.confirmationVisible) {
    throw new Error(`Closing the model dialog did not return to its Settings connection: ${JSON.stringify(returnState)}`)
  }

  console.log('  ℹ️ mock hits=' + hits + ' pageErrors=' + errors.length)
  if (errors.length) console.log('  ⚠️ ' + errors.slice(0, 4).join(' | '))
} catch (error) {
  console.error('  walkthrough failed:', error)
  try { await shot(win, 'ERROR.png') } catch { /* noop */ }
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
  mock.close()
}
console.log('done → ' + outDir)
