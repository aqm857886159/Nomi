import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MantineProvider, Notification } from '@mantine/core'
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildToastNotification } from '../../src/ui/toast'
import { buildNomiTheme, nomiCssVariablesResolver } from '../../src/theme/nomiTheme'

// Real component + production CSS. jsdom cannot measure flex compression or glyph lines.
describe('toast readability in a narrow notification', () => {
  it('preserves readable lines beside arbitrary long actions', async () => {
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 360, height: 1000 } })
    const output = '.tmp/toast-evidence'
    mkdirSync(output, { recursive: true })
    try {
      for (const [width, language] of [[360, 'zh'], [344, 'zh'], [320, 'zh'], [180, 'zh'], [360, 'en']] as const) {
        const message = language === 'en' ? 'CheckTheProviderConnectionAndRetryTheImageGenerationTaskWithoutLosingYourWork' : '请在设置模型页面检查供应商连接状态确认模型可以使用然后重新尝试本次图片生成任务操作'.slice(0, 40)
        const actionLabel = language === 'en' ? 'Switch to a provider with an extraordinarily long display name · GPT Image 2' : '切换到可以正常使用的供应商并且使用目录中已经认证完成的图片模型'.slice(0, 30)
        const { message: content, icon, color, withCloseButton, withBorder, classNames } = buildToastNotification({
          id: 'readability', message, actionLabel, onAction: () => {}, type: 'warning',
        })
        const markup = renderToStaticMarkup(React.createElement(MantineProvider, {
          theme: buildNomiTheme(), cssVariablesResolver: nomiCssVariablesResolver, forceColorScheme: 'light',
        }, React.createElement('div', { style: { width } }, React.createElement(Notification, { icon, color, withCloseButton, withBorder, classNames }, content))))
        await page.setContent(`<html data-mantine-color-scheme="light"><head><style>${readFileSync('public/tailwind.generated.css', 'utf8')}</style><style>${readFileSync('src/theme/nomi-tokens.css', 'utf8')}</style></head><body>${markup}</body></html>`)
        const shell = await page.locator('.mantine-Notification-root').boundingBox()
        assert.ok(shell && shell.width >= 320 && shell.width <= 360, 'notification minimum stays within viewport')
        const text = page.getByText(message, { exact: true })
        const lines = await text.evaluate((element) => {
          const node = element.firstChild!
          const counts: Record<string, number> = {}
          for (let index = 0; index < (node.textContent?.length ?? 0); index++) {
            const range = document.createRange()
            range.setStart(node, index)
            range.setEnd(node, index + 1)
            const top = String(Math.round(range.getBoundingClientRect().top))
            counts[top] = (counts[top] ?? 0) + 1
          }
          return Object.values(counts)
        })
        await page.screenshot({ path: `${output}/${process.env.TOAST_EVIDENCE_PHASE ?? 'green'}-${width}-${language}.png` })
        assert.equal(lines.length >= 5 && Math.max(...lines) <= 2, false, `${width}px: glyphs per line ${lines}`)
        assert.ok(Math.max(...lines) > 8, 'body must retain useful width')
        const button = page.getByRole('button', { name: actionLabel })
        assert.equal(await button.getAttribute('title'), actionLabel)
        const geometry = await button.evaluate((element) => ({
          action: element.getBoundingClientRect().width,
          row: element.parentElement!.getBoundingClientRect().width,
          clipped: element.scrollWidth > element.clientWidth,
        }))
        // 2026-10-01（bb66718e2）起动作字永远完整：放不下就折到正文下面，不再按行宽 40% 截断。
        assert.ok(geometry.action <= geometry.row + 1, 'action stays inside the row')
        assert.equal(geometry.clipped, false, 'action label is never clipped')
        console.log(JSON.stringify({ width, language, glyphsPerLine: lines, ...geometry }))
      }
    } finally {
      await browser.close()
    }
  })
})
