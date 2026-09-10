// Real asset upload and decoder selection: a Mixamo FBX becomes a character; a plain GLB stays a model.
// FBX 那一半需要真实的 Mixamo 带蒙皮角色文件（仓库不随附，用户自备）：用 NOMI_DIRECTOR_TEST_FBX 指向它；
// 没给就把这一半明说为「跳过」，不算通过。GLB 那一半用现场生成的最小立方体 GLB，不依赖任何外部文件。
import fs from 'node:fs'
import path from 'node:path'
import { clickOrFail, launchDirectorLab, repoRoot, writeCubeGlb } from './_directorLab.mjs'

const lab = await launchDirectorLab({ name: 'model-import' })
const { page } = lab
try {
  await clickOrFail(page.getByText('资产库', { exact: true }), '资产库')
  const assets = page.getByTestId('director-assets')
  const fbxPath = process.env.NOMI_DIRECTOR_TEST_FBX
  if (fbxPath && fs.existsSync(fbxPath)) {
    const fbxName = path.basename(fbxPath, path.extname(fbxPath))
    await assets.locator('input[type="file"]').setInputFiles(fbxPath)
    await assets.locator('div.pl-6').filter({ hasText: fbxName }).first().dblclick()
    await lab.waitScene(`s.objects.some(o => o.name === ${JSON.stringify(fbxName)} && o.type === 'character' && o.rig === 'mixamo')`, '真实FBX被正确解码并识别为Mixamo角色', 30_000)
    const actor = (await lab.scene()).objects.find((object) => object.name === fbxName)
    const bones = await lab.bridge('boneExtentByEntity', actor.id)
    lab.check('导入FBX存在真实Mixamo骨骼', Boolean(bones) && bones.maxY > bones.minY)
    await lab.snap('fbx-character')
  } else {
    console.log('  · 跳过 FBX 角色导入：未设置 NOMI_DIRECTOR_TEST_FBX（需自备 Mixamo 带蒙皮角色 FBX）')
  }
  const glb = writeCubeGlb(path.join(repoRoot, '.tmp', 'director-model-import', 'plain-model.glb'))
  await assets.locator('input[type="file"]').setInputFiles(glb)
  await assets.locator('div.pl-6').filter({ hasText: 'plain-model' }).first().dblclick()
  await lab.waitScene("s.objects.some(o => o.name === 'plain-model' && o.type === 'model')", '无Mixamo骨骼的GLB保留普通模型')
  const model = (await lab.scene()).objects.find((object) => object.name === 'plain-model')
  await page.waitForFunction((id) => {
    const bounds = window.__nomiDirectorE2E?.boundsByEntity(id)
    return bounds && bounds.max.every(Number.isFinite) && bounds.max.some((value, axis) => value - bounds.min[axis] > 0.01)
  }, model.id)
  lab.check('GLB普通模型已加载并有可见体积', true)
  await lab.snap('plain-glb-model')
} catch (error) {
  console.log('Model import state:', JSON.stringify((await lab.scene())?.objects.map(({ id, name, type, rig, modelPath }) => ({ id, name, type, rig, modelPath }))))
  await lab.snap('import-failure')
  lab.check(`模型导入中断：${String(error)}`, false)
} finally {
  await lab.finish()
}
