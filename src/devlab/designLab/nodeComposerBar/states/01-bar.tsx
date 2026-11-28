// 「画布 · 节点生成浮框底栏」：视频、图片、明暗各一，外加点开之后那一层（面板 / 单参数直出）。
// 前几格渲染的都是**现役** BaseGenerationNode + NodeGenerationComposer 本体（coverage: 'shell'）——
// 2026-09-11 拍板的 v1.1 已接线，参数区是摘要 pill：同日 02:10 的逐参数 chip 于 04:30 被用户收回，
// **画布节点保持原样**。改了真身，这一屏跟着变，不需要在这里画第二遍。
// 原来的第六格「chips 模式（付费卡用）」随 D2 旧付费卡一起删了（付费卡上不再挂参数控件）。
//
// 格 id 保持样张阶段的名字不变：截图文件名是拍板对账的锚点，改名等于把前几版的对账线索弄丢。
import React from 'react'
import { ComposerBarStage, ParamPanelStage } from '../nodeComposerBarLabKit'
import type { LabState } from '../../labScreen'

const SOURCE = 'docs/design/2026-09-10-node-composer-bar-v1.md §v1.1（摘要 pill + 统一面板）'
const FLAT_SOURCE = 'docs/design/2026-09-10-node-composer-bar-v1.md §v1.2（面板里选项摊开 · 单参数直出）'
const MIRRORS = [
  'src/workbench/generationCanvas/nodes/InlineParameterBar.tsx:45',
  'src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx:420',
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
  // ── v1.2：点开之后那一层（2026-09-11 13:00 用户真机拍板「点好几次」）──────────────
  // 浮层 portal 到 body、不在舞台子树里，所以这两格必须截整屏（capture: 'viewport'）。
  {
    id: 'composer-bar-panel-flat-options',
    name: 'v1.2 · 参数面板展开：选项全摊开，一个下拉都没有（比例带图形 / 清晰度 / 时长滑杆）',
    source: FLAT_SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/NodeParameterControls.tsx:663',
    coverage: 'component-only',
    capture: 'viewport',
    scheme: 'light',
    render: () => <ParamPanelStage kind="video-panel" />,
  },
  {
    id: 'composer-bar-panel-solo-direct',
    name: 'v1.2 · 只有一个参数（Agnes Image 只声明「尺寸」）：点 pill 一步直出选项，没有面板壳',
    source: FLAT_SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/NodeParameterControls.tsx:663',
    coverage: 'component-only',
    capture: 'viewport',
    scheme: 'light',
    render: () => <ParamPanelStage kind="image-solo" />,
  },
]
