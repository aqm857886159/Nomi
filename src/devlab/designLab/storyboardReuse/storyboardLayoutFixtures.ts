import type { PlanAnchor, PlanShot, StoryboardPlan } from '../../../workbench/generationCanvas/agent/storyboardPlan'
import { encodeMention } from '../../../workbench/assets/promptMentions'
import { labShot } from '../storyboard/storyboardFixtures'

/**
 * 分镜表「视觉列 + 内容列」版面那一轮（2026-10-06 第二轮，L-sbui）的夹具：**只有数据**。
 *
 * 和第一轮一样，同一个 state id 在 main、上一版、本版上各渲染一次，所以这里只 import 三个版本都有的东西
 * （`labShot`、`encodeMention` 与类型），长相全由各版本的真组件决定。
 *
 * 静帧按**真实画幅**画（viewBox = 宽:高）：结果图、参考卡图要显示「按比例完整放进框里」，
 * 拿一张竖长条去冒充 16:9 的结果，框里的留白就是假的。
 */
function still(width: number, height: number, from: string, to: string, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>`
    + `<rect width="${width}" height="${height}" fill="url(#g)"/>`
    + `<text x="${width / 2}" y="${height * 0.92}" font-family="system-ui" font-size="${Math.round(Math.min(width, height) / 9)}" fill="rgba(255,255,255,.75)" text-anchor="middle">${label}</text>`
    + `</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export const REF_LINWEI = still(3, 4, '#e8d5c0', '#2b1d17', 'linwei')
export const REF_NEON = still(1, 1, '#3b2f4f', '#141019', 'neon')
export const REF_WATCH = still(1, 1, '#3d4a3a', '#141a12', 'watch')
export const RESULT_16_9 = still(16, 9, '#4a3a2a', '#1a1410', '16:9 result')
export const ANCHOR_CHARACTER_3_4 = still(3, 4, '#d9c2a8', '#2b1d17', '3:4')
export const ANCHOR_SCENE_16_9 = still(16, 9, '#243244', '#0f172a', '16:9')

export const LAYOUT_ANCHORS: PlanAnchor[] = [
  { id: 'a-linwei', kind: 'character', name: '林薇', description: '短发，深色风衣，眼神冷', carrier: 'visual', modelKey: 'gpt-image-2', modelVendor: 'apimart', params: { aspect_ratio: '3:4' } },
  { id: 'a-alley', kind: 'scene', name: '后巷', description: '窄巷，霓虹，积水', carrier: 'visual', modelKey: 'gpt-image-2', modelVendor: 'apimart', params: { aspect_ratio: '16:9' } },
]

/** 三镜：全能参考挂两张、文生视频不挂、改图挂一张。override = 这一镜覆盖的画幅（混排那一格用）。 */
export function layoutShots(override: Partial<Record<1 | 2 | 3, string>> = {}): PlanShot[] {
  const aspect = (index: 1 | 2 | 3) => (override[index] ? { params: { aspect_ratio: override[index] } } : {})
  return [
    labShot({
      index: 1, modelKey: 'seedance-2-5', modelVendor: 'kie', modeId: 'omni', anchorIds: ['a-linwei'],
      prompt: `林薇${encodeMention(REF_LINWEI)}冲进后巷，镜头跟拍，雨水溅起，${encodeMention(REF_NEON)}的霓虹在积水里晃`,
      referenceBindings: { image_ref: [{ url: REF_LINWEI, name: '林薇', anchorId: 'a-linwei' }, { url: REF_NEON, name: '招牌' }] },
      ...aspect(1),
    }),
    labShot({ index: 2, modelKey: 'seedance-2-5', modelVendor: 'kie', modeId: 't2v', anchorIds: [], prompt: '她回头，追兵的车灯扫过', referenceBindings: {}, ...aspect(2) }),
    labShot({
      index: 3, shotKind: 'image', durationSec: 3, modelKey: 'nano-banana-2', modelVendor: 'kie', modeId: 'edit', anchorIds: [],
      prompt: `特写，${encodeMention(REF_WATCH)} 躺在积水里，表盖反光`,
      referenceBindings: { image_ref: [{ url: REF_WATCH, name: '旧怀表' }] },
      ...aspect(3),
    }),
  ]
}

export function layoutPlan(aspectRatio: string, shots: PlanShot[] = layoutShots()): StoryboardPlan {
  return { title: '雨夜追逐', aspectRatio, anchors: LAYOUT_ANCHORS, shots }
}
