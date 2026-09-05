import { describe, expect, it } from 'vitest'
import {
  REFERENCE_CARD_SIZE,
  REFERENCE_COLUMN_WIDTH,
  REFERENCE_MAX_SLOTS,
  REFERENCE_SLOT_BOX,
  REFERENCE_SLOT_GAP,
  REFERENCE_STACK_ANGLES,
  REFERENCE_STACK_CARD_HEIGHT,
  REFERENCE_STACK_CARD_WIDTH,
  REFERENCE_STACK_ORIGIN_X_RATIO,
  REFERENCE_STACK_VISIBLE_CARDS,
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
  })

  /**
   * 2026-09-06 用户反馈四：「前两列——产物列和参考列——不同比例时排版要齐。」
   * 槽的占位改成**一只固定盒**：0 张、1 张、30 张、红虚框全同尺寸，三个槽因此同宽同高同顶线。
   */
  it('固定盒 = 扇面全开的包围盒，且与张数无关（0/1/30 张都是同一只）', () => {
    expect(REFERENCE_SLOT_BOX).toEqual({
      width: referenceStackBox(REFERENCE_STACK_VISIBLE_CARDS).width,
      height: referenceStackBox(REFERENCE_STACK_VISIBLE_CARDS).height,
    })
    // 是上界：任何张数的扇面都装得进这只盒（这才叫"永远待在自己格子里"）。
    for (let count = 0; count <= 30; count += 1) {
      expect(referenceStackBox(count).width).toBeLessThanOrEqual(REFERENCE_SLOT_BOX.width)
      expect(referenceStackBox(count).height).toBeLessThanOrEqual(REFERENCE_SLOT_BOX.height)
    }
    expect(REFERENCE_SLOT_BOX.width).toBeGreaterThanOrEqual(REFERENCE_CARD_SIZE)
    expect(REFERENCE_SLOT_BOX.height).toBeGreaterThanOrEqual(REFERENCE_CARD_SIZE)
  })

  it('列宽由盒和间距 derive（三格永不换行、永不横向溢出），不是写死的 200', () => {
    expect(REFERENCE_COLUMN_WIDTH).toBe(
      REFERENCE_SLOT_BOX.width * REFERENCE_MAX_SLOTS + REFERENCE_SLOT_GAP * (REFERENCE_MAX_SLOTS - 1))
    // 最宽的一行（三格全叠满）也不超列宽——旧写法按张数占位，一改盒就溢出，那是写死列宽的锅。
    const widest = REFERENCE_SLOT_BOX.width * REFERENCE_MAX_SLOTS + REFERENCE_SLOT_GAP * (REFERENCE_MAX_SLOTS - 1)
    expect(widest).toBeLessThanOrEqual(REFERENCE_COLUMN_WIDTH)
  })
})
