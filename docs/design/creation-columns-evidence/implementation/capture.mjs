/* global process, URL, document, getComputedStyle, console */
import fs from 'node:fs/promises'
import { launchNomiApp } from '../../../../tests/ux/_launchApp.mjs'
import { expect } from '@playwright/test'
const phase = process.argv[2] || 'after'
const root = new URL('.', import.meta.url).pathname
await fs.mkdir(root,{recursive:true})
const session=await launchNomiApp({name:`c76-${phase}`,settleMs:0,env:{VITE_DEV_SERVER_URL:'http://127.0.0.1:5273',NOMI_DISABLE_AUTO_UPDATE:'1'},initialLocalStorage:{'nomi-color-scheme':'light','nomi:splash:v1':'seen','nomi:journey-tour:v1':'seen'}})
const page=session.win
try {
 await page.setViewportSize({width:1440,height:900})
 await expect(page.getByRole('button',{name:/新建空白项目/})).toBeVisible({timeout:30000})
 await page.getByRole('button',{name:/新建空白项目/}).click()
 await expect(page.locator('[data-creation-editor] .tiptap')).toBeVisible()
 await page.locator('[data-creation-editor] .tiptap').fill('车站外，雨水沿着旧屋檐滴落。林望握着那封迟到了十年的信。\n车门将要关闭时，一个熟悉的身影停在了灯下。')
 await page.locator('[data-creation-editor] .tiptap').blur()
 for(const theme of ['light','dark']) {
 await page.evaluate(theme=>{document.documentElement.setAttribute('data-mantine-color-scheme',theme)},theme)
 await page.evaluate(()=>document.fonts.ready)
 await page.screenshot({path:`${root}/${phase}-${theme}.png`})
 const data=await page.evaluate(()=>{
  const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}
  const selectors=['[data-creation-resource-tree]','[data-creation-editor]','[data-v4-panel]']
  return selectors.map(selector=>{const el=document.querySelector(selector);if(!el)throw Error(selector);const s=getComputedStyle(el);return {selector,rect:rect(el),radius:s.borderRadius,border:s.border,shadow:s.boxShadow,headerHeight:el.querySelector(':scope > header, :scope > div:first-child, .workbench-editor-toolbar')?.getBoundingClientRect().height,controls:[...el.querySelectorAll('button,input,textarea,summary,[contenteditable=true]')].filter(x=>x.getBoundingClientRect().width&&x.getBoundingClientRect().height).map((x,i)=>({id:x.getAttribute('data-v4-control')||x.getAttribute('aria-label')||x.getAttribute('title')||x.textContent.trim()||String(i),rect:rect(x)}))}})
 })
 await fs.writeFile(`${root}/${phase}-${theme}.json`,JSON.stringify(data,null,2)+'\n')
 console.log(theme,data.map(x=>({selector:x.selector,rect:x.rect,controls:x.controls.length})))
 }
} finally {await session.app.close()}
