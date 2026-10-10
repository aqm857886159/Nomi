// 画布批量生成的唯一入口是「组工具条」上的「生成整组」。需要「几个节点一起生成」的走查统一经这里：
// 先把当前选中的节点编成一组，再点工具条。不要在各走查里各抄一份选择器。
import { clickOrFail, expect } from './_assert.mjs'

export const GROUP_GENERATE_NAME = /^(生成整组|Generate group)$/
export const GROUP_TOOLBAR = '[data-group-toolbar="true"]'

export function groupGenerateButton(win) {
  return win.locator(GROUP_TOOLBAR).getByRole('button', { name: GROUP_GENERATE_NAME })
}

/** 把已选中的 ≥2 个节点编成一组（点框选浮条上的「编组」）。编完选中的就是这个整组，组工具条随之出现。 */
export async function groupSelectedNodes(win) {
  const groupButton = win.locator('.generation-canvas-v2__selection-toolbar').getByRole('button', { name: /^(编组|Group)$/ })
  await clickOrFail(groupButton, '框选浮条「编组」')
  await expect(win.locator(GROUP_TOOLBAR), '编组后出现组工具条').toBeVisible()
}

/** 编组 → 点「生成整组」。调用方接着处理确认卡。 */
export async function groupSelectedNodesAndGenerate(win) {
  await groupSelectedNodes(win)
  await clickOrFail(groupGenerateButton(win), '组工具条「生成整组」')
}
