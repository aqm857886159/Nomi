// Real builder controls and persistent scene/library transactions with a deterministic delayed model result.
// This verifies the product workflow, not provider output quality.
import { clickOrFail, launchDirectorLab } from './_directorLab.mjs'
import { expect, expectAbsent, proveProbe } from './_assert.mjs'

const lab = await launchDirectorLab({ name: 'ai-builder' })
const { page } = lab
const scene = { sceneName: 'Walk Cafe', groups: [{ name: 'Furniture', elements: [{ type: 'cube', name: 'Table', position: [0, 0.5, 0], scale: [2, 1, 1] }, { type: 'cylinder', name: 'Stool', position: [2, 0.4, 0], scale: [0.6, 0.8, 0.6] }] }] }
try {
  await page.evaluate(() => {
    window.__nomiDirectorAiPending = []
    window.__nomiDirectorAiMock = (input) => new Promise((resolve) => window.__nomiDirectorAiPending.push({ input, resolve }))
  })
  await clickOrFail(page.getByRole('button', { name: 'AI 搭场景', exact: true }), 'AI 搭场景')
  const ai = page.getByTestId('director-ai-bar')
  await ai.locator('textarea').fill('A cafe with a table and stool')
  await ai.getByRole('radio', { name: '新图层', exact: true }).click()
  const images = ['red', 'blue', 'green', 'yellow'].map((color) => ({ name: `${color}.svg`, mimeType: 'image/svg+xml', buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="${color}"/></svg>`) }))
  await ai.locator('input[type="file"]').setInputFiles(images)
  await expect(ai.getByRole('button', { name: '移除参考图', exact: true, includeHidden: true })).toHaveCount(3)
  const beforeCancel = await lab.project()
  await ai.getByRole('button', { name: '开始搭建', exact: true }).click()
  await expect(ai.locator('textarea')).toBeDisabled()
  await expect(ai.getByRole('radio', { name: '新图层', exact: true })).toBeDisabled()
  await ai.getByRole('button', { name: '取消', exact: true }).click()
  await page.evaluate((result) => window.__nomiDirectorAiPending[0].resolve(result), scene)
  await expect(page.getByTestId('director-ai-status')).toHaveText('已取消生成')
  expect(await lab.project()).toEqual(beforeCancel)
  await lab.snap('cancelled-with-three-references')
  await ai.getByRole('button', { name: '开始搭建', exact: true }).click()
  await page.waitForFunction(() => window.__nomiDirectorAiPending.length === 2)
  expect(await page.evaluate(() => window.__nomiDirectorAiPending[1].input.images.length)).toBe(3)
  await page.evaluate((result) => window.__nomiDirectorAiPending[1].resolve(result), scene)
  await lab.waitScene('p.scenes.length === 2 && p.assets.items.length === 1 && s.objects.length === 3', '生成结果与资产一起落盘')
  await lab.snap('generated-scene-and-library')
  const aiProof = await proveProbe(ai, '生成完成后 AI 搭场景面板仍在')
  await ai.getByRole('button', { name: '关闭', exact: true }).click()
  await expectAbsent(ai, { provenBy: aiProof, message: '关闭后 AI 搭场景面板持续退出' })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+z')
  await lab.waitScene('p.scenes.length === 1 && p.assets.items.length === 0', '一次撤销同时移除图层和资产')
  await page.keyboard.press('Control+Shift+z')
  await lab.waitScene('p.scenes.length === 2 && p.assets.items.length === 1', '重做恢复图层和资产')
  await clickOrFail(page.getByText('资产库', { exact: true }), '资产库')
  await page.getByTestId('director-assets').locator('div.pl-6').filter({ hasText: 'AI·Walk Cafe' }).first().dblclick()
  await lab.waitScene('p.scenes.length === 3 && s.objects.length === 3', '保存的AI场景可再次导入')
  await lab.snap('reimported-generated-scene')
  lab.check('AI参考图上限/迟到取消/生成/资产保存/撤销重做/再次导入闭环通过', true)
} catch (error) {
  await lab.snap('failure')
  lab.check(`AI走查中断：${String(error)}`, false)
} finally {
  await lab.finish()
}
