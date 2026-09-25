import React from 'react'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { persistNodeImageFile } from './persistNodeImage'
import { isProjectExecutionContextCurrent, isProjectImportCancellation, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import { logRendererError } from '../../../desktop/rendererLog'

/**
 * 卡片 / 节点「上传一张图」的统一回调。
 *
 * 复用「拖拽导入」的成熟节奏：先用 base64 给即时预览（短命，~100ms 内被替换），
 * 紧接着把 File 落盘换成 nomi-local:// 并替换掉 base64 —— 于是【永久 base64 被消除】，
 * store 最终只留本地文件 URL。落盘失败才保留 base64 兜底（可持久化、不丢图）。
 *
 * 单一真相源：Scene/Character/Prop 三张图片卡共用此 hook，不各写一份（P1）。
 */
export function useNodeImageUpload(nodeId: string, source: string): (dataUrl: string, file: File, context: ProjectExecutionContext) => void {
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  return React.useCallback(
    (dataUrl: string, file: File, context: ProjectExecutionContext) => {
      // context 由选文件那一刻（读 FileReader 之前）捕获后传入；这里只复验，不再现取当前项目。
      if (!isProjectExecutionContextCurrent(context)) return
      const createdAt = Date.now()
      const mergeMeta = (patch: Record<string, unknown>) => {
        const current = useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId)?.meta || {}
        return { ...current, ...patch }
      }
      // 1) 即时预览（base64，短命）。
      const transient = { id: `upload-${createdAt}`, type: 'image' as const, url: dataUrl, createdAt }
      updateNode(nodeId, {
        result: transient,
        history: [transient],
        status: 'success',
        meta: mergeMeta({ source, uploadStatus: 'uploading', localOnly: true }),
      })
      // 2) 落盘 → nomi-local，替换掉 base64。
      void persistNodeImageFile(file, nodeId, context).then((localUrl) => {
        if (!isProjectExecutionContextCurrent(context)) return
        if (!localUrl) {
          updateNode(nodeId, { meta: mergeMeta({ uploadStatus: 'local-only', localOnly: true }) })
          return
        }
        const hosted = { id: `asset-${createdAt}`, type: 'image' as const, url: localUrl, createdAt }
        updateNode(nodeId, {
          result: hosted,
          history: [hosted],
          status: 'success',
          meta: mergeMeta({ source, uploadStatus: 'uploaded', localOnly: false }),
        })
      }).catch((error) => {
        if (isProjectExecutionContextCurrent(context) && !isProjectImportCancellation(error)) logRendererError('node-image-upload-failed', error)
      })
    },
    [nodeId, source, updateNode],
  )
}
