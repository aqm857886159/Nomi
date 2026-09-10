// User-facing asset tree actions plus a real uploaded 3DGS valley (generated PLY), using the existing renderer.
// 仓库不内置任何泼溅文件：示例场景由用户自备上传，这里用与 J5 相同的生成山谷走同一条上传通路。
import path from 'node:path'
import { expect } from './_assert.mjs'
import { addCameraPreset, clickOrFail, launchDirectorLab, repoRoot, writeValleyPly } from './_directorLab.mjs'
import { stationTimeout } from './_station-budget.mjs'

const lab = await launchDirectorLab({ name: 'asset-tree' })
const { page } = lab
try {
  await clickOrFail(page.getByText('资产库', { exact: true }), '资产库')
  const assets = page.getByTestId('director-assets')
  const folder = (name) => assets.locator('div[draggable="true"]').filter({ has: page.getByRole('button', { name, exact: true }) }).last()
  const header = (name) => folder(name).locator(':scope > div.group').first()
  async function createFolder(name, parent) {
    if (parent) await header(parent).getByRole('button', { name: '新建文件夹', exact: true }).click()
    else await assets.getByRole('button', { name: '新建文件夹', exact: true }).first().click()
    const created = folder('新文件夹')
    await created.locator(':scope > div.group').getByRole('button', { name: '重命名', exact: true }).click()
    await assets.locator('input').last().fill(name)
    await assets.locator('input').last().press('Enter')
  }
  await createFolder('Actors')
  await createFolder('Locations')
  await createFolder('Props', 'Actors')
  await lab.waitScene('p.assets.folders.length === 3', '三个目录已保存')
  const all = (await lab.project()).assets.folders
  const locationId = all.find((item) => item.name === 'Locations').id
  const actorsId = all.find((item) => item.name === 'Actors').id
  const propsId = all.find((item) => item.name === 'Props').id
  await header('Actors').getByRole('button', { name: '移动到…', exact: true }).click()
  await page.getByRole('button', { name: 'Locations', exact: true }).last().click()
  await lab.waitScene(`p.assets.folders.find(f => f.id === ${JSON.stringify(actorsId)}).parentId === ${JSON.stringify(locationId)}`, '目录移动到Locations')
  await header('Locations').dragTo(header('Props'))
  await lab.waitScene(`p.assets.folders.find(f => f.id === ${JSON.stringify(locationId)}).parentId === null && p.assets.folders.find(f => f.id === ${JSON.stringify(propsId)}).parentId === ${JSON.stringify(actorsId)}`, '拒绝拖进自己的子目录')
  const raw = { name: 'Chair scene', objects: [{ id: 'chair', name: 'Chair', type: 'cube', position: { x: 0, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }] }
  await assets.locator('input[type="file"]').setInputFiles({ name: 'chair.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(raw)) })
  const item = assets.locator('div.pl-6').filter({ hasText: 'chair' }).first()
  await expect(item).toBeVisible()
  await item.dragTo(header('Props'))
  await lab.waitScene(`p.assets.items.some(i => i.name === 'chair' && i.folderId === ${JSON.stringify(propsId)})`, '文件拖入Props')
  await header('Locations').getByRole('button', { name: 'Locations', exact: true }).click()
  const search = assets.locator('input:not([type="file"])').first()
  await search.fill('chair')
  await expect(item).toBeVisible()
  await lab.snap('nested-search')
  await search.fill('')
  await search.press('Escape')
  const ply = writeValleyPly(path.join(repoRoot, '.tmp', 'director-assets', 'valley.ply'), 15000)
  await assets.locator('input[type="file"]').setInputFiles(ply)
  const valley = assets.locator('div.pl-6').filter({ hasText: 'valley' }).first()
  await expect(valley).toBeVisible()
  await valley.dblclick()
  await lab.waitScene("s.objects.some(o => o.type === 'splat')", '上传的山谷入场')
  const splat = (await lab.scene()).objects.find((object) => object.type === 'splat')
  await page.waitForFunction((id) => {
    const info = window.__nomiDirectorE2E?.splatInfo(id)
    return info?.initialized && info.count > 0 && !info.revealing
  }, splat.id, { timeout: stationTimeout({ operations: 4 }) })
  const info = await lab.bridge('splatInfo', splat.id)
  lab.check('上传的 PLY 山谷已解码且完成显现', info.initialized && info.count > 0 && !info.revealing, `${info.count} splats`)
  lab.check('泼溅添加按源轴约定绕X翻转180度', splat.rotation.x === 180)
  await clickOrFail(page.getByText('场景对象', { exact: true }), '场景对象')
  await lab.outlinerRow('valley').dblclick()
  const rename = page.getByTestId('director-outliner').locator('input:not([placeholder])').first()
  await rename.fill('Valley renamed')
  await rename.press('Enter')
  await lab.waitScene("s.objects.some(o => o.name === 'Valley renamed')", '山谷重命名')
  const renamed = await lab.bridge('splatInfo', splat.id)
  lab.check('重命名不重建泼溅或重启黑幕', renamed?.identity === info.identity && renamed.initialized && !renamed.revealing)
  await lab.snap('uploaded-valley')
  await addCameraPreset(lab, '正面特写')
  await lab.waitScene('s.cameras.length === 1', '为山谷建立观察机位')
  await page.getByTestId('director-pip').getByRole('button', { name: '进入视角', exact: true }).click()
  await lab.snap('valley-observation-camera')
  lab.check('资产目录菜单/拖拽/循环拒绝/折叠搜索走通', true)
} catch (error) {
  lab.check(`资产走查中断：${String(error)}`, false)
} finally {
  await lab.finish()
}
