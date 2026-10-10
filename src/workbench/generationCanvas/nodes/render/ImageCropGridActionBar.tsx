import { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { DecisionBar } from '../../../../design'
import type { NodeImageEditing } from '../useNodeImageEditing'

/**
 * 切图 / 裁剪的确认条。
 *
 * 为什么单独一个文件：它必须渲染在**图片区之外**（卡片正下方），而宿主
 * `BaseGenerationNode.tsx` 是登记在案的巨壳（check:filesize 有基线、只许减不许增），
 * 所以这段不进宿主。取景框状态由浮层上报给 `useNodeImageEditing.draft`（唯一 owner），
 * 这里只读不存。（2026-10-11 用户走查 §5：确认/取消原来绝对定位在图片内部，压住了要切的格子。）
 */
export default function ImageCropGridActionBar({ editing }: { editing: NodeImageEditing }): JSX.Element | null {
  const { t } = useTranslation()
  const gridSize = editing.editGrid
  const draft = editing.draft
  if (!gridSize || !draft) return null
  const cropOnly = gridSize.rows === 1 && gridSize.cols === 1
  return (
    <div
      className="absolute inset-x-0 top-[calc(100%+8px)] z-[15] flex justify-center"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="rounded-nomi bg-nomi-paper p-1 shadow-nomi-md">
        <DecisionBar
          inline
          cancelLabel={t('generationCommon.cropGrid.cancel')}
          onCancel={editing.cancelEdit}
          primaryLabel={
            cropOnly ? t('generationCommon.cropGrid.confirmCrop') : t('generationCommon.cropGrid.confirmSplit')
          }
          onPrimary={() => {
            void editing.handleEditConfirm(draft)
          }}
        />
      </div>
    </div>
  )
}
