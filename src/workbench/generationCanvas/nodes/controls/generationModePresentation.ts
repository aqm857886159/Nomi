// 「生成方式」怎么呈现（B3）——**只管界面上给用户看什么**，不碰传输投影。
//
// 用户拍板（10-18 / 10-19）：
//   · 生成方式由输入决定：放了首尾帧两格就是首尾帧，放了参考就是参考；要切，在参数面板**顶部**切（现有组件原样）。
//   · 永远没有「文生视频」：空的视频节点就是「参考」方式、没放参考就是文字生成——文生那个档案模式不出现在分段里。
//   · 只在有两种以上带图方式时才出现这一组；模型只有首帧时那个方式叫「首帧」。
//   · 图片节点没有这一组：没放图是文生图，放了图是参考 / 改图（方式在发送时按输入现算，见 modeForInputs）。
//   · 声音 / 3D 暂保它们现有的模式栏（census AUD-01 / 3D-01：「补格后再定是否移参数，勿套视频两分法」）。
//
// 模式的真名（vendorTerm）仍是档案的事，这里只按 `intent`（档案跨模型统一的意图词）把标签收成三个人话词；
// 认不出的（视频编辑等）照用档案真名。
import type { ModelArchetype, ArchetypeMode } from '../../../../../electron/shared/modelArchetypes'
import type { ArchetypeModeChoice } from './channelModeReach'

export type PanelModeChoice = { id: string; label: string; /** 悬停的上限提示，只有「参考」有。 */ limitTip?: string }

export type ModePresentation =
  | { where: 'none' }
  /** 声音 / 3D：沿用现有的模式栏（参考区上方一行）。 */
  | { where: 'bar' }
  | { where: 'panel'; choices: PanelModeChoice[]; activeId: string }

type Texts = {
  reference: string
  firstLast: string
  firstFrame: string
  /** 「此模型最多：9 张图、3 段视频、3 段音频」。 */
  limitTip: (counts: { images?: number; videos?: number; audios?: number }) => string
}

function referenceLimits(mode: ArchetypeMode): { images?: number; videos?: number; audios?: number } {
  const limits: { images?: number; videos?: number; audios?: number } = {}
  for (const slot of mode.slots) {
    if (slot.max === undefined) continue
    if (slot.kind === 'image_ref') limits.images = slot.max
    else if (slot.kind === 'video_ref') limits.videos = slot.max
    else if (slot.kind === 'audio_ref') limits.audios = slot.max
  }
  return limits
}

/** 视频 / 图片节点的生成方式只由输入决定：这两类走参数面板（或干脆不出现），别的类型沿用旧栏。 */
export function presentGenerationModes(args: {
  archetype: ModelArchetype | null
  /** 已按渠道可达性收窄过的分段（archetypeModeChoices）。 */
  visibleChoices: readonly ArchetypeModeChoice[]
  activeModeId: string
  kind: 'video' | 'image' | 'other'
  texts: Texts
}): ModePresentation {
  const { archetype, visibleChoices, activeModeId, kind, texts } = args
  if (!archetype) return { where: 'none' }
  if (kind === 'image') return { where: 'none' }
  if (kind === 'other') return visibleChoices.length > 1 ? { where: 'bar' } : { where: 'none' }
  const modeOf = (id: string): ArchetypeMode | undefined => archetype.modes.find((mode) => mode.id === id)
  // 「参考」排第一（默认），其余按档案声明顺序。
  const bodyChoices = visibleChoices.filter((choice) => modeOf(choice.id)?.intent !== 'text')
  const isReferenceMode = (id: string): boolean => {
    const kinds = new Set(modeOf(id)?.slots.map((slot) => slot.kind))
    return kinds.has('image_ref') && !kinds.has('first_frame') && !kinds.has('source_video')
  }
  const withBody = [...bodyChoices.filter((choice) => isReferenceMode(choice.id)), ...bodyChoices.filter((choice) => !isReferenceMode(choice.id))]
  if (withBody.length < 2) return { where: 'none' }
  // 按方式的**实际能力**标，不按意图词猜：槽是首 / 尾帧 → 首帧 / 首尾帧；槽是参考图数组 → 参考；认不出的（视频编辑等）用档案真名。
  // （只看意图词 `single` 会把 Veo 3.1 的 3 张参考、Seedance 2 apimart 的 9 张都标成「首帧」——用户想用一张图当首帧，
  //  发出去的却是参考图驱动，生成类型不对，钱照扣。）
  const labelOf = (choice: ArchetypeModeChoice): string => {
    const mode = modeOf(choice.id)
    const kinds = new Set(mode?.slots.map((slot) => slot.kind))
    if (kinds.has('source_video')) return choice.vendorTerm
    if (kinds.has('first_frame') && kinds.has('last_frame')) return texts.firstLast
    if (kinds.has('first_frame')) return texts.firstFrame
    if (kinds.has('image_ref')) return texts.reference
    return choice.vendorTerm
  }
  const rawLabels = withBody.map(labelOf)
  // 两个方式叫成同一个词（同一模型里有两个「参考」类模式）：认不清的那几个回到档案真名，别让分段里出现两个一样的字。
  const labels = rawLabels.map((label, index) => (rawLabels.indexOf(label) === index && rawLabels.lastIndexOf(label) === index ? label : withBody[index]!.vendorTerm))
  const choices = withBody.map((choice, index): PanelModeChoice => {
    const mode = modeOf(choice.id)
    const limits = mode && isReferenceMode(choice.id) ? referenceLimits(mode) : {}
    const hasLimit = limits.images !== undefined || limits.videos !== undefined || limits.audios !== undefined
    return { id: choice.id, label: labels[index]!, ...(hasLimit ? { limitTip: texts.limitTip(limits) } : {}) }
  })
  // 当前是文生那个看不见的方式（空节点的默认）：高亮「参考」——没放参考就是文字生成，和「参考」里一张都没放等价。
  const activeIsVisible = choices.some((choice) => choice.id === activeModeId)
  const defaultVisible = withBody.find((choice) => isReferenceMode(choice.id)) ?? withBody[0]!
  return { where: 'panel', choices, activeId: activeIsVisible ? activeModeId : defaultVisible.id }
}

/** 把词典里的几句人话收成 Texts（宿主壳只管传 t）。 */
export function modePresentationTexts(t: (key: string, values?: Record<string, unknown>) => string): Texts {
  return {
    reference: t('generationCommon.composerB3.modeReference'),
    firstLast: t('generationCommon.composerB3.modeFirstLast'),
    firstFrame: t('generationCommon.composerB3.modeFirstFrame'),
    limitTip: (counts) => t('generationCommon.composerB3.modeLimit', {
      limits: [
        counts.images !== undefined ? t('generationCommon.composerB3.limitImages', { count: counts.images }) : '',
        counts.videos !== undefined ? t('generationCommon.composerB3.limitVideos', { count: counts.videos }) : '',
        counts.audios !== undefined ? t('generationCommon.composerB3.limitAudios', { count: counts.audios }) : '',
      ].filter(Boolean).join(t('generationCommon.composerB3.limitSeparator')),
    }),
  }
}
