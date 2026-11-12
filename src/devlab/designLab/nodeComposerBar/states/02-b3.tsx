// 「画布 · 节点生成浮框」B3 版（2026-10-19，I-b1a）。每一格都是现役 `BaseGenerationNode` + `NodeGenerationComposer` 本体，
// 取景台只负责把节点 / 连线 / 参考灌进两个真 store（见 nodeComposerB3LabKit）。
// 格 id 与画布样张的格名对应（B3a…B3p、E1d），拍板对账时一眼对得上。
// 同一格的英文 / 暗色由证据脚本加 `?lang=en` `?scheme=dark` 再截一遍（tests/ux/b1a-composer-b3-evidence.mjs），这里只登记中文浅色一份。
import React from 'react'
import { ComposerB3Stage, mention, type B3Scenario } from '../nodeComposerB3LabKit'
import type { LabState } from '../../labScreen'

const SOURCE = 'docs/design/boards/2026-10-18/ComposerB3.board.json（画布「Nomi 0.24 交互方案」B3 / E1 各格）'
const MIRRORS = [
  'src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx:343',
  'src/workbench/generationCanvas/nodes/NodeParameterControls.tsx:700',
  'src/workbench/assets/AssetReference.tsx:96',
]

const THREE_REFS_PROMPT = `${mention('女主肖像')} 的人物走进 ${mention('海边小镇')}，树影按 ${mention('树林')}，镜头缓慢推近。`

const SEVEN = ['女主肖像', '海边小镇', '树林', '海边清晨', '海边傍晚', '纸船', '落叶']
/** 30 张参考（Seedance 2.5 的参考上限）：七张图轮着用，每张带不同的 #k 好让 URL 不重。 */
const THIRTY_REFS = Array.from({ length: 30 }, (_, index) => `${SEVEN[index % SEVEN.length]}#${index}`)

const stage = (scenario: B3Scenario): (() => React.JSX.Element) => () => <ComposerB3Stage scenario={scenario} />

export const COMPOSER_B3_STATES: readonly LabState[] = [
  {
    id: 'b3a-video-empty',
    name: 'B3a · 视频 · 空，默认参考',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'video', model: 'seedance' }),
  },
  {
    id: 'b3b-video-params',
    name: 'B3b · 视频 · 参数面板（生成方式已挪到底栏方式格，面板里不再有这一段）',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ kind: 'video', model: 'seedance', open: 'params' }),
  },
  {
    id: 'b3c-video-three-refs',
    name: 'B3c · 视频 · 参考 3 张（含连线）+ 连入文字',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'video', model: 'seedance', modeId: 'omni', edgeRefs: [{ name: '女主肖像' }], arrayRefs: ['海边小镇', '树林'], textChip: '开场白', prompt: THREE_REFS_PROMPT }),
  },
  {
    id: 'b3d-video-first-last',
    // 用尾帧可以不放的档案（Seedance 2.5 走 APIMart）：只放首帧时首尾帧放得下，按首尾帧发。
    // 2026-11-12 前这一格用 Seedance 2.0（尾帧必填），只放 1 张却停在首尾帧、生成钮灰着——正是用户报的那个错，现在会按全能参考发。
    name: 'B3d · 视频 · 首尾帧（只放首帧，尾帧可不放）',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'video', model: 'seedance25Apimart', modeId: 'firstlast', frames: { first: '海边小镇' }, prompt: '镜头缓慢推近，薄雾散开，海面泛起金光。' }),
  },
  {
    id: 'b3e-video-ambiguous',
    name: 'B3e · 视频 · 参考 2 张（「要当首尾帧用？」提示已删：方式格就是这次发的，想换就点方式格）',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'video', model: 'seedance', modeId: 'omni', arrayRefs: ['海边清晨', '海边傍晚'], prompt: `${mention('海边清晨')} 慢慢过渡到 ${mention('海边傍晚')} 的暖光，镜头缓慢推近。` }),
  },
  {
    id: 'b3f-video-switch-first-last',
    name: 'B3f · 视频 · 存着首尾帧、放了 3 张：首尾帧放不下，按全能参考发，3 张都在用（不再有「未用到」）',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    // 现行存法：一份有序列表（不带旧的按槽键）。带旧键的是旧工程，那一类在 b3u（先放一边）。
    render: stage({ kind: 'video', model: 'seedance', modeId: 'firstlast', arrayRefs: ['海边清晨', '海边傍晚', '树林'], prompt: '镜头缓慢推近，海面从清晨的薄雾过渡到傍晚的暖光。' }),
  },
  {
    id: 'b3g-image-empty',
    name: 'B3g · 图片 · 空，参数面板没有生成方式',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ kind: 'image', model: 'gpt-image', open: 'params' }),
  },
  {
    id: 'b3h-image-three-refs',
    name: 'B3h · 图片 · 放 3 张图',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'image', model: 'gpt-image', modeId: 'i2i', arrayRefs: ['女主肖像', '海边小镇', '树林'], prompt: `让 ${mention('女主肖像')} 的人物站在 ${mention('海边小镇')}，背景树影按 ${mention('树林')}，逆光。` }),
  },
  {
    id: 'b3i-image-no-ref-model',
    name: 'B3i · 图片 · 模型不收参考图（入口灰掉、连线图淡显）',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'image', model: 'imagen', edgeRefs: [{ name: '女主肖像' }, { name: '海边小镇' }], prompt: '清晨的海边小镇，薄雾，柔和的逆光。' }),
  },
  {
    id: 'b3q-image-quantity',
    name: 'B3 · 数量只在模型声明了「出图张数」时出现（Soul 2）',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'image', model: 'soul', prompt: '雨夜老街口的定场画面，霓虹与积水。' }),
  },
  {
    id: 'b3j-model-menu',
    name: 'B3j · 换模型前 · 模型菜单只列模型',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ kind: 'video', model: 'seedance', modeId: 'firstlast', frames: { first: '海边清晨', last: '海边傍晚' }, prompt: '镜头缓慢推近，海面从清晨的薄雾过渡到傍晚的暖光。', open: 'model' }),
  },
  {
    id: 'b3j-after-swap',
    name: 'B3j · 换成没有首尾帧的模型之后（两格变成两张缩略图，不加说明）',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'video', model: 'wan', modeId: 'ref', edgeRefs: [{ name: '海边清晨' }, { name: '海边傍晚' }], prompt: '镜头缓慢推近，海面从清晨的薄雾过渡到傍晚的暖光。' }),
  },
  {
    id: 'b3s-video-three-uploads',
    name: 'B3 · 参考 3 张（都是上传的）· 来回切首尾帧的往返走查夹具',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'video', model: 'seedance', modeId: 'omni', arrayRefs: ['海边清晨', '海边傍晚', '树林'], prompt: `${mention('海边清晨')} 慢慢过渡到 ${mention('海边傍晚')}，树影按 ${mention('树林')}。` }),
  },
  {
    id: 'b3j-swap-edges',
    name: 'B3j · 换模型前 · 首尾帧是两条连线（换模型的走查夹具，连线来的图自己按槽落）',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ kind: 'video', model: 'seedance', modeId: 'firstlast', edgeRefs: [{ name: '海边清晨', mode: 'first_frame' }, { name: '海边傍晚', mode: 'last_frame' }], prompt: '镜头缓慢推近，海面从清晨的薄雾过渡到傍晚。' }),
  },
  {
    id: 'b3t-video-firstlast-two-ref-edges',
    name: 'B3t · 首尾帧 · 连两条参考连线（不带首 / 尾帧语义）：第一条落首帧、第二条落尾帧（用户 10-22 拍板 ⑪）',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ kind: 'video', model: 'seedance', modeId: 'firstlast', edgeRefs: [{ name: '海边清晨', mode: 'reference' }, { name: '海边傍晚', mode: 'reference' }], prompt: '镜头缓慢推近，海面从清晨的薄雾过渡到傍晚。' }),
  },
  {
    id: 'b3u-video-legacy-parked',
    name: 'B3 · 旧工程：参考方式里以前藏着的首帧先放一边（淡显「不会发」，悬停「点一下用上」，点一下放回在用；#1269 条件 4）',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'video', model: 'seedance', modeId: 'omni', arrayRefs: ['海边清晨', '海边傍晚'], frames: { first: '纸船' }, prompt: `${mention('海边清晨')} 慢慢过渡到 ${mention('海边傍晚')}，镜头缓慢推近。` }),
  },
  {
    id: 'b3o-model-menu-channel',
    name: 'B3o · 模型菜单 · 渠道直选（同模型多家直接点小签）',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ kind: 'video', model: 'seedance', modeId: 'omni', secondChannel: true, arrayRefs: ['海边清晨', '海边傍晚'], prompt: '镜头缓慢推近，海面从清晨过渡到傍晚。', open: 'model' }),
  },
  {
    id: 'b3o-params-provider',
    name: 'B3o · 参数面板里的「供应商」一组（和菜单小签同一个选择）',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ kind: 'video', model: 'seedance', modeId: 'omni', secondChannel: true, arrayRefs: ['海边清晨', '海边傍晚'], prompt: '镜头缓慢推近，海面从清晨过渡到傍晚。', open: 'params' }),
  },
  {
    id: 'b3p-channel-missing-mode',
    name: 'B3p · 渠道缺方式（别家能做）：参考行行尾小字带文字链接',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'video', model: 'seedance', modeId: 'omni', channelGap: 'switch', arrayRefs: ['海边清晨', '海边傍晚'], prompt: '镜头缓慢推近，海面从清晨过渡到傍晚。' }),
  },
  {
    id: 'b3p-channel-missing-none',
    name: 'B3p · 渠道缺方式（已接入的模型里都做不了）：只有说明，没有链接',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'video', model: 'seedance', modeId: 'omni', channelGap: 'none', arrayRefs: ['海边清晨', '海边傍晚'], prompt: '镜头缓慢推近，海面从清晨过渡到傍晚。' }),
  },
  {
    id: 'b3r-video-30-refs',
    name: 'B3 · 最坏规模 · 参考行 30 张图（Seedance 2.5 参考上限 30 图）——性能场景的夹具',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'video', model: 'seedance25', modeId: 'omni', arrayRefs: THIRTY_REFS, prompt: `${mention('女主肖像#0')} 走进 ${mention('海边小镇#1')}，镜头缓慢推近。` }),
  },
  {
    id: 'e1d-node-error',
    name: 'E1d · 节点错误报告 · 失败卡盖住正文，换个模型打开下面这条生成框的模型菜单',
    source: SOURCE, mirrors: ['src/workbench/generationCanvas/nodes/NodeErrorReport.tsx:55'], coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'video', model: 'seedance', prompt: '纸船缓缓漂过水洼，镜头固定，纸船从左向右慢慢漂过画面。', error: 'InvalidParameter: resolution "1080p" is not supported by this model', size: { width: 340, height: 250 } }),
  },
]
