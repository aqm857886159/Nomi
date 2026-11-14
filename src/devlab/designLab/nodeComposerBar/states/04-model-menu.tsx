// 模型菜单（2026-11-12 样张 K6，用户已批；2026-11-14 落地）：每行 = 品牌图标 + 名字 + 一句按档案现算的能力描述，
// 变体（快速版 / 轻量版）各占一行，最后一行「隐藏模型 N」；底栏模型格同一枚图标。
// 一格 = 现役 `BaseGenerationNode` + `NodeGenerationComposer` 本体，目录是 APIMart 的**真**视频目录（不是编的几行），
// 好让「最多行 / 最长名 / 最长描述」来自数据本身；英文 / 暗色由证据脚本加 `?lang=en` `?scheme=dark`。
import React from 'react'
import { ComposerB3Stage, type B3Scenario } from '../nodeComposerB3LabKit'
import type { LabState } from '../../labScreen'

const SOURCE = 'docs/design/boards/2026-11-12-mode-bar/ModeBar.board.json（样张 K6）'
const MIRRORS = [
  'src/workbench/common/useDedupedModelSelect.ts:1',
  'src/design/NomiSelect.tsx:238',
  'src/workbench/generationCanvas/nodes/InlineParameterBar.tsx:456',
]
const stage = (scenario: B3Scenario): (() => React.JSX.Element) => () => <ComposerB3Stage scenario={scenario} />

export const COMPOSER_MODEL_MENU_STATES: readonly LabState[] = [
  {
    id: 'mm-a-variants-menu',
    name: 'K6 · 模型菜单：每行品牌图标 + 名字 + 一句能力描述；Seedance 2.0 的 Fast / Mini 各占一行，选中的是节点存着的 Fast；最后一行「隐藏模型」',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ kind: 'video', model: 'seedance2Apimart', catalog: 'apimart', open: 'model', prompt: '她从清晨的码头走到傍晚的海堤，镜头缓慢推近。' }),
  },
  {
    id: 'mm-b-two-vendors',
    name: 'K6 · 菜单里有两家供应商：不是默认那家的行才带供应商名（一条通用规则，组件里不写供应商名）',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ kind: 'video', model: 'seedance2Apimart', catalog: 'two-vendors', open: 'model', prompt: '她从清晨的码头走到傍晚的海堤，镜头缓慢推近。' }),
  },
]
