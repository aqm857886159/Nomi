// 分镜表里每一个 Portal 弹层的键盘合同（V-1039 评审：「用作…」/ 片段菜单挪进 Portal 后 Tab 进不去）。
// 修在 `src/design/AnchoredPopover.tsx` 这一层，所以这里按**清单遍历**，不是只测一个：
//   打开 → 焦点进浮层 → Tab / Shift+Tab 在浮层内循环（不掉出去）→ Esc 关 → 焦点回到打开前的那个元素。
// 清单少一项 = 有一个 Portal 弹层没有被盯着；多接一个弹层就往清单里加一行。
import { test } from 'vitest'
import { expect } from '@playwright/test'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const POPOVERS = [
  {
    name: '行首「⋯」菜单',
    query: 'confirm',
    focusOpener: (page) => page.locator('[data-storyboard-row-menu-trigger="1"]').focus(),
    activate: (page) => page.keyboard.press('Enter'),
    menu: '[data-storyboard-row-menu="1"]',
  },
  {
    name: '「用作…」菜单',
    query: 'confirm',
    focusOpener: (page) => page.locator('[data-storyboard-actbar] button[aria-label]').last().focus(),
    activate: (page) => page.keyboard.press('Enter'),
    menu: '[data-storyboard-result-intake-menu]',
  },
  {
    name: '提示词片段菜单',
    query: 'segments',
    // 片段是编辑器里的可点元素：打开前焦点在提示词编辑器，鼠标点开后关闭应回到编辑器。
    focusOpener: (page) => page.locator('[data-storyboard-row="1"] .ProseMirror').first().focus(),
    activate: (page) => page.locator('[data-storyboard-prompt-segment]').first().click(),
    menu: '[data-storyboard-prompt-menu]',
  },
  {
    name: '底栏「⋯」弹层',
    // 夹具模型用档案里带开关（boolean）参数的 rh-kling-3.0：开关一律住在行尾 ⋯ 里，出不出 ⋯ 不取决于字体 / 宽度
    //（之前靠「枚举装不下被挪进 ⋯」，Windows 出、Linux CI 字体下整条装得下就不出）。
    query: 'media=video&switch',
    opener: '[data-storyboard-composer-switches="1"]',
    focusOpener: (page) => page.locator('[data-storyboard-composer-switches="1"]').focus(),
    activate: (page) => page.keyboard.press('Enter'),
    menu: '[data-storyboard-composer-switch-panel="1"]',
  },
]

for (const item of POPOVERS) test(`分镜 Portal 弹层键盘合同：${item.name}`, async () => {
  const cacheDir = fs.mkdtempSync(path.join(tmpdir(), 'nomi-storyboard-popover-kbd-'))
  const server = await createServer({ configFile: false, cacheDir, server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/ux/fixtures/original-storyboard-editor-harness.html?locale=en&${item.query}`)
    await page.addStyleTag({ url: '/tailwind.generated.css' })
    await page.addStyleTag({ url: '/src/styles/index.css' })
    await expect(page.locator('[data-storyboard-editor]')).toBeVisible()
    await page.locator('[data-storyboard-editor]').evaluate((element, width) => { element.parentElement.style.width = `${width}px` }, item.width ?? 840)
    const expand = page.locator('[data-storyboard-editor]').getByRole('button', { name: 'Expand all', exact: true })
    if (await expand.isVisible()) await expand.click()

    // 触发器找不到时让失败自己说话（Linux CI 上「底栏 ⋯」找不到，而本地有）：把底栏长什么样、视口多大写进断言消息。
    if (item.opener) {
      const found = await page.locator(item.opener).first().waitFor({ state: 'attached', timeout: 8000 }).then(() => true, () => false)
      if (!found) {
        const diagnostics = await page.evaluate(() => {
          const bars = [...document.querySelectorAll('[data-storyboard-composer-bar]')]
          return {
            viewport: { w: innerWidth, h: innerHeight },
            editorWidth: document.querySelector('[data-storyboard-editor]')?.getBoundingClientRect().width,
            rowDensity: document.querySelector('[data-storyboard-row="1"]')?.getAttribute('data-storyboard-row-density'),
            bars: bars.map((bar) => ({
              width: Math.round(bar.getBoundingClientRect().width),
              scrollWidth: bar.scrollWidth,
              text: bar.innerText.replace(/\s+/g, ' ').trim(),
              demoted: bar.getAttribute('data-storyboard-composer-demoted'),
              attrs: [...bar.querySelectorAll('*')].flatMap((node) => [...node.attributes].filter((a) => a.name.startsWith('data-storyboard')).map((a) => `${node.tagName.toLowerCase()}[${a.name}=${a.value}]`)),
              controls: [...bar.querySelectorAll('button,[role=combobox],input')].map((node) => node.getAttribute('aria-label') || node.textContent?.trim() || node.tagName),
            })),
          }
        })
        throw new Error(`${item.name}：找不到触发器 ${item.opener}。底栏诊断：${JSON.stringify(diagnostics)}`)
      }
    }
    await item.focusOpener(page)
    await page.evaluate(() => { window.__opener = document.activeElement })
    await item.activate(page)
    const menu = page.locator(item.menu)
    await expect(menu, `${item.name} 没打开`).toBeVisible()
    const insideMenu = () => page.evaluate((selector) => Boolean(document.querySelector(selector)?.contains(document.activeElement)), item.menu)
    expect(await insideMenu(), `${item.name}：打开后焦点没有进浮层`).toBe(true)

    // Tab / Shift+Tab 走很多下，焦点始终在浮层里（循环，不掉到页面别处）。
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab')
      expect(await insideMenu(), `${item.name}：第 ${i + 1} 次 Tab 焦点掉出了浮层`).toBe(true)
    }
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Shift+Tab')
      expect(await insideMenu(), `${item.name}：第 ${i + 1} 次 Shift+Tab 焦点掉出了浮层`).toBe(true)
    }

    await page.keyboard.press('Escape')
    await expect(menu, `${item.name}：Esc 没有关掉浮层`).toHaveCount(0)
    // Radix FocusScope 在卸载后的下一个任务里还焦点，所以要等，不能立刻读。
    await expect.poll(() => page.evaluate(() => document.activeElement === window.__opener), { message: `${item.name}：关闭后焦点没有回到打开前的那个元素`, timeout: 3000 }).toBe(true)
  } finally {
    await browser?.close()
    await server.close()
  }
}, 240000)
