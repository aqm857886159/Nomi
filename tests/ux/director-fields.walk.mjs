// Real inspector primitives and inspectors, mounted without 3D; validates cancel/commit/undo.
import fs from 'node:fs'
import { chromium } from 'playwright'
import { expect } from './_assert.mjs'
const fixture = '.tmp/director-full-audit-20260907/inspector-fields.html'
fs.mkdirSync('.tmp/director-full-audit-20260907', { recursive: true })
fs.writeFileSync(fixture, `<html><head><link rel="stylesheet" href="/tailwind.generated.css"></head><body><div id="app"></div><button id="outside">outside</button><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client';
import {DirectorStoreContext,useDirectorStore} from '/src/workbench/generationCanvas/nodes/director/DirectorEditorContext.ts';
import {createDirectorStore} from '/src/workbench/generationCanvas/nodes/director/model/directorStore.ts';
import {CAMERA_PRESETS,buildCameraFromPreset} from '/src/workbench/generationCanvas/nodes/director/model/cameraPresets.ts';
import {Vec3Fields,ColorField} from '/src/workbench/generationCanvas/nodes/director/panels/fields/FieldPrimitives.tsx';
import {SliderNumberField} from '/src/workbench/generationCanvas/nodes/director/panels/fields/SliderNumberField.tsx';
import {CameraInspector} from '/src/workbench/generationCanvas/nodes/director/panels/inspector/CameraInspector.tsx';
import {LightInspector} from '/src/workbench/generationCanvas/nodes/director/panels/inspector/LightInspector.tsx';
import {SceneLayerInspector} from '/src/workbench/generationCanvas/nodes/director/panels/inspector/SceneLayerInspector.tsx';
import {ObjectTransformSection} from '/src/workbench/generationCanvas/nodes/director/panels/inspector/TransformSection.tsx';
const store=createDirectorStore({defaultSceneName:'S'}); const api=store.getState();
const id=api.addObject({name:'A',type:'character',position:{x:5,y:2,z:3},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},visible:true,locked:false,color:'#ff0000'});
const cameraId=api.addCamera(buildCameraFromPreset({preset:CAMERA_PRESETS[0],id:'camera',name:'Camera'}));
const lightId=api.addLight('point','Light');
window.fixture={store,id,cameraId,lightId};
function App(){const project=useDirectorStore(s=>s.project); const scene=project.scenes.find(s=>s.id===project.activeSceneId);const object=scene.objects.find(o=>o.id===id); const save=()=>api.saveState();
return React.createElement('main',{style:{width:600}},
React.createElement('div',{id:'vec'},React.createElement(Vec3Fields,{label:'position',value:object.position,onChangeStart:save,onChange:position=>api.updateObject(id,{position})})),
React.createElement('div',{id:'scalar'},React.createElement(SliderNumberField,{label:'scalar',value:object.position.x,min:0,max:20,step:1,onChangeStart:save,onChange:x=>api.updateObject(id,{position:{...object.position,x}})})),
React.createElement('div',{id:'color'},React.createElement(ColorField,{label:'color',value:object.color??'',allowClear:true,presets:[],onChangeStart:save,onChange:color=>api.updateObject(id,{color})})),
React.createElement('div',{id:'object-transform'},React.createElement(ObjectTransformSection,{object})),
React.createElement('div',{id:'camera'},React.createElement(CameraInspector,{camera:scene.cameras.find(c=>c.id===cameraId)})),
React.createElement('div',{id:'light'},React.createElement(LightInspector,{light:scene.lights.find(l=>l.id===lightId)})),
React.createElement('div',{id:'scene'},React.createElement(SceneLayerInspector)));
}
createRoot(document.getElementById('app')).render(React.createElement(DirectorStoreContext.Provider,{value:store},React.createElement(App)));
</script></body></html>`)
const browser = await chromium.launch({ headless: true, channel: process.env.NOMI_BROWSER_CHANNEL ?? 'chrome' })
const page = await browser.newPage({ viewport: { width: 800, height: 900 } })
const errors = []
page.on('pageerror', error => { errors.push(error.message); console.log(`PAGE ERROR ${error.message}`) })
let failures = 0
const value = () => page.evaluate(() => window.fixture.store.getState().findObject(window.fixture.id)?.position.x)
const undo = () => page.evaluate(() => window.fixture.store.getState().undo())
async function run(name, check, restores = true) {
  await page.goto(`${process.env.NOMI_DIRECTOR_URL ?? 'http://127.0.0.1:5175'}/${fixture}`)
  await expect(page.locator('#scalar input[type=text]')).toBeVisible()
  const before = await page.evaluate(() => window.fixture.store.getState().exportProject())
  try { await check(); if (restores) expect(await page.evaluate(() => window.fixture.store.getState().exportProject())).toEqual(before); console.log(`PASS ${name}`) }
  catch (error) { failures++; console.log(`FAIL ${name}: ${error.message}`) }
}
try {
  for (const field of ['vec', 'scalar']) {
    for (const mode of ['escape', 'blank']) await run(`${field} ${mode} does not write zero`, async () => {
      const input = page.locator(`#${field} input[type=text]`).first()
      await input.fill(mode === 'blank' ? '' : '9')
      if (mode === 'escape') await input.press('Escape')
      await page.locator('#outside').click()
      expect(await value()).toBe(5)
    })
  }
  await run('range keyboard change is undoable', async () => {
    await page.locator('#scalar input[type=range]').focus()
    await page.keyboard.press('ArrowRight')
    expect(await value()).toBe(6)
    await undo()
    expect(await value()).toBe(5)
  })
  await run('focused numeric wheel value survives blur', async () => {
    const input = page.locator('#vec input[type=text]').first()
    await input.focus()
    await input.hover()
    await page.mouse.wheel(0,-100)
    await expect.poll(value).toBe(5.01)
    await page.locator('#outside').click()
    expect(await value()).toBe(5.01)
    await undo()
  })
  for (const kind of ['camera','object']) await run(`${kind} evaluated transform disables keyboard controls`, async () => {
    await page.evaluate(kind => {
      const f=window.fixture; const api=f.store.getState(); const id=kind==='camera'?f.cameraId:f.id;
      const clip=api.addTrajectoryClip(id,0,4); api.insertWaypoint(id,0,{x:0},clip.id); api.insertWaypoint(id,4,{x:4},clip.id); api.setTimelineContext({currentTime:2});
    },kind)
    const section = page.locator(kind==='camera'?'#camera':'#object-transform').getByTestId('director-edit-mode').locator('..')
    await expect(section.locator('input[type=text]').first()).toBeDisabled()
    await expect(section.locator('input[type=range]').first()).toBeDisabled()
    await expect(section.locator('button').first()).toBeDisabled()
  }, false)
  await run('clearing color is undoable', async () => {
    await page.locator('#color button').click()
    await undo()
    expect(await page.evaluate(() => window.fixture.store.getState().findObject(window.fixture.id)?.color)).toBe('#ff0000')
  })
  await run('color keyboard/input event is undoable', async () => {
    await page.locator('#color input[type=color]').fill('#00ff00')
    await undo()
    expect(await page.evaluate(() => window.fixture.store.getState().findObject(window.fixture.id)?.color)).toBe('#ff0000')
  })
  for (const kind of ['camera', 'light']) await run(`${kind} rename is undoable`, async () => {
    await page.locator(`#${kind} input[type=text]`).first().fill('Changed')
    await page.locator('#outside').click()
    await undo()
    expect(await page.evaluate(kind => {
      const f=window.fixture; return kind==='camera' ? f.store.getState().findCamera(f.cameraId)?.name : f.store.getState().findLight(f.lightId)?.name
    }, kind)).toBe(kind === 'camera' ? 'Camera' : 'Light')
  })
  const toggles = [['camera',0,'showRayHelper'],['light',3,'castShadow'],['scene',0,'showCharacterLabels'],['scene',1,'gridVisible'],['scene',2,'gridSnapEnabled']]
  for (const [kind,index,key] of toggles) await run(`${kind} ${key} is undoable`, async () => {
    const read = () => page.evaluate(({kind,key}) => {const f=window.fixture; const s=f.store.getState(); return (kind==='camera'?s.findCamera(f.cameraId):kind==='light'?s.findLight(f.lightId):s.activeScene().sceneConfig)?.[key]}, {kind,key})
    const before=await read()
    await page.locator(`#${kind} input[type=checkbox]`).nth(index).click()
    expect(await read()).toBe(!before)
    await undo()
    expect(await read()).toBe(before)
  })
  if (failures) throw new Error(`${failures} field interaction failures; ${errors.length} page errors`)
  if (errors.length) throw new Error(errors.join('\n'))
} finally { await browser.close() }
