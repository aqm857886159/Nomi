import fs from 'node:fs'
import path from 'node:path'
import { expect, waitForVisualQuiescence } from './_assert.mjs'
import { switchGenerationView } from './_shell.mjs'
import { launchParityFixture, selectParityNode } from './_viewParityFixture.mjs'

let fixture
const observations={}
try {
  fixture=await launchParityFixture('hidden-surface-input')
  const {win,snapshot,shot}=fixture
  await selectParityNode(win)
  await expect.poll(async()=>(await snapshot()).selected).toEqual(['shared-node'])
  observations.beforeDelete=await snapshot()
  await shot('01-selected-canvas')
  await switchGenerationView(win,'list')
  await expect(win.locator('[data-generation-list]')).toBeVisible()
  await win.keyboard.press('Delete')
  await waitForVisualQuiescence(win)
  observations.afterDelete=await snapshot()
  expect(observations.afterDelete).toEqual(observations.beforeDelete)
  await switchGenerationView(win,'canvas')
  await shot('02-after-list-delete')
  await win.keyboard.press('Meta+d')
  await expect.poll(async()=>(await snapshot()).nodes.length).toBe(2)
  observations.beforeUndo=await snapshot()
  await switchGenerationView(win,'list')
  await win.keyboard.press('Meta+z')
  await waitForVisualQuiescence(win)
  observations.afterUndo=await snapshot()
  expect(observations.afterUndo).toEqual(observations.beforeUndo)
  await switchGenerationView(win,'canvas')
  await shot('03-after-list-undo')
  console.log('PASS hidden surface preserved nodes, selection and undo state',JSON.stringify(observations))
} catch(error) {
  observations.error=String(error.stack||error)
  console.error(observations.error)
  process.exitCode=error.exitCode||1
  await fixture?.shot('99-failed').catch(()=>{})
} finally {
  if(fixture)fs.writeFileSync(path.join(fixture.out,'observations.json'),JSON.stringify(observations,null,2))
  await fixture?.close()
}
