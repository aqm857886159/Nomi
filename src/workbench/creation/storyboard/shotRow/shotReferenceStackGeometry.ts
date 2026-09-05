/**
 * 参考叠放格的几何（合同 §2.6 / §4.2 / §6.3）。
 *
 * 叠放是「手抓扑克」：第一张正放，后两张以**左下角为轴**（`transform-origin: 20% 100%`）
 * 向右上各转 13°/26°。旋转让卡片扫出的面积**大于卡片本身**——右上角甩出去、右下角荡下来。
 * 槽如果只按卡片尺寸占位，扇面就会盖住右边那个槽和自己下面的 caption（2026-09-06 用户实测到的
 * 正是这一幕：全能参考的图片堆压在「白膜预览」上、把「参考」两个字盖掉）。
 *
 * 所以这里算的不是「卡多大」，而是**旋转后的真实包围盒**：三个角度各转四个角，取并集。
 * 槽按这个包围盒占位，扇面就永远待在自己格子里——与张数无关（≥3 张只画 3 张，包围盒封顶）。
 */

export const REFERENCE_CARD_SIZE = 56
/** 叠放卡比单张 tile 窄（样张 `.stack .t1{width:44px}`）——窄卡才能在一格里扇得开。 */
export const REFERENCE_STACK_CARD_WIDTH = 44
export const REFERENCE_STACK_CARD_HEIGHT = 56
/** 第 n 张的旋转角；数组长度 = 最多画几张（再多只加计数，不加卡）。 */
export const REFERENCE_STACK_ANGLES = [0, 13, 26] as const
export const REFERENCE_STACK_VISIBLE_CARDS = REFERENCE_STACK_ANGLES.length
/** 旋转轴在卡内的位置（左下角略往里，样张 `transform-origin:20% 100%`）。 */
export const REFERENCE_STACK_ORIGIN_X_RATIO = 0.2
/** 三个槽之间的最小间距；槽宽已含扇面，间距只负责「两格之间看得出是两格」。 */
export const REFERENCE_SLOT_GAP = 8

export type ReferenceStackBox = {
  /** 槽要预留的宽/高（含扇面甩出去的部分）。 */
  width: number
  height: number
  /** 卡片左上角在这个预留框里的落点——扇面往上甩时要把卡整体往下推，否则顶边被裁。 */
  cardLeft: number
  cardTop: number
}

function rotatedCorners(angleDeg: number): { x: number; y: number }[] {
  const width = REFERENCE_STACK_CARD_WIDTH
  const height = REFERENCE_STACK_CARD_HEIGHT
  const originX = width * REFERENCE_STACK_ORIGIN_X_RATIO
  const originY = height
  const radians = (angleDeg * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return [[0, 0], [width, 0], [width, height], [0, height]].map(([x, y]) => {
    const dx = x - originX
    const dy = y - originY
    return { x: originX + dx * cos - dy * sin, y: originY + dx * sin + dy * cos }
  })
}

/** 画 `visibleCards` 张卡时，扇面的包围盒（含卡片本身）。 */
export function referenceStackBox(bindingCount: number): ReferenceStackBox {
  const visible = Math.min(Math.max(0, bindingCount), REFERENCE_STACK_VISIBLE_CARDS)
  if (visible <= 1) {
    return { width: REFERENCE_CARD_SIZE, height: REFERENCE_CARD_SIZE, cardLeft: 0, cardTop: 0 }
  }
  const points = REFERENCE_STACK_ANGLES.slice(0, visible).flatMap((angle) => rotatedCorners(angle))
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxY = Math.max(...points.map((point) => point.y))
  // 落点先取整（CSS 用整数 px 才不糊边），预留框再按取整后的落点封顶——
  // 先算尺寸再取整会让下/右边缘差半个像素，扇面正好从那半个像素里漏出去。
  const cardLeft = Math.ceil(Math.max(0, -minX))
  const cardTop = Math.ceil(Math.max(0, -minY))
  return {
    width: Math.ceil(maxX + cardLeft),
    height: Math.ceil(maxY + cardTop),
    cardLeft,
    cardTop,
  }
}

/** 槽的占位宽度：单张 = tile 边长，多张 = 扇面包围盒宽。 */
export function referenceSlotWidth(bindingCount: number): number {
  return Math.max(REFERENCE_CARD_SIZE, referenceStackBox(bindingCount).width)
}

/** 槽的媒体区高度；同一行三个槽取最大值对齐，caption 才在一条线上。 */
export function referenceSlotHeight(bindingCount: number): number {
  return Math.max(REFERENCE_CARD_SIZE, referenceStackBox(bindingCount).height)
}
