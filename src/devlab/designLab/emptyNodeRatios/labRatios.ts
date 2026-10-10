// 空节点比例样张的比例清单：**从生产的常用比例表派生**（不在 lab 里抄一份）。
// 生产表加一个比例，样张自动出现一格；结构测试 labRatios.test.ts 盯着这条派生关系。
import { COMMON_RATIO_ORDER } from '../../../workbench/generationCanvas/nodes/aspectRatio'

export type LabRatio = { label: string; value: number }

/** 「16:9」→ 16/9；格式不对的抛错（生产表里只有 a:b 形式）。 */
export function ratioValueOf(label: string): number {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(label)
  if (!match) throw new Error(`比例格式不是 a:b：${label}`)
  return Number(match[1]) / Number(match[2])
}

/** 生产常用比例，按生产表的展示序。 */
export const LAB_RATIOS: readonly LabRatio[] = COMMON_RATIO_ORDER.map((label) => ({ label, value: ratioValueOf(label) }))
