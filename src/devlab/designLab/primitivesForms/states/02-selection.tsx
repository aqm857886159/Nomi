// 设计实验室 · primitive 陈列 · 选择族。
//
// 同一根轴上并排三套：`DesignSegmentedControl`（Mantine）、`NomiSegmented`（原生）、
// `NomiSelect`（Mantine Combobox 外裹 token 行）。前两套是优化方案 D-3 点名的近重复合并候选；
// 这里只把现状摆出来，不做取舍（合并属 D 档，只出方案不动码）。
import React from 'react'

import { DesignSegmentedControl, NomiSegmented, NomiSelect } from '../../../../design'
import type { NomiSelectOption } from '../../../../design'
import { OpenPopoverStage, PrimitiveStage, Specimen, Stateful } from '../../primitives/primitivesLabKit'
import type { LabState } from '../../labScreen'

const SOURCE_SEGMENTED = 'src/design/NomiSegmented.tsx + src/design/forms.tsx · 优化方案 D-3 近重复合并候选'
const SOURCE_SELECT = 'src/design/NomiSelect.tsx · docs/design/nomi-design-system.md §3 选择面板'

const MODEL_OPTIONS: NomiSelectOption[] = [
  { value: 'seedream-4-5', label: 'Seedream 4.5', icon: { kind: 'model', fallback: 'SD' }, trailing: '¥0.28/张' },
  { value: 'nano-banana', label: 'Nano Banana Pro', icon: { kind: 'model', fallback: 'NB' }, trailing: '¥0.12/张' },
  { value: 'kling-2-5', label: 'Kling 2.5 Turbo', icon: { kind: 'model', fallback: 'KL' }, trailing: '¥1.40/秒' },
  { value: 'wan-2-6', label: 'Wan 2.6', icon: { kind: 'model', fallback: 'WN' }, disabled: true, trailing: '未接入' },
  { value: 'veo-3', label: 'Veo 3', icon: { kind: 'model', fallback: 'VE' }, dimmed: true, trailing: '近期连败' },
]

const RATIO_OPTIONS = [
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3', disabled: true },
]

export const SELECTION_STATES: readonly LabState[] = [
  {
    id: 'pf-06-segmented-controls',
    name: 'DesignSegmentedControl（Mantine）vs NomiSegmented（原生）· 同轴两套并排',
    source: SOURCE_SEGMENTED,
    coverage: 'shell',
    render: () => (
      <PrimitiveStage>
        <Specimen label="DesignSegmentedControl · Mantine 封装" align="stretch">
          <Stateful initial="16:9">
            {(value, set) => (
              <DesignSegmentedControl
                value={value}
                onChange={set}
                data={RATIO_OPTIONS.filter((option) => !option.disabled).map((option) => option.value)}
              />
            )}
          </Stateful>
        </Specimen>
        <Specimen label="NomiSegmented · density=default（32px）" align="stretch">
          <Stateful initial="16:9">
            {(value, set) => <NomiSegmented ariaLabel="画幅" value={value} options={RATIO_OPTIONS} onChange={set} />}
          </Stateful>
        </Specimen>
        <Specimen label="NomiSegmented · density=compact（28px · 画布参数条）" align="stretch">
          <Stateful initial="9:16">
            {(value, set) => (
              <NomiSegmented ariaLabel="画幅" density="compact" value={value} options={RATIO_OPTIONS} onChange={set} />
            )}
          </Stateful>
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'pf-07-nomi-select-triggers',
    name: 'NomiSelect · 触发 pill 的形态矩阵（收起态）',
    source: SOURCE_SELECT,
    coverage: 'shell',
    // 收起态单独一格：pill 上「小标签 + 值 + 徽标 + ▾」四件东西挤在 28px 高里，
    // 最容易出事的是值被挤没。展开态在下一格。
    render: () => (
      <PrimitiveStage>
        <Specimen label="size=sm（28px，默认）· 占位 / 有值 / 带前置标签">
          <Stateful initial="">
            {(value, set) => (
              <NomiSelect ariaLabel="模型" placeholder="选择模型" value={value} options={MODEL_OPTIONS} onChange={set} />
            )}
          </Stateful>
          <Stateful initial="seedream-4-5">
            {(value, set) => <NomiSelect ariaLabel="模型" value={value} options={MODEL_OPTIONS} onChange={set} />}
          </Stateful>
          <Stateful initial="16:9">
            {(value, set) => (
              <NomiSelect ariaLabel="画幅" leadingLabel="画幅" value={value} options={RATIO_OPTIONS} onChange={set} />
            )}
          </Stateful>
        </Specimen>
        <Specimen label="size=xs（24px · 时间轴/紧凑工具条）">
          <Stateful initial="nano-banana">
            {(value, set) => <NomiSelect ariaLabel="模型" size="xs" value={value} options={MODEL_OPTIONS} onChange={set} />}
          </Stateful>
        </Specimen>
        <Specimen label="triggerBadge 三 tone · disabled">
          <Stateful initial="kling-2-5">
            {(value, set) => (
              <NomiSelect
                ariaLabel="模型"
                value={value}
                options={MODEL_OPTIONS}
                onChange={set}
                triggerBadge={{ text: '模板', tone: 'accent' }}
              />
            )}
          </Stateful>
          <Stateful initial="kling-2-5">
            {(value, set) => (
              <NomiSelect
                ariaLabel="模型"
                value={value}
                options={MODEL_OPTIONS}
                onChange={set}
                triggerBadge={{ text: '超额', tone: 'danger' }}
              />
            )}
          </Stateful>
          {/* 禁用格也接真 setter：占位 handler 会让这一格变成「画得像能点、点了永远没反应」的样本，
              而陈列屏正是用来定义「对的样子」的地方（check:controls 规则二）。 */}
          <Stateful initial="seedream-4-5">
            {(value, set) => (
              <NomiSelect ariaLabel="模型" value={value} options={MODEL_OPTIONS} onChange={set} disabled />
            )}
          </Stateful>
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'pf-08-nomi-select-open',
    name: 'NomiSelect · 展开态（选中对勾 / 附注 / 禁用行 / 减淡行）',
    source: SOURCE_SELECT,
    coverage: 'shell',
    // 展开态由取景台**真的点一下触发钮**得到，不是另画一份下拉（见取景台头注纪律 1）。
    render: () => (
      <OpenPopoverStage height={320}>
        {(portalTarget) => (
          <Stateful initial="seedream-4-5">
            {(value, set) => (
              <NomiSelect
                ariaLabel="模型"
                value={value}
                options={MODEL_OPTIONS}
                onChange={set}
                portalTarget={portalTarget}
              />
            )}
          </Stateful>
        )}
      </OpenPopoverStage>
    ),
  },
  {
    id: 'pf-09-nomi-select-searchable',
    name: 'NomiSelect · searchable 展开态（长枚举走搜索 + 换行列表）',
    source: SOURCE_SELECT,
    coverage: 'shell',
    render: () => (
      <OpenPopoverStage height={340}>
        {(portalTarget) => (
          <Stateful initial="kling-2-5">
            {(value, set) => (
              <NomiSelect
                ariaLabel="模型"
                searchable
                value={value}
                options={MODEL_OPTIONS}
                onChange={set}
                portalTarget={portalTarget}
              />
            )}
          </Stateful>
        )}
      </OpenPopoverStage>
    ),
  },
]
