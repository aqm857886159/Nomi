import type { ModelOption } from '../../../config/models'
import type { PlanAnchor, PlanShot, StoryboardPlan } from '../../../workbench/generationCanvas/agent/storyboardPlan'
import type { ShotRowExec, AnchorCardRuntime } from '../../../workbench/creation/storyboard/exec/storyboardRowStatus'
import type { ShotVariant } from '../../../workbench/creation/storyboard/shotRow/shotVariants'

/**
 * 设计实验室 · 分镜表 v6 的**假数据**。
 *
 * 为什么是假的：实验室的职责是「把每一个形态摆出来给人拍板」，不是跑真生成。真数据下有些形态
 * （生成中 37%、失败、参考已变、五种槽矩阵同屏）根本凑不齐，凑齐也不可重现——基线就没法钉。
 * 所以这里给的是**固定夹具**：同一份输入永远渲染同一张图。
 *
 * 有一处刻意用真东西：**模型档案**。`modelKey` 写的是真实 identifierPatterns，于是参考槽与底栏控件
 * 都由真档案 derive（合同 §2.3/§4 的两个投影）——槽矩阵那几格展示的就是六种真实档案的真实声明，
 * 不是照着文档手抄一遍（手抄的那份会漂）。
 */

/** 固定的 SVG 静帧。用真图而不是空 url：空 url 会渲染成一排「图已失效」，那是夹具的锅却读成产品缺陷。 */
function still(from: string, to: string, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 200" preserveAspectRatio="none">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">`
    + `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>`
    + `<rect width="120" height="200" fill="url(#g)"/>`
    + `<text x="60" y="185" font-family="system-ui" font-size="11" fill="rgba(255,255,255,.72)" text-anchor="middle">${label}</text>`
    + `</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export const STILL_ROOFTOP = still('#243244', '#0f172a', 'rooftop')
export const STILL_NEON = still('#3b2f4f', '#141019', 'neon')
export const STILL_PORTRAIT = still('#e8d5c0', '#2b1d17', 'portrait')
export const STILL_PROP = still('#3d4a3a', '#141a12', 'prop')
export const STILL_WIDE = still('#4a3a2a', '#1a1410', 'wide')

/**
 * 模型清单：`modelKey` 是真实档案的 identifierPattern，所以 `resolveArchetypeForModel` 真的解析得出档案。
 * 六种真实档案（合同 §4.3 的矩阵）全在这里能被寻址到。
 */
export const LAB_VIDEO_MODELS: ModelOption[] = [
  { value: 'seedance-2-5', label: 'Seedance 2.5', vendor: 'kie', vendorName: 'kie', modelKey: 'bytedance/seedance-2-5' },
  { value: 'veo-3-1', label: 'Veo 3.1', vendor: 'kie', vendorName: 'kie', modelKey: 'veo-3.1' },
]

export const LAB_IMAGE_MODELS: ModelOption[] = [
  { value: 'nano-banana-2', label: 'Nano Banana 2', vendor: 'kie', vendorName: 'kie', modelKey: 'nano-banana-2' },
]

export const LAB_ANCHORS: PlanAnchor[] = [
  {
    id: 'a-linwei',
    kind: 'character',
    name: '林薇',
    description: '28 岁，短发，深色风衣，左眉有一道细疤；情绪克制，动作干脆。',
    carrier: 'visual',
    modelKey: 'nano-banana-2',
  },
  {
    id: 'a-rooftop',
    kind: 'scene',
    name: '天台夜景',
    description: '雨后天台，积水反着楼下的霓虹；栏杆锈迹，远处高架车流。',
    carrier: 'visual',
    modelKey: 'nano-banana-2',
  },
  {
    id: 'a-watch',
    kind: 'prop',
    name: '旧怀表',
    description: '黄铜表壳，表盖内侧刻着一行字，链子断过一节。',
    carrier: 'visual',
    modelKey: 'nano-banana-2',
  },
  {
    id: 'a-style',
    kind: 'style',
    name: '全片风格',
    description: '冷调，只有霓虹与车灯是暖的；不要手持抖动，不要慢镜。',
    carrier: 'text',
  },
]

export function labShot(over: Partial<PlanShot> & { index: number }): PlanShot {
  return {
    shotId: `shot-${over.index}`,
    durationSec: 5,
    anchorIds: [],
    prompt: '远景，雨后天台，@林薇 独自站在栏杆边，霓虹反光，缓推',
    modelKey: 'seedance-2-5',
    modeId: 'first',
    referenceBindings: { first_frame: [{ url: STILL_ROOFTOP, name: '天台夜景', anchorId: 'a-rooftop' }] },
    ...over,
  }
}

export function labPlan(over?: Partial<StoryboardPlan>): StoryboardPlan {
  return {
    title: '雨夜天台',
    aspectRatio: '9:16',
    anchors: LAB_ANCHORS,
    shots: [labShot({ index: 1 })],
    ...over,
  }
}

/** 行执行态夹具。真机里它是 plan × 画布节点 derive 出来的；这里直接给成品，形态才凑得齐。 */
export function labExec(over?: Partial<ShotRowExec>): ShotRowExec {
  return {
    status: 'ready',
    node: null,
    keyframeNode: null,
    waitingRefs: [],
    unlockedRefs: [],
    missingSlots: [],
    changedRefs: [],
    resultUrl: null,
    progressPercent: null,
    progressMessage: null,
    errorMessage: null,
    locked: false,
    ...over,
  }
}

export function labAnchorRuntime(anchor: PlanAnchor, over?: Partial<AnchorCardRuntime>): AnchorCardRuntime {
  return {
    anchor,
    node: null,
    visual: anchor.carrier === 'visual',
    resultUrl: null,
    generating: false,
    failed: false,
    errorMessage: null,
    progressPercent: null,
    locked: false,
    referencedByCount: 0,
    waitingShotCount: 0,
    ...over,
  }
}

export const LAB_VARIANTS: ShotVariant[] = [
  {
    id: 'v3',
    url: STILL_NEON,
    tag: '镜01-v3',
    modelLabel: 'Seedance 2.5',
    modeLabel: '首帧',
    prompt: '远景，雨后天台，霓虹反光更强，缓推',
    createdAt: 3,
  },
  {
    id: 'v2',
    url: STILL_ROOFTOP,
    tag: '镜01-v2',
    modelLabel: 'Seedance 2.5',
    modeLabel: '首帧',
    prompt: '远景，雨后天台，@林薇 独自站在栏杆边，缓推',
    createdAt: 2,
  },
  {
    id: 'v1',
    url: STILL_WIDE,
    tag: '镜01-v1',
    modelLabel: 'Seedance 2.5',
    modeLabel: '文生视频',
    prompt: '远景，雨后天台，夜',
    createdAt: 1,
  },
]

export const NOOP = (): void => {}
