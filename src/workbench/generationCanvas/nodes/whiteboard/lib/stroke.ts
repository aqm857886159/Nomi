import getStroke from 'perfect-freehand'

export type PointerPoint = [number, number, number]
export type StrokeOutlinePoint = [number, number]

export function normalizePointerPoint(x: number, y: number, pressure?: number): PointerPoint {
  const normalizedPressure = pressure && pressure > 0 ? pressure : 0.5

  return [Number(x.toFixed(2)), Number(y.toFixed(2)), Number(normalizedPressure.toFixed(2))]
}

export function getSvgPathFromStroke(points: StrokeOutlinePoint[]): string {
  if (points.length < 4) {
    return ''
  }

  const first = points[0]
  const pathParts = [`M${formatPoint(first)}`]

  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index]
    const next = points[index + 1]
    const midpoint: StrokeOutlinePoint = [(current[0] + next[0]) / 2, (current[1] + next[1]) / 2]

    pathParts.push(`Q${formatPoint(current)} ${formatPoint(midpoint)}`)
  }

  return `${pathParts.join(' ')} Z`
}

export function createSmoothStrokePath(points: PointerPoint[], size: number): string {
  if (points.length < 2) {
    return ''
  }

  const outline = getStroke(points, {
    size,
    thinning: 0.55,
    smoothing: 0.58,
    streamline: 0.52,
    simulatePressure: false,
    easing: (time) => time
  }) as StrokeOutlinePoint[]

  return getSvgPathFromStroke(outline)
}

function formatPoint(point: StrokeOutlinePoint): string {
  return `${point[0].toFixed(2)},${point[1].toFixed(2)}`
}
