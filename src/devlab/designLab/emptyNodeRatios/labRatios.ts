// 空节点比例样张的比例清单与尺寸：**从生产的常用比例表派生**（不在 lab 里抄一份）。
// 生产表加一个比例，样张自动出现一格；结构测试 labRatios.test.ts 盯着这条派生关系。
// 尺寸也只在这里算一份：名义尺寸（存的 size）→ 渲染尺寸（resolveNodeVisualSize，和生产外壳同一个真相源）。
import { COMMON_RATIO_ORDER } from '../../../workbench/generationCanvas/nodes/aspectRatio'
import { nodeWidthForAspectRatio, resolveNodeVisualSize } from '../../../workbench/generationCanvas/nodes/nodeSizing'
import type { GenerationCanvasNode } from '../../../workbench/generationCanvas/model/generationCanvasTypes'

export type LabRatio = { label: string; value: number }
export type FrameSize = { width: number; height: number }

/** 「16:9」→ 16/9；格式不对的抛错（生产表里只有 a:b 形式）。 */
export function ratioValueOf(label: string): number {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(label)
  if (!match) throw new Error(`比例格式不是 a:b：${label}`)
  return Number(match[1]) / Number(match[2])
}

/** 生产常用比例，按生产表的展示序。 */
export const LAB_RATIOS: readonly LabRatio[] = COMMON_RATIO_ORDER.map((label) => ({ label, value: ratioValueOf(label) }))

/** 名义尺寸：画布上按比例落的节点（宽按生产规则，高 = 宽 / 比例）。 */
export function ratioFrame(ratio: LabRatio): FrameSize {
  const width = nodeWidthForAspectRatio(ratio.value)
  return { width, height: Math.round(width / ratio.value) }
}

/** 名义尺寸：小尺寸（宽 240，按 1:1 实际像素）。 */
export const SMALL_NODE_WIDTH = 240
export function smallRatioFrame(ratio: LabRatio): FrameSize {
  return { width: SMALL_NODE_WIDTH, height: Math.round(SMALL_NODE_WIDTH / ratio.value) }
}

/** 渲染尺寸：名义尺寸经生产 resolveNodeVisualSize 钳出来的真实外壳尺寸（比如 240×103 → 240×120）。 */
export function renderedFrame(kind: 'image' | 'video', size: FrameSize): FrameSize {
  const node = {
    id: `lab-${kind}`,
    kind,
    title: '',
    categoryId: 'shots',
    position: { x: 0, y: 0 },
    size,
    status: 'idle',
    prompt: '',
    meta: {},
  } as unknown as GenerationCanvasNode
  const visual = resolveNodeVisualSize(node)
  return { width: visual.width, height: visual.height }
}
