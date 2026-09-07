import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import { EditableNodeTitle } from './render/EditableNodeTitle'

// 注：这里原本还有 NodeImagePreviewButton（body-portal 大图）和 NodeResultHeaderActions
// （卡片右上角那两颗 bg-nomi-paper/[0.82] 半透明**常驻**按钮：放大 + 生成记录）。
// 2026-08-04 §1.5「动作不许压在内容上」落地时删除：
//   · 「放大」和图片浮条的「全屏」本就重复，而且是两套不同实现（body portal vs 画布 portal）。
//     留画布 portal 那套（NodeMediaPreviewDialog）——它图/视频都支持、带视频自愈，
//     且 portal 到画布区是有意设计（只覆盖红框区、能压住区域内的助手和时间轴把手）。
//   · 「生成记录」是 ProvenancePanel 的唯一入口，不能删，已迁进浮动工具栏
//     （ToolbarProvenanceButton，一份定义四处复用）。⚠️ 那条工具栏是**选中**才出、不是 hover 才出。
// 本文件只剩下面这个内联标题——它是标题不是动作，且本来就 hover/选中才显形，不遮画面。

export function NodeInlineImageTitle({
  nodeId,
  value,
  selected,
}: {
  nodeId: string
  value: string
  selected: boolean
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'absolute bottom-2 left-2 z-[4] max-w-[calc(100%-72px)] rounded-nomi-sm px-2 py-1',
        'bg-nomi-ink/85 text-nomi-paper shadow-nomi-sm backdrop-blur-[8px] pointer-events-auto',
        'transition-opacity duration-nomi-fast ease-nomi-fast',
        selected ? 'opacity-100' : 'opacity-0 group-hover/node:opacity-100 focus-within:opacity-100',
      )}
      data-node-inline-title="true"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <EditableNodeTitle
        nodeId={nodeId}
        value={value}
        placeholder={t('generationCommon.imagePreview.untitled')}
        className="max-w-full text-caption font-semibold text-nomi-paper"
      />
    </div>
  )
}
