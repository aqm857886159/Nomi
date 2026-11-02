import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it('E3: retry can be clicked again after rejection/failure, while the same row rejects a double click', async () => {
  const require = createRequire(import.meta.url)
  const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
  // These ports are unused by retry. Keep real FrameActions/FailureActions and their decision owner.
  const ports = [
    { pattern: /NodeErrorReport$/, source: 'export const UnknownSubmissionConfirmation=()=>null;' },
    { pattern: /releaseUnknownSubmission$/, source: 'export const useUnknownSubmissionRelease=()=>({confirming:false,busy:false,failed:false});' },
    { pattern: /projectCanvasReadSurface$/, source: 'export const withProjectAction=()=>{};' },
    { pattern: /notificationPolicy$/, source: 'export const revealNotificationTarget=()=>{};' },
    { pattern: /recoverTaskActions$/, source: 'export const reopenRecoverableNode=()=>{};' },
  ]
  const result = await build({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import i18n from './src/i18n';
    import FrameActions from './src/workbench/creation/storyboard/shotRow/StoryboardFrameActions';
    const node={id:'failed-node',kind:'image',error:'429 rate limit',position:{x:0,y:0},status:'error'};
    const exec={status:'failed',node,failedNode:node,errorMessage:node.error,resultUrl:null};
    let calls=0, finish;
    function App(){const[busy,setBusy]=React.useState(false);const retry=()=>{if(busy)return;calls++;setBusy(true);void new Promise((resolve,reject)=>{finish=reject}).catch(()=>{}).finally(()=>setBusy(false))};return <FrameActions exec={exec} variants={[]} actionBusy={busy} onGenerate={retry}/>}
    window.retryStats=()=>calls; window.finishRetry=()=>finish(new Error('refused or failed again'));
    i18n.changeLanguage('en').then(()=>createRoot(document.getElementById('root')).render(<App/>));
  `, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'unused-recovery-ports', setup(build: { onResolve: (options: { filter: RegExp }, resolve: () => { path: string; namespace: string }) => void; onLoad: (options: { filter: RegExp; namespace: string }, load: (args: { path: string }) => { contents: string; loader: 'js' }) => void }) {
      for (const [index, port] of ports.entries()) build.onResolve({ filter: port.pattern }, () => ({ path: String(index), namespace: 'retry-port' }))
      build.onLoad({ filter: /.*/, namespace: 'retry-port' }, (args: { path: string }) => ({ contents: ports[Number(args.path)].source, loader: 'js' }))
    } }],
  })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(3000)
    await page.setContent('<main id="root"></main>')
    await page.addScriptTag({ content: result.outputFiles[0].text })
    const button = page.locator('[data-storyboard-retry-state]')
    await button.waitFor()
    for (let expected = 1; expected <= 2; expected++) {
      await button.click()
      await page.waitForFunction(() => document.querySelector('[data-storyboard-retry-state]')?.getAttribute('data-storyboard-retry-state') === 'busy')
      expect(await button.isDisabled()).toBe(true)
      await button.evaluate((element: HTMLButtonElement) => element.click())
      expect(await page.evaluate('window.retryStats()')).toBe(expected)
      await page.evaluate('window.finishRetry()')
      await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[data-storyboard-retry-state]')?.disabled)
    }
  } finally { await browser.close() }
})
