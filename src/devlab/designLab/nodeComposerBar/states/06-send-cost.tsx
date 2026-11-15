// 发送键与花费并成一颗胶囊（2026-11-07 拍板图 ModelSurfaces：cost.send-pill / cost.hover）。
// 一格 = 现役 `BaseGenerationNode` + `NodeGenerationComposer` 本体；估价从桌面桥的 vendorPricePreview 来（和生产同一个口），
// 实验室只回一份写死的公开估价。英文 / 暗色由证据脚本加 `?lang=en` `?scheme=dark` 再截一遍。
// 最挤的一格（「会被数据撑开的地方」）：英文、参数取最长值、积分数取最长的那种（四位数 + 两位小数 +「≈」）。
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

export const COMPOSER_SEND_COST_STATES: readonly LabState[] = [
  {
    id: 'sc-a-pill',
    name: '发送键与花费一颗胶囊：硬币 + 积分数 + ↑（Seedance 2.5 · APIMart，公开价约 19.5 积分）',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ ...SEEDANCE, quote: { usd: 1.95, credits: 19.5, source: 'lab' } }),
  },
  {
    id: 'sc-b-crowded-en',
    name: '最挤：英文、比例 / 清晰度 / 时长取最长值、积分数最长（≈1,234.56）——放不下时按底栏让法先让摘要，胶囊不折行',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ ...SEEDANCE, locale: 'en', params: LONGEST, quote: { usd: 123.456, credits: 1234.56, source: 'lab', basis: 'output-estimate' } }),
  },
  {
    id: 'sc-c-unknown',
    name: '算不出：钮上只剩 ↑，不印数、不印 0',
    source: SOURCE, mirrors: MIRRORS, coverage: 'shell', scheme: 'light',
    render: stage({ ...SEEDANCE, quote: null }),
  },
]
