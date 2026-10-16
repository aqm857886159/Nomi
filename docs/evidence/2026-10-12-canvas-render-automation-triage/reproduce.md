# 长提示词现状探针复跑

仅组件级特征探针，不是用户项目、Electron 性能或 WorkBuddy 端到端验收。基线见 JSON。生成完整 Tailwind 后才能跑，不能把未加载样式的结果算作复现。

在仓库根创建 `.tmp/canvas-incident-probe/`，保存以下三个文件。先执行 `node scripts/build-tailwind.mjs --minify` 并等待成功，再运行 `node .tmp/canvas-incident-probe/run.mjs`。runner 的 evidence 目录可改成自己的临时输出目录。需要已有 pnpm 依赖与 Playwright Chromium。

## index.html

```html
<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/tailwind.generated.css"></head><body><div id="root"></div><script type="module" src="/.tmp/canvas-incident-probe/main.tsx"></script></body></html>
```

## main.tsx

```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import '@mantine/core/styles.css'
import '@xyflow/react/dist/style.css'
import '/src/i18n'
import { NomiAppProviders } from '/src/NomiAppProviders'
import { NomiColorSchemeProvider } from '/src/theme/NomiColorSchemeProvider'
import { ComposerBarStage } from '/src/devlab/designLab/nodeComposerBar/nodeComposerBarLabKit'
createRoot(document.getElementById('root')!).render(<NomiColorSchemeProvider><NomiAppProviders><ComposerBarStage kind="image" /></NomiAppProviders></NomiColorSchemeProvider>)
```

## run.mjs

```js
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
const evidence = '.tmp/canvas-incident-probe/evidence'
mkdirSync(evidence, { recursive: true })
const server = await createServer({ configFile: false, cacheDir: '.tmp/canvas-incident-probe/cache', server: { host: '127.0.0.1', port: 0, watch: null, hmr: false } })
let browser
try {
 await server.listen()
 browser = await chromium.launch({headless:true})
 const page=await browser.newPage({viewport:{width:1100,height:900}})
 const errors=[]
 page.on('pageerror',e=>errors.push(String(e)))
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/.tmp/canvas-incident-probe/index.html`)
 const editor=page.locator('[data-node-composer-prompt] .ProseMirror')
 await editor.waitFor({timeout:60000})
 await editor.fill('一只猫坐在窗边，暖色自然光。'.repeat(180))
 await page.locator('[data-node-composer-footer]').waitFor()
 const report = await page.locator('.generation-canvas-v2-node__composer-card').evaluate(card=>{
   const r=card.getBoundingClientRect();const p=card.querySelector('[data-node-composer-prompt]'); const f=card.querySelector('[data-node-composer-footer]');const b=card.querySelector('[data-bar-segment="generate"]');const pr=p.getBoundingClientRect();const fr=f.getBoundingClientRect();const br=b.getBoundingClientRect();p.scrollTop=10000;
   return { card:{height:r.height,bottom:r.bottom},prompt:{height:pr.height,scrollHeight:p.scrollHeight,clientHeight:p.clientHeight,scrollTop:p.scrollTop}, footer:{bottom:fr.bottom,top:fr.top,inside:fr.bottom<=r.bottom+1},button:{bottom:br.bottom,inside:br.bottom<=r.bottom+1},style:{overflow:getComputedStyle(card).overflow,display:getComputedStyle(card).display},controls:[...f.querySelectorAll('button')].map(b=>({label:b.getAttribute('aria-label'),text:b.textContent?.trim()}))}
 })
 await page.screenshot({path:evidence+'/main-long-prompt.png'})
 writeFileSync(evidence+'/main-long-prompt.json',JSON.stringify({baseline:'0c1ed6a0c9421091f238413d682af97e9aa18d9d',fixture:'production BaseGenerationNode/Composer via existing design-lab fixture, synthetic catalog, no real project/generation',report,errors},null,2))
 console.log(JSON.stringify({report,errors},null,2))
 if(!report.footer.inside || !report.button.inside || report.prompt.scrollTop<=0) process.exitCode=1
} finally {await browser?.close();await server.close()}
```
