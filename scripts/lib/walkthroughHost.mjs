// 共享走查宿主辅助库（Q-smell 味道② 收口 `scripts/*-walkthrough.mjs` 公共样板）。
// 提供窗口尺寸与错误收集、截图与几何测量、本地 mock HTTP 启动与延迟 SSE、
// 设置三级模型弹窗 DOM 态探针、空白项目画布/ComfyUI 入口导航、seed 项目定位与 nomi-local:// 探针。
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * 调整 Electron 走查窗口大小并挂载 pageerror / console(error) 收集器。
 * 返回收集数组，便于脚本末尾统一汇报错误。
 */
export async function prepareWalkthroughWindow(
  app,
  win,
  { width = 1600, height = 1000, collectErrors = true, settleMs = 0, errors = [] } = {},
) {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w, bounds) => w.setBounds(bounds), { x: 0, y: 0, width, height }).catch(() => {})
  if (collectErrors) {
    win.on('pageerror', (e) => errors.push(String(e)))
    win.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
  }
  if (settleMs > 0) await win.waitForTimeout(settleMs)
  return errors
}

/** 创建走查截图函数，保持各脚本原有输出前缀与落盘路径。 */
export function createWalkthroughScreenshotter(outDir, { prefix = '  📸 ', logFullPath = false } = {}) {
  return async (win, name) => {
    const target = path.join(outDir, name)
    await win.screenshot({ path: target })
    console.log(`${prefix}${logFullPath ? target : name}`)
  }
}

/** 读取 Playwright locator 的客户端边界矩形。 */
export async function measureLocatorRect(locator) {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect()
    return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom }
  })
}

/** 在 127.0.0.1 随机可用端口拉起本地 mock HTTP 服务器并返回 port 与 baseUrl。 */
export async function listenLocalHttpServer(server, { label = 'Local mock', pathSuffix = '/v1' } = {}) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error(`${label} did not expose a TCP port`)
  }
  return {
    port: address.port,
    baseUrl: `http://127.0.0.1:${address.port}${pathSuffix}`,
  }
}

/**
 * 向本地 mock HTTP 响应流式写回一条 OpenAI 兼容 SSE chat completion（支持可取消延迟）。
 */
export function streamDelayedOpenAiChatCompletion(
  response,
  { id = 'chatcmpl-nomi-walk', model, delayMs = 0, delayedResponses },
) {
  const send = () => {
    if (response.destroyed) return
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    response.write(`data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1_000),
      model,
      choices: [{ index: 0, delta: { role: 'assistant', content: 'ready' }, finish_reason: null }],
    })}\n\n`)
    response.write(`data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1_000),
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`)
    response.end('data: [DONE]\n\n')
  }
  if (delayMs <= 0) {
    send()
    return
  }
  let timer
  const clearDelay = () => {
    if (!timer) return
    clearTimeout(timer)
    delayedResponses?.delete(timer)
    timer = undefined
  }
  timer = setTimeout(() => {
    const completedTimer = timer
    timer = undefined
    if (completedTimer) delayedResponses?.delete(completedTimer)
    send()
  }, delayMs)
  delayedResponses?.add(timer)
  response.once('close', clearDelay)
}

/**
 * 读取设置对话框（760×560）与第三层模型设置弹窗（880×640）的可见性、层级、几何、焦点与水平溢出状态。
 */
export async function readSettingsModelDialogState(
  win,
  pageSelector,
  { includeDialogLabels = false, checkModelRootOverflow = true } = {},
) {
  return win.evaluate(
    ({ selector, includeLabels, checkRootOverflow }) => {
      const visible = (element) =>
        element instanceof HTMLElement
        && element.getClientRects().length > 0
        && getComputedStyle(element).display !== 'none'
        && getComputedStyle(element).visibility !== 'hidden'
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
        const bounds = element.getBoundingClientRect()
        return {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          right: bounds.right,
          bottom: bounds.bottom,
        }
      }
      const settings = document.querySelector('[data-settings-dialog]')
      const modelRoot = document.querySelector('[data-model-settings-dialog]')
      const modelPanel = modelRoot?.closest('[role="dialog"]')
      const page = document.querySelector(selector)
      const active = document.activeElement
      const visibleDialogEls = [...document.querySelectorAll('[role="dialog"]')].filter(visible)
      const overflowTargets = checkRootOverflow ? [modelPanel, modelRoot, page] : [modelPanel, page]
      const pageInsideModel = page instanceof HTMLElement && Boolean(modelRoot?.contains(page))
      const focusInsideModel = active instanceof Element && Boolean(modelRoot?.contains(active))
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        visibleDialogs: visibleDialogEls.length,
        ...(includeLabels
          ? {
              dialogLabels: visibleDialogEls.map((dialog) => ({
                ariaLabel: dialog.getAttribute('aria-label'),
                labelledBy: dialog.getAttribute('aria-labelledby'),
                text: (dialog.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
                className: dialog.className,
              })),
            }
          : {}),
        settingsVisible: visible(settings),
        modelVisible: visible(modelRoot) && visible(modelPanel),
        pageInsideModel,
        pageInsideModelDialog: pageInsideModel,
        pageInsideSettings: page instanceof HTMLElement && Boolean(settings?.contains(page)),
        focusInsideModel,
        focusedInside: focusInsideModel,
        settingsLayer: settings ? highestLayer(settings) : 0,
        modelLayer: modelPanel ? highestLayer(modelPanel) : 0,
        settingsRect: toRect(settings),
        modelRect: toRect(modelPanel),
        horizontalOverflow: overflowTargets.some(
          (element) => element instanceof HTMLElement && element.scrollWidth > element.clientWidth + 2,
        ),
        documentOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
      }
    },
    { selector: pageSelector, includeLabels: includeDialogLabels, checkRootOverflow: checkModelRootOverflow },
  )
}

/** 从项目库新建空白项目并按需切到「生成」工作区。 */
export async function openBlankProjectCanvas(
  win,
  { projectSettleMs = 2200, pressEscape = false, enterCanvas = true, workspaceScoped = false, canvasSettleMs = 1000 } = {},
) {
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(projectSettleMs)
  if (pressEscape) await win.keyboard.press('Escape').catch(() => {})
  if (enterCanvas) {
    if (workspaceScoped) {
      await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click()
    } else {
      await win.getByText('生成', { exact: true }).first().click()
    }
    if (canvasSettleMs > 0) await win.waitForTimeout(canvasSettleMs)
  }
}

/** 从首页进入「接入模型」并启用/展开本地 ComfyUI 设置页。 */
export async function openLocalComfyuiSettings(win) {
  await win.getByRole('button', { name: '接入模型', exact: false }).first().click()
  await win.waitForTimeout(1000)
  await win.getByText('有本地 ComfyUI', { exact: false }).first().click()
  await win.waitForTimeout(500)
  await win.getByText('本地 ComfyUI', { exact: true }).first().click()
  await win.waitForTimeout(400)
  await win.getByRole('button', { name: '启用 ComfyUI', exact: false }).first().click()
  await win.waitForTimeout(2200)
  await win.getByText('本地 ComfyUI', { exact: true }).first().click()
  await win.waitForTimeout(600)
}

/** 在隔离项目目录中定位首个已落盘的 project.json（兼容 .nomi/project.json 与根目录 project.json）。 */
export function findSeededProjectFile(isolatedProjects) {
  const projectDirs = readdirSync(isolatedProjects, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(isolatedProjects, entry.name))
  const projectFile = projectDirs
    .flatMap((dir) => [path.join(dir, '.nomi', 'project.json'), path.join(dir, 'project.json')])
    .find((candidate) => existsSync(candidate))
  return { projectFile, projectDirs }
}

/** 轮询 DOM 中由应用真实生成的首个 nomi-local:// 地址。 */
export async function waitForNomiLocalUrl(win, { attempts = 20, intervalMs = 750 } = {}) {
  let seedUrl = null
  for (let i = 0; i < attempts && !seedUrl; i += 1) {
    seedUrl = await win.evaluate(() => {
      for (const el of document.querySelectorAll('*')) {
        for (const attr of ['src', 'poster', 'data-src', 'href']) {
          const value = el.getAttribute?.(attr)
          if (typeof value === 'string' && value.startsWith('nomi-local://')) return value
        }
      }
      return null
    })
    if (!seedUrl) await win.waitForTimeout(intervalMs)
  }
  return seedUrl
}
