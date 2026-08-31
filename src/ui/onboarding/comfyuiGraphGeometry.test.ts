// 节点图像素几何。夹具走 buildWorkflowGraphView 的真实输出（不手捏 GraphView），
// 保证这两块的口径始终对得上。
import { describe, expect, it } from 'vitest'
import { buildWorkflowGraphView, type GraphInput } from './comfyuiWorkflowGraphView'
import {
  buildGraphGeometry,
  clampZoom,
  fitOffset,
  fitZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  NODE_HEIGHT,
  NODE_WIDTH,
} from './comfyuiGraphGeometry'

/** 一条直链 + 一个旁支：200 与 110 同列，108 消费两者，300 收尾。 */
const GRAPH: GraphInput = {
  110: { class_type: 'CLIPTextEncode', inputs: { text: 'hi' } },
  200: { class_type: 'LoadImage', inputs: { image: 'start.png' } },
  108: { class_type: 'WanImageToVideo', inputs: { positive: ['110', 0], image: ['200', 0] } },
  300: { class_type: 'SaveVideo', inputs: { video: ['108', 0] } },
}

const geometry = () => buildGraphGeometry(buildWorkflowGraphView(GRAPH, {}))
const at = (id: string) => geometry().nodes.find((n) => n.nodeId === id)!

describe('节点图几何', () => {
  it('列号 → x 单调递增，消费者永远在生产者右边', () => {
    expect(at('108').x).toBeGreaterThan(at('110').x)
    expect(at('300').x).toBeGreaterThan(at('108').x)
  })

  it('同列节点 x 相同、y 不重叠', () => {
    expect(at('110').x).toBe(at('200').x)
    expect(Math.abs(at('110').y - at('200').y)).toBeGreaterThanOrEqual(NODE_HEIGHT)
  })

  it('短列垂直居中——单节点的末列落在整图中带，连线不斜甩到角上', () => {
    const [a, b] = [at('110').y, at('200').y]
    expect(at('300').y).toBeGreaterThan(Math.min(a, b))
    expect(at('300').y).toBeLessThan(Math.max(a, b))
  })

  it('内容尺寸包住所有节点并留出四周留白', () => {
    const geo = geometry()
    for (const node of geo.nodes) {
      expect(node.x).toBeGreaterThan(0)
      expect(node.y).toBeGreaterThan(0)
      expect(node.x + NODE_WIDTH).toBeLessThanOrEqual(geo.width)
      expect(node.y + NODE_HEIGHT).toBeLessThanOrEqual(geo.height)
    }
  })

  it('每条边画一次，起点在源节点右缘、落点在目标节点左缘', () => {
    const geo = geometry()
    expect(geo.edges.map((e) => e.key).sort()).toEqual(['108->300', '110->108', '200->108'])
    const edge = geo.edges.find((e) => e.key === '110->108')!
    expect(edge.path.startsWith(`M ${at('110').x + NODE_WIDTH} ${at('110').y + NODE_HEIGHT / 2}`)).toBe(true)
    expect(edge.endX).toBe(at('108').x)
    expect(edge.endY).toBe(at('108').y + NODE_HEIGHT / 2)
  })

  it('端点缺失的边不画（悬空边不该让整层崩）', () => {
    const view = buildWorkflowGraphView(GRAPH, {})
    const withGhost = { ...view, edges: [...view.edges, { from: '110', to: '999' }] }
    expect(buildGraphGeometry(withGhost).edges.map((e) => e.key)).not.toContain('110->999')
  })

  it('空图不产生 NaN 尺寸', () => {
    const geo = buildGraphGeometry(buildWorkflowGraphView({}, {}))
    expect(Number.isFinite(geo.width)).toBe(true)
    expect(Number.isFinite(geo.height)).toBe(true)
    expect(geo.nodes).toEqual([])
  })
})

describe('缩放', () => {
  it('钳在上下限内', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM)
    expect(clampZoom(99)).toBe(MAX_ZOOM)
    expect(clampZoom(0.8)).toBe(0.8)
  })

  it('「适应」是让人看全、不是看大——小图不放大', () => {
    expect(fitZoom({ width: 100, height: 100 }, { width: 1000, height: 1000 })).toBe(1)
  })

  it('大图按最紧的那一维缩', () => {
    expect(fitZoom({ width: 2000, height: 500 }, { width: 1000, height: 1000 })).toBeCloseTo(0.5)
    expect(fitZoom({ width: 500, height: 2000 }, { width: 1000, height: 1000 })).toBeCloseTo(0.5)
  })

  it('视口还没量出来（0 宽高）时退回 1，不产生 NaN 或 0 缩放', () => {
    expect(fitZoom({ width: 800, height: 600 }, { width: 0, height: 0 })).toBe(1)
  })

  it('图比视口小则居中；比视口大则贴左上角（靠拖看剩下的）', () => {
    expect(fitOffset({ width: 100, height: 100 }, { width: 500, height: 300 }, 1)).toEqual({ x: 200, y: 100 })
    expect(fitOffset({ width: 1000, height: 1000 }, { width: 500, height: 300 }, 1)).toEqual({ x: 0, y: 0 })
  })
})
