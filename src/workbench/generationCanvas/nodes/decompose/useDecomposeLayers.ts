// 「元素拆解」交互编排（从工具条抽出，别喂巨壳 R9）。
// 付费确认 → 调 decompose IPC 拿 N 张远端图层 → 逐张落地成 nomi-local（同 removeBackground）→
// 组装白板态。工具条据 decomposeState 打开 WhiteboardModal(sourceKind:'image')，关闭时白板现成的
// 「截图合成回主图」完成闭环。
import React from 'react'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import type { WhiteboardState } from '../whiteboard/whiteboardTypes'
import { inferWhiteboardAspectRatio } from '../whiteboard/whiteboardState'
import { buildLayerWhiteboardState } from './buildLayerWhiteboard'
import { confirmAndMintGrant, describeGenerationCost, generationCostContextForNode } from '../../spend/spendConfirm'
import { getDesktopBridge } from '../../../../desktop/bridge'
import { isProjectExecutionContextCurrent, withProjectAction } from '../../../project/projectCanvasReadSurface'
import { listWorkbenchModelCatalogVendors } from '../../../api/modelCatalogApi'
import { confirmDialog } from '../../../../design/confirmDialogStore'
import i18n from '../../../../i18n'
import { isVendorOfBuiltin } from '../../../../../electron/shared/builtinVendorIdentity'

/**
 * 没接 Replicate 时不甩死胡同错误，而是引导去「模型接入」（那里已有 Replicate 卡：官网链接 +
 * 「登录 Replicate → Account → API tokens 拿 r8_ token」提示）。返回 true=已接入可继续。
 */
async function ensureReplicateConnectedOrGuide(): Promise<boolean> {
  const vendors = await listWorkbenchModelCatalogVendors().catch(() => [])
  // #831：同域名可以有多条 Replicate 连接，身份经 lineage 解析，不比 key 字面量。
  const replicate = vendors.find((v) => isVendorOfBuiltin(vendors, v.key, 'replicate'))
  if (replicate?.enabled && replicate.hasApiKey) return true
  const go = await confirmDialog({
    title: i18n.t('generationCommon.decompose.connectTitle'),
    message: i18n.t('generationCommon.decompose.connectMessage'),
    confirmLabel: i18n.t('generationCommon.decompose.connect'),
    cancelLabel: i18n.t('generationCommon.decompose.later'),
  })
  if (go) window.dispatchEvent(new CustomEvent('nomi-open-model-catalog'))
  return false
}

const DECOMPOSE_LAYERS = 6

export type DecomposeLayersController = {
  decomposeBusy: boolean
  decomposeState: WhiteboardState | null
  runDecompose: () => Promise<void>
  clearDecompose: () => void
}

export function useDecomposeLayers(node: GenerationCanvasNode, imageUrl: string, reportFeedback: (message: string) => void): DecomposeLayersController {
  const [decomposeBusy, setDecomposeBusy] = React.useState(false)
  const [decomposeState, setDecomposeState] = React.useState<WhiteboardState | null>(null)

  const runDecompose = React.useCallback(async () => {
    reportFeedback('')
    if (!imageUrl || decomposeBusy) return
    // 拆图层动作起点签发原项目。付费产出的图层按原项目落进它的素材库（显式项目 IO，不因切项目丢钱）；
    // 白板状态只在原项目仍打开时回写，换了项目不弹到新项目里。
    const project = withProjectAction((issued) => issued)
    if (!project) return
    // 先确保 Replicate 已接入，否则引导去接入（不甩死胡同错误）。
    if (!(await ensureReplicateConnectedOrGuide())) return
    const grantId = await confirmAndMintGrant({
      nodeIds: [node.id],
      nodes: [{ meta: { modelVendor: 'replicate', modelKey: 'qwen/qwen-image-layered' } }],
      title: i18n.t('generationCommon.decompose.title'),
      message: `${describeGenerationCost(1, 'image', generationCostContextForNode(node, project.binding.projectId))}${i18n.t('generationCommon.decompose.costSuffix')}`,
      confirmLabel: i18n.t('generationCommon.decompose.confirm'),
      initiator: 'user',
    })
    if (!grantId || !isProjectExecutionContextCurrent(project)) return
    setDecomposeBusy(true)

    try {
      const bridge = getDesktopBridge()
      if (!bridge) throw new Error(i18n.t('generationCommon.decompose.desktopUnavailable'))
      // 主进程已就地把图层落盘成 nomi-local（传 projectId 触发），渲染层拿到即用、秒开白板。
      const { layers } = await bridge.image.decomposeLayers({
        nodeId: node.id,
        imageUrl,
        numLayers: DECOMPOSE_LAYERS,
        grantId,
        projectId: project.binding.projectId,
      })
      if (!isProjectExecutionContextCurrent(project)) return
      if (!layers || layers.length === 0) throw new Error(i18n.t('generationCommon.decompose.noLayers'))
      const ratio = inferWhiteboardAspectRatio(node.meta?.imageWidth, node.meta?.imageHeight)
      setDecomposeState(buildLayerWhiteboardState(layers, ratio))

    } catch (error) {
      if (!isProjectExecutionContextCurrent(project)) return
      reportFeedback(error instanceof Error && error.message ? error.message : i18n.t('generationCommon.decompose.failed'))
    } finally {
      if (isProjectExecutionContextCurrent(project)) setDecomposeBusy(false)
    }
  }, [decomposeBusy, imageUrl, node, reportFeedback])

  const clearDecompose = React.useCallback(() => setDecomposeState(null), [])

  return { decomposeBusy, decomposeState, runDecompose, clearDecompose }
}
