// 「画布 · 节点生成浮框底栏」五格：视频（运镜未选 / 已选）、图片、明暗各一。
// 每一格渲染的都是**现役** BaseGenerationNode + NodeGenerationComposer 本体——2026-09-11
// 拍板的 v1.1 与同日 02:10 拍板的 B（逐参数下拉 chip + ⚙）都已接线，
// 这一屏钉的就是它真身的样子（coverage: 'shell'）；改了真身，这一屏跟着变，不需要在这里画第二遍。
//
// 格 id 保持样张阶段的名字不变：截图文件名是拍板对账的锚点，改名等于把前几版的对账线索弄丢。
import React from 'react'
import { ComposerBarStage } from '../nodeComposerBarLabKit'
import type { LabState } from '../../labScreen'

const SOURCE = 'docs/design/2026-09-10-node-composer-bar-v1.md §B（逐参数下拉）'
const MIRRORS = [
  'src/workbench/generationCanvas/nodes/InlineParameterBar.tsx:78',
  'src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx:414',
  'src/workbench/generationCanvas/nodes/NodePromptToolCluster.tsx:22',
  'src/workbench/generationCanvas/nodes/NodeFloatingToolbar.tsx:26',
]

export const COMPOSER_BAR_STATES: readonly LabState[] = [
  {
    id: 'composer-bar-v1-video',
    name: 'B · 视频节点（比例 / 时长 / 清晰度各一颗下拉 + ⚙）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    scheme: 'light',
    render: () => <ComposerBarStage kind="video" />,
  },
  {
    id: 'composer-bar-v1-video-camera',
    name: 'B · 视频节点（运镜已选 · icon 带激活点）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    scheme: 'light',
    render: () => <ComposerBarStage kind="video" cameraPicked />,
  },
  {
    id: 'composer-bar-v1-image',
    name: 'B · 图片节点（无运镜；参数 chip 按档案只剩图有的那几颗）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    scheme: 'light',
    render: () => <ComposerBarStage kind="image" />,
  },
  {
    id: 'composer-bar-v1-video-dark',
    name: 'B · 视频节点 · 暗',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    scheme: 'dark',
    render: () => <ComposerBarStage kind="video" cameraPicked />,
  },
  {
    id: 'composer-bar-v1-image-dark',
    name: 'B · 图片节点 · 暗',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    scheme: 'dark',
    render: () => <ComposerBarStage kind="image" />,
  },
]
