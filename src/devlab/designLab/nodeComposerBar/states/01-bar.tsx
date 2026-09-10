// 「画布 · 节点生成浮框底栏」六格：视频（运镜未选 / 已选）、图片、明暗各一，
// 外加一格「chips 模式（付费卡用）」。
// 前五格渲染的都是**现役** BaseGenerationNode + NodeGenerationComposer 本体（coverage: 'shell'）——
// 2026-09-11 拍板的 v1.1 已接线，参数区是摘要 pill：同日 02:10 的逐参数 chip 于 04:30 被用户收回，
// **画布节点保持原样**，chip 只给付费确认卡。改了真身，这一屏跟着变，不需要在这里画第二遍。
// 第六格是那第二种摆法的陈列（同一个组件 + 一个属性），本分支上还没有生产宿主 → 'component-only'。
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
    name: 'v1.1 · 视频节点（运镜已选 · icon 带激活点）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    scheme: 'light',
    render: () => <ComposerBarStage kind="video" cameraPicked />,
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
    name: 'v1.1 · 视频节点 · 暗',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    scheme: 'dark',
    render: () => <ComposerBarStage kind="video" cameraPicked />,
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
    // 付费确认卡（这个摆法真正的宿主）在权限那条分支上，本分支没有生产调用点——
    // 按 LabState.mirrors 的约定，这种「组件有、生产还没接」的格子必须显式写 'none'，
    // 不能借用上面那几条画布的行号假装它有家。
    mirrors: 'none',
    coverage: 'component-only',
    scheme: 'light',
    render: () => <ChipsModeStage />,
  },
]
