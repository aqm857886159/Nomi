import type { TranslationKey } from '../../../i18n/translationKey'

/**
 * 文本节点「加工框」的预设：一行纯文字按钮背后的东西——哪个预设、对模型说什么、要不要图。
 *
 * 预设不是新能力：它们是已有的三种写法（续写 / 改写 / 重写）加一句现成的要求。点预设 = 把 `meta.textGenPreset`
 * 写到节点上再走同一条「生成」路径（确认口径、进度、取消、失败提示全是文本节点原有的那一条）。
 */
export const TEXT_PROCESS_PRESET_IDS = ['expand', 'describe', 'translate', 'split'] as const
export type TextProcessPresetId = (typeof TEXT_PROCESS_PRESET_IDS)[number]

export type TextProcessPreset = Readonly<{
  id: TextProcessPresetId
  /** 要不要有图：看图写描述没有图就没东西可写。 */
  needsImage: boolean
  /** 给模型的要求（模型面，不进界面）。 */
  instruction: string
}>

export const TEXT_PROCESS_PRESETS: Readonly<Record<TextProcessPresetId, TextProcessPreset>> = Object.freeze({
  expand: {
    id: 'expand',
    needsImage: false,
    instruction: '把下面这段想法扩写成一条可以直接交给图片 / 视频生成模型的提示词：补足主体、场景、光线、镜头、风格等细节，保持原意，用与原文相同的语言。只输出提示词本身，不要解释。',
  },
  describe: {
    id: 'describe',
    needsImage: true,
    instruction: '请看附带的图片，用一段文字描述它：主体、场景、光线、色调、构图、风格。只输出描述本身，不要解释；有补充说明就用补充说明的语言，没有就用中文。',
  },
  translate: {
    id: 'translate',
    needsImage: false,
    instruction: '把下面的文字翻译成另一种语言：原文主要是中文就译成英文，否则译成中文。保留换行与编号，只输出译文。',
  },
  split: {
    id: 'split',
    needsImage: false,
    instruction: '把下面的内容拆成若干条相互独立、可以分别拿去生成一张图或一个镜头的描述。每条一行，用「1. 」「2. 」这样的编号开头，每条自成一句完整的话，不要标题和解释。',
  },
})

export function readTextProcessPreset(meta: Readonly<Record<string, unknown>> | undefined): TextProcessPreset | null {
  const id = meta?.textGenPreset
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(TEXT_PROCESS_PRESETS, id)
    ? TEXT_PROCESS_PRESETS[id as TextProcessPresetId]
    : null
}

/**
 * 「拆成多条」的结果长什么样：正文正好是一个有序列表（编辑器会在末尾补一个空段落，不算内容）→ 返回条数；
 * 不是（用户已经改成别的样子）→ null。节点底部「拆成 N 条」只看它，条数跟着用户的编辑走。
 */
export function countSplitItems(doc: Readonly<{ content?: readonly unknown[] }> | undefined): number | null {
  const blocks = (doc?.content ?? []).filter((entry) => {
    const block = entry as { type?: string; content?: unknown[] }
    return !(block.type === 'paragraph' && (!block.content || block.content.length === 0))
  })
  if (blocks.length !== 1) return null
  const only = blocks[0] as { type?: string; content?: unknown[] }
  return only.type === 'orderedList' && Array.isArray(only.content) && only.content.length >= 2 ? only.content.length : null
}

/** 预设按钮上的字（整键，编译器校验键存在；加工框与空节点「试试」共用，不各写一份）。 */
export const TEXT_PROCESS_PRESET_LABEL_KEY = {
  expand: 'generationCommon.textProcess.preset.expand',
  describe: 'generationCommon.textProcess.preset.describe',
  translate: 'generationCommon.textProcess.preset.translate',
  split: 'generationCommon.textProcess.preset.split',
} as const satisfies Record<TextProcessPresetId, TranslationKey>
