// 试验页（devlab，生产不引用）的「画布键盘宿主」声明——唯一一处。
//
// 生产里画布那一格的宿主（GenerationWorkspace）声明「输入在这」并标成画布快捷键面；自 e57081ef0（2026-10-30）起，
// 画布的键盘 / 点外面关闭只认声明过的宿主，没声明就静默丢掉。试验页单独挂组件、没有那一格，所以根节点要替它声明，
// 否则页里所有快捷键（导演台按「4」进画线、Esc、空格……）都按不动——2026-11 director-lab.html 就因为少这两行，
// 10 条导演台走查哑了两周。新加的试验页入口要接画布键盘，就调这一个函数，不要再手写这两个属性。
import { SHORTCUT_SURFACE_ATTRIBUTE, workspaceInputAttributes } from '../workbench/shortcutSurface'

export function declareLabCanvasInputHost(container: Element): void {
  for (const [name, value] of Object.entries(workspaceInputAttributes(true))) container.setAttribute(name, value)
  container.setAttribute(SHORTCUT_SURFACE_ATTRIBUTE, 'canvas')
}
