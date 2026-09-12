// 「画布 · 节点生成浮框底栏」六格：视频、图片、明暗各一，
// 外加一格「chips 模式（付费卡用）」。
// 前五格渲染的都是**现役** BaseGenerationNode + NodeGenerationComposer 本体（coverage: 'shell'）——
// 2026-09-11 拍板的 v1.1 已接线，参数区是摘要 pill：同日 02:10 的逐参数 chip 于 04:30 被用户收回，
// **画布节点保持原样**，chip 只给付费确认卡。改了真身，这一屏跟着变，不需要在这里画第二遍。
// 第六格是那第二种摆法的陈列（同一个组件 + 一个属性）；它的生产宿主是付费确认卡
// （`NodeGenerationComposer host="panel"`，#736 合入后进来的），整件的样子在 v4 屏那几格。
//
// 格 id 保持样张阶段的名字不变：截图文件名是拍板对账的锚点，改名等于把前几版的对账线索弄丢。
import React from 'react'
import { ChipsModeStage, ComposerBarStage } from '../nodeComposerBarLabKit'
import type { LabState } from '../../labScreen'

const SOURCE = 'docs/design/2026-09-10-node-composer-bar-v1.md §v1.1（摘要 pill + 统一面板）'
const CHIPS_SOURCE = 'docs/design/2026-09-10-node-composer-bar-v1.md §B（逐参数下拉 · 只给付费确认卡）'
const MIRRORS = [
  'src/workbench/generationCanvas/nodes/InlineParameterBar.tsx:109',
  'src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx:414',
  'src/workbench/generationCanvas/nodes/NodePromptToolCluster.tsx:22',
  'src/workbench/generationCanvas/nodes/NodeFloatingToolbar.tsx:26',
]

export const COMPOSER_BAR_STATES: readonly LabState[] = [
  {
    id: 'composer-bar-v1-video',
    name: 'v1.1 · 视频节点（模型 / 变体 / 参数摘要 pill）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    scheme: 'light',
    render: () => <ComposerBarStage kind="video" />,
  },
  {
    id: 'composer-bar-v1-video-camera',
    name: 'v1.1 · 视频节点（运镜写在提示词）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    scheme: 'light',
    render: () => <ComposerBarStage kind="video" />,
  },
  {
    id: 'composer-bar-v1-image',
    name: 'v1.1 · 图片节点（无运镜；摘要按档案只报比例 + 清晰度）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    scheme: 'light',
    render: () => <ComposerBarStage kind="image" />,
  },
  {
    id: 'composer-bar-v1-video-dark',
    name: 'v1.1 · 视频节点 · 暗（运镜写在提示词）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    scheme: 'dark',
    render: () => <ComposerBarStage kind="video" />,
  },
  {
    id: 'composer-bar-v1-image-dark',
    name: 'v1.1 · 图片节点 · 暗',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    scheme: 'dark',
    render: () => <ComposerBarStage kind="image" />,
  },
  {
    id: 'composer-bar-chips-mode',
    name: 'chips 模式（付费卡用）· 同一组件的 parameterLayout 属性',
    source: CHIPS_SOURCE,
    // 这个摆法的生产宿主已经进来了（#736 的付费确认卡 = `NodeGenerationComposer host="panel"`，
    // 它显式传 `parameterLayout='chips'`）。所以这一格不再是「组件有、生产没接」的零采纳件，
    // 指路牌指向那个真实调用点；它整件的样子在 v4 屏的 `v4-spend-params-*` 几格。
    mirrors: 'src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx:479',
    coverage: 'shell',
    scheme: 'light',
    render: () => <ChipsModeStage />,
  },
]
