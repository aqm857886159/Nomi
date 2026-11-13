// 模型品牌图的**唯一对照表**：模型档案的 `family`（家族）→ 一枚单色品牌图。
//
// 图来自现成的 `@lobehub/icons-static-svg`（MIT）。下面只 import 用到的那几枚，打包只带它们
// （其余 600 多枚不进产物）。单色：`fill="currentColor"`，作 <img> 时是黑色，暗色模式由
// `NomiIdentityIcon` 反相成白色（`monochrome: true`）。
//
// 规矩：
//   · 只按档案声明的 `family` 取图（档案由仓库的统一解析函数认：显式 `meta.archetypeId`，或按型号名），
//     不看自定义模型的显示名——叫「Seedream lookalike」的自建模型不会借到别人的牌子（2026-09-14 即梦挂豆包牌子的教训）；
//   · 查不到的返回名字首字母的字块（`fallback`），不留空、不借别家的图；
//   · 组件里一律不写「某某供应商 / 某某模型就画某某图」，加一家 = 在 FAMILY_ICON 里加一行 + 在下面 import 一枚。
import alibaba from '@lobehub/icons-static-svg/icons/alibaba.svg'
import doubao from '@lobehub/icons-static-svg/icons/doubao.svg'
import elevenlabs from '@lobehub/icons-static-svg/icons/elevenlabs.svg'
import gemini from '@lobehub/icons-static-svg/icons/gemini.svg'
import google from '@lobehub/icons-static-svg/icons/google.svg'
import grok from '@lobehub/icons-static-svg/icons/grok.svg'
import hailuo from '@lobehub/icons-static-svg/icons/hailuo.svg'
import happyhorse from '@lobehub/icons-static-svg/icons/happyhorse.svg'
import hunyuan from '@lobehub/icons-static-svg/icons/hunyuan.svg'
import jimeng from '@lobehub/icons-static-svg/icons/jimeng.svg'
import kling from '@lobehub/icons-static-svg/icons/kling.svg'
import flux from '@lobehub/icons-static-svg/icons/flux.svg'
import meshy from '@lobehub/icons-static-svg/icons/meshy.svg'
import minimax from '@lobehub/icons-static-svg/icons/minimax.svg'
import modelscope from '@lobehub/icons-static-svg/icons/modelscope.svg'
import muse from '@lobehub/icons-static-svg/icons/muse.svg'
import nanobanana from '@lobehub/icons-static-svg/icons/nanobanana.svg'
import openai from '@lobehub/icons-static-svg/icons/openai.svg'
import pixverse from '@lobehub/icons-static-svg/icons/pixverse.svg'
import qwen from '@lobehub/icons-static-svg/icons/qwen.svg'
import runway from '@lobehub/icons-static-svg/icons/runway.svg'
import suno from '@lobehub/icons-static-svg/icons/suno.svg'
import vidu from '@lobehub/icons-static-svg/icons/vidu.svg'
import { getArchetypeById, resolveArchetypeForModel } from '../../electron/shared/modelArchetypes'
import type { ModelArchetype } from '../../electron/shared/modelArchetypes/types'
import type { DedupedModel, ModelProviderRef } from './modelIdentity'
import type { NomiIdentityIconSource } from '../design'

/** 档案 `family` → 品牌图。一处登记，别处不许再写「哪个模型画哪张图」。 */
const FAMILY_ICON: Readonly<Record<string, string>> = {
  seedance: doubao,
  seedream: doubao,
  'doubao-tts': doubao,
  'seed-tts': doubao,
  'dreamina-image': jimeng,
  minimax,
  'minimax-music': minimax,
  'minimax-speech': minimax,
  happyhorse,
  vidu,
  kling,
  'grok-imagine': grok,
  veo: google,
  imagen: google,
  lyria: google,
  'gemini-omni': gemini,
  'gemini-image-3': gemini,
  omni: gemini,
  runway,
  'runway-gen4-image': runway,
  'runway-seed-audio': runway,
  'runway-muse': muse,
  wan: alibaba,
  'wan-image': alibaba,
  'z-image': alibaba,
  'qwen-image': qwen,
  hailuo,
  pixverse,
  flux,
  'gpt-image': openai,
  'codex-imagegen': openai,
  'nano-banana': nanobanana,
  'hunyuan-image': hunyuan,
  hunyuan3d: hunyuan,
  meshy,
  suno,
  'suno-sfx': suno,
  'elevenlabs-speech': elevenlabs,
  'elevenlabs-music': elevenlabs,
  'elevenlabs-sfx': elevenlabs,
  'elevenlabs-scribe': elevenlabs,
  modelscope,
}

/** 名字首字母（字块兜底）：英文取大写首字母，汉字取首字。 */
export function modelNameInitial(name: string): string {
  const first = Array.from(name.trim())[0] ?? ''
  return /[a-z]/i.test(first) ? first.toUpperCase() : first
}

function explicitArchetypeId(provider: ModelProviderRef): string {
  const meta = provider.option.meta
  if (!meta || typeof meta !== 'object') return ''
  const id = (meta as { archetypeId?: unknown }).archetypeId
  return typeof id === 'string' ? id.trim() : ''
}

/** 一组模型的档案：取各家供应商里第一个**显式声明**档案的那个（同一模型各家挂的是同一份）。自定义模型不按名字猜。 */
export function modelArchetypeOf(model: Pick<DedupedModel, 'providers'>): ModelArchetype | null {
  for (const provider of model.providers) {
    const id = explicitArchetypeId(provider)
    const archetype = id ? getArchetypeById(id) : null
    if (archetype) return archetype
  }
  return null
}

/**
 * 一组模型的家族：用仓库里「这一行是哪个档案」的那一个解析函数（显式 archetypeId 优先，没写就按型号名认），
 * 不在这里再写一份匹配——别的通道上的同一个模型（只靠型号名认出档案）也拿到同一枚图。自定义模型不借牌子的保证
 * 来自解析函数本身：认不出档案的行没有家族。
 */
export function modelFamilyOf(model: Pick<DedupedModel, 'providers'>): string {
  for (const provider of model.providers) {
    const option = provider.option
    const archetype = resolveArchetypeForModel({
      modelKey: provider.modelKey ?? option.modelKey,
      modelAlias: provider.modelAlias ?? option.modelAlias,
      vendorKey: provider.vendor ?? option.vendor,
      meta: option.meta,
      ...(option.modelNameSource ? { modelNameSource: option.modelNameSource } : {}),
    })
    if (archetype) return archetype.family
  }
  return ''
}

/** 模型的身份图：认得家族 → 品牌图（单色）；认不得 → 名字首字母字块。永远有东西可画。 */
export function modelBrandIcon(model: Pick<DedupedModel, 'providers' | 'label'>): NomiIdentityIconSource {
  const src = FAMILY_ICON[modelFamilyOf(model)]
  const initial = modelNameInitial(model.label)
  return { kind: 'model', ...(src ? { src, monochrome: true } : {}), ...(initial ? { fallback: initial } : {}) }
}

/** 测试与门岗用：对照表里登记了哪些家族。 */
export function registeredModelFamilies(): string[] {
  return Object.keys(FAMILY_ICON)
}
