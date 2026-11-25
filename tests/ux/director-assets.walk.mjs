// User-facing asset tree actions plus a real uploaded 3DGS valley (generated PLY), using the existing renderer.
// 仓库不内置任何泼溅文件：示例场景由用户自备上传，这里用与 J5 相同的生成山谷走同一条上传通路。
import path from 'node:path'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { expect } from './_assert.mjs'
import { addCameraPreset, clickOrFail, closeAssets, directorText, launchDirectorLab, openAssets, writeValleyPly } from './_directorLab.mjs'
import { stationTimeout } from './_station-budget.mjs'

const tempDir = makeTempDir('nomi-director-assets-')
const lab = await launchDirectorLab({ name: 'asset-tree', shotsDir: path.join(tempDir, 'shots') })
const { page } = lab
try {
  await openAssets(lab)
  const assets = page.getByTestId('director-assets-drawer').getByTestId('director-assets')
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
  const ply = writeValleyPly(path.join(tempDir, 'valley.ply'), 15000)
  await assets.locator('input[type="file"]').setInputFiles(ply)
  const valley = assets.locator('div.pl-6').filter({ hasText: 'valley' }).first()
  await expect(valley).toBeVisible()
  await valley.dblclick()
  // 双击后泼溅在页面主线程上解码：无界面软件渲染、机器忙时能占住主线程半分钟，2s 空闲自动保存跟着推迟（2026-10-24 本机实测落盘 +36s）。
  // 上限和下面「显现完成」同一档，不用默认 20s。
  await lab.waitScene("s.objects.some(o => o.type === 'splat')", '上传的山谷入场', stationTimeout({ operations: 4 }))
  const splat = (await lab.scene()).objects.find((object) => object.type === 'splat')
  const splatInfo = () => lab.bridge('splatInfo', splat.id)
  // 软件渲染下显现受帧耗时影响。按解码与显现完成的读数收口。
  await expect.poll(splatInfo, { message: '上传的 PLY 山谷已解码且完成显现', timeout: stationTimeout({ operations: 8 }) })
    .toMatchObject({ initialized: true, count: 15000, revealing: false })
  const info = await splatInfo()
  lab.check('上传的 PLY 山谷已解码且完成显现', info.initialized && info.count === 15000 && !info.revealing, `${info.count} splats`)
  lab.check('泼溅添加按源轴约定绕X翻转180度', splat.rotation.x === 180)
  await lab.openOutliner()
  await lab.outlinerRow('valley').dblclick()
  const rename = page.getByTestId('director-outliner').locator('input:not([placeholder])').first()
  await rename.fill('Valley renamed')
  await rename.press('Enter')
  await lab.waitScene("s.objects.some(o => o.name === 'Valley renamed')", '山谷重命名')
  const renamed = await lab.bridge('splatInfo', splat.id)
  lab.check('重命名不重建泼溅或重启黑幕', renamed?.identity === info.identity && renamed.initialized && !renamed.revealing)
  await lab.snap('uploaded-valley')
  // 重命名是在「▤ 图层名 ▾」浮层里做的：先像用户一样收起它（开着会盖住资产库抽屉的 ×），再关资产库露出左下预览小窗
  await lab.closeOutliner()
  await closeAssets(lab)
  await addCameraPreset(lab, '正面特写')
  await lab.waitScene('s.cameras.length === 1', '为山谷建立观察机位')
  const enterPov = page.getByTestId('director-pip').getByRole('button', { name: await directorText(page, 'camera.enterPov'), exact: true })
  const timeout = stationTimeout({ operations: 4 })
  await clickOrFail(enterPov, '观察机位·进入视角', { timeout })
  await expect(page.getByTestId('director-pov-hud')).toBeVisible({ timeout })
  await lab.snap('valley-observation-camera')
  lab.check('资产目录菜单/拖拽/循环拒绝/折叠搜索走通', true)
} catch (error) {
  lab.check(`资产走查中断：${String(error.stack ?? error)}`, false)
} finally {
  await lab.finish()
}
