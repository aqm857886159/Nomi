// 「自动 · 实际模型名」的唯一解析真源（2026-11-27 AutoModel 板硬约束 auto.name-is-what-runs / auto.no-name-for-unusable）。
//
// 职责：
// 1. 维护图片 / 视频两条推荐梯队表（SG-1 选项 A：图片文字出图与改图同用 GPT Image 2.6 Sunburst；视频首选 Seedance 2.5）。
// 2. 输入本机当前真正可用的候选列表、用户供应商偏好序与近期连败探针，给出唯一确定的运行模型身份与显示名。
// 3. 设置页 AI 策略 2 行胶囊、设置下拉首项、画布新建节点模型胶囊、画布节点下拉首项、以及节点自动态写回 `node.meta`
//    全部调用同一个 `resolveAutoGenerationModel`——禁止任何 UI 自己另算一份名字。
// 4. 当用户手选了仅支持单一子能力的模型（如 Z-Image Turbo 只支持文字出图）时，计算缺失子能力及其自动回退模型名（edge.single-capability-pick）。

import { CANONICAL_MODEL_IDS } from '../../electron/shared/modelCanonicalIds'
import { compareVendorLanding } from '../../electron/shared/contracts/vendorPreference'
import {
  TASK_KINDS_BY_MEDIA,
  type GenerationDefaultMediaKind,
  type GenerationDefaultTaskKind,
  type GenerationModelDefault,
} from '../../electron/shared/contracts/generationModelDefaultsContract'
import { resolveModelArchetype } from '../../electron/shared/modelArchetypes'
import { translateModelDisplayText } from '../i18n/modelDisplayText'
import type { ModelCatalogModelDto } from '../workbench/api/modelCatalogApi'
import { dedupeModelOptions } from './modelIdentity'
import { toCatalogModelOptions } from './modelOptionMappers'
import type { ModelOption } from './models'

/** 图片「自动」推荐梯队（SG-1 选项 A：文生图与改图均首选 GPT Image 2.6 Sunburst；无 2.6 时落 2.5 Sunburst 等）。 */
export const IMAGE_AUTO_MODEL_LADDER: readonly string[] = [
  'gpt-image-2.6-sunburst',
  'gpt-image-2.6-flare',
  'gpt-image-2.5-sunburst',
  'gemini-nano-banana-2.1',
  'gemini-3-pro-image-preview',
  'doubao-seedream-5-0-pro',
  'gpt-image-2.5-flare',
  'gpt-image-2',
  'gemini-3.1-flash-image-preview',
  'gemini-2.5-flash-image-preview',
  'doubao-seedream-4.5',
]

/** 视频「自动」推荐梯队（首选 Seedance 2.5；样片模式行不抢占常规自动首选）。 */
export const VIDEO_AUTO_MODEL_LADDER: readonly string[] = [
  'doubao-seedance-2.5',
  'doubao-seedance-2.0',
  'wan3.0-video',
  'kling-v4',
  'MiniMax-H3',
  'kling-3.0-turbo',
  'kling-v3',
  'wan2.7',
  'veo3.1-fast',
  'MiniMax-Hailuo-2.3',
  'viduq3-pro',
  'viduq3',
]

const LADDER_BY_KIND: Readonly<Record<GenerationDefaultMediaKind, ReadonlyMap<string, number>>> = {
  image: new Map(IMAGE_AUTO_MODEL_LADDER.map((key, index) => [key, index])),
  video: new Map(VIDEO_AUTO_MODEL_LADDER.map((key, index) => [key, index])),
}

/** 跨供应商逻辑身份反向索引：任一供应商的 modelKey → 同逻辑模型在各家的全部 modelKey（含自身）。 */
const SIBLING_KEYS: ReadonlyMap<string, readonly string[]> = (() => {
  const byCanonical = new Map<string, string[]>()
  for (const [modelKey, canonical] of Object.entries(CANONICAL_MODEL_IDS)) {
    const list = byCanonical.get(canonical)
    if (list) list.push(modelKey)
    else byCanonical.set(canonical, [modelKey])
  }
  return new Map(
    Object.entries(CANONICAL_MODEL_IDS).map(([modelKey, canonical]) => [modelKey, byCanonical.get(canonical) ?? [modelKey]]),
  )
})()

export type AutoModelAilingProbe = (identity: { modelKey: unknown; vendor: unknown }) => boolean

export type ResolvedAutoGenerationModel = Readonly<{
  option: ModelOption
  vendorKey: string
  modelKey: string
  /** 当前界面语言下的规范模型显示名（如「GPT Image 2.6 Sunburst」「Seedance 2.5」）。 */
  displayName: string
  /** 命中的推荐梯队名次（0 = 梯队第 1 名；未进表 = MAX_SAFE_INTEGER）。 */
  ladderRank: number
  /** 本机有可用模型，但梯队第 1 首选模型本机不可用（如只接了 Kie 无 2.6 而落到 2.5 Sunburst）。 */
  isVendorFallback: boolean
}>

function optionStableKeys(option: ModelOption): string[] {
  const keys = new Set<string>()
  for (const raw of [option.modelKey, option.value, option.modelAlias]) {
    const trimmed = typeof raw === 'string' ? raw.trim() : ''
    if (!trimmed) continue
    keys.add(trimmed)
    for (const sibling of SIBLING_KEYS.get(trimmed) ?? []) keys.add(sibling)
  }
  return [...keys]
}

function ladderRankOf(mediaKind: GenerationDefaultMediaKind, option: ModelOption): number {
  const ladder = LADDER_BY_KIND[mediaKind]
  let best = Number.MAX_SAFE_INTEGER
  for (const key of optionStableKeys(option)) {
    const hit = ladder.get(key)
    if (hit !== undefined && hit < best) best = hit
  }
  return best
}

function optionArchetype(option: ModelOption) {
  const modelKey = option.modelKey || option.value
  return resolveModelArchetype(
    {
      modelKey,
      modelAlias: option.modelAlias ?? undefined,
      vendorKey: option.vendor,
      meta: option.meta,
    },
    { variant: { variantId: undefined, modelId: modelKey } },
  )
}

function isSampleDraftOption(option: ModelOption): boolean {
  const key = (option.modelKey || option.value || '').trim().toLowerCase()
  if (key.endsWith('-sample')) return true
  return Boolean(optionArchetype(option)?.sampleOf)
}

function isNicheUtilityOnlyOption(mediaKind: GenerationDefaultMediaKind, option: ModelOption): boolean {
  if (mediaKind !== 'image') return false
  const archetype = optionArchetype(option)
  if (!archetype || archetype.modes.length === 0) return false
  return archetype.modes.every((mode) => mode.id === 'upscale' || mode.id === 'layer_split')
}

function displayLabelForOption(options: readonly ModelOption[], picked: ModelOption): string {
  const group = dedupeModelOptions([...options]).find((model) =>
    model.providers.some(
      (provider) =>
        provider.option === picked ||
        (provider.option.value === picked.value && (provider.vendor || '') === (picked.vendor || '')),
    ),
  )
  return translateModelDisplayText(group?.label || picked.label || picked.modelKey || picked.value || '')
}

/**
 * 「自动」解析唯一纯函数。
 * - 输入 `options` 必须是当前已通过可用性闸（`availability.usable` 及所需模式）的候选列表。
 * - 0 个可用模型时返回 `null`，调用方据此显示「自动 · 暂无可用模型」（`auto.no-name-for-unusable`）。
 */
export function resolveAutoGenerationModel({
  mediaKind,
  options,
  orderedVendorKeys = [],
  isAiling = () => false,
}: {
  mediaKind: GenerationDefaultMediaKind
  options: readonly ModelOption[]
  orderedVendorKeys?: readonly string[]
  isAiling?: AutoModelAilingProbe
}): ResolvedAutoGenerationModel | null {
  const candidates = options
    .map((option, index) => {
      const modelKey = (option.modelKey || option.value || '').trim()
      const vendorKey = (typeof option.vendor === 'string' ? option.vendor : '').trim()
      return {
        option,
        index,
        modelKey,
        vendorKey,
        ladderRank: ladderRankOf(mediaKind, option),
        isSample: isSampleDraftOption(option),
        isNicheOnly: isNicheUtilityOnlyOption(mediaKind, option),
      }
    })
    .filter((entry) => Boolean(entry.modelKey))

  if (candidates.length === 0) return null

  candidates.sort((a, b) => (
    Number(a.isSample) - Number(b.isSample) ||
    Number(a.isNicheOnly) - Number(b.isNicheOnly) ||
    a.ladderRank - b.ladderRank ||
    compareVendorLanding(a.vendorKey || null, b.vendorKey || null, orderedVendorKeys) ||
    a.index - b.index
  ))

  const healthy = candidates.filter((entry) => !isAiling({ modelKey: entry.modelKey, vendor: entry.vendorKey }))
  const chosen = healthy[0] ?? candidates[0]!

  return {
    option: chosen.option,
    vendorKey: chosen.vendorKey,
    modelKey: chosen.modelKey,
    displayName: displayLabelForOption(options, chosen.option),
    ladderRank: chosen.ladderRank,
    isVendorFallback: chosen.ladderRank > 0,
  }
}

/** 目录行在某任务下是否可执行：主进程 `availability.usable` 为真，且发布模式包含该任务（轻量单测夹具未填 publishedModes 时兼容放行）。 */
export function catalogRowServesTask(row: ModelCatalogModelDto, taskKind: GenerationDefaultTaskKind): boolean {
  const mediaKind = taskKind === 'text_to_image' || taskKind === 'image_edit' ? 'image' : 'video'
  if (row.kind !== mediaKind || row.availability?.usable !== true || !row.vendorKey || !row.modelKey) return false
  if (Array.isArray(row.publishedModes) && row.publishedModes.length > 0) {
    return row.publishedModes.includes(taskKind)
  }
  // 轻量夹具未给 publishedModes 时，若能认出内置档案，按档案实际支持的 transportTaskKind 判。
  const archetype = resolveModelArchetype(
    { modelKey: row.modelKey, modelAlias: row.modelAlias, vendorKey: row.vendorKey, meta: row.meta },
    { variant: { variantId: undefined, modelId: row.modelKey } },
  )
  if (archetype && archetype.modes.length > 0) {
    return archetype.modes.some((mode) => mode.transportTaskKind === taskKind)
  }
  return true
}

export function catalogRowsToTaskModelOptions(
  models: readonly ModelCatalogModelDto[],
  vendorNameOf: (vendorKey: string) => string,
  taskKind: GenerationDefaultTaskKind,
): ModelOption[] {
  const usable = models.filter((row) => catalogRowServesTask(row, taskKind))
  return toCatalogModelOptions(usable).map((opt) => {
    const name = opt.vendor ? vendorNameOf(opt.vendor) : undefined
    return name ? { ...opt, vendorName: name } : opt
  })
}

/**
 * 从目录行直接算某一媒介行（「图片」或「视频」）此刻的「自动」结果：
 * 优先按主任务（文字出图 / 文字出视频）挑；若本机只有副任务（仅改图 / 仅图生视频）模型可用，则退到副任务候选，不误报「暂无可用模型」。
 */
export function resolveCatalogAutoGenerationModel({
  models,
  vendorNameOf,
  mediaKind,
  orderedVendorKeys = [],
  isAiling = () => false,
}: {
  models: readonly ModelCatalogModelDto[]
  vendorNameOf: (vendorKey: string) => string
  mediaKind: GenerationDefaultMediaKind
  orderedVendorKeys?: readonly string[]
  isAiling?: AutoModelAilingProbe
}): ResolvedAutoGenerationModel | null {
  const [primaryTask, secondaryTask] = TASK_KINDS_BY_MEDIA[mediaKind]
  const primaryOptions = catalogRowsToTaskModelOptions(models, vendorNameOf, primaryTask)
  if (primaryOptions.length > 0) {
    return resolveAutoGenerationModel({ mediaKind, options: primaryOptions, orderedVendorKeys, isAiling })
  }
  const secondaryOptions = catalogRowsToTaskModelOptions(models, vendorNameOf, secondaryTask)
  return resolveAutoGenerationModel({ mediaKind, options: secondaryOptions, orderedVendorKeys, isAiling })
}

export type SingleCapabilityFallbackInfo = Readonly<{
  supportedTask: GenerationDefaultTaskKind
  missingTask: GenerationDefaultTaskKind
  fallbackModelName: string | null
}>

/**
 * 检查用户在设置页为某一媒介手选的 `(vendorKey, modelKey)` 是否**只能做其中一件事**（edge.single-capability-pick）：
 * - 同时考虑同供应商下的 canonical 兄弟行（如 Kie 把同一款 GPT Image 拆成 text-to-image 与 image-to-image 两行时，该款模型在 Kie 上两件事都能做，不误报单能力）。
 * - 若确实只支持一个子任务（如 Z-Image Turbo 只能文字出图），返回受限子任务、缺失子任务、以及缺失子任务下自动会跑的模型显示名。
 */
export function inspectSingleCapabilityPick({
  models,
  vendorNameOf,
  mediaKind,
  picked,
  orderedVendorKeys = [],
  isAiling = () => false,
}: {
  models: readonly ModelCatalogModelDto[]
  vendorNameOf: (vendorKey: string) => string
  mediaKind: GenerationDefaultMediaKind
  picked: GenerationModelDefault | undefined
  orderedVendorKeys?: readonly string[]
  isAiling?: AutoModelAilingProbe
}): SingleCapabilityFallbackInfo | null {
  if (!picked) return null
  const usableKindRows = models.filter(
    (row) => row.kind === mediaKind && row.availability?.usable === true && row.vendorKey && row.modelKey,
  )
  const targetRow = usableKindRows.find(
    (row) => row.vendorKey === picked.vendorKey && row.modelKey === picked.modelKey,
  )
  if (!targetRow) return null

  const [primaryTask, secondaryTask] = TASK_KINDS_BY_MEDIA[mediaKind]
  const servesPrimary = catalogRowServesTask(targetRow, primaryTask)
  const servesSecondary = catalogRowServesTask(targetRow, secondaryTask)

  if (servesPrimary && servesSecondary) return null
  if (!servesPrimary && !servesSecondary) return null

  const supportedTask = servesPrimary ? primaryTask : secondaryTask
  const missingTask = servesPrimary ? secondaryTask : primaryTask
  const missingOptions = catalogRowsToTaskModelOptions(models, vendorNameOf, missingTask)
  const fallbackAuto = resolveAutoGenerationModel({
    mediaKind,
    options: missingOptions,
    orderedVendorKeys,
    isAiling,
  })
  return {
    supportedTask,
    missingTask,
    fallbackModelName: fallbackAuto?.displayName ?? null,
  }
}
