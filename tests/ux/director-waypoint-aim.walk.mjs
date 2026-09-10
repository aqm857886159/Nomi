// Real waypoint and clip inspectors, mounted without the 3D renderer.
import fs from 'node:fs'
import { chromium } from 'playwright'
import { expect, expectAbsent, proveProbe } from './_assert.mjs'
const folder = '.tmp/director-full-audit-20260907'
const fixture = `${folder}/waypoint-aim.html`
fs.mkdirSync(folder, { recursive: true })
fs.writeFileSync(fixture, `<html><head><link rel="stylesheet" href="/tailwind.generated.css"></head><body><div id="app"></div><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client'; import {MantineProvider} from '@mantine/core';
import {ConfirmDialogHost} from '/src/design/index.ts';
import i18n from 'i18next'; import {initReactI18next} from 'react-i18next'; import {zhDirector} from '/src/i18n/locales/director.ts';
import {DirectorStoreContext,useDirectorStore} from '/src/workbench/generationCanvas/nodes/director/DirectorEditorContext.ts';
import {createDirectorStore} from '/src/workbench/generationCanvas/nodes/director/model/directorStore.ts';
import {CAMERA_PRESETS,buildCameraFromPreset} from '/src/workbench/generationCanvas/nodes/director/model/cameraPresets.ts';
import {WaypointCard} from '/src/workbench/generationCanvas/nodes/director/panels/inspector/WaypointCard.tsx';
import {BatchWaypointsCard} from '/src/workbench/generationCanvas/nodes/director/panels/inspector/BatchWaypointsCard.tsx';
import {TrajectoryClipInspector} from '/src/workbench/generationCanvas/nodes/director/panels/inspector/TrajectoryClipInspector.tsx';
import {ActionClipInspector} from '/src/workbench/generationCanvas/nodes/director/panels/inspector/ActionClipInspector.tsx';
import {CloseupClipInspector} from '/src/workbench/generationCanvas/nodes/director/panels/inspector/CloseupClipInspector.tsx';
await i18n.use(initReactI18next).init({lng:'zh-CN',resources:{'zh-CN':{translation:{director:zhDirector,common:{reset:'复位'}}}}});
const store=createDirectorStore({defaultSceneName:'S'}); const api=store.getState();
const object=name=>({name,type:'character',position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},visible:true,locked:false});
const id=api.addObject(object('Source')); const target=api.addObject({...object('Target'),type:'cube'}); api.addObject({...object('Group'),type:'group'});
const cameraId=api.addCamera(buildCameraFromPreset({preset:CAMERA_PRESETS[0],id:'camera',name:'Camera'}));
const clip=api.addTrajectoryClip(id,0,4); api.insertWaypointsBatch(id,clip.id,[0,2,4].map(time=>({time,x:0,y:0,z:0,yaw:20,pitch:10,roll:30})));
const targetClip=api.addTrajectoryClip(target,0,4); api.insertWaypointsBatch(target,targetClip.id,[{time:0,x:0,y:0,z:10,yaw:0,pitch:0,roll:0},{time:4,x:10,y:0,z:0,yaw:0,pitch:0,roll:0}]);
const action=api.addActionClip(id,{name:'Pose',clipType:'custom_pose',duration:4}); const closeup=api.addCloseupClip(cameraId,target,0,4);
window.fixture={store,id,target,cameraId,clipId:clip.id,actionId:action.id,closeupId:closeup.id};
function App(){const scene=useDirectorStore(s=>s.activeScene()); const source=scene.objects.find(o=>o.id===id); const camera=scene.cameras.find(c=>c.id===cameraId);
return React.createElement('main',{style:{width:650}},
React.createElement(ConfirmDialogHost),
React.createElement('div',{id:'single'},source.motionTrajectory[1]&&React.createElement(WaypointCard,{entity:source,waypoint:source.motionTrajectory[1]})),
React.createElement('div',{id:'batch'},source.motionTrajectory.length>1&&React.createElement(BatchWaypointsCard,{entity:source,waypoints:source.motionTrajectory})),
React.createElement('div',{id:'trajectory'},React.createElement(TrajectoryClipInspector,{entity:source,clip:source.trajectoryClips[0]})),
React.createElement('div',{id:'action'},React.createElement(ActionClipInspector,{object:source,clip:source.actionClips[0]})),
React.createElement('div',{id:'closeup'},React.createElement(CloseupClipInspector,{camera,clip:camera.closeupClips[0]})));}
createRoot(document.getElementById('app')).render(React.createElement(MantineProvider,null,React.createElement(DirectorStoreContext.Provider,{value:store},React.createElement(App))));
</script></body></html>`)
const browser = await chromium.launch({ headless: true, channel: process.env.NOMI_BROWSER_CHANNEL ?? 'chrome' })
const page = await browser.newPage({ viewport: { width: 800, height: 1000 } })
const errors = []
page.on('pageerror', error => { errors.push(error.message); console.log(`PAGE ERROR ${error.message}`) })
const project = () => page.evaluate(() => window.fixture.store.getState().exportProject())
const points = () => page.evaluate(() => window.fixture.store.getState().findObject(window.fixture.id).motionTrajectory)
const undo = () => page.evaluate(() => window.fixture.store.getState().undo())
let failures = 0
async function run(name, check) {
  await page.goto(`${process.env.NOMI_DIRECTOR_URL ?? 'http://127.0.0.1:5175'}/${fixture}`)
  await expect(page.locator('#single input[type=range]')).toBeVisible()
  try { await check(); console.log(`PASS ${name}`) } catch (error) { failures++; console.log(`FAIL ${name}: ${error.message}`) }
}
try {
  await run('single target and clear preserve baked heading and undo', async () => {
    const before = await project()
    await page.locator('#single').getByRole('button', { name: '看向目标', exact: true }).click()
    expect(await page.getByRole('option').allTextContents()).toEqual(['自由朝向','Target'])
    await page.getByRole('option', { name: 'Target', exact: true }).click()
    expect((await points())[1].yaw).toBe(45)
    expect((await points())[1].lookAtObjectId).toBeTruthy()
    await page.locator('#single').getByRole('button', { name: '看向目标', exact: true }).click()
    await page.getByRole('option', { name: '自由朝向', exact: true }).click()
    expect((await points())[1].yaw).toBe(45)
    expect((await points())[1].lookAtObjectId).toBeUndefined()
    await undo(); await undo(); expect(await project()).toEqual(before)
  })
  await run('batch target evaluates every frame and is one undo', async () => {
    const before = await project()
    await page.locator('#batch').getByRole('button', { name: '看向目标', exact: true }).click()
    await page.getByRole('option', { name: 'Target', exact: true }).click()
    expect((await points()).map(p=>p.yaw)).toEqual([0,45,90])
    expect((await points()).every(p=>p.lookAtObjectId===undefined)).toBe(true)
    await page.screenshot({path:`${folder}/waypoint-aim.png`})
    await undo(); expect(await project()).toEqual(before)
  })
  await run('batch pitch and roll can be edited and reset independently', async () => {
    const before = await project()
    const inputs=page.locator('#batch input[type=text]')
    await inputs.nth(0).fill('-25'); await inputs.nth(0).press('Enter')
    expect((await points()).map(({pitch,roll})=>({pitch,roll}))).toEqual(Array.from({length:3},()=>({pitch:-25,roll:30})))
    await page.locator('#batch').getByRole('button',{name:'重置',exact:true}).nth(1).click()
    expect((await points()).map(({pitch,roll})=>({pitch,roll}))).toEqual(Array.from({length:3},()=>({pitch:-25,roll:0})))
    await undo(); await undo(); expect(await project()).toEqual(before)
  })
  for (const section of ['trajectory','action','closeup','single','batch']) await run(`${section} held slider change is one undo`, async () => {
    const before = await project()
    const range=page.locator(`#${section} input[type=range]`).first()
    await range.focus()
    await page.keyboard.down('ArrowRight'); await page.keyboard.down('ArrowRight'); await page.keyboard.up('ArrowRight')
    expect(JSON.stringify(await project())===JSON.stringify(before)).toBe(false)
    await undo(); expect(await project()).toEqual(before)
  })
  await run('batch delete waits for confirmation, cancel keeps points, confirm is undoable', async () => {
    const before=await project()
    await page.locator('#batch').getByRole('button',{name:'批量删除',exact:true}).click()
    expect(await project()).toEqual(before)
    const dialog=page.locator('[data-confirm-dialog-surface]')
    await expect(dialog).toBeVisible()
    const cancelProof=await proveProbe(dialog,'批量删除确认框已打开')
    await page.locator('[data-confirm-dialog-cancel]').click()
    await expectAbsent(dialog,{provenBy:cancelProof,message:'取消删除后确认框持续退出'})
    expect(await project()).toEqual(before)
    await page.locator('#batch').getByRole('button',{name:'批量删除',exact:true}).click()
    const confirmProof=await proveProbe(dialog,'再次批量删除已重新打开确认框')
    await page.locator('[data-confirm-dialog-confirm]').click()
    await expectAbsent(dialog,{provenBy:confirmProof,message:'确认删除后确认框持续退出'})
    await expect.poll(points).toEqual([])
    await undo(); expect(await project()).toEqual(before)
  })
} finally {
  await browser.close()
}
console.log(`Waypoint inspector verification: ${failures} failures; ${errors.length} page errors`)
if(failures||errors.length) process.exitCode=1
