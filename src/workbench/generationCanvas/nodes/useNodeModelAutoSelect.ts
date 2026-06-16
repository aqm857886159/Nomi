// NodeParameterControls 的「模型自动选择」副作用集合（4 个 useEffect）。
// 从组件抽出为 hook：默认选模型 / vendor 同步 / 供应商断开自愈 / archetype meta 初始化。
// 行为与原组件逐字节一致——仅把 effect 体平移进来，依赖数组原样保留。
import React from 'react'
import type { ModelOption } from '../../../config/models'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import {
  buildModelControls,
  defaultPatchForControls,
  readMeta,
} from './controls/parameterControlModel'
import { ensureArchetypeNodeMeta, normalizeArchetypeVariantMeta, resolveArchetypeForModel } from './controls/archetypeMeta'
import { remapArchetypeMode } from '../runner/usableVendorModel'
import { showInfoToast } from '../../../utils/showInfoToast'
import { chooseDefaultModelOption, resolveArchetypeForOption } from './nodeModelArchetype'

type UseNodeModelAutoSelectArgs = {
  node: GenerationCanvasNode
  meta: Record<string, unknown>
  modelOptions: readonly ModelOption[]
  selectedModelValue: string
  selectedModelOption: ModelOption | null
  archetype: ReturnType<typeof resolveArchetypeForOption>
  isGenerationNode: boolean
  isImageLike: boolean
  isVideoLike: boolean
  updateNode: (nodeId: string, patch: Partial<GenerationCanvasNode>) => void
}

export function useNodeModelAutoSelect({
  node,
  meta,
  modelOptions,
  selectedModelValue,
  selectedModelOption,
  archetype,
  isGenerationNode,
  isImageLike,
  isVideoLike,
  updateNode,
}: UseNodeModelAutoSelectArgs): void {
  React.useEffect(() => {
    if (!isGenerationNode) return
    if (selectedModelValue) return
    const firstOption = chooseDefaultModelOption(modelOptions, isImageLike, isVideoLike)
    if (!firstOption?.value) return
    const defaultPatch = defaultPatchForControls(buildModelControls(firstOption.meta, isImageLike, isVideoLike))
    updateNode(node.id, {
      meta: {
        ...(node.meta || {}),
        modelKey: firstOption.modelKey || firstOption.value,
        modelAlias: firstOption.modelAlias || firstOption.value,
        modelVendor: firstOption.vendor || null,
        vendor: firstOption.vendor || null,
        modelLabel: firstOption.label,
        ...defaultPatch,
        ...(isVideoLike
          ? { videoModel: firstOption.value, videoModelVendor: firstOption.vendor || null }
          : { imageModel: firstOption.value, imageModelVendor: firstOption.vendor || null }),
      },
    })
  }, [isGenerationNode, isVideoLike, modelOptions, node.id, node.meta, selectedModelValue, updateNode])

  React.useEffect(() => {
    if (!isGenerationNode || !selectedModelOption) return
    const optionVendor = typeof selectedModelOption.vendor === 'string' ? selectedModelOption.vendor.trim() : ''
    const currentVendor =
      readMeta(meta, 'modelVendor') ||
      readMeta(meta, 'vendor') ||
      readMeta(meta, isVideoLike ? 'videoModelVendor' : 'imageModelVendor')
    if (!optionVendor || currentVendor === optionVendor) return
    updateNode(node.id, {
      meta: {
        ...(node.meta || {}),
        modelKey: selectedModelOption.modelKey || selectedModelOption.value,
        modelAlias: selectedModelOption.modelAlias || selectedModelOption.value,
        modelVendor: optionVendor,
        vendor: optionVendor,
        modelLabel: selectedModelOption.label,
        ...(isVideoLike
          ? { videoModel: selectedModelOption.value, videoModelVendor: optionVendor }
          : { imageModel: selectedModelOption.value, imageModelVendor: optionVendor }),
      },
    })
  }, [isGenerationNode, isVideoLike, meta, node.id, node.meta, selectedModelOption, updateNode])

  // ★变体合并迁移（2026-06-16，最大风险点）：旧项目 node.meta.modelKey 钉的是具体变体串
  // （如 doubao-seedance-2.0-fast），合并后 picker 只剩基础 modelKey。把旧变体 modelKey 归一成
  // 基础 modelKey + meta.archetype.variantId（保住「用户当初要 fast」），绝不让旧项目模型选择变空。
  // 必须**早于**下面的「供应商断开自愈」effect 跑——归一后 selectedModelValue 变成基础 modelKey、
  // 能在 picker 命中，自愈 effect 就不会误报「供应商已断开」toast。幂等：已归一 → no-op。
  // 据 selectedModelValue 解析档案（此时旧 modelKey 仍命中基础档案的 identifierPatterns）。
  React.useEffect(() => {
    if (!isGenerationNode || !selectedModelValue) return
    const sourceArchetype = resolveArchetypeForModel({
      modelKey: selectedModelValue,
      modelAlias: readMeta(meta, 'modelAlias'),
      vendorKey: readMeta(meta, 'modelVendor') || readMeta(meta, 'vendor'),
      meta,
    })
    if (!sourceArchetype?.variants?.length) return
    const patch = normalizeArchetypeVariantMeta(node.meta || {}, sourceArchetype)
    if (!patch) return
    updateNode(node.id, {
      meta: {
        ...(node.meta || {}),
        ...patch,
        modelAlias: patch.modelKey,
        ...(isVideoLike ? { videoModel: patch.modelKey } : { imageModel: patch.modelKey }),
      },
    })
  }, [isGenerationNode, isVideoLike, meta, node.id, node.meta, selectedModelValue, updateNode])

  // 供应商断开后，节点钉死的旧模型已从下拉移除（selectedModelOption===null，但 selectedModelValue 仍在）。
  // 按 archetype 在当前可用 options 里找同款，自动改选并写回 meta —— 否则节点会卡在选不中的死供应商上，
  // 标签/参数全错。与运行时咽喉 resolveExecutableNodeFromCatalog 同策略（同 id 优先，family 兜底）。
  React.useEffect(() => {
    if (!isGenerationNode || !selectedModelValue || selectedModelOption) return
    const sourceArchetype = resolveArchetypeForModel({
      modelKey: selectedModelValue,
      modelAlias: readMeta(meta, 'modelAlias'),
      vendorKey: readMeta(meta, 'modelVendor') || readMeta(meta, 'vendor'),
      meta,
    })
    if (!sourceArchetype) return
    const target =
      modelOptions.find((option) => resolveArchetypeForOption(option)?.id === sourceArchetype.id) ||
      modelOptions.find((option) => resolveArchetypeForOption(option)?.family === sourceArchetype.family)
    const optionVendor = typeof target?.vendor === 'string' ? target.vendor.trim() : ''
    if (!target?.value || !optionVendor) return
    const targetArchetype = resolveArchetypeForOption(target)
    const remapped = targetArchetype
      ? remapArchetypeMode(sourceArchetype, (meta.archetype as { modeId?: string } | undefined)?.modeId, targetArchetype)
      : null
    updateNode(node.id, {
      meta: {
        ...(node.meta || {}),
        modelKey: target.modelKey || target.value,
        modelAlias: target.modelAlias || target.value,
        modelVendor: optionVendor,
        vendor: optionVendor,
        modelLabel: target.label,
        ...(remapped ? { archetype: remapped } : {}),
        ...(isVideoLike
          ? { videoModel: target.value, videoModelVendor: optionVendor }
          : { imageModel: target.value, imageModelVendor: optionVendor }),
      },
    })
    showInfoToast(`原供应商已断开，已自动切换到「${target.label}」`)
  }, [isGenerationNode, isVideoLike, meta, modelOptions, node.id, node.meta, selectedModelOption, selectedModelValue, updateNode])

  // 选到一个有内置档案的模型、还没有命名空间 meta 时，初始化 node.meta.archetype（落到默认模式）。
  // 幂等：已是该档案则 no-op，不会循环。
  React.useEffect(() => {
    if (!isGenerationNode || !archetype) return
    const patch = ensureArchetypeNodeMeta(node.meta || {}, archetype)
    if (patch) updateNode(node.id, { meta: patch })
  }, [isGenerationNode, archetype, node.id, node.meta, updateNode])
}
