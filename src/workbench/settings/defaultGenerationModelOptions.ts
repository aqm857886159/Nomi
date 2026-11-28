// 「新建节点默认用哪个模型」下拉的选项构建（纯函数，靠单测钉真值表）。
//
// 要点：
// 1. **可用性唯一真闸**：只收录 `model.availability.usable === true` 的目录行（check-model-availability 门岗守卫）。
// 2. **身份是双段 `(vendorKey, modelKey)`**：跨供应商同名模型附加 ` · 供应商名` 消歧；
//    编码采用不透明下标 id + decode/encode 表，不拼分隔符，杜绝 `/` 或 `:` 转义串台。
// 3. **2 行媒介粒度（`optionsByMediaKind`）+ 4 类任务粒度（`optionsByKind`）同源派生**：
//    设置页 AI 策略 2 行按 `image` / `video` 平铺展示（按 `applyModelBoxDefaults` 默认顺序排，并带档案能力行描述）；
//    任务级对账测试与调用方继续读取同源 `optionsByKind`。

import { resolveModelArchetype } from '../../../electron/shared/modelArchetypes'
import {
  GENERATION_DEFAULT_MEDIA_KINDS,
  GENERATION_DEFAULT_TASK_KINDS,
  type GenerationDefaultMediaKind,
  type GenerationDefaultTaskKind,
  type GenerationModelDefault,
} from '../../../electron/shared/contracts/generationModelDefaultsContract'
import { applyModelBoxDefaults } from '../../config/modelBoxDefaults'
import { modelCapabilityLine } from '../../config/modelCapabilityLine'
import type { NomiSelectOption } from '../../design'
import { translateModelDisplayText } from '../../i18n/modelDisplayText'
import type { ModelCatalogModelDto } from '../api/modelCatalogApi'

const KIND_OF_TASK: Record<GenerationDefaultTaskKind, GenerationDefaultMediaKind> = {
  text_to_image: 'image',
  image_edit: 'image',
  text_to_video: 'video',
  image_to_video: 'video',
}

export type DefaultModelOptionSet = {
  /** 设置 › AI 策略 2 行（图片 / 视频）使用的非自动平铺模型项（按默认模型框顺序排列，含能力描述）。 */
  optionsByMediaKind: Record<GenerationDefaultMediaKind, NomiSelectOption[]>
  /** 任务级选项（首项为 `autoLabel`，供任务级门岗对账与助手弹层复用）。 */
  optionsByKind: Record<GenerationDefaultTaskKind, NomiSelectOption[]>
  /** 下拉值 → 双段身份。值不认识（目录变了或空串自动）时返回 null。 */
  decode: (value: string) => GenerationModelDefault | null
  /** 双段身份 → 下拉值。目录里没有这个模型时返回 null（UI 据此标「已不可用」）。 */
  encode: (identity: GenerationModelDefault) => string | null
}

function identityId(index: number): string {
  return `m${index}`
}

function capabilityDescriptionOf(model: ModelCatalogModelDto): string | undefined {
  const archetype = resolveModelArchetype(
    {
      modelKey: model.modelKey,
      modelAlias: model.modelAlias,
      vendorKey: model.vendorKey,
      meta: model.meta,
    },
    { variant: { variantId: undefined, modelId: model.modelKey } },
  )
  if (!archetype) return undefined
  const line = modelCapabilityLine(archetype)
  return line || undefined
}

export function buildDefaultModelOptions(
  models: readonly ModelCatalogModelDto[],
  vendorNameOf: (vendorKey: string) => string,
  autoLabel: string,
): DefaultModelOptionSet {
  const decodeMap = new Map<string, GenerationModelDefault>()
  const encodeMap = new Map<string, string>()
  // 「能不能用」只认主进程那一个答案（model.availability.usable）。
  const usable = models.filter((model) => model.availability.usable && model.vendorKey && model.modelKey)

  usable.forEach((model, index) => {
    const id = identityId(index)
    decodeMap.set(id, { vendorKey: model.vendorKey, modelKey: model.modelKey })
    encodeMap.set(`${model.vendorKey}\0${model.modelKey}`, id)
  })

  const optionsByMediaKind = {} as Record<GenerationDefaultMediaKind, NomiSelectOption[]>
  for (const mediaKind of GENERATION_DEFAULT_MEDIA_KINDS) {
    const rawRows = usable.flatMap((model, index) => {
      if (model.kind !== mediaKind) return []
      const label = translateModelDisplayText(model.labelZh || model.modelKey)
      return [{
        model,
        index,
        label,
        // 供 applyModelBoxDefaults 认出跨家同一模型排位
        providers: [{
          vendor: model.vendorKey,
          modelKey: model.modelKey,
          option: { value: model.modelKey, modelKey: model.modelKey, label },
        }],
      }]
    })
    const ordered = applyModelBoxDefaults(
      rawRows.map((entry) => ({ entry, model: { providers: entry.providers } })),
      null,
    ).map(({ row }) => row.entry)

    const vendorsByLabel = new Map<string, Set<string>>()
    for (const { model, label } of ordered) {
      const vendors = vendorsByLabel.get(label) ?? new Set<string>()
      vendors.add(model.vendorKey)
      vendorsByLabel.set(label, vendors)
    }

    optionsByMediaKind[mediaKind] = ordered.map(({ model, index, label }) => {
      const ambiguous = (vendorsByLabel.get(label)?.size ?? 0) > 1
      const description = capabilityDescriptionOf(model)
      return {
        value: identityId(index),
        label: ambiguous
          ? `${label} · ${translateModelDisplayText(vendorNameOf(model.vendorKey) || model.vendorKey)}`
          : label,
        ...(description ? { description } : {}),
      }
    })
  }

  const optionsByKind = {} as Record<GenerationDefaultTaskKind, NomiSelectOption[]>
  for (const taskKind of GENERATION_DEFAULT_TASK_KINDS) {
    const wanted = KIND_OF_TASK[taskKind]
    const options: NomiSelectOption[] = [{ value: '', label: autoLabel }]
    const candidates = usable.flatMap((model, index) =>
      model.kind === wanted && (!model.publishedModes?.length || model.publishedModes.includes(taskKind))
        ? [{ model, index, label: translateModelDisplayText(model.labelZh || model.modelKey) }]
        : [],
    )
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
        label: ambiguous
          ? `${label} · ${translateModelDisplayText(vendorNameOf(model.vendorKey) || model.vendorKey)}`
          : label,
      })
    }
    optionsByKind[taskKind] = options
  }

  return {
    optionsByMediaKind,
    optionsByKind,
    decode: (value) => decodeMap.get(value) ?? null,
    encode: (identity) => encodeMap.get(`${identity.vendorKey}\0${identity.modelKey}`) ?? null,
  }
}
