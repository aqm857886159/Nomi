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
const SEVEN = ['女主肖像', '海边小镇', '海边清晨', '海边傍晚', '树林', '纸船', '落叶']
/** 参考槽按 URL 去重：名字后面带 #k 得到 k 个不同的 URL。 */
const refs = (count: number): string[] => Array.from({ length: count }, (_, index) => `${SEVEN[index % SEVEN.length]}#${index}`)
const BOUNDARY_SOURCE = 'docs/design/boards/2026-11-12-mode-bar/ModeBar.board.json（边界样张 K1–K5）'

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
  // ── 边界样张 K1–K5（用户 2026-11-12「按推荐做」）：放到最多、行尾最长、底栏最长、菜单说明最长 ──
  {
    id: 'mb-k1-omni-max',
    name: 'K1 · 全能参考放满：30 张图 + 10 段视频 + 10 段音频（Seedance 2.5 上限）：图最多露 3 行多，再多在区内滚；行尾按类型报数、钉在滚动区外',
    source: BOUNDARY_SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'video', model: 'seedance25Apimart', arrayRefs: refs(30), edgeMedia: { video: 10, audio: 10 }, prompt: PROMPT }),
  },
  {
    id: 'mb-k2-switched-four',
    name: 'K2 · 放了 4 张已改成全能参考：图和那句话放得下一行，那句话在行尾',
    source: BOUNDARY_SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'video', model: 'seedance25Apimart', arrayRefs: refs(4), modeSwitchNotice: { modeId: 'omni', count: 4 }, prompt: PROMPT }),
  },
  {
    id: 'mb-k2-switched-five',
    name: 'K2 · 放了 5 张已改成全能参考：放不下一行，那句话整句换到图下面、靠右',
    source: BOUNDARY_SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'video', model: 'seedance25Apimart', arrayRefs: refs(5), modeSwitchNotice: { modeId: 'omni', count: 5 }, prompt: PROMPT }),
  },
  {
    id: 'mb-k2-twelve',
    name: 'K2 · 12 张图折成两行：「参考图 12 张」在图下面一行、靠右',
    source: BOUNDARY_SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'video', model: 'seedance25Apimart', arrayRefs: refs(12), prompt: PROMPT }),
  },
  {
    id: 'mb-k2-switched-max',
    name: 'K2 · 行尾最长：放满 50 个后「放了 50 张，已改成全能参考」',
    source: BOUNDARY_SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'video', model: 'seedance25Apimart', arrayRefs: refs(30), edgeMedia: { video: 10, audio: 10 }, modeSwitchNotice: { modeId: 'omni', count: 50 }, prompt: PROMPT }),
  },
  {
    id: 'mb-k3-model-limit-max',
    name: 'K3 · 30 张换到只收 2 张的可灵 4.0：其余 28 张只变淡，一句话说清',
    source: BOUNDARY_SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'video', model: 'kling4', arrayRefs: refs(30), prompt: PROMPT }),
  },
  {
    id: 'mb-k4-bar-common',
    name: 'K4 · 底栏常见：Seedance 2.0 + 变体 + 全能参考 + 16:9 · 720p · 5s（这一刀变体还单独一格）',
    source: BOUNDARY_SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'video', model: 'seedance', arrayRefs: refs(2), prompt: PROMPT }),
  },
  {
    id: 'mb-k4-bar-longest',
    name: 'K4 · 底栏最长：21:9 · 1080p · 15s；挤的时候只退参数一格，整值地退',
    source: BOUNDARY_SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'video', model: 'seedance', arrayRefs: refs(2), params: { aspect_ratio: '21:9', resolution: '1080p', duration: 15 }, prompt: PROMPT }),
  },
  {
    id: 'mb-k4-bar-longest-firstlast',
    name: 'K4 · 底栏最长（方式名最长）：首尾帧 + 21:9 · 1080p · 15s',
    source: BOUNDARY_SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'video', model: 'seedance', modeId: 'firstlast', frames: { first: '海边清晨', last: '海边傍晚' }, params: { aspect_ratio: '21:9', resolution: '1080p', duration: 15 }, prompt: PROMPT }),
  },
  {
    id: 'mb-k5-menu-longest',
    name: 'K5 · 放满 50 个点开方式菜单：说明最长，最宽 340、最多两行、不截断',
    source: BOUNDARY_SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ kind: 'video', model: 'seedance25Apimart', arrayRefs: refs(30), edgeMedia: { video: 10, audio: 10 }, prompt: PROMPT, open: 'mode' }),
  },
]
