import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it('announces loading outside the busy button and preserves its width and label', async () => {
  const require = createRequire(import.meta.url)
  const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { MantineProvider } from '@mantine/core';
      import { DesignButton } from './src/design/actions';
      import i18n from './src/i18n';
      function Host() {
        const [loading, setLoading] = useState(false);
        return <MantineProvider><div style={{ display: 'flex' }}>
          <DesignButton loading={loading} onClick={() => setLoading(true)}>Save capture</DesignButton>
          <button onClick={() => setLoading(false)}>Finish</button>
        </div></MantineProvider>;
      }
      i18n.changeLanguage('en').then(() => createRoot(document.getElementById('root')).render(<Host />));
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife',
    loader: { '.svg': 'dataurl', '.png': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce' })
    await page.setContent('<main id="root"></main>')
    await page.addStyleTag({ content: readFileSync(require.resolve('@mantine/core/styles.css'), 'utf8') })
    await page.addScriptTag({ content: result.outputFiles[0].text })

    const button = page.getByRole('button', { name: 'Save capture', exact: true })
    await button.waitFor()
    const status = page.getByRole('status')
    const initialStatuses = await status.count()
    const width = (await button.boundingBox())?.width
    await button.click()

    const busyButton = button.and(page.locator('[aria-busy="true"]'))
    await busyButton.waitFor()
    expect(await busyButton.isDisabled()).toBe(true)
    expect((await busyButton.boundingBox())?.width).toBe(width)
    expect(initialStatuses).toBe(1)
    expect(await status.allTextContents()).toEqual(['Loading'])
    expect(await status.evaluate(node => node.closest('[aria-busy="true"], [aria-hidden="true"]'))).toBeNull()

    await page.getByRole('button', { name: 'Finish' }).click()
    expect(await button.isEnabled()).toBe(true)
    expect(await status.allTextContents()).toEqual([''])
  } finally {
    await browser.close()
  }
}, 30_000)
