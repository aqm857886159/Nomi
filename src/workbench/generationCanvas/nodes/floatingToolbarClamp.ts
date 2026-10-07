/**
 * 节点浮条的位置测量：浮条整条必须留在**可见画布**里（画布舞台 = 右侧 Agent 面板让出来之后的那块），
 * 左右、上下都夹住；舞台太窄就限宽折行。节点贴着画布边时，浮条比节点宽得多，不夹就会被舞台裁掉一截
 * （「重拍这镜」现在只住在浮条里，被裁掉就等于没有入口）。
 *
 * 这是「量 → setState → 再量」的反馈环（浮条外壳的 useLayoutEffect），所以这里的唯一不变量是：
 * **一次测量就算出不动点**——同一帧里再量一次，结果必须原样不变，于是至多三次提交就停。
 *
 * 2026-10-06（docs/fixes/2026-10-06-floating-toolbar-update-loop.root-cause.json）：旧版假定
 * 「已施加的位移 = 屏幕像素」（净缩放恒为 1）。浮条的反向缩放读的是 store 里「记住的缩放」，
 * 打开项目「摆全貌」那一刻 React Flow 已是 2.1 倍、store 还是 1，屏幕上的位移就是记账的 2.1 倍：
 * 迭代 s ← c − (k−1)·s 在 k ≥ 2 时发散，同步的 layout effect 来回 setState 到 React #185，整块画布崩。
 * 现在净缩放 `scale` 从 DOM **量出来**（变换后宽 / 布局宽），位移按它换算——不管祖先上叠了什么缩放
 * （视口、节点弹入动画、实验室外框），一步到位。
 */

/** 浮条离舞台边缘至少留多少屏幕像素。 */
export const FLOATING_TOOLBAR_EDGE = 8
/** 舞台再窄，浮条也至少这么宽（屏幕像素），再窄就让它被裁。 */
export const FLOATING_TOOLBAR_MIN_WIDTH = 240
/**
 * 低于这个变化量（**屏幕像素**）就算收敛：不再 setState。
 *
 * 必须大于测量本身的噪声：布局宽可能是取整过的（offsetWidth），净缩放就带着 ±0.5/宽 的误差，
 * 限宽 = 舞台宽 / 净缩放 每量一次会抖将近 1 像素；容差若小于这个抖动，浮条折行时宽度一变、取整一变、
 * 限宽再变，永远停不下来（2026-10-07 CI 画布验收窄窗口那一格就是这样转到 #185 的）。
 * 2 像素远小于离舞台边的 8 像素留白，看不出来。
 */
const SETTLE_PX = 2

/**
 * 单轴夹取。`rectLeft / rectRight` 是浮条此刻的屏幕位置（已经带着 `appliedShift`），`min / max` 是舞台内缘，
 * `scale` 是浮条的净缩放（本地 1 单位 = 屏幕多少像素）。返回新的位移（本地单位，与 `appliedShift` 同一把尺）：
 * 先把「没位移时的自然位置」还原出来再算，所以画布平移回来之后位移会自己归零，不会留一个过期的偏移。
 * 浮条比舞台还宽时左对齐（左边的动作先露出来）。
 */
export function floatingToolbarShift({ rectLeft, rectRight, appliedShift, scale, min, max }: {
  rectLeft: number
  rectRight: number
  appliedShift: number
  scale: number
  min: number
  max: number
}): number {
  const k = Number.isFinite(scale) && scale > 0 ? scale : 1
  const naturalLeft = rectLeft - appliedShift * k
  const naturalRight = rectRight - appliedShift * k
  let offset = 0
  if (naturalRight - naturalLeft >= max - min) offset = min - naturalLeft
  else if (naturalLeft < min) offset = min - naturalLeft
  else if (naturalRight > max) offset = max - naturalRight
  return offset / k
}

type ScreenRect = { left: number; right: number; top: number; bottom: number; width: number }

export type FloatingToolbarPlacement = {
  /** 水平位移（本地单位；外壳按 `translate(shiftX / zoom)` 施加，屏幕上 = shiftX × 净缩放）。 */
  shiftX: number
  shiftY: number
  /** 本地像素的最大宽度；`undefined` = 还没量过。 */
  maxWidth: number | undefined
}

/**
 * 一次测量 → 下一份摆放；返回 `null` 表示已经收敛，**不许再 setState**。
 *
 * `layoutWidth` 是浮条不含 transform 的布局宽（外壳传带小数的计算宽；就算传取整的 offsetWidth，容差也盖得住），
 * 和屏幕宽一除就是净缩放。
 * 先定宽（宽度一变矩形就变，这一拍不算位移），宽度稳了再一步算出两个方向的位移。
 */
export function nextFloatingToolbarPlacement(input: {
  rect: ScreenRect
  layoutWidth: number
  stage: ScreenRect
  applied: FloatingToolbarPlacement
}): FloatingToolbarPlacement | null {
  const { rect, layoutWidth, stage, applied } = input
  if (!(rect.width > 0) || !(layoutWidth > 0)) return null
  const scale = rect.width / layoutWidth
  const limit = Math.max(FLOATING_TOOLBAR_MIN_WIDTH, Math.floor(stage.width - 2 * FLOATING_TOOLBAR_EDGE)) / scale
  if (applied.maxWidth === undefined || Math.abs(limit - applied.maxWidth) * scale > SETTLE_PX) return { ...applied, maxWidth: limit }
  const shiftX = floatingToolbarShift({ rectLeft: rect.left, rectRight: rect.right, appliedShift: applied.shiftX, scale, min: stage.left + FLOATING_TOOLBAR_EDGE, max: stage.right - FLOATING_TOOLBAR_EDGE })
  const shiftY = floatingToolbarShift({ rectLeft: rect.top, rectRight: rect.bottom, appliedShift: applied.shiftY, scale, min: stage.top + FLOATING_TOOLBAR_EDGE, max: stage.bottom - FLOATING_TOOLBAR_EDGE })
  if (Math.abs(shiftX - applied.shiftX) * scale <= SETTLE_PX && Math.abs(shiftY - applied.shiftY) * scale <= SETTLE_PX) return null
  return { ...applied, shiftX, shiftY }
}
