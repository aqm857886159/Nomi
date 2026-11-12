// 「模型｜方式｜参数」底栏（2026-11-12 样张 A–J）。每一格都是现役 `BaseGenerationNode` + `NodeGenerationComposer` 本体，
// 方式格、方式菜单、行尾那句话都是生产组件按唯一 owner modeForInputs 现算出来的，取景台只灌节点和参考。
// 格 id 的字母对应样张字母（mb-a…mb-j），拍板对账时一眼对得上；英文 / 暗色由证据脚本加 `?lang=en` `?scheme=dark` 再截一遍。
import React from 'react'
import { ComposerB3Stage, type B3Scenario } from '../nodeComposerB3LabKit'
import type { LabState } from '../../labScreen'

const SOURCE = 'docs/design/boards/2026-11-12-mode-bar/ModeBar.board.json（样张 A–J）'
const MIRRORS = [
  'src/workbench/generationCanvas/nodes/InlineParameterBar.tsx:456',
  'src/workbench/generationCanvas/nodes/NodeParameterControls.tsx:572',
  'src/workbench/generationCanvas/nodes/controls/referenceRowTail.tsx:1',
]
const PROMPT = '她从清晨的码头走到傍晚的海堤，镜头缓慢推近。'
const stage = (scenario: B3Scenario): (() => React.JSX.Element) => () => <ComposerB3Stage scenario={scenario} />

export const COMPOSER_MODE_BAR_STATES: readonly LabState[] = [
  {
    id: 'mb-a-no-input-menu',
    name: 'A · 没放图：方式格写「文生视频」，点开带图的三种置灰并说要放什么',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ kind: 'video', model: 'seedance25Apimart', open: 'mode' }),
  },
  {
    id: 'mb-b-one-image-menu',
    name: 'B · 放了 1 张：自动按全能参考，另外两种带图方式都能点',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ kind: 'video', model: 'seedance25Apimart', arrayRefs: ['海边清晨'], prompt: PROMPT, open: 'mode' }),
  },
  {
    id: 'mb-c-first-last-params',
    name: 'C · 手选首尾帧（2 张）：参数面板只剩这种方式用得上的参数，没有「生成方式」',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ kind: 'video', model: 'seedance25Apimart', modeId: 'firstlast', frames: { first: '海边清晨', last: '海边傍晚' }, prompt: PROMPT, open: 'params' }),
  },
  {
    id: 'mb-d-third-image',
    name: 'D · 手选首尾帧后放到第 3 张：自动改成全能参考，行尾说一句',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'video', model: 'seedance25Apimart', arrayRefs: ['海边清晨', '海边傍晚', '树林'], modeSwitchNotice: { modeId: 'omni', count: 3 }, prompt: PROMPT }),
  },
  {
    id: 'mb-d-third-image-menu',
    name: 'D · 同上点开方式菜单：放不下的方式置灰并报数',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ kind: 'video', model: 'seedance25Apimart', arrayRefs: ['海边清晨', '海边傍晚', '树林'], modeSwitchNotice: { modeId: 'omni', count: 3 }, prompt: PROMPT, open: 'mode' }),
  },
  {
    id: 'mb-f-kling-menu',
    name: 'F · 换模型菜单跟着换：可灵 4.0 只有文生视频、图生视频两种',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ kind: 'video', model: 'kling4', open: 'mode' }),
  },
  {
    id: 'mb-h-image-node',
    name: 'H · 图片节点放了图：没有方式格，行尾「参考图 1 张 · 按图改」',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'image', model: 'gpt-image', arrayRefs: ['女主肖像'], prompt: '把背景换成雪夜，人物不变。' }),
  },
  {
    id: 'mb-i-remove-menu',
    name: 'I · 删回 2 张不自己跳回：还是全能参考，首尾帧又能点了',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ kind: 'video', model: 'seedance25Apimart', arrayRefs: ['海边清晨', '海边傍晚'], prompt: PROMPT, open: 'mode' }),
  },
  {
    id: 'mb-j-model-limit',
    name: 'J · 换到放不下的模型（可灵 4.0 最多 2 张，放了 3 张）：多出的变淡标「不会发」，行尾报数，照样能发',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'video', model: 'kling4', arrayRefs: ['海边清晨', '海边傍晚', '树林'], prompt: PROMPT }),
  },
]
