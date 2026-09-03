// NodeParameterControls 的「模型自动选择」副作用集合（4 个 useEffect）。
// 从组件抽出为 hook：默认选模型 / vendor 同步 / 供应商断开自愈 / archetype meta 初始化。
// 所有派生写回都从 store 读取最新节点，避免两个同屏控制实例用旧快照互相触发。
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelOption } from '../../../config/models'
import {
  parseCustomCapabilityContract,
  replaceCustomCapabilityContractMeta,
} from '../../../config/modelArchetypes'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { projectParameterReferenceSlots } from '../model/parameterReferenceSlots'
import { buildModelControls, defaultPatchForControls, readMeta } from './controls/parameterControlModel'
import {
  applyArchetypeModeSwitch,
  ensureArchetypeNodeMeta,
  normalizeArchetypeVariantMeta,
  resolveArchetypeForModel,
} from './controls/archetypeMeta'
import { resolveModeForConnectedReferences } from '../agent/referenceEdgeCapability'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { CanvasMutationOptions } from '../store/canvasGuards'
import { whenCanvasWriteBoundarySettled } from '../events/canvasWriteBoundary'
import { remapArchetypeMode } from '../runner/usableVendorModel'
import { showInfoToast } from '../../../utils/showInfoToast'
import { chooseDefaultModelOption, resolveArchetypeForOption } from './nodeModelArchetype'
import {
  generationModelDefaultsLoaded,
  getGenerationModelDefaults,
  loadGenerationModelDefaults,
  subscribeGenerationModelDefaults,
} from '../model/generationModelDefaults'
import {
  deriveGenerationDefaultTaskKind,
  nodeHasImageReference,
  resolveDefaultModelOption,
} from './defaultNodeModelSelection'

type UseNodeModelAutoSelectArgs = {
  node: GenerationCanvasNode
  modelOptions: readonly ModelOption[]
  selectedModelValue: string
  selectedModelOption: ModelOption | null
  archetype: ReturnType<typeof resolveArchetypeForOption>
  isGenerationNode: boolean
  isImageLike: boolean
  isVideoLike: boolean
  updateNode: (nodeId: string, patch: Partial<GenerationCanvasNode>, options?: CanvasMutationOptions) => void
}

export function useNodeModelAutoSelect({
  node,
  modelOptions,
  selectedModelValue,
  selectedModelOption,
  archetype,
  isGenerationNode,
  isImageLike,
  isVideoLike,
  updateNode,
}: UseNodeModelAutoSelectArgs): void {
  const { t } = useTranslation()
  const deferredWrites = React.useRef(new Set<string>())
  const latestNodeRef = React.useRef(node)
  latestNodeRef.current = node
  const getLatestNode = React.useCallback((): GenerationCanvasNode => (
    useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id) || latestNodeRef.current
  ), [node.id])
  const getLatestMeta = React.useCallback((): Record<string, unknown> => getLatestNode().meta || {}, [getLatestNode])
  const writeDerivedMeta = React.useCallback((nodeId: string, patch: Partial<GenerationCanvasNode>): void => {
    const options = { history: false } as const
    try {
      updateNode(nodeId, patch, options)
    } catch (error) {
      const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
      const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : ''
      if (name !== 'AbortError' || message !== 'Canvas proposal receipt commit is in progress') throw error
      const key = `${nodeId}:${JSON.stringify(patch)}`
      if (deferredWrites.current.has(key)) return
      deferredWrites.current.add(key)
      void whenCanvasWriteBoundarySettled().then(() => {
        deferredWrites.current.delete(key)
        if (!useGenerationCanvasStore.getState().nodes.some((candidate) => candidate.id === nodeId)) return
        try { updateNode(nodeId, patch, options) } catch { /* the node may have been removed during the commit */ }
      })
    }
  }, [updateNode])
  // 「新建卡片默认模型」偏好装好没有。装好前**不能**挑模型：此刻偏好是空的，
  // 挑出来的是「自动选择」的结果并会写进节点 meta，偏好随后才到——
  // 用户看到的就是「我明明设了默认模型，新建的卡还是别的」。装好后订阅会触发重跑。
  const defaultsReady = React.useSyncExternalStore(
    subscribeGenerationModelDefaults,
    generationModelDefaultsLoaded,
    generationModelDefaultsLoaded,
  )
  React.useEffect(() => {
    void loadGenerationModelDefaults()
  }, [])

  React.useEffect(() => {
    if (!isGenerationNode) return
    if (selectedModelValue) return
    if (!defaultsReady) return
    const latestNode = getLatestNode()
    const latestMeta = latestNode.meta || {}
    const taskKind = deriveGenerationDefaultTaskKind({
      isImageLike,
      isVideoLike,
      hasImageReference: nodeHasImageReference(latestMeta),
    })
    // 用户设过就用他的；没设、或设的那个此刻不可用（供应商删了/模型禁用了），
    // 就让位给原有的健康挑选策略——绝不把卡片钉在一个跑不了的模型上。
    const preferred = resolveDefaultModelOption(modelOptions, getGenerationModelDefaults(), taskKind)
    const firstOption = preferred ?? chooseDefaultModelOption(modelOptions, isImageLike, isVideoLike)
    if (!firstOption?.value) return
    const defaultPatch = defaultPatchForControls(buildModelControls(firstOption.meta, isImageLike, isVideoLike))
    const modelMeta = replaceCustomCapabilityContractMeta(latestMeta, firstOption.meta)
    writeDerivedMeta(node.id, {
      meta: projectParameterReferenceSlots({
        ...modelMeta,
        modelKey: firstOption.modelKey || firstOption.value,
        modelAlias: firstOption.modelAlias || firstOption.value,
        modelVendor: firstOption.vendor || null,
        vendor: firstOption.vendor || null,
        modelLabel: firstOption.label,
        ...defaultPatch,
        ...(isVideoLike
          ? { videoModel: firstOption.value, videoModelVendor: firstOption.vendor || null }
          : { imageModel: firstOption.value, imageModelVendor: firstOption.vendor || null }),
      }, firstOption.meta),
    })
  }, [defaultsReady, getLatestNode, isGenerationNode, isImageLike, isVideoLike, modelOptions, node.id, selectedModelValue, writeDerivedMeta])

  React.useEffect(() => {
    if (!isGenerationNode || !selectedModelOption) return
    const optionVendor = typeof selectedModelOption.vendor === 'string' ? selectedModelOption.vendor.trim() : ''
    const latestMeta = getLatestMeta()
    const currentVendor =
      readMeta(latestMeta, 'modelVendor') ||
      readMeta(latestMeta, 'vendor') ||
      readMeta(latestMeta, isVideoLike ? 'videoModelVendor' : 'imageModelVendor')
    if (!optionVendor) return
    const contractChanged = JSON.stringify(parseCustomCapabilityContract(latestMeta))
      !== JSON.stringify(parseCustomCapabilityContract(selectedModelOption.meta))
    const modelMeta = replaceCustomCapabilityContractMeta(latestMeta, selectedModelOption.meta)
    const nextMeta = projectParameterReferenceSlots({
      ...modelMeta,
      modelKey: selectedModelOption.modelKey || selectedModelOption.value,
      modelAlias: selectedModelOption.modelAlias || selectedModelOption.value,
      modelVendor: optionVendor,
      vendor: optionVendor,
      modelLabel: selectedModelOption.label,
      ...(isVideoLike
        ? { videoModel: selectedModelOption.value, videoModelVendor: optionVendor }
        : { imageModel: selectedModelOption.value, imageModelVendor: optionVendor }),
    }, selectedModelOption.meta)
    const declarationsChanged = JSON.stringify(latestMeta.parameterReferenceSlots) !== JSON.stringify(nextMeta.parameterReferenceSlots)
    if (currentVendor === optionVendor && !contractChanged && !declarationsChanged) return
    writeDerivedMeta(node.id, { meta: nextMeta })
  }, [getLatestMeta, isGenerationNode, isVideoLike, node.id, selectedModelOption, writeDerivedMeta])

  // ★变体合并迁移（2026-06-16，最大风险点）：旧项目 node.meta.modelKey 钉的是具体变体串
  // （如 doubao-seedance-2.0-fast），合并后 picker 只剩基础 modelKey。把旧变体 modelKey 归一成
  // 基础 modelKey + meta.archetype.variantId（保住「用户当初要 fast」），绝不让旧项目模型选择变空。
  // 必须**早于**下面的「供应商断开自愈」effect 跑——归一后 selectedModelValue 变成基础 modelKey、
  // 能在 picker 命中，自愈 effect 就不会误报「供应商已断开」toast。幂等：已归一 → no-op。
  // 据 selectedModelValue 解析档案（此时旧 modelKey 仍命中基础档案的 identifierPatterns）。
  React.useEffect(() => {
    if (!isGenerationNode || !selectedModelValue) return
    // ⚠️ 迁移只针对**已经解析不到**的旧串。一个在当前目录里活着的 (vendor, modelKey) 绝不能被改写：
    // 变体的 identifierPatterns 是**供应商无关**的裸串，而不同供应商可以用同一个裸串命名不同的行——
    // Runway 的真实 modelKey `veo3.1` 正好等于 veo-3.1 档案 fast 变体的 pattern，`seedance2` 同理。
    // 少了这道闸，迁移会把活着的 Runway 节点改写成 APIMart 的基础串（veo3.1-fast / bytedance/seedance-2），
    // 供应商却还留在 runway：轻则模式栏/参数显示成另一家的样子，重则 (runway, bytedance/seedance-2)
    // 这个组合在目录里根本不存在 → 生成面板直接报「加载失败」。R13 真机走查抓到的就是这个。
    if (selectedModelOption) return
    const latestMeta = getLatestMeta()
    const sourceArchetype = resolveArchetypeForModel({
      modelKey: selectedModelValue,
      modelAlias: readMeta(latestMeta, 'modelAlias'),
      vendorKey: readMeta(latestMeta, 'modelVendor') || readMeta(latestMeta, 'vendor'),
      meta: latestMeta,
    })
    if (!sourceArchetype?.variants?.length) return
    const patch = normalizeArchetypeVariantMeta(latestMeta, sourceArchetype)
    if (!patch) return
    writeDerivedMeta(node.id, {
      meta: {
        ...latestMeta,
        ...patch,
        modelAlias: patch.modelKey,
        ...(isVideoLike ? { videoModel: patch.modelKey } : { imageModel: patch.modelKey }),
      },
    })
  }, [getLatestMeta, isGenerationNode, isVideoLike, node.id, selectedModelOption, selectedModelValue, writeDerivedMeta])

  // 供应商断开后，节点钉死的旧模型已从下拉移除（selectedModelOption===null，但 selectedModelValue 仍在）。
  // 按 archetype 在当前可用 options 里找同款，自动改选并写回 meta —— 否则节点会卡在选不中的死供应商上，
  // 标签/参数全错。与运行时咽喉 resolveExecutableNodeFromCatalog 同策略（同 id 优先，family 兜底）。
  React.useEffect(() => {
    if (!isGenerationNode || !selectedModelValue || selectedModelOption) return
    const latestMeta = getLatestMeta()
    const sourceArchetype = resolveArchetypeForModel({
      modelKey: selectedModelValue,
      modelAlias: readMeta(latestMeta, 'modelAlias'),
      vendorKey: readMeta(latestMeta, 'modelVendor') || readMeta(latestMeta, 'vendor'),
      meta: latestMeta,
    })
    if (!sourceArchetype) return
    const target =
      modelOptions.find((option) => resolveArchetypeForOption(option)?.id === sourceArchetype.id) ||
      modelOptions.find((option) => resolveArchetypeForOption(option)?.family === sourceArchetype.family)
    const optionVendor = typeof target?.vendor === 'string' ? target.vendor.trim() : ''
    if (!target?.value || !optionVendor) return
    const targetArchetype = resolveArchetypeForOption(target)
    const remapped = targetArchetype
      ? remapArchetypeMode(
          sourceArchetype,
          (latestMeta.archetype as { modeId?: string } | undefined)?.modeId,
          targetArchetype,
          readMeta(latestMeta, 'modelVendor') || readMeta(latestMeta, 'vendor'),
          optionVendor,
        )
      : null
    writeDerivedMeta(node.id, {
      meta: {
        ...replaceCustomCapabilityContractMeta(latestMeta, target.meta),
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
    showInfoToast(t('generationCommon.node.providerDisconnectedSwitched', { model: target.label }))
  }, [
    getLatestMeta,
    isGenerationNode,
    isVideoLike,
    modelOptions,
    node.id,
    selectedModelOption,
    selectedModelValue,
    t,
    writeDerivedMeta,
  ])

  // 选到一个有内置档案的模型、还没有命名空间 meta 时，初始化 node.meta.archetype（落到默认模式）。
  // 幂等：已是该档案则 no-op，不会循环。
  // 初始化的同一笔写里对账活边参考（2026-07-28 群反馈）：「创建并连接」菜单 + 自动选模型不经
  // handleModelChange，默认 t2i 会把已连参考晾在门外——UI 停在「文生图」误导用户（提交端虽有
  // 咽喉 reconcile 兜底发送正确，但界面得当场说真话）。仅在初始化时刻对账，不做持续强制——
  // 用户之后手动切回文生图是他的选择，提交时才由咽喉按「挂着参考=要用参考」纠正。
  React.useEffect(() => {
    if (!isGenerationNode || !archetype) return
    const latestNode = getLatestNode()
    const latestMeta = latestNode.meta || {}
    const patch = ensureArchetypeNodeMeta(latestMeta, archetype)
    if (!patch) return
    const state = useGenerationCanvasStore.getState()
    const promotedModeId = resolveModeForConnectedReferences({ ...latestNode, meta: patch }, state.nodes, state.edges)
    writeDerivedMeta(
      node.id,
      { meta: promotedModeId ? applyArchetypeModeSwitch(patch, archetype, promotedModeId) : patch },
    )
  }, [archetype, getLatestNode, isGenerationNode, node.id, writeDerivedMeta])
}
