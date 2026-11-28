// 「新建卡片默认模型」下拉的选项构建（纯函数，靠单测钉真值表）。
//
// 两个要点：
// 1. **身份是双段 `(vendorKey, modelKey)`**，只有同名选项跨供应商时才需要展示供应商名——
//    两个中转站提供同名模型时，只显示模型名的话用户根本分不清自己选的是哪一个。
// 2. **不做字符串拼接式的编码**。vendorKey 由 Base URL 派生、modelKey 常含 `/` 与 `:`，
//    任何分隔符都可能出现在里面，split 回来就是错的。这里改为发一个不透明的下标 id，
//    配一张 decode 表——从结构上消灭转义 bug。

import type { ModelCatalogModelDto } from '../api/modelCatalogApi'
import type { NomiSelectOption } from '../../design'
import { translateModelDisplayText } from '../../i18n/modelDisplayText'
import {
  GENERATION_DEFAULT_TASK_KINDS,
  type GenerationDefaultTaskKind,
  type GenerationModelDefault,
} from '../../../electron/shared/contracts/generationModelDefaultsContract'

/** 目录只按 image/video 粗分（DTO 的 kind 就这个粒度）。图片两类共用图片模型，视频两类共用视频模型。 */
const KIND_OF_TASK: Record<GenerationDefaultTaskKind, 'image' | 'video'> = {
  text_to_image: 'image',
  image_edit: 'image',
  text_to_video: 'video',
  image_to_video: 'video',
}

export type DefaultModelOptionSet = {
  optionsByKind: Record<GenerationDefaultTaskKind, NomiSelectOption[]>
  /** 下拉值 → 双段身份。值不认识（目录变了）时返回 null。 */
  decode: (value: string) => GenerationModelDefault | null
  /** 双段身份 → 下拉值。目录里没有这个模型时返回 null（UI 据此标「已不可用」）。 */
  encode: (identity: GenerationModelDefault) => string | null
}

/** 不透明 id：只保证同一次构建内稳定且唯一，不承载语义，外部不许 split 它。 */
function identityId(index: number): string {
  return `m${index}`
}

export function buildDefaultModelOptions(
  models: readonly ModelCatalogModelDto[],
  vendorNameOf: (vendorKey: string) => string,
  autoLabel: string,
): DefaultModelOptionSet {
  const decodeMap = new Map<string, GenerationModelDefault>()
  const encodeMap = new Map<string, string>()
  // 「能不能用」只认主进程那一个答案。旧版这里只看 `enabled`——这是全仓最宽的一份判据，
  // 于是 Agent 面板「图片默认 / 视频默认」两行能列出一个供应商没接入、根本跑不了的模型，
  // 而同一份目录在画布选择器里早就被滤掉了（2026-09-12 P0-10 同类）。
  const usable = models.filter((model) => model.availability.usable && model.vendorKey && model.modelKey)

  usable.forEach((model, index) => {
    const id = identityId(index)
    decodeMap.set(id, { vendorKey: model.vendorKey, modelKey: model.modelKey })
    encodeMap.set(`${model.vendorKey}\0${model.modelKey}`, id)
  })

  const optionsByKind = {} as Record<GenerationDefaultTaskKind, NomiSelectOption[]>
  for (const taskKind of GENERATION_DEFAULT_TASK_KINDS) {
    const wanted = KIND_OF_TASK[taskKind]
    const options: NomiSelectOption[] = [{ value: '', label: autoLabel }]
    const candidates = usable.flatMap((model, index) =>
      model.kind === wanted && (!model.publishedModes?.length || model.publishedModes.includes(taskKind))
        ? [{ model, index, label: translateModelDisplayText(model.labelZh || model.modelKey) }] : [])
    const vendorsByLabel = new Map<string, Set<string>>()
    for (const { model, label } of candidates) {
      const vendors = vendorsByLabel.get(label) ?? new Set<string>()
      vendors.add(model.vendorKey)
      vendorsByLabel.set(label, vendors)
    }
    for (const { model, index, label } of candidates) {
      const ambiguous = vendorsByLabel.get(label)!.size > 1
      options.push({
        value: identityId(index),
        label: ambiguous ? label + ' · ' + translateModelDisplayText(vendorNameOf(model.vendorKey) || model.vendorKey) : label,
      })
    }
    optionsByKind[taskKind] = options
  }

  return {
    optionsByKind,
    decode: (value) => decodeMap.get(value) ?? null,
    encode: (identity) => encodeMap.get(`${identity.vendorKey}\0${identity.modelKey}`) ?? null,
  }
}
