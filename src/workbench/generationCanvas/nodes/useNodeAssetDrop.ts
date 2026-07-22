// 拖文件到生成节点 composer → 加为参考（规范「三来源 + 两捷径」之捷径 A）。
// 挂在 NodeGenerationComposer 卡的定位锚上：onDragOver 高亮 + onDrop 写入。
// must-fix（对抗评审）：① 桌面文件走上传管线拿 hosted URL，别塞 data:（发送 resolver 会丢）；
// ② stopPropagation + preventDefault，否则冒泡到 stage.handleStageDrop 会新建独立 asset 卡；
// ③ 统一经 addAssetUrlToNode 单源写入（含去重/上限）。
import React from 'react'
import i18n from '../../../i18n'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { importWorkbenchLocalAssetFile } from '../../api/assetUploadApi'
import { assetUrl } from './controls/parameterControlModel'
import { showInfoToast } from '../../../utils/showInfoToast'
import {
  WORKSPACE_FILE_DRAG_MIME,
  buildWorkspaceFileUrl,
  parseWorkspaceFileDrag,
} from '../../explorer/workspaceFileDrag'
import { dropKindFromMime, dropKindFromWorkspaceKind, resolveNodeArraySlots } from '../model/nodeAssetDrop'
import { type AddAssetOutcome, addAssetUrlToNode } from './nodeAssetWrite'

type DropHandlers = {
  onDragOver: (event: React.DragEvent<HTMLElement>) => void
  onDragLeave: (event: React.DragEvent<HTMLElement>) => void
  onDrop: (event: React.DragEvent<HTMLElement>) => void
}

export type NodeAssetDrop = {
  /** 该节点当前模式是否有数组参考槽——无则不接管拖拽（不给非参考节点误高亮）。 */
  acceptsDrop: boolean
  isDragOver: boolean
  isUploading: boolean
  dropHandlers: DropHandlers
}

function reportOutcome(outcome: AddAssetOutcome): void {
  if (outcome.status === 'full') {
    showInfoToast(i18n.t('generationCommon.node.assetDrop.full', { max: outcome.max, label: outcome.label }))
  } else if (outcome.status === 'no-slot') {
    showInfoToast(i18n.t('generationCommon.node.assetDrop.noSlot'))
  }
}

export function useNodeAssetDrop(node: GenerationCanvasNode): NodeAssetDrop {
  const [isDragOver, setDragOver] = React.useState(false)
  const [isUploading, setUploading] = React.useState(false)
  const acceptsDrop = React.useMemo(() => resolveNodeArraySlots(node.meta).length > 0, [node.meta])

  const onDragOver = React.useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!acceptsDrop) return
      const types = Array.from(event.dataTransfer.types || [])
      if (!types.includes('Files') && !types.includes(WORKSPACE_FILE_DRAG_MIME)) return
      event.preventDefault()
      event.stopPropagation() // 不冒泡到 stage（否则松手会新建独立 asset 卡）
      event.dataTransfer.dropEffect = 'copy'
      setDragOver(true)
    },
    [acceptsDrop],
  )

  const onDragLeave = React.useCallback((event: React.DragEvent<HTMLElement>) => {
    // 进入子元素不算离开（relatedTarget 仍在卡内）。
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setDragOver(false)
  }, [])

  const onDrop = React.useCallback(
    async (event: React.DragEvent<HTMLElement>) => {
      if (!acceptsDrop) return
      event.preventDefault()
      event.stopPropagation()
      setDragOver(false)
      const dt = event.dataTransfer

      // ① 项目文件树拖入：文件已在项目里，用 nomi-local 协议引用，无需上传。
      const workspace = parseWorkspaceFileDrag(dt.getData(WORKSPACE_FILE_DRAG_MIME))
      if (workspace) {
        const kind = dropKindFromWorkspaceKind(workspace.kind)
        if (!kind) {
          showInfoToast(i18n.t('generationCommon.node.assetDrop.noSlot'))
          return
        }
        reportOutcome(
          addAssetUrlToNode(node.id, kind, buildWorkspaceFileUrl(workspace.projectId, workspace.relativePath)),
        )
        return
      }

      // ② OS 文件拖入：上传拿 hosted URL（must-fix：别塞 data:）。可多文件，逐个上传 + 写入。
      const files = Array.from(dt.files || [])
      if (!files.length) return
      setUploading(true)
      try {
        for (const file of files) {
          const kind = dropKindFromMime(file.type)
          if (!kind) {
            showInfoToast(i18n.t('generationCommon.node.assetDrop.unsupported'))
            continue
          }
          try {
            const uploaded = await importWorkbenchLocalAssetFile(
              file,
              file.name || i18n.t('generationCommon.node.assetDrop.defaultName'),
              {
                ownerNodeId: node.id,
                taskKind: 'image_edit',
              },
            )
            const url = assetUrl(uploaded)
            if (!url) throw new Error(i18n.t('generationCommon.node.assetDrop.missingUrl'))
            reportOutcome(addAssetUrlToNode(node.id, kind, url))
          } catch (error) {
            showInfoToast(
              error instanceof Error ? error.message : i18n.t('generationCommon.node.assetDrop.uploadFailed'),
            )
          }
        }
      } finally {
        setUploading(false)
      }
    },
    [acceptsDrop, node.id],
  )

  return { acceptsDrop, isDragOver, isUploading, dropHandlers: { onDragOver, onDragLeave, onDrop } }
}
