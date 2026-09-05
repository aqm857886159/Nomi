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

/**
 * **参考列的固定媒体盒**（2026-09-06 用户反馈四：「前两列——产物列和参考列——不同比例时排版要齐」）。
 *
 * 上一版槽宽槽高按**这一个槽装了几张**算：0 张 56×56、2 张 56×65、3 张 65×73。于是同一行的三个槽
 * 一高一矮，行与行之间又各不相同——参考列成了整张表里最参差的一块。
 *
 * 现在只有一只盒，尺寸 = **扇面全开时的包围盒**（画满 `REFERENCE_STACK_VISIBLE_CARDS` 张）。
 * 它是这一列的上界：预留了它，扇面就永远待在自己格子里；固定了它，参考 / 白膜预览 / 参考音频
 * 三个槽、叠放堆、单张 tile、缺输入图的红虚框全部同宽同高、同一条顶线，caption 也就在一条线上。
 * 内容一律**顶左对齐**（扇面的第一张卡本来就落在 `cardTop = 1`，与单张 tile 差 1px，肉眼是一条线）。
 */
export const REFERENCE_SLOT_BOX: { width: number; height: number } = {
  width: referenceStackBox(REFERENCE_STACK_VISIBLE_CARDS).width,
  height: referenceStackBox(REFERENCE_STACK_VISIBLE_CARDS).height,
}

/** 参考列最多几格（合同 §4.1 规则②，按六种真实档案定的上限）。 */
export const REFERENCE_MAX_SLOTS = 3

/**
 * 参考列的列宽——**从盒子和间距 derive，不写死**。
 *
 * 合同 §4.1 写的「200px」是样张量出来的估值，而不是从内容推出来的：固定盒（65）× 3 格 + 两个 8px
 * 间距 = 211，塞进 200 就又要横向滚，滚动条本身还会把 caption 那条线压掉一格。列宽跟着盒子走，
 * 「固定单行三格、永不换行」这条规则才真的成立（宽度是结果，不是另一个要人工对齐的常数）。
 */
export const REFERENCE_COLUMN_WIDTH =
  REFERENCE_SLOT_BOX.width * REFERENCE_MAX_SLOTS + REFERENCE_SLOT_GAP * (REFERENCE_MAX_SLOTS - 1)
