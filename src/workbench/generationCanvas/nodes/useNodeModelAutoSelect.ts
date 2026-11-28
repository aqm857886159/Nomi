// NodeParameterControls 的「模型自动选择」副作用集合。
// 2026-11-27 AutoModel 板（SG-1 / SG-2 / auto.name-is-what-runs）：
// - 新卡不再读「跟上次一样」记忆；设置未配固定模型时，走唯一真源 `resolveAutoGenerationModel` 并标记 `modelAuto: true`；
// - 处于 `modelAuto: true`（或继承自单能力默认模型 `modelFromDefault: true` 而当前模式不再支持该模型）的空闲节点，
//   当模式切换（如 Kie 文生图 ↔ 改图行切换）、供应商变化或连败状态变化时，同步到 `resolveAutoGenerationModel` 算出的模型，
//   确保左下胶囊「自动 · X」印出的名字与发送执行读取的 `node.meta` 完全同源。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { resolveAutoGenerationModel } from '../../../config/autoGenerationModel'
import type { ModelOption } from '../../../config/models'
import {
  parseCustomCapabilityContract,
  replaceCustomCapabilityContractMeta,
  resolveModelArchetype,
  variantRecordedInMeta,
} from '../../../../electron/shared/modelArchetypes'
import { useVendorPreferenceOrder } from '../../common/useVendorPreference'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { projectParameterReferenceSlots } from '../model/parameterReferenceSlots'
import { buildModelControls, defaultPatchForControls, isAspectRatioControl, readMeta } from './controls/parameterControlModel'
import {
  carryHumanModePreference,
  ensureArchetypeNodeMeta,
  normalizeArchetypeVariantMeta,
} from './controls/archetypeMeta'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { CanvasMutationOptions } from '../store/canvasGuards'
import { whenCanvasWriteBoundarySettled } from '../events/canvasWriteBoundary'
import { selectedModelKey } from '../runner/catalogTaskResolve'
import { isModelRecentlyAiling } from '../runner/modelHealthMemory'
import { useToastStore } from '../../../ui/toast'
import { classifyGenerationError } from '../../observability/classifyError'
import { chooseDefaultModelOption, resolveArchetypeForOption, resolveRenderedControls, resolveRenderedMode } from './nodeModelArchetype'
import {
  generationModelDefaultsLoaded,
  getGenerationModelDefaults,
  loadGenerationModelDefaults,
  subscribeGenerationModelDefaults,
} from '../model/generationModelDefaults'
import {
  deriveGenerationDefaultMediaKind,
  deriveGenerationDefaultTaskKind,
  nodeHasImageReference,
  resolveDefaultModelOption,
} from './defaultNodeModelSelection'
import { ASPECT_EXPLICIT_META_KEY } from './aspectExplicit'
import { readCandidateNodeIdentity } from '../agent/candidateNodeMeta'
import { applyVideoAspectSeed, videoAspectSeedPatch } from './videoAspectSeed'
import {
  candidateNoticeStillHolds,
  disconnectionNoticeStillHolds,
  failedAttemptOf,
  failureDescribesCurrentSelection,
  failureNoticeStillHolds,
  nodeNoticeValidity,
  nodeRecoveryToastId,
  providerFailedValues,
  vendorLabelFor,
} from './nodeRecoveryNotice'

function initializedArchetypeMeta(
  meta: Record<string, unknown>,
  archetype: NonNullable<ReturnType<typeof resolveArchetypeForOption>>,
): Record<string, unknown> | null {
  return ensureArchetypeNodeMeta(meta, archetype)
}

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
  const orderedVendorKeys = useVendorPreferenceOrder()
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

  const revalidateListeners = React.useRef(new Set<() => void>())
  const selectionMissingRef = React.useRef(false)
  selectionMissingRef.current = Boolean(selectedModelValue) && !selectedModelOption
  React.useEffect(() => {
    for (const recheck of [...revalidateListeners.current]) recheck()
  }, [selectedModelOption, selectedModelValue])
  const observeSelectionChanges = React.useCallback((recheck: () => void) => {
    revalidateListeners.current.add(recheck)
    return () => { revalidateListeners.current.delete(recheck) }
  }, [])
  const defaultsReady = React.useSyncExternalStore(
    subscribeGenerationModelDefaults,
    generationModelDefaultsLoaded,
    generationModelDefaultsLoaded,
  )
  React.useEffect(() => {
    void loadGenerationModelDefaults()
  }, [])

  // ① 新卡初始化（及单能力默认模型切模式自动回退 + 自动态模型实时同源同步）
  React.useEffect(() => {
    if (!isGenerationNode) return
    const latestNode = getLatestNode()
    const status = latestNode.status || 'idle'
    if (status === 'queued' || status === 'running') return
    const latestMeta = latestNode.meta || {}
    const isAutoMeta = latestMeta.modelAuto === true
    const isFromDefault = latestMeta.modelFromDefault === true

    if (selectedModelValue) {
      // 只有处于「自动」态，或继承了设置里的单能力默认模型但当前模式不支持它的空闲卡，才由自动真源重算。
      if (!isAutoMeta && !(isFromDefault && !selectedModelOption)) return
      const mediaKind = deriveGenerationDefaultMediaKind({ isImageLike, isVideoLike })
      if (!mediaKind) return
      const taskKind = deriveGenerationDefaultTaskKind({
        isImageLike,
        isVideoLike,
        hasImageReference: nodeHasImageReference(latestMeta),
      })
      const preferred = isFromDefault ? resolveDefaultModelOption(modelOptions, getGenerationModelDefaults(), taskKind) : undefined
      const autoResolved = preferred
        ? null
        : resolveAutoGenerationModel({
            mediaKind,
            options: modelOptions,
            orderedVendorKeys,
            isAiling: isModelRecentlyAiling,
          })
      const nextOption = preferred ?? autoResolved?.option
      if (!nextOption?.value) return
      const nextVendor = nextOption.vendor || null
      const nextKey = nextOption.modelKey || nextOption.value
      const nextAutoFlag = !preferred
      const currentVendor = readMeta(latestMeta, 'modelVendor') || readMeta(latestMeta, 'vendor') || null
      if (selectedModelValue === nextKey && currentVendor === nextVendor && Boolean(latestMeta.modelAuto) === nextAutoFlag) {
        return
      }
      const nextArchetype = resolveArchetypeForOption(nextOption, { variantId: undefined, modelId: nextOption.modelKey })
      const modelMeta = replaceCustomCapabilityContractMeta(latestMeta, nextOption.meta)
      let syncedMeta = projectParameterReferenceSlots({
        ...modelMeta,
        modelKey: nextKey,
        modelAlias: nextOption.modelAlias || nextOption.value,
        modelVendor: nextVendor,
        vendor: nextVendor,
        modelLabel: nextOption.label,
        modelAuto: nextAutoFlag,
        ...(isVideoLike
          ? { videoModel: nextOption.value, videoModelVendor: nextVendor }
          : { imageModel: nextOption.value, imageModelVendor: nextVendor }),
      }, nextOption.meta)
      if (nextArchetype) {
        syncedMeta = initializedArchetypeMeta(syncedMeta, nextArchetype) || syncedMeta
      }
      writeDerivedMeta(node.id, { meta: syncedMeta })
      return
    }

    const candidateIdentity = readCandidateNodeIdentity(latestMeta)
    if (candidateIdentity?.modelKey) {
      useToastStore.getState().push({
        id: nodeRecoveryToastId(node.id),
        occurrence: `candidate-unavailable:${candidateIdentity.modelVendor}:${candidateIdentity.modelKey}`,
        reason: 'candidate-model-unavailable',
        type: 'warning',
        ttl: false,
        message: t('generationCommon.node.candidateModelUnavailable', {
          model: candidateIdentity.modelKey,
          vendor: candidateIdentity.modelVendor || '—',
        }),
        validWhile: nodeNoticeValidity({ nodeId: node.id, holds: candidateNoticeStillHolds }),
      })
      return
    }
    if (!defaultsReady) return
    const mediaKind = deriveGenerationDefaultMediaKind({ isImageLike, isVideoLike })
    const taskKind = deriveGenerationDefaultTaskKind({
      isImageLike,
      isVideoLike,
      hasImageReference: nodeHasImageReference(latestMeta),
    })
    const preferred = resolveDefaultModelOption(modelOptions, getGenerationModelDefaults(), taskKind)
    const autoResolved = !preferred && mediaKind
      ? resolveAutoGenerationModel({
          mediaKind,
          options: modelOptions,
          orderedVendorKeys,
          isAiling: isModelRecentlyAiling,
        })
      : null
    const firstOption = preferred ?? autoResolved?.option ?? chooseDefaultModelOption(modelOptions, isImageLike, isVideoLike)
    if (!firstOption?.value) return
    const firstControls = buildModelControls(firstOption.meta, isImageLike, isVideoLike)
    const explicitAspect = isVideoLike && latestMeta[ASPECT_EXPLICIT_META_KEY] === true
    const defaultPatch = defaultPatchForControls(explicitAspect ? firstControls.filter(control => !isAspectRatioControl(control)) : firstControls)
    const canvas = useGenerationCanvasStore.getState()
    const firstArchetype = resolveArchetypeForOption(firstOption, { variantId: undefined, modelId: firstOption.modelKey })
    const modelMeta = replaceCustomCapabilityContractMeta(latestMeta, firstOption.meta)
    let defaultMeta = projectParameterReferenceSlots({
      ...modelMeta,
      modelKey: firstOption.modelKey || firstOption.value,
      modelAlias: firstOption.modelAlias || firstOption.value,
      modelVendor: firstOption.vendor || null,
      vendor: firstOption.vendor || null,
      modelLabel: firstOption.label,
      ...(mediaKind ? { modelAuto: !preferred, modelFromDefault: Boolean(preferred) } : {}),
      ...defaultPatch,
      ...(isVideoLike
        ? { videoModel: firstOption.value, videoModelVendor: firstOption.vendor || null }
        : { imageModel: firstOption.value, imageModelVendor: firstOption.vendor || null }),
    }, firstOption.meta)
    if (firstArchetype) {
      defaultMeta = initializedArchetypeMeta(defaultMeta, firstArchetype) || defaultMeta
    }
    if (isVideoLike && !explicitAspect) {
      const nextNode = { ...latestNode, meta: defaultMeta }
      const nextGraph = { nodes: canvas.nodes.map((item) => (item.id === node.id ? nextNode : item)), edges: canvas.edges }
      const firstMode = firstArchetype ? resolveRenderedMode(firstOption, defaultMeta, true, { node: nextNode, graph: nextGraph }) : null
      const modeControls = firstArchetype
        ? resolveRenderedControls(firstOption, defaultMeta, isImageLike, true, { node: nextNode, graph: nextGraph })
        : []
      const aspectControls = modeControls.some(isAspectRatioControl) ? modeControls : firstControls
      const aspectPatch = videoAspectSeedPatch({
        nodeId: node.id,
        nodes: nextGraph.nodes,
        edges: canvas.edges,
        controls: aspectControls,
        meta: latestMeta,
        mode: firstMode,
        respectExplicit: false,
      })
      defaultMeta = applyVideoAspectSeed(defaultMeta, aspectPatch)
    }
    writeDerivedMeta(node.id, { meta: defaultMeta })
  }, [defaultsReady, getLatestNode, isGenerationNode, isImageLike, isVideoLike, modelOptions, node.id, orderedVendorKeys, selectedModelOption, selectedModelValue, t, writeDerivedMeta])

  React.useEffect(() => {
    if (!isGenerationNode || !selectedModelOption) return
    const optionVendor = typeof selectedModelOption.vendor === 'string' ? selectedModelOption.vendor.trim() : ''
    const latestMeta = getLatestMeta()
    const currentVendor =
      readMeta(latestMeta, 'modelVendor') ||
      readMeta(latestMeta, 'vendor') ||
      readMeta(latestMeta, isVideoLike ? 'videoModelVendor' : 'imageModelVendor')
    if (!optionVendor || (currentVendor && currentVendor !== optionVendor)) return
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

  React.useEffect(() => {
    if (!isGenerationNode || !selectedModelValue) return
    if (selectedModelOption) return
    const latestMeta = getLatestMeta()
    const sourceArchetype = resolveModelArchetype({
      modelKey: selectedModelValue,
      modelAlias: readMeta(latestMeta, 'modelAlias'),
      vendorKey: readMeta(latestMeta, 'modelVendor') || readMeta(latestMeta, 'vendor'),
      meta: latestMeta,
    }, { variant: variantRecordedInMeta(latestMeta, latestMeta.modelKey) })
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

  React.useEffect(() => {
    if (!isGenerationNode || !selectedModelValue) return
    const latestNode = getLatestNode()
    const failed = failedAttemptOf(latestNode)
    const report = failed && failureDescribesCurrentSelection(latestNode, failed) ? classifyGenerationError(failed.error) : null
    const failure = report?.vendorSide ? report : null
    if (selectedModelOption && !failure) return
    const latestMeta = getLatestMeta()
    // 自动态或继承默认态在空闲切模式时由 effect ① 自动切到当前可用推荐模型，不误报「供应商已断开」。
    if (!failure && (latestMeta.modelAuto === true || latestMeta.modelFromDefault === true) && modelOptions.length > 0) return
    const currentVendor = readMeta(latestMeta, 'modelVendor') || readMeta(latestMeta, 'vendor')
    const sourceVendor = failure && failed ? failed.vendorKey : currentVendor
    const sourceVendorLabel = vendorLabelFor(modelOptions, sourceVendor)
    const sourceArchetype = resolveModelArchetype({
      modelKey: selectedModelValue,
      modelAlias: readMeta(latestMeta, 'modelAlias'),
      vendorKey: sourceVendor,
      meta: latestMeta,
    }, { variant: variantRecordedInMeta(latestMeta, latestMeta.modelKey) })
    if (!sourceArchetype) return
    const alternatives = modelOptions.filter((option) => option.vendor !== sourceVendor)
    const target =
      alternatives.find((option) => resolveArchetypeForOption(option, { variantId: undefined, modelId: option.modelKey })?.id === sourceArchetype.id) ||
      alternatives.find((option) => resolveArchetypeForOption(option, { variantId: undefined, modelId: option.modelKey })?.family === sourceArchetype.family)
    const optionVendor = typeof target?.vendor === 'string' ? target.vendor.trim() : ''
    if (!target?.value || !optionVendor) return
    const targetArchetype = resolveArchetypeForOption(target, { variantId: undefined, modelId: target.modelKey })
    const sourceModel = readMeta(latestMeta, 'modelAlias') || readMeta(latestMeta, 'modelKey') || selectedModelValue
    const pinned = { vendorKey: currentVendor, modelKey: selectedModelKey(latestNode) }
    useToastStore.getState().push({
      id: nodeRecoveryToastId(node.id),
      occurrence: failure && failed ? failed.occurrence : `disconnected:${currentVendor}:${sourceModel}`,
      reason: failure ? failure.kind : 'provider-disconnected',
      type: 'warning',
      ttl: false,
      message: failure
        ? t('generationCommon.node.providerFailed', providerFailedValues(sourceVendorLabel, failure))
        : t('generationCommon.node.providerDisconnected', { vendor: sourceVendorLabel }),
      actionLabel: t('generationCommon.node.switchProvider', { model: target.label, vendor: target.vendorName }),
      validWhile: nodeNoticeValidity({
        nodeId: node.id,
        holds: failure && failed
          ? (current) => failureNoticeStillHolds(current, failed)
          : (current) => disconnectionNoticeStillHolds(current, pinned, selectionMissingRef.current),
        alsoRecheckOn: observeSelectionChanges,
      }),
      onAction: () => {
        const current = getLatestMeta()
        if (readMeta(current, 'modelVendor') !== readMeta(latestMeta, 'modelVendor')
          || readMeta(current, 'modelKey') !== readMeta(latestMeta, 'modelKey')) return
        const carried = targetArchetype ? carryHumanModePreference(current, sourceArchetype, targetArchetype) : current
        updateNode(node.id, {
          meta: {
            ...replaceCustomCapabilityContractMeta(carried, target.meta),
            modelKey: target.modelKey || target.value,
            modelAlias: target.modelAlias || target.value,
            modelVendor: optionVendor,
            vendor: optionVendor,
            modelLabel: target.label,
            modelAuto: false,
            modelFromDefault: false,
            ...(isVideoLike
              ? { videoModel: target.value, videoModelVendor: optionVendor }
              : { imageModel: target.value, imageModelVendor: optionVendor }),
          },
        })
      },
    })
  }, [
    getLatestMeta,
    getLatestNode,
    isGenerationNode,
    isVideoLike,
    modelOptions,
    node.id,
    node.status,
    node.error,
    node.runs,
    observeSelectionChanges,
    selectedModelOption,
    selectedModelValue,
    t,
    updateNode,
  ])

  React.useEffect(() => {
    if (!isGenerationNode || !archetype) return
    const latestNode = getLatestNode()
    const latestModelKey = typeof latestNode.meta?.modelKey === 'string' ? latestNode.meta.modelKey : ''
    if (selectedModelOption && latestModelKey
      && ![selectedModelOption.modelKey, selectedModelOption.value, selectedModelOption.modelAlias].includes(latestModelKey)) return
    const initialized = initializedArchetypeMeta(latestNode.meta || {}, archetype)
    if (initialized) writeDerivedMeta(node.id, { meta: initialized })
  }, [archetype, getLatestNode, isGenerationNode, node.id, selectedModelOption, writeDerivedMeta])
}
