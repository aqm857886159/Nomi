import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

// 外壳「打开 Agent 后把焦点放进输入框」和输入框本身之间的约定（AGENT_COMPOSER_INPUT_SELECTOR）。
// 10-12 输入框从 textarea 换成 TipTap 后，外壳还在找 `textarea`，点小球 / ⌘J 打开后焦点进不来，近一个月没人发现。
// 这里在真浏览器里挂上生产的输入框（AgentPanelV4Composer），用外壳同一个找法聚焦——输入框再换实现、口没跟上，这里先红。
it('外壳的找法能把焦点放进真输入框（不是 textarea，是 TipTap 可编辑区）', async () => {
  const require = createRequire(import.meta.url)
  const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
  const result = await build({ stdin: { contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { MantineProvider } from '@mantine/core';
    import { AgentPanelV4Composer, AGENT_COMPOSER_INPUT_SELECTOR } from './src/workbench/ai/v4/AgentPanelV4Composer';
    import { focusAgentComposerSoon } from './src/ui/app-shell/shell/agentFormStore';
    window.warnings = [];
    window.focusLikeShell = () => focusAgentComposerSoon('#project-agent-resident ' + AGENT_COMPOSER_INPUT_SELECTOR, { warn: (fields) => window.warnings.push(fields) });
    window.selector = AGENT_COMPOSER_INPUT_SELECTOR;
    function App() {
      const [value, setValue] = React.useState('');
      return <MantineProvider><div id="project-agent-resident"><AgentPanelV4Composer value={value} onValueChange={setValue} /></div></MantineProvider>
    }
    createRoot(document.getElementById('root')).render(<App />);
  `, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'error', define: { 'process.env.NODE_ENV': '"development"', 'import.meta.url': '"http://localhost/"', 'import.meta.env': '{}' } })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.setContent('<main id="root"></main>')
    await page.addScriptTag({ content: result.outputFiles[0].text })
    await page.waitForSelector('[data-v4-block="composer"] [contenteditable]', { timeout: 10_000 }).catch((error: Error) => {
      throw new Error(`${error.message}\n页面错误：${pageErrors.join(' / ')}`)
    })
    expect(await page.evaluate(() => document.activeElement === document.body), '挂上时就抢了焦点').toBe(true)

    await page.evaluate('window.focusLikeShell()')
    await expect.poll(() => page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null
      const selector = (window as unknown as { selector: string }).selector
      return Boolean(active?.isContentEditable && active.matches(selector) && active.closest('[data-v4-block="composer"]'))
    }), { timeout: 5000 }).toBe(true)
    expect(await page.evaluate('window.warnings'), '找到了还出声').toEqual([])
  } finally {
    await browser.close()
  }
}, 60_000)
