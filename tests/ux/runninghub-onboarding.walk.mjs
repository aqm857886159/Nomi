// RunningHub 目录走查。默认在隔离资料中用测试凭据查模型，不提交生成任务。
import path from 'node:path'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import {
  canvasFitView, collapseAgentPanel, createBlankProject, nodeModelTrigger,
  openNodeModelMenu, selectOrAddCanvasNode, switchGenerationView, switchWorkspace,
} from './_shell.mjs'
import { initialPreferences } from './uiDriverOptions.mjs'

const shotsDir = makeTempDir('runninghub-shots')
process.env.EVIDENCE_DIR ??= shotsDir
const realKey = process.env.RH_KEY
const { win, close } = await launchNomiApp({
  name: 'runninghub-onboarding',
  tempRoot: makeTempDir('runninghub-onboarding'),
  syntheticCredentialStorage: !realKey,
  initialLocalStorage: initialPreferences({ locale: 'zh-CN', theme: 'light' }),
})

try {
  await win.evaluate(async (key) => {
    await window.nomiDesktop.modelCatalog.upsertVendorApiKey('runninghub', { apiKey: key, enabled: true })
  }, realKey || 'runninghub-catalog-walk-fixture')
  await win.reload()
  await createBlankProject(win)
  await switchWorkspace(win, 'generation')
  await switchGenerationView(win, 'canvas')
  await collapseAgentPanel(win)

  for (const { kind, expectedModels, pick } of [
    { kind: 'video', expectedModels: ['Seedance 2.0', '可灵 3.0'], pick: '可灵 3.0' },
    // 新建节点没有参考图，默认文生 3D；HiTem3D 只有图生通道。
    { kind: 'model3d', expectedModels: ['混元3D v3.1', 'Meshy 6'], pick: 'Meshy 6' },
  ]) {
    await addCanvasNodeFromRail(win, kind)
    const node = win.locator(`.react-flow__node.selected [data-kind="${kind}"]`)
    await expect(node).toHaveCount(1)
    if (kind === 'model3d') {
      await canvasFitView(win)
      await selectOrAddCanvasNode(win, kind)
    }
    await openNodeModelMenu(win)
    const menu = win.locator('[data-nomi-select-dropdown]:visible')
    const menuProof = await proveProbe(menu, `${kind} 模型菜单已展开`)
    const more = menu.getByRole('button', { name: '更多', exact: true })
    if (kind === 'model3d') await more.click()
    const labels = menu.locator('[data-nomi-select-option-label]')
    await screenshotSettled(win, { path: path.join(shotsDir, `${kind}-models.png`) })
    const names = await labels.allTextContents()
    console.log(kind, names)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toEqual(expect.arrayContaining(expectedModels))
    await menu.getByText(pick, { exact: true }).click()
    await expectAbsent(menu, { provenBy: menuProof, message: `选中 ${pick} 后下拉菜单已收起` })
    await expect(nodeModelTrigger(win)).toContainText(pick)
  }
  console.log('DONE')
} finally {
  await close()
}
