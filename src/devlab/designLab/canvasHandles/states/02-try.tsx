// 空节点「试试」（拍板 3）替换那一句操作说明；剪辑空态直说；空画布一排任务卡 = 左缘常驻那几样。
import React from 'react'
import type { LabState } from '../../labScreen'
import { EmptyCanvasStage, FIXTURES, HandlesStage } from '../canvasHandlesLabKit'

const SOURCE = '用户 10-08 拍板 ③（「试试」只搭结构不花钱，只列今天真有的能力）；设计卡 docs/plan/2026-10-08-canvas-handles.md'
const PLACEHOLDER = 'src/workbench/generationCanvas/nodes/render/CardCommon.tsx:142'

export const TRY_STATES: readonly LabState[] = [
  {
    id: 'ch-05-try-image-zh',
    name: '空图片卡「试试」：文字生图 / 参考图生图',
    source: SOURCE,
    mirrors: PLACEHOLDER,
    coverage: 'shell',
    render: () => <HandlesStage locale="zh-CN" nodes={[FIXTURES.emptyImage()]} selectedId="h-empty-image" />,
  },
  {
    id: 'ch-05-try-image-en',
    name: '空图片卡「试试」：文字生图 / 参考图生图（英文）',
    source: SOURCE,
    mirrors: PLACEHOLDER,
    coverage: 'shell',
    render: () => <HandlesStage locale="en" nodes={[FIXTURES.emptyImage()]} selectedId="h-empty-image" />,
  },
  {
    id: 'ch-05-try-image-zh-dark',
    name: '空图片卡「试试」：文字生图 / 参考图生图（暗色）',
    source: SOURCE,
    mirrors: PLACEHOLDER,
    coverage: 'shell',
    scheme: 'dark',
    render: () => <HandlesStage locale="zh-CN" nodes={[FIXTURES.emptyImage()]} selectedId="h-empty-image" />,
  },
  {
    id: 'ch-06-try-video-zh',
    name: '空视频卡「试试」：首帧生视频 / 首尾帧生视频 / 文字生视频',
    source: SOURCE,
    mirrors: PLACEHOLDER,
    coverage: 'shell',
    render: () => <HandlesStage locale="zh-CN" nodes={[FIXTURES.emptyVideo()]} selectedId="h-empty-video" />,
  },
  {
    id: 'ch-06-try-video-en',
    name: '空视频卡「试试」：首帧生视频 / 首尾帧生视频 / 文字生视频（英文）',
    source: SOURCE,
    mirrors: PLACEHOLDER,
    coverage: 'shell',
    render: () => <HandlesStage locale="en" nodes={[FIXTURES.emptyVideo()]} selectedId="h-empty-video" />,
  },
  {
    id: 'ch-07-try-text-zh',
    name: '空文本卡「试试」：写脚本 / 拿它生图 / 拿它生视频',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/render/TextDocumentNode.tsx:177',
    coverage: 'shell',
    render: () => <HandlesStage locale="zh-CN" nodes={[FIXTURES.emptyText()]} />,
  },
  {
    id: 'ch-07-try-text-en',
    name: '空文本卡「试试」：写脚本 / 拿它生图 / 拿它生视频（英文）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/render/TextDocumentNode.tsx:177',
    coverage: 'shell',
    render: () => <HandlesStage locale="en" nodes={[FIXTURES.emptyText()]} />,
  },
  {
    id: 'ch-08-empty-clip-zh',
    name: '空剪辑卡：「把视频节点连进来」+「在画布上点选」',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/ClipNodeTimeline.tsx:586',
    coverage: 'shell',
    render: () => <HandlesStage locale="zh-CN" nodes={[FIXTURES.emptyClip()]} />,
  },
  {
    id: 'ch-08-empty-clip-en',
    name: '空剪辑卡：「把视频节点连进来」+「在画布上点选」（英文）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/ClipNodeTimeline.tsx:586',
    coverage: 'shell',
    render: () => <HandlesStage locale="en" nodes={[FIXTURES.emptyClip()]} />,
  },
  {
    id: 'ch-09-empty-canvas-zh',
    name: '空画布：一排任务卡（种类 = 左缘常驻那几样，不加双击入口）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/components/CanvasEmptyState.tsx:19',
    coverage: 'shell',
    render: () => <EmptyCanvasStage locale="zh-CN" />,
  },
  {
    id: 'ch-09-empty-canvas-en',
    name: '空画布：一排任务卡（种类 = 左缘常驻那几样，不加双击入口）（英文）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/components/CanvasEmptyState.tsx:19',
    coverage: 'shell',
    render: () => <EmptyCanvasStage locale="en" />,
  },
]
