// ComfyUI「导入自定义工作流」面板的共用走查骨架：一台本地假 ComfyUI + 种好指向它的 comfyui-local
// → 启动真实应用 → 打开导入面板 → 粘贴并分析。
//
// 入口导航只写这一份。2026-09 模型设置改版后，ComfyUI 被收进了「其他方式」分组，
// 而各条走查各抄了一份旧导航，结果一起过期、一起报红。所以锚点改用组件自带的
// data-model-home-* 标记（与 model-access-journeys/ui-driver.mjs 同一套），不按翻译文案找。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, clickOrFail, DEFAULT_TIMEOUT_MS } from './_assert.mjs'

/** 面板上走查要点的几处可见文案（按语言）。 */
export const PANEL_TEXT = {
  'zh-CN': { importCustom: '自定义', pasteArea: 'ComfyUI 工作流 JSON', analyze: '分析', report: '反馈给 Nomi' },
  en: { importCustom: 'Custom Workflow', pasteArea: 'ComfyUI workflow JSON', analyze: 'Analyze workflow', report: 'Report Issue' },
}

/**
 * 假 ComfyUI：/object_info 返回给定索引。onPrompt(prompt) 可以返回 { status, body } 来模拟 /prompt 的回应，
 * 不返回就按受理处理。其余路径一律 404。
 */
export async function startFakeComfy({ objectInfo, onPrompt }) {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/object_info') return res.end(JSON.stringify(objectInfo))
    if (req.url === '/system_stats') return res.end(JSON.stringify({ system: { comfyui_version: '0.35.0' }, devices: [] }))
    if (req.method === 'POST' && req.url === '/prompt' && onPrompt) {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        const reply = onPrompt(JSON.parse(raw).prompt ?? {}) ?? { status: 200, body: { prompt_id: 'walk-prompt', number: 1, node_errors: {} } }
        res.statusCode = reply.status
        res.end(JSON.stringify(reply.body))
      })
      return
    }
    res.statusCode = 404
    res.end('{}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }
}

/** 种一台指向假服务器的 comfyui-local，启动应用，一路点到导入面板（粘贴框可见为止）。 */
export async function openComfyImportPanel({ name, baseUrl, locale = 'zh-CN' }) {
  const settingsDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), `nomi-${name}-`)), 'settings')
  fs.mkdirSync(settingsDir, { recursive: true })
  fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
    version: 12,
    vendors: [{
      key: 'comfyui-local', name: '本地 ComfyUI', enabled: false, authType: 'none', authHeader: null,
      baseUrlHint: baseUrl, createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z',
    }],
    models: [], mappings: [], apiKeysByVendor: {},
  }, null, 2))

  const { app, win } = await launchNomiApp({ name, settingsDir, settleMs: 2200 })
  await win.evaluate((lang) => {
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1', 'nomi-onboarding-checklist:v1']) window.localStorage.setItem(k, 'seen')
    window.localStorage.setItem('nomi:locale:v1', lang)
  }, locale)
  await win.reload()
  await win.waitForTimeout(2200)
  for (let i = 0; i < 5; i += 1) {
    const skip = win.locator('button,[role="button"],a', { hasText: /跳过|开始创作|进入|完成|先逛逛|Skip/i }).first()
    if (await skip.count()) await skip.click({ timeout: 800 }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(220)
  }

  const text = PANEL_TEXT[locale]
  await clickOrFail(win.locator('[data-testid="open-model-settings"]').first(), '模型设置 入口', { timeout: DEFAULT_TIMEOUT_MS })
  const comfyRow = win.locator('[data-model-home-available="comfyui-local"]').first()
  if (!(await comfyRow.isVisible().catch(() => false))) {
    await clickOrFail(win.locator('[data-model-home-action="other-ways"]').first(), '「其他方式」分组', { timeout: DEFAULT_TIMEOUT_MS })
  }
  await clickOrFail(comfyRow, 'ComfyUI 行', { timeout: DEFAULT_TIMEOUT_MS })
  await clickOrFail(win.locator('button', { hasText: text.importCustom }).first(), '展开「导入自定义工作流」', { timeout: DEFAULT_TIMEOUT_MS })
  const textarea = win.locator(`textarea[aria-label="${text.pasteArea}"]`).first()
  await expect(textarea, '没找到工作流粘贴框').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  return { app, win, settingsDir, text, textarea }
}

/** 粘贴工作流并点「分析」。 */
export async function pasteAndAnalyze({ win, text, textarea }, graph) {
  await textarea.fill(JSON.stringify(graph, null, 2))
  await clickOrFail(win.locator('button', { hasText: text.analyze }).first(), '分析 按钮', { timeout: DEFAULT_TIMEOUT_MS })
}
