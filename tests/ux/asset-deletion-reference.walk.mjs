import fs from 'node:fs'
import path from 'node:path'
import { expect, expectVisible, expectAbsent, proveProbe } from './_assert.mjs'
import { switchGenerationView, canvasFitViewButton } from './_shell.mjs'
import { launchParityFixture } from './_viewParityFixture.mjs'

let fixture
const observations={}
try {
  fixture=await launchParityFixture('asset-deletion-reference')
  const {app,win,file,url,projectRoot,shot,cdp}=fixture
  observations.before={exists:fs.existsSync(file),timeline:JSON.parse(fs.readFileSync(path.join(projectRoot,'.nomi/project.json'))).payload.timeline}
  await win.evaluate(()=>window.dispatchEvent(new CustomEvent('nomi-open-browser')))
  await win.getByRole('button',{name:/打开素材盒|Open asset box/,exact:true}).click()
  await expect.poll(()=>app.windows().filter(page=>page.url().includes('browser-asset-overlay')).length).toBe(1)
  const overlay=app.windows().find(page=>page.url().includes('browser-asset-overlay'))
  const tile=overlay.locator('[data-browser-asset-tile]').filter({hasText:'parity-shared'})
  await expectVisible(tile)
  await tile.click({button:'right'})
  await overlay.getByRole('menuitem',{name:/删除|Delete/,exact:false}).click()
  const dialog=overlay.locator('[data-confirm-dialog-surface]')
  await expect(dialog).toBeVisible()
  await shot('01-confirm',overlay)
  await dialog.locator('[data-confirm-dialog-confirm]').click()
  await expect(dialog).not.toBeVisible()
  await expectVisible(overlay.getByText(/仍在使用|还在使用|还在画布或时间轴上用着|still in use|still used/i))
  observations.after={exists:fs.existsSync(file)}
  expect(observations.after.exists).toBe(true)
  await expect(tile).toBeVisible()
  await shot('02-kept-in-use',overlay)
  observations.freshResponse=await win.evaluate(async(url)=>{const r=await fetch(url,{cache:'no-store'});return {status:r.status,ok:r.ok}},url)
  expect(observations.freshResponse.status).toBe(200)
  await cdp.send('Network.clearBrowserCache')
  await win.reload({waitUntil:'domcontentloaded'})
  const resume=win.getByRole('button',{name:/继续创作|Continue/}).first()
  if(await resume.isVisible())await resume.click()
  await expectVisible(win.locator('[data-generation-view-switcher]'))
  await switchGenerationView(win,'canvas')
  await canvasFitViewButton(win).click()
  const image=win.locator('.generation-canvas-v2-node[data-node-id="shared-node"] img').first()
  await expect.poll(()=>image.evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true)
  const mediaProof=await proveProbe(image,'重载后同一个画布节点的媒体探针可见')
  await expectAbsent(win.locator('[data-node-media-failure]'),{provenBy:mediaProof})
  observations.reloadedImage=await image.evaluate(i=>({complete:i.complete,width:i.naturalWidth}))
  await shot('03-reloaded-canvas-and-timeline')
  console.log('PASS browser deletion preserved referenced file and media after reload',JSON.stringify(observations))
} catch(error) {
  observations.error=String(error.stack||error)
  console.error(observations.error)
  process.exitCode=error.exitCode||1
  await fixture?.shot('99-failed').catch(()=>{})
} finally {
  if(fixture)fs.writeFileSync(path.join(fixture.out,'observations.json'),JSON.stringify(observations,null,2))
  await fixture?.close()
}
