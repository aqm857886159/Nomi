/**
 * [INPUT]: three 的 Object3D / Vector3 类型、../sceneRefs 的 isWorldVisible
 * [OUTPUT]: characterLabelAnchor：可见角色的完整世界头顶锚点；layoutCharacterLabels：投影后的名牌排版（重合的错开）；
 *           estimateLabelWidth / VIEWPORT_LABEL_METRICS：DOM 名牌在渲染前的尺寸
 * [POS]: 视口与离屏出片共享标签锚点与排版：视口 DOM 名牌（ViewportLabels）和截图 / 录像烧进画面的名牌（directorCapture.drawLabels）
 *        走同一个排版函数，「所见即所得」。继承场景/父组/对象的可见性与完整变换。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type * as THREE from 'three'
import { isWorldVisible } from '../sceneRefs'

export function characterLabelAnchor(root: THREE.Object3D, height: number, target: THREE.Vector3): boolean {
  if (!isWorldVisible(root)) return false
  root.localToWorld(target.set(0, height * 1.05, 0))
  return true
}

/** 一个名牌：x = 水平中心，y = 锚点（名牌底边默认贴在这里，名牌画在锚点之上）。 */
export type LabelBox = Readonly<{ id: string; x: number; y: number; width: number; height: number }>
export type PlacedLabel<T extends LabelBox> = T & { top: number }

/**
 * 名牌排版：任意两个投影后重合的名牌都错开，不对具体角色特判。
 * 锚点靠下（离镜头近、画面里更靠前）的先占位置；后来的若和已占的框相交，就整体上移到那个框之上（留 gap），直到谁都不挨。
 * 输出顺序与输入一致，同样的输入同样的结果（录像逐帧不抖）。
 */
export function layoutCharacterLabels<T extends LabelBox>(labels: readonly T[], gap: number): PlacedLabel<T>[] {
  const order = labels.map((label, index) => ({ label, index })).sort((a, b) => b.label.y - a.label.y || a.label.id.localeCompare(b.label.id))
  const placed: { left: number; right: number; top: number; bottom: number }[] = []
  const tops = new Array<number>(labels.length)
  for (const { label, index } of order) {
    const left = label.x - label.width / 2
    const right = label.x + label.width / 2
    let bottom = label.y
    for (let guard = 0; guard <= placed.length; guard += 1) {
      const hit = placed.find((box) => left < box.right && box.left < right && bottom - label.height < box.bottom && box.top < bottom)
      if (!hit) break
      bottom = hit.top - gap
    }
    placed.push({ left, right, top: bottom - label.height, bottom })
    tops[index] = bottom - label.height
  }
  return labels.map((label, index) => ({ ...label, top: tops[index] }))
}

/** 视口 DOM 名牌的尺寸（text-micro 11px · leading-4 16px + py-0.5 + 边框 = 22px 高；px-1.5 + 边框；离头顶再抬 6px）。排版要在渲染前知道框多大。 */
export const VIEWPORT_LABEL_METRICS = Object.freeze({ fontPx: 11, paddingX: 7, height: 22, lift: 6 })

/** DOM 名牌渲染前的宽度估计：中日韩字按一个字号宽，其余按 0.6 个字号；加左右内边距与边框。 */
export function estimateLabelWidth(text: string, fontPx: number, paddingX: number): number {
  let width = 0
  for (const char of text) width += /[⺀-鿿가-힯豈-﫿＀-￯]/.test(char) ? fontPx : fontPx * 0.6
  return Math.ceil(width + paddingX * 2)
}
