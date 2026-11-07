import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

// Retained from the deleted shader walkthrough: the hook still serves GenerationStatusBar.
it('shares one released capability probe and cleans up live reduced-motion listeners in StrictMode', async () => {
  const require = createRequire(import.meta.url)
  const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
  const result = await build({ stdin: { contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { useReducedProcessMotion } from './src/workbench/generationCanvas/nodes/useReducedProcessMotion';
    let probes=0, released=0; const listeners=new Set();
    const realContext=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...args){
      if(kind!=='webgl') return realContext.call(this,kind,...args);
      probes++; return {getExtension:name=>name==='WEBGL_lose_context'?{loseContext:()=>released++}:{UNMASKED_RENDERER_WEBGL:0x9246},getParameter:()=>'Hardware fixture'};
    };
    const realMatch=window.matchMedia.bind(window);
    window.matchMedia=query=>{
      const media=realMatch(query), add=media.addEventListener.bind(media), remove=media.removeEventListener.bind(media);
      media.addEventListener=(type,callback,...args)=>{if(type==='change')listeners.add(callback);add(type,callback,...args)};
      media.removeEventListener=(type,callback,...args)=>{if(type==='change')listeners.delete(callback);remove(type,callback,...args)};
      return media;
    };
    function Consumer(){return <span data-reduced={String(useReducedProcessMotion())}/>}
    function App(){const [show,setShow]=React.useState(true);return <><button onClick={()=>setShow(!show)}>Toggle</button>{show&&Array.from({length:8},(_,key)=><Consumer key={key}/>)}</>}
    window.probeStats=()=>({probes,released,listeners:listeners.size});
    createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
  `, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"development"' } })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ reducedMotion: 'no-preference' })
    await page.setContent('<main id="root"></main>')
    await page.addScriptTag({ content: result.outputFiles[0].text })
    const visible = (value: string) => page.waitForFunction(value => document.querySelectorAll(`[data-reduced="${value}"]`).length === 8, value)
    const stats = () => page.evaluate('window.probeStats()')
    await visible('false')
    expect(await stats()).toEqual({ probes: 1, released: 1, listeners: 8 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await visible('true')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await visible('false')
    await page.getByRole('button', { name: 'Toggle' }).click()
    expect(await stats()).toEqual({ probes: 1, released: 1, listeners: 0 })
    await page.getByRole('button', { name: 'Toggle' }).click()
    await visible('false')
    expect(await stats()).toEqual({ probes: 1, released: 1, listeners: 8 })
  } finally { await browser.close() }
})
