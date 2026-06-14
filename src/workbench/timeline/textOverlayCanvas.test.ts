import { describe, expect, it } from 'vitest'
import { drawTextBox } from './textOverlayCanvas'
import { resolveTextBox, wrapTextToWidth } from './textLayout'
import type { TimelineTextClip } from './timelineTypes'

// 用「1 码点 = 1 单位宽」的假 measureText，让折行可预测，并验证 drawTextBox 的折行
// 与 textLayout.wrapTextToWidth 完全一致（导出与预览同一折行规范，不再 mid-word 截断）。
function makeFakeCtx(): { ctx: CanvasRenderingContext2D; lines: string[] } {
  const lines: string[] = []
  const ctx = {
    font: '',
    textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline,
    fillStyle: '' as string,
    strokeStyle: '' as string,
    lineWidth: 0,
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    arcTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    measureText: (text: string) => ({ width: Array.from(text).length } as TextMetrics),
    fillText: (text: string) => { lines.push(text) },
  } as unknown as CanvasRenderingContext2D
  return { ctx, lines }
}

function captionClip(text: string): TimelineTextClip {
  return { id: 'c1', text, style: 'caption', startFrame: 0, endFrame: 90 }
}

const unitMeasure = (segment: string): number => Array.from(segment).length

describe('drawTextBox 折行与 textLayout 单一规范一致', () => {
  it('拉丁长句按空格断词（不拦腰截断单词），与 wrapTextToWidth 输出一致', () => {
    const width = 600
    const height = 400
    const clip = captionClip('the quick brown fox jumps over')
    const box = resolveTextBox(clip, width, height)
    const innerMaxWidth = Math.max(1, box.maxWidthPx - box.fontSizePx * 1.4)
    const expected = wrapTextToWidth(clip.text, innerMaxWidth, unitMeasure)

    const { ctx, lines } = makeFakeCtx()
    drawTextBox(ctx, clip, width, height)

    expect(lines).toEqual(expected)
    // 回归保证：任何被空格分隔的整词都不应被拆进两行（除非词本身超过限宽）
    for (const line of lines) {
      for (const word of line.split(' ')) {
        expect(unitMeasure(word)).toBeLessThanOrEqual(Math.ceil(innerMaxWidth))
      }
    }
  })

  it('空文本不绘制（无 fillText 调用）', () => {
    const { ctx, lines } = makeFakeCtx()
    drawTextBox(ctx, captionClip('   '), 600, 400)
    expect(lines).toEqual([])
  })
})
