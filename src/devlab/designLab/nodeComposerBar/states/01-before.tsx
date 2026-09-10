// 现状（before）两格：视频节点、图片节点各一。
// 这两格渲染的是**现役** NodeGenerationComposer 本体，不是照着它画的——用户要判断的
// 「挤不挤、截没截断」必须来自真身，样张画的挤是画出来的挤。
import React from 'react'
import { ComposerBarBeforeStage } from '../nodeComposerBarLabKit'
import type { LabState } from '../../labScreen'

const SOURCE = 'docs/design/2026-09-10-node-composer-bar-v1.md §现状'
const MIRRORS = [
  'src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx:406',
  'src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:639',
]

export const COMPOSER_BAR_BEFORE_STATES: readonly LabState[] = [
  {
    id: 'composer-bar-before-video',
    name: '现状 · 视频节点底栏（9 件挤一行）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    scheme: 'light',
    render: () => <ComposerBarBeforeStage kind="video" />,
  },
  {
    id: 'composer-bar-before-image',
    name: '现状 · 图片节点底栏（7 件）',
    source: SOURCE,
    mirrors: MIRRORS,
    coverage: 'shell',
    scheme: 'light',
    render: () => <ComposerBarBeforeStage kind="image" />,
  },
]
