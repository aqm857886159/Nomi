// 内联画板 `<canvas>` 真实渲染像素探针（给 `win().evaluate(probeInlineWhiteboardCanvas)` 直接传函数用）。
//
// 为什么只看 `whiteboardState.canvasAssets` 不够（#1705 走查复盘）：
//   源图写入了落盘 / store 的 `canvasAssets`，但如果所在图层不可见（visible:false / opacity:0）、
//   图片解码失败、或 Leafer 渲染层只画出了纯空白底色 `#fbfbfa` / 全透明 `<canvas>`，
//   只核对 `whiteboardAssetUrls` 仍会假绿通过。
//
// 本探针在浏览器上下文内直接读 `[data-nomi-inline-whiteboard="true"]` 下所有可见 `<canvas>` 的 2D 像素：
//   - 全透明（`nonTransparentSamples === 0`）→ 假（未绘出）
//   - 纯单色空白底（如背景 Rect `#fbfbfa` 或纯白/纯黑：`distinctColors < 2` 或 `nonUniformSamples < 8`）→ 假（无源图内容）
//   - 跨域污染无法读回（`taintedCount > 0` 且无可读内容画布）→ 假（显式暴露 tainted，不静默放行）
//   - 真实多色源图绘出（非全透明 + ≥2 色档 + 足够多非均匀像素）→ 真。
//
// 注意：本函数会经 `page.evaluate(...)` 序列化进渲染进程，函数体不得引用外部模块变量或辅助函数。
export function probeInlineWhiteboardCanvas() {
  const isVisible = (element) => {
    if (!element) return false
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.01
  }

  const board = document.querySelector('[data-nomi-inline-whiteboard="true"]')
  if (!isVisible(board)) {
    return {
      boardVisible: false,
      canvasCount: 0,
      visibleCanvasCount: 0,
      readableCanvasCount: 0,
      taintedCount: 0,
      hasRenderedContent: false,
      bestCanvas: null,
    }
  }

  const canvases = [...board.querySelectorAll('canvas')]
  let visibleCanvasCount = 0
  let readableCanvasCount = 0
  let taintedCount = 0
  let hasRenderedContent = false
  let bestCanvas = null

  for (const canvas of canvases) {
    if (!isVisible(canvas) || canvas.width <= 0 || canvas.height <= 0) continue
    visibleCanvasCount += 1
    const ctx = canvas.getContext('2d')
    if (!ctx) continue

    let data
    try {
      data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    } catch {
      taintedCount += 1
      continue
    }
    readableCanvasCount += 1

    const width = canvas.width
    const height = canvas.height
    // 避开 2px 边缘，防止深色主题宿主底色与内部背景矩形之间 1px 抗锯齿毛边被误当成图像内容。
    const insetX = width > 8 ? 2 : 0
    const insetY = height > 8 ? 2 : 0
    const startX = insetX
    const endX = width - 1 - insetX
    const startY = insetY
    const endY = height - 1 - insetY
    const spanX = Math.max(1, endX - startX + 1)
    const spanY = Math.max(1, endY - startY + 1)
    const stepX = Math.max(1, Math.floor(spanX / 128))
    const stepY = Math.max(1, Math.floor(spanY / 128))

    let totalSamples = 0
    let nonTransparentSamples = 0
    let nonUniformSamples = 0
    let refR = -1
    let refG = -1
    let refB = -1
    const colors = new Set()

    for (let y = startY; y <= endY; y += stepY) {
      for (let x = startX; x <= endX; x += stepX) {
        const offset = (y * width + x) * 4
        const r = data[offset]
        const g = data[offset + 1]
        const b = data[offset + 2]
        const a = data[offset + 3]
        totalSamples += 1
        if (a <= 0) continue
        nonTransparentSamples += 1
        if (colors.size < 64) {
          colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4))
        }
        if (refR < 0) {
          refR = r
          refG = g
          refB = b
        } else if (Math.abs(r - refR) + Math.abs(g - refG) + Math.abs(b - refB) > 24) {
          nonUniformSamples += 1
        }
      }
    }

    const rendered = nonTransparentSamples > 0 && colors.size >= 2 && nonUniformSamples >= 8
    const summary = {
      width,
      height,
      totalSamples,
      nonTransparentSamples,
      distinctColors: colors.size,
      nonUniformSamples,
      rendered,
    }
    if (rendered) hasRenderedContent = true
    if (
      !bestCanvas
      || (summary.rendered && !bestCanvas.rendered)
      || (summary.rendered === bestCanvas.rendered && summary.nonUniformSamples > bestCanvas.nonUniformSamples)
      || (summary.rendered === bestCanvas.rendered
        && summary.nonUniformSamples === bestCanvas.nonUniformSamples
        && summary.nonTransparentSamples > bestCanvas.nonTransparentSamples)
    ) {
      bestCanvas = summary
    }
  }

  return {
    boardVisible: true,
    canvasCount: canvases.length,
    visibleCanvasCount,
    readableCanvasCount,
    taintedCount,
    hasRenderedContent,
    bestCanvas,
  }
}
