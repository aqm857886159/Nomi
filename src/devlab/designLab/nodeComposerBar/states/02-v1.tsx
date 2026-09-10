// v1 样张六格：视频（未选运镜 / 已选运镜）、图片、明暗各一、以及 B 簇 hover 的 tooltip 态。
//
// coverage 一律 `missing`——**这是诚实档，不是渲染失败**：v1 的排布现役一行代码都没有，
// 底栏与参考区虽是现役组件，但「锁在浮条 / B 簇在提示词框右上 / 参数 chip 只报两个值」
// 这三件现役界面走不到。标 shell 会让人以为打开 app 就长这样。
//
// ⚠️ `missing` 在走查里有专门判据（舞台必须是 missing 占位），而这几格是真渲染，
// 所以档位取 `component-only`：组件都在、界面走不到这个形态——正是这一族的定义。
import React from 'react'
import { ComposerBarV1Stage } from '../nodeComposerBarLabKit'
import type { LabState } from '../../labScreen'

const SOURCE = 'docs/design/2026-09-10-node-composer-bar-v1.md §v1'
const MIRRORS = [
  'src/workbench/generationCanvas/nodes/InlineParameterBar.tsx:194',
  'src/workbench/generationCanvas/nodes/NodeFloatingToolbar.tsx:21',
  'src/workbench/generationCanvas/nodes/NodeLockBadge.tsx:12',
]

export const COMPOSER_BAR_V1_STATES: readonly LabState[] = [
  {
    id: 'composer-bar-v1-video',
    name: 'v1 · 视频节点（运镜未选）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'component-only',
    scheme: 'light',
    render: () => <ComposerBarV1Stage kind="video" />,
  },
  {
    id: 'composer-bar-v1-video-camera',
    name: 'v1 · 视频节点（运镜已选 · icon 带激活点）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'component-only',
    scheme: 'light',
    render: () => <ComposerBarV1Stage kind="video" cameraPicked />,
  },
  {
    id: 'composer-bar-v1-image',
    name: 'v1 · 图片节点',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'component-only',
    scheme: 'light',
    render: () => <ComposerBarV1Stage kind="image" />,
  },
  {
    id: 'composer-bar-v1-video-dark',
    name: 'v1 · 视频节点 · 暗',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <ComposerBarV1Stage kind="video" cameraPicked />,
  },
  {
    id: 'composer-bar-v1-image-dark',
    name: 'v1 · 图片节点 · 暗',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <ComposerBarV1Stage kind="image" />,
  },
  {
    // tooltip 走 Radix Portal 到 body、fixed 定位，按元素截会截出「没有 tooltip」的假证据。
    id: 'composer-bar-v1-cluster-hover',
    name: 'v1 · B 簇 hover（运镜 tooltip 报已选值）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'component-only',
    scheme: 'light',
    capture: 'viewport',
    render: () => <ComposerBarV1Stage kind="video" cameraPicked tooltipFor="camera-move" />,
  },
]
