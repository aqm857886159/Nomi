// 分组框在走查里的**唯一**定位出口（10-10 拍板：框头进框内后，各走查不再各抄一份选择器）。
//
// 为什么要它：框头从框外标签改到框内一行（组名 · 计数 + 生成全部），工具条的 ⋯ 也是新入口。旧的选择器散在八份走查里，
// 框头一改就同时悬空。现在走查找框 / 框头 / 标题 / 计数 / 生成全部 / 工具条的组名与 ⋯，一律经这里；框头再变，只改这一个文件。
//
// 页面里读 DOM 的走查（page.evaluate）用下面的字符串常量；Playwright 定位用对应的函数。
import { clickOrFail } from './_assert.mjs'
import { GROUP_TOOLBAR } from './_groupGenerate.mjs'

/** 框体（绝对定位的 div，带 data-group-id）。 */
export const GROUP_FRAME_SELECTOR = '.generation-canvas-v2__group-box[data-group-id]'
/** 框头（框内左上一行：组名 · 计数 · 生成全部）。 */
export const GROUP_FRAME_HEADER_SELECTOR = '.generation-canvas-v2__group-box-label'
/** 框头里的组名（分镜组带「分镜 · 」前缀）。 */
export const GROUP_FRAME_TITLE_SELECTOR = '[data-frame-title="true"]'
/** 框头里的计数（「6 镜」「3 个」，拖动中「6 → 5」）。 */
export const GROUP_FRAME_COUNT_SELECTOR = '[data-frame-count="true"]'
/** 框头右上「生成全部」。 */
export const GROUP_FRAME_GENERATE_ALL_SELECTOR = '[data-frame-generate-all="true"]'
/** 分组工具条上的组名与计数（与框头同一显示函数：分镜 · 名 · N 镜）。 */
export const GROUP_TOOLBAR_TITLE_SELECTOR = '[data-group-toolbar-count="true"]'
/** 分组工具条末尾「⋯」的无障碍名字（中：「组「名」的更多操作」，英：「More actions for group …」）。 */
export const GROUP_TOOLBAR_MORE_NAME = /的更多操作$|More actions/

/** 按组 id 找框体。 */
export function groupFrame(win, groupId) {
  return win.locator(`.generation-canvas-v2__group-box[data-group-id="${groupId}"]`)
}
/** 框头根（框体内）。 */
export function groupFrameHeader(frame) {
  return frame.locator(GROUP_FRAME_HEADER_SELECTOR).first()
}
export function groupFrameTitle(frame) {
  return frame.locator(GROUP_FRAME_TITLE_SELECTOR).first()
}
export function groupFrameCount(frame) {
  return frame.locator(GROUP_FRAME_COUNT_SELECTOR).first()
}
export function groupFrameGenerateAll(frame) {
  return frame.locator(GROUP_FRAME_GENERATE_ALL_SELECTOR).first()
}
export function groupToolbarTitle(win) {
  return win.locator(GROUP_TOOLBAR_TITLE_SELECTOR).first()
}
export function groupToolbarMore(win) {
  return win.locator(GROUP_TOOLBAR).getByRole('button', { name: GROUP_TOOLBAR_MORE_NAME }).first()
}

// ── 框的菜单入口（右键 / 工具条「⋯」）──

/** 框体空白点：左下角内缩区（左上角压着节点名字标签，右下角常被成员卡盖住）。 */
export async function frameBlankPosition(frame) {
  const box = await frame.boundingBox()
  return { x: 8, y: Math.max(8, (box?.height ?? 40) - 8) }
}

/** 右键框体空白打开框菜单（与工具条「⋯」同一份 FrameContextMenu）。 */
export async function openFrameMenuByRightClick(frame) {
  await frame.click({ button: 'right', position: await frameBlankPosition(frame) })
}

/** 选中框（点框体空白）后，经工具条末尾「⋯」打开框菜单（只剩 改名 / 折叠 / 删除）。 */
export async function openFrameMenuFromToolbar(win, frame) {
  await frame.click({ position: await frameBlankPosition(frame) })
  await clickOrFail(groupToolbarMore(win), '分组工具条「⋯」')
}
