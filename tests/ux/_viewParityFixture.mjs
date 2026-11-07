import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectVisible, screenshotSettled } from './_assert.mjs'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { switchGenerationView, canvasFitViewButton } from './_shell.mjs'
import { findNodeHitPoint } from './_canvasHit.mjs'

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')

export async function launchParityFixture(name) {
 const base=process.env.NOMI_WALK_TEMP_ROOT||path.join(os.tmpdir(),'nomi-view-parity-cut1')
 fs.mkdirSync(base,{recursive:true})
 const locale=process.env.WALK_LOCALE==='en'?'en':'zh-CN'
 const out=path.join(base,`${name}-${locale}`)
 fs.mkdirSync(out,{recursive:true})
const tempRoot=makeTempDir('view-parity-cut1-profile-')
const projectId='view-parity-cut1'
const projectRoot=path.join(tempRoot,'projects',projectId)
fs.mkdirSync(path.join(projectRoot,'.nomi'),{recursive:true})
fs.mkdirSync(path.join(projectRoot,'assets/imported'),{recursive:true})
const relative='assets/imported/parity-shared.jpg'
const file=path.join(projectRoot,relative)
fs.copyFileSync(path.join(repoRoot,'resources/onboarding-demo/shot-4.jpg'),file)
const url=`nomi-local://asset/${projectId}/${relative}`
const result={id:'shared-r1',type:'image',url,thumbnailUrl:url,previewState:'ready',createdAt:1}
const node={id:'shared-node',kind:'image',title:'Parity shared image',prompt:'',categoryId:'shots',references:[],runs:[],history:[result],result,status:'success',position:{x:100,y:100},size:{width:320,height:180},meta:{imageWidth:320,imageHeight:180,imageAspectRatio:16/9}}
const record={id:projectId,name:'View parity reproduction',version:2,createdAt:1,updatedAt:1,savedAt:1,revision:1,lastKnownRootPath:projectRoot,payload:{generationCanvas:{nodes:[node],edges:[],groups:[],selectedNodeIds:[]},timeline:{version:1,fps:30,scale:1,playheadFrame:0,tracks:[{id:'imageTrack',type:'image',label:'image',clips:[{id:'shared-clip',type:'image',sourceNodeId:`asset:${relative}`,label:'Parity shared image',startFrame:0,endFrame:90,frameCount:90,offsetStartFrame:0,offsetEndFrame:0,url}]}]}}}
fs.writeFileSync(path.join(projectRoot,'.nomi/project.json'),JSON.stringify(record))

 if(process.platform==='darwin') {
   const asn=execFileSync('lsappinfo',['front'],{encoding:'utf8'}).trim()
   const front=execFileSync('lsappinfo',['info','-only','name,bundleid,pid',asn],{encoding:'utf8'}).trim()
   const admission={at:new Date().toISOString(),asn,front,load:os.loadavg()}
   fs.writeFileSync(path.join(out,'admission.json'),JSON.stringify(admission,null,2))
   console.log('Immediate prelaunch',JSON.stringify(admission))
   if(!/"LSDisplayName"="[^"]+"/.test(front)||/"Claude"|com\.anthropic/i.test(front)||admission.load[1]>=10) {
     throw Object.assign(new Error('Launch admission changed; no Electron launched'),{exitCode:75})
   }
 }
 const {app,win,close}=await launchNomiApp({name,tempRoot,initialLocalStorage:{'nomi:locale:v1':locale,'nomi:splash:v1':'seen','nomi:journey-tour:v1':'seen','nomi:canvas-gesture-hint:v1':'seen','__nomiE2E':'1'},syntheticCredentialStorage:true,settleMs:0})
 const shot=async(label,page=win)=>screenshotSettled(page,{path:path.join(out,`${label}.png`)})
 const snapshot=()=>win.evaluate(()=>{const s=window.__nomiCanvasStore.getState();return {nodes:s.nodes.map(n=>({id:n.id,result:n.result})),selected:[...s.selectedNodeIds]}})
 try {
   const cdp=await win.context().newCDPSession(win)
   await cdp.send('Network.enable')
   await cdp.send('Network.setCacheDisabled',{cacheDisabled:true})
   await win.getByText(record.name,{exact:false}).first().hover()
   await win.getByRole('button',{name:/继续创作|Continue/}).first().click()
   await expectVisible(win.locator('[data-generation-view-switcher]'))
   await switchGenerationView(win,'canvas')
   await canvasFitViewButton(win).click()
   await win.waitForFunction(()=>Boolean(window.__nomiCanvasStore))
   await expect.poll(()=>win.locator('.generation-canvas-v2-node[data-node-id="shared-node"] img').first().evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true)
   return {app,win,close,cdp,shot,snapshot,file,url,projectRoot,projectId,out,locale}
 } catch(error) {
   await close()
   throw error
 }
}

export async function selectParityNode(win) {
 const point=await findNodeHitPoint(win,{nodeSelector:'.react-flow__node[data-id="shared-node"]'})
 if(!point)throw new Error('No real pointer target for the fixture node')
 await win.mouse.click(point.x,point.y)
}
