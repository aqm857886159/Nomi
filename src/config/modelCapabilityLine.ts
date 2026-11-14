// 模型菜单每行第二行那句能力描述——**一处算出**，不手写每个模型一句话。
//
// 数据来自模型档案（`electron/shared/modelArchetypes`）自己声明的东西：各方式（文生 / 图生 / 首尾帧 /
// 参考 / 编辑）、分辨率选项、时长选项。档案变了，这句话自动跟着变；没有档案的模型（自定义 / 未识别）
// 不编，返回空串（菜单那一行就只有名字）。
//
// 至多 3 项（输入方式 · 最高分辨率 · 最长时长），文案走 i18n（zh / en 两套）。
import type { ModelArchetype } from '../../electron/shared/modelArchetypes/types'
import type { ModelParameterControl } from '../../electron/shared/videoCapabilities/types'
import i18n from '../i18n'

const MAX_ITEMS = 3

type Translate = (key: string, options?: Record<string, unknown>) => string

function tr(key: string, options?: Record<string, unknown>): string {
  return (i18n.t as Translate)(`generationCommon.parameters.modelLine.${key}`, options)
}

/** 「1080p」→ 1080、「4K」→ 4000、「2k」→ 2000；认不出的（「1024x1024」「auto」）→ 0。 */
function resolutionRank(value: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*([pk])$/i.exec(value.trim())
  if (!match) return 0
  const n = Number(match[1])
  return match[2].toLowerCase() === 'k' ? n * 1000 : n
}

function controlsOf(archetype: ModelArchetype, keys: readonly string[]): ModelParameterControl[] {
  return archetype.modes.flatMap((mode) => mode.params.filter((control) => keys.includes(control.key)))
}

function maxResolution(archetype: ModelArchetype): string {
  let best = { rank: 0, label: '' }
  for (const control of controlsOf(archetype, ['resolution', 'resolution_type', 'size', 'quality'])) {
    for (const option of control.options) {
      const text = String(option.value)
      const rank = resolutionRank(text)
      if (rank > best.rank) best = { rank, label: text.toLowerCase().endsWith('k') ? text.toUpperCase() : text.toLowerCase() }
    }
  }
  return best.label
}

function maxSeconds(archetype: ModelArchetype): number {
  let best = 0
  for (const control of controlsOf(archetype, ['duration', 'duration_seconds'])) {
    for (const option of control.options) {
      const n = Number(option.value)
      if (Number.isFinite(n) && n > best) best = n
    }
    if (typeof control.max === 'number' && control.max > best) best = control.max
  }
  return best
}

function inputPhrase(archetype: ModelArchetype): string {
  const intents = new Set(archetype.modes.map((mode) => mode.intent))
  const hasSlot = (kind: string): boolean => archetype.modes.some((mode) => mode.slots.some((slot) => slot.kind === kind))
  if (archetype.kind === 'image') {
    const parts = [
      ...(intents.has('text') ? [tr('textImage')] : []),
      ...(hasSlot('image_ref') || intents.has('edit') || intents.has('single') ? [tr('imageEdit')] : []),
    ]
    return parts.join('/')
  }
  if (archetype.kind !== 'video') return ''
  const parts = [
    ...(intents.has('text') ? [tr('text')] : []),
    ...(intents.has('single') || hasSlot('first_frame') ? [tr('image')] : []),
    ...(intents.has('firstlast') || hasSlot('last_frame') ? [tr('firstLast')] : []),
    ...(intents.has('character') || hasSlot('video_ref') || hasSlot('audio_ref') ? [tr('reference')] : []),
    ...(intents.has('edit') || hasSlot('source_video') ? [tr('edit')] : []),
  ]
  return parts.join('/')
}

/** 一行能力描述；档案缺失或什么都没算出来 → 空串（不编）。 */
export function modelCapabilityLine(archetype: ModelArchetype | null | undefined): string {
  if (!archetype) return ''
  const resolution = maxResolution(archetype)
  const seconds = archetype.kind === 'video' ? maxSeconds(archetype) : 0
  const items = [
    inputPhrase(archetype),
    resolution ? tr('upTo', { value: resolution }) : '',
    seconds > 0 ? tr('maxSeconds', { count: seconds }) : '',
  ].filter(Boolean)
  return items.slice(0, MAX_ITEMS).join(' · ')
}
