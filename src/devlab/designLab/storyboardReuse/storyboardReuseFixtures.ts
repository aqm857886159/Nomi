import type { ModelOption } from '../../../config/models'
import type { PlanAnchor, PlanShot, StoryboardPlan } from '../../../workbench/generationCanvas/agent/storyboardPlan'
import { removeBinding } from '../../../workbench/creation/storyboard/shotRow/shotReferenceSlots'
import { encodeMention } from '../../../workbench/assets/promptMentions'
import { LAB_VIDEO_MODELS, STILL_NEON, STILL_PORTRAIT, STILL_PROP, labShot } from '../storyboard/storyboardFixtures'

/**
 * 设计实验室 · 分镜表「复用画布底栏」提案屏的夹具（2026-10-06，L-sbui）。
 *
 * 这一屏的每一格都要能**成对**出图：同一个 state id，`main` 上渲染的是现役组件（现在），
 * 本分支渲染的是改过的组件（改后）。所以夹具只描述**数据**（方案、锚、镜头），不描述长相——
 * 长相全由真组件决定；「自动引用」「删参考」这两格的数据变化也走真函数（见下面两个 helper），
 * 现在那一版里它们是现役行为（不自动引用 / 只删绑定），改后那一版换成新 owner。
 *
 * 模型清单用真实档案认得的 modelKey，参数控件因此由真档案 derive，不是这里手写的。
 */

export const REUSE_IMAGE_MODELS: ModelOption[] = [
  { value: 'gpt-image-2', label: 'GPT Image 2', vendor: 'apimart', vendorName: 'APIMart', modelKey: 'gpt-image-2' },
  { value: 'nano-banana-2', label: 'Nano Banana 2', vendor: 'kie', vendorName: 'kie', modelKey: 'nano-banana-2' },
]

export const REUSE_VIDEO_MODELS: ModelOption[] = LAB_VIDEO_MODELS

export const REUSE_ANCHORS: PlanAnchor[] = [
  {
    id: 'a-linwei',
    kind: 'character',
    name: '林薇',
    description: '短发，深色风衣，眼神冷',
    carrier: 'visual',
    modelKey: 'gpt-image-2',
    modelVendor: 'apimart',
  },
  {
    id: 'a-alley',
    kind: 'scene',
    name: '后巷',
    description: '窄巷，霓虹，积水',
    carrier: 'visual',
  },
  {
    id: 'a-style',
    kind: 'style',
    name: '全片风格',
    description: '赛博霓虹，冷蓝洋红',
    carrier: 'text',
  },
]

/** 林薇这张参考卡出图后的结果（夹具图）。 */
export const LINWEI_RESULT = STILL_PORTRAIT

/** 镜 1：全能参考模式，提示词里点了「林薇」——自动引用那一格看的就是它。 */
export function shotOmni(): PlanShot {
  return labShot({
    index: 1,
    modelKey: 'seedance-2-5',
    modelVendor: 'kie',
    modeId: 'omni',
    anchorIds: ['a-linwei', 'a-alley'],
    prompt: '林薇冲进后巷，镜头跟拍，雨水溅起',
    referenceBindings: {},
  })
}

/** 镜 2：Agent 起草的默认模式（文生视频，不带参考槽）。 */
export function shotTextToVideo(): PlanShot {
  return labShot({
    index: 2,
    modelKey: 'seedance-2-5',
    modelVendor: 'kie',
    modeId: 't2v',
    anchorIds: ['a-linwei'],
    prompt: '她回头，追兵的车灯扫过',
    referenceBindings: {},
  })
}

/** 镜 3：图片镜，改图模式，已经摆了两张参考、提示词里有两枚 @。 */
export function shotImageEdit(): PlanShot {
  return labShot({
    index: 3,
    shotKind: 'image',
    durationSec: 3,
    modelKey: 'nano-banana-2',
    modelVendor: 'kie',
    modeId: 'edit',
    anchorIds: [],
    prompt: `近景，${encodeMention(STILL_NEON)} 霓虹招牌下，${encodeMention(STILL_PROP)} 在积水里反光`,
    referenceBindings: {
      image_ref: [
        { url: STILL_NEON, name: '招牌' },
        { url: STILL_PROP, name: '旧怀表' },
      ],
    },
  })
}

export function reusePlan(shots: PlanShot[] = [shotOmni(), shotTextToVideo(), shotImageEdit()]): StoryboardPlan {
  return {
    title: '雨夜追逐',
    aspectRatio: '16:9',
    anchors: REUSE_ANCHORS,
    shots,
  }
}

/**
 * 林薇出图之后，方案会变成什么样。
 *
 * 现在（main）：什么都不会发生——没有任何 owner 把参考卡的结果写回引用它的镜头（审计 U4）。
 */
export function planAfterAnchorResult(plan: StoryboardPlan): StoryboardPlan {
  return plan
}

/**
 * 用户在镜 3 的参考里删掉第一张之后，镜头会变成什么样。
 *
 * 现在（main）：只删绑定，提示词里那枚 @ 留下来变成孤儿芯片（审计 U5 / A7）。
 */
export function shotAfterRemovingFirstReference(shot: PlanShot): PlanShot {
  const next = removeBinding(shot.referenceBindings, 'image_ref', 0)
  return next ? { ...shot, referenceBindings: next } : shot
}
