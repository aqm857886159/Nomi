// Agent 面板 v4 · 空态的**起手动作表**（纯换算，不碰 React）。
//
// 冷启动时对话流是空的。57 张拍板态里从来没画过这一格，于是面板主体就是一片白——
// 那不是「干净」，是**沉默**：用户看不出这块面板能做什么，也不知道第一句话该说什么。
// 空态给的不是插图、不是欢迎语，是三句**他真的可以说出口的话**。
//
// 「真的可以说」这件事必须可证，否则空态就成了一排指向不存在动作的假按钮——
// 那比空白更糟（用户点了、什么都没发生）。所以每条起手都声明它靠哪一个**已注册能力**：
//   ① 能力 id 对着 `electron/shared/agentCapabilities/registry` 那张注册表解析，
//      注册表里没有这个 id，这条起手当场消失（不是渲染成一个死 chip）；
//   ② `agentPanelV4EmptyState.test.ts` 断言每个面**恰好三条**——于是「能力改名/下架」
//      不是静默少一颗 chip，而是当场红；
//   ③ 那个测试还把 zh / en 两版起手句喂给 `agentChatPolicy.agentToolsForRequest`
//      （各面真正的工具投影），证明这句话发出去之后模型手里真有那个工具。
//      起手句的措辞因此是**承重的**：把「分镜」写成「镜头」、把 storyboard 写成 shots，
//      意图路由就走到别的工具集上，测试会告诉你。
import { CAPABILITY_CONTRACTS } from '../../../../electron/shared/agentCapabilities/registry'
import type { ResidentSurface } from '../resident/residentShellDisplay'
import type { TranslationKey } from '../../../i18n/translationKey'

export type V4StarterChip = Readonly<{
  /** 稳定 DOM 身份，走查按它点第一颗 chip。 */
  id: string
  /** 这条起手靠哪一个已注册能力。注册表里没有 = 这条起手不存在。 */
  capabilityId: string
  labelKey: TranslationKey
  /** 点下去填进 composer 的那句话（**不自动发送**：第一句话该由用户按下发送）。 */
  promptKey: TranslationKey
}>

/** 每个面的空态标题：一句话说清这块面板在这里能干什么。 */
export const V4_EMPTY_TITLE_KEY = {
  creation: 'agentPanelV4.emptyCreation',
  storyboard: 'agentPanelV4.emptyStoryboard',
  generation: 'agentPanelV4.emptyGeneration',
  preview: 'agentPanelV4.emptyPreview',
} as const satisfies Record<ResidentSurface, TranslationKey>

const SURFACE_STARTERS = {
  creation: [
    { id: 'write-script', capabilityId: 'document.write', labelKey: 'agentPanelV4.starterWriteScript', promptKey: 'agentPanelV4.starterWriteScriptPrompt' },
    { id: 'break-shots', capabilityId: 'canvas.write', labelKey: 'agentPanelV4.starterBreakShots', promptKey: 'agentPanelV4.starterBreakShotsPrompt' },
    { id: 'tighten-draft', capabilityId: 'document.write', labelKey: 'agentPanelV4.starterTightenDraft', promptKey: 'agentPanelV4.starterTightenDraftPrompt' },
  ],
  storyboard: [
    { id: 'read-script', capabilityId: 'document.read', labelKey: 'agentPanelV4.starterReadScript', promptKey: 'agentPanelV4.starterReadScriptPrompt' },
    { id: 'break-shots', capabilityId: 'canvas.write', labelKey: 'agentPanelV4.starterBreakShots', promptKey: 'agentPanelV4.starterBreakShotsPrompt' },
    { id: 'check-shots', capabilityId: 'canvas.read', labelKey: 'agentPanelV4.starterCheckShots', promptKey: 'agentPanelV4.starterCheckShotsPrompt' },
  ],
  generation: [
    { id: 'generate-selected', capabilityId: 'generation.plan', labelKey: 'agentPanelV4.starterGenerateSelected', promptKey: 'agentPanelV4.starterGenerateSelectedPrompt' },
    { id: 'break-reference', capabilityId: 'asset.read', labelKey: 'agentPanelV4.starterBreakReference', promptKey: 'agentPanelV4.starterBreakReferencePrompt' },
    { id: 'check-canvas', capabilityId: 'canvas.read', labelKey: 'agentPanelV4.starterCheckCanvas', promptKey: 'agentPanelV4.starterCheckCanvasPrompt' },
  ],
  preview: [
    { id: 'read-timeline', capabilityId: 'timeline.read', labelKey: 'agentPanelV4.starterReadTimeline', promptKey: 'agentPanelV4.starterReadTimelinePrompt' },
    { id: 'trim-clips', capabilityId: 'timeline.write', labelKey: 'agentPanelV4.starterTrimClips', promptKey: 'agentPanelV4.starterTrimClipsPrompt' },
    { id: 'export', capabilityId: 'export.write', labelKey: 'agentPanelV4.starterExport', promptKey: 'agentPanelV4.starterExportPrompt' },
  ],
} as const satisfies Record<ResidentSurface, readonly V4StarterChip[]>

const REGISTERED_CAPABILITY_IDS: ReadonlySet<string> = new Set(CAPABILITY_CONTRACTS.map((contract) => contract.id))

/**
 * 这个面的起手动作。只留**注册表里真有**的那几条：能力下架了，chip 跟着消失，
 * 而不是留一颗点下去什么都不会发生的按钮。
 */
export function starterChipsForSurface(surface: ResidentSurface): readonly V4StarterChip[] {
  return SURFACE_STARTERS[surface].filter((chip) => REGISTERED_CAPABILITY_IDS.has(chip.capabilityId))
}
