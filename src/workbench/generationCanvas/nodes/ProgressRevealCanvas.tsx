import React from 'react'

/**
 * 进度驱动的马赛克渐显。
 *
 * img-fx 提供的是「按时间跑」的揭示动画；导入没有不确定的等待，它有真进度——
 * 已拷贝多少字节就该显出多少画面。所以格子的**数量**由比例决定，动画感由下面那层
 * img-fx shader 继续提供（我们不自己写 shader，也不改它的揭示）。
 *
 * 画到 ratio=1 时，画面就是这份素材将来挂上去的那张预览（同一个文件、同样 object-contain），
 * 所以覆盖层卸载时没有「换一张图」的闪烁。
 */
const CELL_PX = 16

/** 同一张图每次都碎成同一副样子：稳定的伪随机序，重渲染/重挂载不会让已显出的格子跳位。 */
function seededCellOrder(seed: string, total: number): number[] {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619)
  }
  let state = hash >>> 0
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const order = Array.from({ length: total }, (_, index) => index)
  for (let index = total - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[order[index], order[swap]] = [order[swap], order[index]]
  }
  return order
}

type RevealGrid = {
  image: HTMLImageElement
  order: number[]
  columns: number
  drawn: number
  fit: { x: number; y: number; width: number; height: number }
}

function containFit(canvas: HTMLCanvasElement, image: HTMLImageElement) {
  const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight)
  const width = image.naturalWidth * scale
  const height = image.naturalHeight * scale
  return { x: (canvas.width - width) / 2, y: (canvas.height - height) / 2, width, height }
}

export function ProgressRevealCanvas({ imageUrl, ratio }: { imageUrl?: string; ratio: number }): JSX.Element {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const gridRef = React.useRef<RevealGrid | null>(null)
  const [revealed, setRevealed] = React.useState(0)
  const [total, setTotal] = React.useState(0)

  const draw = React.useCallback((target: number) => {
    const canvas = canvasRef.current
    const grid = gridRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !grid || !context) return
    // 只增不减：已经显出来的格子不会因为一条乱序进度事件又消失。
    for (let index = grid.drawn; index < target; index += 1) {
      const cell = grid.order[index]
      const x = (cell % grid.columns) * CELL_PX
      const y = Math.floor(cell / grid.columns) * CELL_PX
      context.save()
      context.beginPath()
      context.rect(x, y, CELL_PX, CELL_PX)
      context.clip()
      context.drawImage(grid.image, grid.fit.x, grid.fit.y, grid.fit.width, grid.fit.height)
      context.restore()
    }
    grid.drawn = Math.max(grid.drawn, target)
    setRevealed(grid.drawn)
  }, [])

  React.useEffect(() => {
    const canvas = canvasRef.current
    gridRef.current = null
    setRevealed(0)
    setTotal(0)
    if (!canvas || !imageUrl) return
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (cancelled || !canvasRef.current) return
      const element = canvasRef.current
      element.width = Math.max(1, element.clientWidth)
      element.height = Math.max(1, element.clientHeight)
      const columns = Math.max(1, Math.ceil(element.width / CELL_PX))
      const rows = Math.max(1, Math.ceil(element.height / CELL_PX))
      gridRef.current = { image, columns, drawn: 0, order: seededCellOrder(imageUrl, columns * rows), fit: containFit(element, image) }
      setTotal(columns * rows)
    }
    image.src = imageUrl
    return () => { cancelled = true }
  }, [imageUrl])

  React.useEffect(() => {
    if (!total) return
    draw(Math.round(Math.max(0, Math.min(1, ratio)) * total))
  }, [draw, ratio, total])

  return <canvas ref={canvasRef} aria-hidden className="absolute inset-0 size-full"
    data-progress-reveal data-reveal-ratio={ratio.toFixed(3)} data-reveal-cells={revealed} data-reveal-total={total} />
}
