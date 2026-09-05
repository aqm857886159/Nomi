import { describe, expect, it } from 'vitest'
import {
  REFERENCE_CARD_SIZE,
  REFERENCE_SLOT_GAP,
  REFERENCE_STACK_ANGLES,
  REFERENCE_STACK_CARD_HEIGHT,
  REFERENCE_STACK_CARD_WIDTH,
  REFERENCE_STACK_ORIGIN_X_RATIO,
  REFERENCE_STACK_VISIBLE_CARDS,
  referenceSlotHeight,
  referenceSlotWidth,
  referenceStackBox,
} from './shotReferenceStackGeometry'

/** 独立复算一遍扇面的角点——和实现走不同的路，才验得出实现算错没有。 */
function fanCorners(visible: number): { x: number; y: number }[] {
  const originX = REFERENCE_STACK_CARD_WIDTH * REFERENCE_STACK_ORIGIN_X_RATIO
  const originY = REFERENCE_STACK_CARD_HEIGHT
  const corners: { x: number; y: number }[] = []
  for (const angle of REFERENCE_STACK_ANGLES.slice(0, visible)) {
    const radians = (angle * Math.PI) / 180
    for (const [x, y] of [[0, 0], [REFERENCE_STACK_CARD_WIDTH, 0], [REFERENCE_STACK_CARD_WIDTH, REFERENCE_STACK_CARD_HEIGHT], [0, REFERENCE_STACK_CARD_HEIGHT]]) {
      const dx = x - originX
      const dy = y - originY
      corners.push({
        x: originX + dx * Math.cos(radians) - dy * Math.sin(radians),
        y: originY + dx * Math.sin(radians) + dy * Math.cos(radians),
      })
    }
  }
  return corners
}

describe('参考叠放格几何', () => {
  it('1–30 张：预留框永远装得下扇面的每一个角（这才是「不遮相邻槽」的判据）', () => {
    for (let count = 1; count <= 30; count += 1) {
      const box = referenceStackBox(count)
      const visible = Math.min(count, REFERENCE_STACK_VISIBLE_CARDS)
      if (visible <= 1) {
        expect(box).toEqual({ width: REFERENCE_CARD_SIZE, height: REFERENCE_CARD_SIZE, cardLeft: 0, cardTop: 0 })
        continue
      }
      for (const corner of fanCorners(visible)) {
        expect(corner.x + box.cardLeft).toBeGreaterThanOrEqual(-0.001)
        expect(corner.x + box.cardLeft).toBeLessThanOrEqual(box.width + 0.001)
        expect(corner.y + box.cardTop).toBeGreaterThanOrEqual(-0.001)
        expect(corner.y + box.cardTop).toBeLessThanOrEqual(box.height + 0.001)
      }
    }
  })

  it('扇面确实比卡片大——不预留就一定溢出（防「按卡片尺寸占位」的退化）', () => {
    const box = referenceStackBox(3)
    expect(box.width).toBeGreaterThan(REFERENCE_STACK_CARD_WIDTH)
    expect(box.height).toBeGreaterThan(REFERENCE_STACK_CARD_HEIGHT)
  })

  it('张数封顶：≥3 张画的卡不再增加，占位也不再增长', () => {
    expect(referenceStackBox(30)).toEqual(referenceStackBox(REFERENCE_STACK_VISIBLE_CARDS))
    expect(referenceSlotWidth(30)).toBe(referenceSlotWidth(3))
    expect(referenceSlotHeight(30)).toBe(referenceSlotHeight(3))
  })

  it('三格 + 间距装得进参考列的 200px（合同 §4.1 规则②：固定单行三格）', () => {
    // 现实里最宽的一行：一个槽叠满 + 两个单张槽（Seedance 全能参考）。
    const widest = referenceSlotWidth(30) + referenceSlotWidth(1) + referenceSlotWidth(0) + REFERENCE_SLOT_GAP * 2
    expect(widest).toBeLessThanOrEqual(200)
  })
})
