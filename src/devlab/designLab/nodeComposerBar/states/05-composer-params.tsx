// 参数面板 / 底栏「高级设置」/ 名字旁说明（2026-11-14 拍板图 ComposerParams 第二排 T–U3、L、Q）。
// 每一格都是现役 `BaseGenerationNode` + `NodeGenerationComposer` 本体，模型按档案 id 现拼（名字、参数都读档案），
// 展开态由取景台真的点一下得到。英文 / 暗色由证据脚本加 `?lang=en` `?scheme=dark` 再截一遍。
// 最后一格是全目录矩阵：走查脚本通过 window.__cpMatrix 逐个换「档案 × 方式」，量底栏放不放得下。
import React from 'react'
import { ComposerB3Stage, type B3Scenario } from '../nodeComposerB3LabKit'
import type { LabState } from '../../labScreen'
import { MODEL_ARCHETYPES } from '../../../../../electron/shared/modelArchetypes'
import { parameterControlRole } from '../../../../workbench/generationCanvas/nodes/controls/parameterControlModel'

const MIRRORS = [
  'src/workbench/generationCanvas/nodes/InlineParameterBar.tsx:342',
  'src/workbench/generationCanvas/nodes/controls/AdvancedSettings.tsx:37',
  'src/workbench/generationCanvas/nodes/controls/parameterControlModel.ts:211',
]
const PROMPT = '她从清晨的码头走到傍晚的海堤，镜头缓慢推近。'
const stage = (scenario: B3Scenario): (() => React.JSX.Element) => () => <ComposerB3Stage scenario={scenario} />
const SEEDANCE: B3Scenario = { kind: 'video', model: 'seedance25Apimart', prompt: PROMPT }

export const COMPOSER_PARAMS_STATES: readonly LabState[] = [
  {
    id: 'cp-t-panel-flat',
    name: 'T · Seedance 2.5 文生视频点开参数：面板全摊开（比例 / 清晰度 / 时长 / 生成音频），不限高；底栏右边多一颗「高级设置」',
    source: 'docs/design/boards/2026-11-14-composer-params/ComposerParams.board.json（样张 T）', mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ ...SEEDANCE, open: 'params' }),
  },
  {
    id: 'cp-t2-advanced-open',
    name: 'T2 · 点开「高级设置」：底栏下面展开五项（返回尾帧 / 种子 / 水印 / 输出格式 / 提交前内容审核），名字旁 ⓘ',
    source: 'docs/design/boards/2026-11-14-composer-params/ComposerParams.board.json（样张 T2）', mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ ...SEEDANCE, open: 'advanced' }),
  },
  {
    id: 'cp-t3-advanced-changed',
    name: 'T3 · 高级设置里填过种子、收着：图标带一个小点',
    source: 'docs/design/boards/2026-11-14-composer-params/ComposerParams.board.json（样张 T3）', mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ ...SEEDANCE, params: { seed: 20261114 } }),
  },
  {
    id: 'cp-t8-both-open',
    name: 'T8 · 参数面板和高级设置同时开',
    source: 'docs/design/boards/2026-11-14-composer-params/ComposerParams.board.json（样张 T8）', mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ ...SEEDANCE, open: 'params-advanced' }),
  },
  {
    id: 'cp-u-image-model',
    name: 'U · 图片模型（Seedream 5.5）：面板 3 项，高级设置 3 项',
    source: 'docs/design/boards/2026-11-14-composer-params/ComposerParams.board.json（样张 U）', mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ kind: 'image', model: 'gpt-image', archetypeId: 'seedream-5-5', prompt: '雨夜的街口，霓虹映在积水里。', open: 'params-advanced' }),
  },
  {
    id: 'cp-u2-max-main',
    name: 'U2 · 面板项数最多：ElevenLabs v3 语音 7 项全摊开，没有高级设置图标',
    source: 'docs/design/boards/2026-11-14-composer-params/ComposerParams.board.json（样张 U2）', mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ kind: 'audio', model: 'gpt-image', archetypeId: 'eleven-v3', prompt: '欢迎来到海边小镇。', open: 'params' }),
  },
  {
    id: 'cp-u3-single-advanced',
    name: 'U3 · 高级设置只有 1 项也进（Seedance 2.5 渠道 A 文生视频：种子）',
    source: 'docs/design/boards/2026-11-14-composer-params/ComposerParams.board.json（样张 U3）', mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ kind: 'video', model: 'seedance25', archetypeId: 'seedance-2.5', prompt: PROMPT, open: 'advanced' }),
  },
  {
    id: 'cp-l-options-56',
    name: 'L · 一格里选项最多（Gemini Image 3.1 Flash 的 56 个比例）：最多露 3 行，在格内滚',
    source: 'docs/design/boards/2026-11-14-composer-params/ComposerParams.board.json（样张 L）', mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ kind: 'image', model: 'gpt-image', archetypeId: 'gemini-image-3.1-flash', prompt: '雨夜的街口。', open: 'params' }),
  },
  {
    id: 'cp-q-longest-label',
    name: 'Q · 面板里最长的参数名（即梦多帧「段时长(秒,仅2图)」，英文最长）',
    source: 'docs/design/boards/2026-11-14-composer-params/ComposerParams.board.json（样张 Q）', mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ kind: 'video', model: 'seedance', archetypeId: 'dreamina-multiframe', prompt: PROMPT, open: 'params' }),
  },
  {
    id: 'cp-solo-panel',
    name: '只有一项参数的面板：和别的面板同一只 320 面板，不再是 68 宽的窄条',
    source: 'docs/design/boards/2026-11-14-composer-params/ComposerParams.board.json（界面问题 d）', mirrors: MIRRORS, coverage: 'shell', scheme: 'light', capture: 'viewport',
    render: stage({ kind: 'video', model: 'seedance', archetypeId: 'muse-video-ext', prompt: PROMPT, open: 'params' }),
  },
  {
    id: 'cp-perf-panel-7-200',
    name: '性能量具用 · 画布上 200 个节点，选中的是 ElevenLabs v3 语音（面板 7 项最多），参数面板收着',
    source: 'docs/design/boards/2026-11-14-composer-params/ComposerParams.board.json（设计卡 ★7：点开全摊开的面板）', mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'audio', model: 'gpt-image', archetypeId: 'eleven-v3', prompt: '欢迎来到海边小镇。', fillerNodes: 199 }),
  },
  {
    id: 'cp-perf-advanced-5-200',
    name: '性能量具用 · 画布上 200 个节点，选中的是 Seedance 2.5 文生视频（高级设置 5 项最多），高级设置收着',
    source: 'docs/design/boards/2026-11-14-composer-params/ComposerParams.board.json（设计卡 ★7：点开高级设置）', mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ ...SEEDANCE, fillerNodes: 199 }),
  },
  {
    id: 'cp-matrix',
    name: '全目录矩阵（走查用）：window.__cpMatrix.set(档案, 方式) 换组合，每个组合按方式要的输入摆好、参数取最长值',
    source: 'docs/design/boards/2026-11-14-composer-params/ComposerParams.board.json（便签「边界表」：实现时把全部模型 × 方式 × 中英文跑一遍）', mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: () => <MatrixStage />,
  },
]

type Combo = { archetypeId: string; modeId: string }

/** 方式要什么输入就摆什么：首帧 / 尾帧放图，参考图 / 视频 / 音频各放够下限（至少 1 个），让按输入现算的方式真落在这一种上。 */
function scenarioFor({ archetypeId, modeId }: Combo): B3Scenario {
  const archetype = MODEL_ARCHETYPES.find((candidate) => candidate.id === archetypeId)!
  const mode = archetype.modes.find((candidate) => candidate.id === modeId)!
  const slot = (kind: string) => mode.slots.find((candidate) => candidate.kind === kind)
  const count = (kind: string) => { const found = slot(kind); return found ? Math.max(1, found.min) : 0 }
  // 底栏最挤的样子：比例 / 清晰度 / 时长 / 数量这几格取字最长的那个值（数字取最大）。
  const params: Record<string, unknown> = {}
  for (const param of mode.params) {
    if (!parameterControlRole({ ...param, binding: 'parameter' })) continue
    if (param.options.length) {
      const longest = [...param.options].sort((a, b) => String(b.label ?? b.value).length - String(a.label ?? a.value).length)[0]!
      params[param.key] = longest.value
    } else if (typeof param.max === 'number') params[param.key] = param.max
  }
  const images = ['海边清晨', '海边傍晚', '树林', '纸船', '落叶', '女主肖像']
  return {
    kind: archetype.kind,
    model: 'seedance',
    archetypeId,
    modeId,
    prompt: PROMPT,
    params,
    ...(count('image_ref') ? { arrayRefs: Array.from({ length: count('image_ref') }, (_, index) => `${images[index % images.length]}#${index}`) } : {}),
    ...(slot('first_frame') || slot('last_frame') ? { frames: { ...(slot('first_frame') ? { first: '海边清晨' } : {}), ...(slot('last_frame') ? { last: '海边傍晚' } : {}) } } : {}),
    ...(count('video_ref') || count('source_video') || count('audio_ref') ? { edgeMedia: { video: count('video_ref') + count('source_video'), audio: count('audio_ref') } } : {}),
  }
}

declare global {
  interface Window { __cpMatrix?: { combos: Combo[]; set: (combo: Combo) => void; current: () => Combo } }
}

function MatrixStage(): React.JSX.Element {
  const combos = React.useMemo(() => MODEL_ARCHETYPES.flatMap((archetype) => archetype.modes.map((mode) => ({ archetypeId: archetype.id, modeId: mode.id }))), [])
  const [combo, setCombo] = React.useState<Combo>(combos[0]!)
  const scenario = React.useMemo(() => scenarioFor(combo), [combo])
  React.useEffect(() => {
    window.__cpMatrix = { combos, set: setCombo, current: () => combo }
    return () => { delete window.__cpMatrix }
  }, [combos, combo])
  return <div data-cp-matrix={`${combo.archetypeId}/${combo.modeId}`}><ComposerB3Stage key={`${combo.archetypeId}/${combo.modeId}`} scenario={scenario} /></div>
}
