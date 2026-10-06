import type { ModelOption } from '../../../config/models'
import type { PlanAnchor, PlanShot, StoryboardPlan } from '../../../workbench/generationCanvas/agent/storyboardPlan'
import { LAB_VIDEO_MODELS, labShot } from '../storyboard/storyboardFixtures'
import { REUSE_ANCHORS, REUSE_IMAGE_MODELS } from '../storyboardReuse/storyboardReuseFixtures'

/**
 * 设计实验室 · 分镜「批量 / 选择」提案屏的夹具（2026-10-06，L-sbbatch）：**只有数据**。
 *
 * 模型清单用真实档案认得的 modelKey：参数集合由真档案派生（`storyboardComposerControls`），
 * 公共集由真函数 `deriveBulkParamScope` 求，不是这里手写的。三个视频模型是故意挑的：
 *   · Seedance 2.5：清晰度 480p/720p · 比例（含 adaptive）· 时长 4–30 · 生成音频 · 返回尾帧；
 *   · Veo 3.1：比例 16:9/9:16 · 清晰度 720p/1080p/4k，**没有时长**；
 *   · Kling 3.0：画质 std/pro/4K · 时长 3/5/10 · 比例 16:9/9:16/1:1 · 声音，**没有清晰度**；
 *   · Hailuo 3：目录里有、档案里没有可调参数——公共集为空那一格用它。
 */

export const BATCH_VIDEO_MODELS: ModelOption[] = [
  ...LAB_VIDEO_MODELS,
  { value: 'kling-3.0/video', label: 'Kling 3.0', vendor: 'kie', vendorName: 'kie', modelKey: 'kling-3.0/video' },
  { value: 'minimax-hailuo-3', label: 'Hailuo 3', vendor: 'apimart', vendorName: 'APIMart', modelKey: 'minimax-hailuo-3' },
]
export const BATCH_IMAGE_MODELS: ModelOption[] = REUSE_IMAGE_MODELS

export const BATCH_ANCHORS: PlanAnchor[] = REUSE_ANCHORS

/** 五镜：三个视频模型 + 一镜图片 + 一镜 Hailuo。选哪几镜 = 公共集怎么变。 */
export function batchShots(): PlanShot[] {
  return [
    labShot({ index: 1, modelKey: 'bytedance/seedance-2-5', modelVendor: 'kie', modeId: 'omni', anchorIds: ['a-linwei', 'a-alley'], prompt: '林薇冲进后巷，镜头跟拍，雨水溅起', referenceBindings: {} }),
    labShot({ index: 2, durationSec: 8, modelKey: 'bytedance/seedance-2-5', modelVendor: 'kie', modeId: 't2v', anchorIds: ['a-linwei'], prompt: '她回头，追兵的车灯扫过', referenceBindings: {} }),
    labShot({ index: 3, shotKind: 'image', durationSec: 3, modelKey: 'nano-banana-2', modelVendor: 'kie', modeId: 'edit', anchorIds: [], prompt: '近景，霓虹招牌下，旧怀表在积水里反光', referenceBindings: {} }),
    labShot({ index: 4, modelKey: 'kling-3.0/video', modelVendor: 'kie', anchorIds: ['a-alley'], prompt: '大远景，后巷尽头亮起红灯，升降', referenceBindings: {} }),
    labShot({ index: 5, modelKey: 'veo-3.1', modelVendor: 'kie', anchorIds: [], prompt: '特写，雨滴落在她的睫毛上', referenceBindings: {} }),
    labShot({ index: 6, modelKey: 'minimax-hailuo-3', modelVendor: 'apimart', anchorIds: [], prompt: '她转身离开，背影渐远', referenceBindings: {} }),
  ]
}

export function batchPlan(shots: PlanShot[] = batchShots()): StoryboardPlan {
  return { title: '雨夜追逐', aspectRatio: '16:9', anchors: BATCH_ANCHORS, shots }
}
