import type { PlanShot } from '../../../workbench/generationCanvas/agent/storyboardPlan'
import { encodeMention } from '../../../workbench/assets/promptMentions'
import { labShot } from '../storyboard/storyboardFixtures'
import { REF_LINWEI, REF_NEON, REF_WATCH, layoutShots } from './storyboardLayoutFixtures'

/**
 * 第三轮（竖版：参考挪到预览框右边）的夹具。镜 1 挂 5 张参考，看「竖着排、可以多列、+ 在最后」；
 * 其余两镜沿用第二轮。只 import 第二轮与本版都有的东西，同一格能在两个版本上各渲染一次。
 */
const EXTRA_A = REF_NEON.replace('neon', 'rain')
const EXTRA_B = REF_WATCH.replace('watch', 'car')

export function portraitShots(): PlanShot[] {
  const [, second, third] = layoutShots()
  return [
    labShot({
      index: 1, modelKey: 'seedance-2-5', modelVendor: 'kie', modeId: 'omni', anchorIds: ['a-linwei'],
      prompt: `林薇${encodeMention(REF_LINWEI)}冲进后巷，${encodeMention(REF_NEON)}的霓虹在积水里晃，${encodeMention(REF_WATCH)}从口袋里掉出来`,
      referenceBindings: { image_ref: [
        { url: REF_LINWEI, name: '林薇', anchorId: 'a-linwei' },
        { url: REF_NEON, name: '招牌' },
        { url: REF_WATCH, name: '旧怀表' },
        { url: EXTRA_A, name: '雨' },
        { url: EXTRA_B, name: '车灯' },
      ] },
    }),
    second,
    third,
  ]
}
