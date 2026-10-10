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

// 框的菜单入口（10-10 拍板）：框头上的 ⋯ 与折叠钮已删。
// 「折叠 / 编辑 / 删除」等整框动作：框边右键（同一份 FrameContextMenu）或分组工具条末尾的「⋯」。
export const GROUP_TOOLBAR_MORE_NAME = /的更多操作$|More actions/

/** 框体空白点：左下角内缩区（左上角压着节点名字标签，右下角常被成员卡盖住）。 */
export async function frameBlankPosition(frame) {
  const box = await frame.boundingBox()
  return { x: 8, y: Math.max(8, (box?.height ?? 40) - 8) }
}

/** 右键框体空白打开框菜单。 */
export async function openFrameMenuByRightClick(frame) {
  await frame.click({ button: 'right', position: await frameBlankPosition(frame) })
}

/** 选中框（点框体空白）后，经工具条末尾「⋯」打开同一份框菜单。 */
export async function openFrameMenuFromToolbar(win, frame) {
  await frame.click({ position: await frameBlankPosition(frame) })
  const more = win.locator(GROUP_TOOLBAR).getByRole('button', { name: GROUP_TOOLBAR_MORE_NAME }).first()
  await clickOrFail(more, '分组工具条「⋯」')
}
