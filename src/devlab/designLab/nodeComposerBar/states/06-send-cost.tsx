// 发送键上的约价（2026-11-07 拍板图 ModelSurfaces：cost.send-pill / cost.hover；花费显示第一步）。
// 一格 = 现役 `BaseGenerationNode` + `NodeGenerationComposer` 本体；约价从桌面桥的 vendorPricePreview 来（和生产同一个口），
// 实验室只回一份写死的公开约价。价目数字和免费走查的假价目同一份：Seedance 720P 每秒 0.039 美元、1080P 每秒 0.0975 美元。
// 最长数字 = 假价目里最贵的规格（1080P）× 最长时长（15 秒）× 1 份 = 1.4625 美元 = 14.63 积分。
// 生成浮框屏幕宽恒为 NODE_COMPOSER_WIDTH（不随节点宽变）；最挤 = 英文 + 参数取最长值 + 最长数字，节点取最窄宽度。
// 悬停态由走查脚本用真鼠标停上去（tests/ux/send-cost-estimate.rehearsal.walk.mjs）。
import React from 'react'
import { ComposerB3Stage, type B3Scenario } from '../nodeComposerB3LabKit'
import type { LabState } from '../../labScreen'

const SOURCE = 'docs/design/boards/2026-11-07-model-surfaces/ModelSurfaces.board.json（cost.send-pill）'
const MIRRORS = [
  'src/workbench/generationCanvas/nodes/ComposerSendButton.tsx:1',
  'src/workbench/generationCanvas/spend/useSendCost.ts:1',
]
const PROMPT = '她从清晨的码头走到傍晚的海堤，镜头缓慢推近。'
const stage = (scenario: B3Scenario): (() => React.JSX.Element) => () => <ComposerB3Stage scenario={scenario} />
const SEEDANCE: B3Scenario = { kind: 'video', model: 'seedance25Apimart', prompt: PROMPT }
const LONGEST = { aspect_ratio: '21:9', resolution: '1080p', duration: 15 }
const FIVE_SECONDS = { usd: 0.195, credits: 1.95, source: 'lab' }
const PRICIEST = { usd: 1.4625, credits: 14.625, source: 'lab' }

export const COMPOSER_SEND_COST_STATES: readonly LabState[] = [
  {
    id: 'sc-a-pill',
    name: '有价：发送键上硬币 + 积分数 + ↑（Seedance 2.5 · 5 秒 720P，公开价约 1.95 积分）',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ ...SEEDANCE, quote: FIVE_SECONDS }),
  },
  {
    id: 'sc-b-crowded-en',
    name: '最挤：英文、最窄节点、比例 / 清晰度 / 时长取最长值、最长数字（14.63）——放不下时按底栏让法先让摘要，数字不折行',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ ...SEEDANCE, locale: 'en', params: LONGEST, size: { width: 240, height: 135 }, quote: PRICIEST }),
  },
  {
    id: 'sc-c-unknown',
    name: '算不出：钮上只剩 ↑，不印数、不印 0（悬停「暂时估不出这次用量」）',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ ...SEEDANCE, quote: null }),
  },
  {
    id: 'sc-g-loading',
    name: '生成中：不印数，发送键走主干忙态（和没有约价时逐字相同）',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ ...SEEDANCE, running: true, quote: FIVE_SECONDS }),
  },
  {
    id: 'sc-h-calculating',
    name: '算价中：价还没回来、也没有旧数可留——只有 ↑，不转圈、不闪 0',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ ...SEEDANCE, quote: 'pending' }),
  },
  // sc-i：方式由输入算出来（主干 11-12 起），「首帧方式没放首帧」画不出禁用；这里用真能禁用的一条：Seedance 2.0 只连了参考音频、缺图或视频。
  // 约价是实验室桥写死回的一份——真价目对带参考的这一单会判估不出；这格只看「禁用样子下数字仍可读」。
  {
    id: 'sc-i-disabled-priced',
    name: '禁用 + 有价：只连了参考音频、缺图或视频，键是禁用样子，硬币和数字仍可读（约价为实验室写死）',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ kind: 'video', model: 'seedance', prompt: PROMPT, edgeMedia: { audio: 1 }, quote: FIVE_SECONDS }),
  },
  {
    id: 'sc-j-dark',
    name: '暗色：有价（硬币 + 积分数 + ↑）',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'dark',
    render: stage({ ...SEEDANCE, quote: FIVE_SECONDS }),
  },
]
