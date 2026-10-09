import { orderByVendorPreference } from '../../../../electron/shared/contracts/vendorPreference'
// composer 模型弹层的**行数据**。纯 derive，可单测。
//
// 2026-09-06 打包版实测：弹层里是 17 行，每一行的行首标签都写着「对话」，行尾一个下拉都没有。
// 那不是拍板的那个弹层——现在是**三行**「对话 / 图片默认 / 视频默认」，
// 每行一个当前模型 + 价格 + 一个下拉，一句话说清它的用处：「每类一个默认，Agent 帮你生成时用它」。
// 17 行同名标签同时还有另一个后果：`key={row.slot}` 全撞。
//
// 拍板时是四行，第四行「音频默认」2026-09-07 由用户删掉：仓库里没有音频生成能力
// （`GENERATION_DEFAULT_TASK_KINDS` 只有图/视频的 taskKind，也没有 audio 生成节点或解析器），
// 画一行永远空着的槽是在承诺一个不存在的能力。等音频生成落地了再加回来。
//
// 为什么是「每类一行」而不是「每个模型一行」：用户在这一刻要决定的是**这一类活儿交给谁**，
// 不是从 17 个型号里挑一个。把目录整个摊开等于把「选型」这件事推回给用户，
// 而弹层本来就该替他把这件事收成三四个决定。
//
// 供应商去重也在这一层：同一个模型经三家中转接进来，目录里是三行，但对用户是**一个**模型。
// 摊三行只会逼他去比三个他分不清的供应商名（PR #535 已经在设置页把这条做过一遍）。
import type { AgentPanelV4Data } from './useAgentPanelV4Data'
import type { V4ModelRow } from './AgentPanelV4Composer'
import { buildDefaultModelOptions } from '../../settings/defaultGenerationModelOptions'
import { encodeModelIdentity } from '../assistantModelIdentity'
import type { ModelCatalogModelDto } from '../../api/modelCatalogApi'
import { labelForModel } from '../assistantModelIdentity'

export type AgentModelChoice = Readonly<{ value: string; label: string; trailing?: string }>

/**
 * 同名模型跨供应商折成一行，留下**偏好序里最靠前**的那一家。
 *
 * 偏好序是 PR #535 的 `orderedVendorKeys`（用户在设置里排的）。没排到的家按目录原序接在后面——
 * 不重新发明一套评分，用户排的顺序就是答案。
 */
export function dedupeByModelKey(
  models: readonly ModelCatalogModelDto[],
  orderedVendorKeys: readonly string[],
): readonly ModelCatalogModelDto[] {
  const best = new Map<string, ModelCatalogModelDto>()
  for (const model of orderByVendorPreference(models, orderedVendorKeys, (row) => row.vendorKey)) {
    if (!best.has(model.modelKey)) best.set(model.modelKey, model)
  }
  // 输出保持目录原序（按被选中的那一行的位置），避免弹层每次重排。
  return Object.freeze(models.filter((model) => best.get(model.modelKey) === model))
}

/**
 * 对话那一行的下拉选项。值就是 `vendorKey/modelKey` 的编码（`encodeModelIdentity`），
 * 因为对话模型的偏好（`assistantModelPref`）本来就按这个身份存。
 */
export function chatModelChoices(
  models: readonly ModelCatalogModelDto[],
  vendorNames: Readonly<Record<string, string>>,
  orderedVendorKeys: readonly string[],
  encode: (model: ModelCatalogModelDto) => string,
  creditsLabel: (cost: number) => string,
): readonly AgentModelChoice[] {
  const deduped = dedupeByModelKey(models, orderedVendorKeys)
  return Object.freeze(deduped.map((model) => ({
    value: encode(model),
    label: labelForModel(model, [...models], vendorNames),
    // 价格只在目录真的写了才给。`pricing.cost` 是**积分**，不是编出来的 ≈¥/张。
    ...(model.pricing?.enabled && model.pricing.cost > 0 ? { trailing: creditsLabel(model.pricing.cost) } : {}),
  })))
}

/** Shared catalog-to-row projection used by the resident shell and visual fixtures. */
export function buildV4ModelRows(data: Pick<AgentPanelV4Data, 'models' | 'vendors' | 'orderedVendorKeys' | 'selectedModel' | 'modelLabel' | 'reasoning' | 'selectModel' | 'generationModels' | 'generationDefaults' | 'setGenerationDefault'>, t: (key: string, options?: Record<string, unknown>) => string): readonly V4ModelRow[] {
  const generationOptions = buildDefaultModelOptions(data.generationModels, key => data.vendors[key] ?? key, t('agentPanelV4.modelAuto'))
  const rows: V4ModelRow[] = []
  const chatChoices = chatModelChoices(
    data.models,
    data.vendors,
    data.orderedVendorKeys,
    encodeModelIdentity,
    (cost) => t('agentPanelV4.modelCredits', { cost }),
  )
  const selectedChat = data.selectedModel ? encodeModelIdentity(data.selectedModel) : ''
  rows.push({
    slot: t('agentPanelV4.modelChat'),
    name: data.modelLabel,
    cost: chatChoices.find(choice => choice.value === selectedChat)?.trailing,
    ...(chatChoices.length
      ? {
          options: chatChoices.map(choice => ({ value: choice.value, label: choice.label, ...(choice.trailing ? { trailing: choice.trailing } : {}) })),
          selectedValue: selectedChat,
          onChange: (value: string) => {
            const model = data.models.find(candidate => encodeModelIdentity(candidate) === value)
            if (model) data.selectModel(model)
          },
        }
      : { empty: t('agentPanelV4.modelNone') }),
  })
  const reasoning = data.reasoning
  if (reasoning && reasoning.levels.length > 1) rows.push({
    slot: t('agentPanelV4.reasoningLevel'),
    name: t(`agentPanelV4.reasoningLevels.${reasoning.level}`),
    options: reasoning.levels.map(level => ({ value: level, label: t(`agentPanelV4.reasoningLevels.${level}`) })),
    selectedValue: reasoning.level,
    disabled: reasoning.disabled,
    onChange: value => {
      const level = reasoning.levels.find(candidate => candidate === value)
      if (level && !reasoning.disabled) reasoning.select(level)
    },
  })
  for (const [slot, taskKind] of [
    [t('agentPanelV4.imageDefault'), 'text_to_image'],
    [t('agentPanelV4.videoDefault'), 'text_to_video'],
  ] as const) {
    const options = generationOptions.optionsByKind[taskKind]
    const current = data.generationDefaults[taskKind]
    const selectedValue = current ? generationOptions.encode(current) : ''
    const selectedModel = data.generationModels.find(model => model.vendorKey === current?.vendorKey && model.modelKey === current?.modelKey)
    const cost = selectedModel?.pricing?.enabled && selectedModel.pricing.cost > 0
      ? t('agentPanelV4.modelCredits', { cost: selectedModel.pricing.cost }) : undefined
    const label = options.find(option => option.value === selectedValue)?.label
    rows.push({
      slot,
      cost,
      // 目录里已经没有这个模型时明确标不可用；默认仍是现役自动选择。
      name: label ?? (current ? t('agentPanelV4.modelGone') : t('agentPanelV4.modelAuto')),
      // options[0] 恒为自动选，因此 >1 才有可选模型。
      ...(options.length > 1
        ? {
            options,
            selectedValue: selectedValue ?? '',
            onChange: (value: string) => data.setGenerationDefault(taskKind, generationOptions.decode(value)),
          }
        : { empty: t('agentPanelV4.modelNone') }),
    })
  }
  return Object.freeze(rows)
}
