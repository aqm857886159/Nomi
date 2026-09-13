// 设计实验室 · primitive 陈列 · 选择族。
//
// 同一根轴上并排三套：`DesignSegmentedControl`（Mantine）、`NomiSegmented`（原生）、
// `NomiSelect`（Mantine Combobox 外裹 token 行）。前两套是优化方案 D-3 点名的近重复合并候选；
// 这里只把现状摆出来，不做取舍（合并属 D 档，只出方案不动码）。
//
// ⚠️ 2026-09-07 修正（用户抓到）：陈列格「渲染的是现役组件」只对了一半——**组件是真的，
// props 是夹具作者编的**。pf-06 此前给 `NomiSegmented` 喂纯文字比例选项、还用了生产从不用的
// `density="default"`，渲出「大空框配文字」，而真身（`InlineParameterBar.tsx`，2026-07-17 用户
// 拍板）画的是**按真实宽高比的描边矩形 + 文字**双行。顶着「这是真组件」的名义比手画样张更误导。
// 现在这一格改为**直接复用生产的构造链**：`localizeAutoOption` → `commonRatioSortKey` 排序 →
// `ratioShape` / `shapedGroupLabel`（都从生产模块 import，全仓只此一份定义），夹具只提供数据。
import React from 'react'

import { DesignSegmentedControl, NomiSegmented, NomiSelect } from '../../../../design'
import type { NomiSegmentedOption, NomiSelectOption } from '../../../../design'
import { commonRatioSortKey } from '../../../../workbench/generationCanvas/nodes/aspectRatio'
import {
  ratioShape,
  shapedGroupLabel,
} from '../../../../workbench/generationCanvas/nodes/aspectRatioShape'
import { localizeAutoOption } from '../../../../workbench/generationCanvas/nodes/parameterOptionPresentation'
import { OpenPopoverStage, PrimitiveStage, Specimen, Stateful } from '../../primitives/primitivesLabKit'
import type { LabState } from '../../labScreen'

const SOURCE_SEGMENTED = 'src/design/NomiSegmented.tsx + src/design/forms.tsx · 优化方案 D-3 近重复合并候选'
const SOURCE_SELECT = 'src/design/NomiSelect.tsx · docs/design/nomi-design-system.md §3 选择面板'

/**
 * 模型候选 —— **照 `buildModelSelectOptions` 真正吐出来的形状**
 * （`src/workbench/common/useDedupedModelSelect.ts:104-118`），不是「NomiSelectOption 支持哪些字段」。
 *
 * 2026-09-07 修正前这份夹具编了三样生产不存在的东西，而它们正好都是**看起来很合理**的那种：
 *   · `trailing: '¥0.28/张'` —— 价签。真实 `trailing` 只有两种值：单供应商时是**供应商名**，
 *     或整行避让时的「近期连败」（必配 `trailingTone: 'danger'`，此前漏了 → 红字根本没渲出来）。
 *   · `disabled: true` 的「未接入」行 —— 生产从不把没接的模型画成灰行，
 *     而是整张列表末尾给一条 `connectVendorOption()` 的「去接入」行（同上 :73）。
 *   · **`chips` 一个都没有** —— 同名模型折成一行、行尾摆「能走哪几家」的 chip 是这个组件
 *     最容易出事的布局（下拉宽度因此从 280 变 380，见 `NomiSelect.tsx:86-87`，
 *     组件自己的注释把它列为翻车现场）。夹具不摆 chip，基线就永远看不住它。
 */
const MODEL_OPTIONS: NomiSelectOption[] = [
  {
    value: 'seedream-4-5',
    label: 'Seedream 4.5',
    icon: { kind: 'model', fallback: 'S' },
    // 多供应商 → chips（第一个 = 当前生效那家）。chips 与 trailing **互斥**（组件头注）。
    chips: [
      { value: 'apimart', label: 'APIMart', active: true },
      { value: 'kie', label: 'Kie' },
      { value: 'runninghub', label: 'RunningHub' },
    ],
  },
  {
    value: 'nano-banana',
    label: 'Nano Banana Pro',
    icon: { kind: 'model', fallback: 'N' },
    // 单供应商 → trailing 就是供应商名（不是价签）。
    trailing: 'APIMart',
  },
  {
    value: 'kling-2-5',
    label: 'Kling 2.5 Turbo',
    icon: { kind: 'model', fallback: 'K' },
    chips: [
      { value: 'apimart', label: 'APIMart', active: true },
      { value: 'kie', label: 'Kie' },
    ],
  },
  {
    value: 'veo-3',
    label: 'Veo 3',
    icon: { kind: 'model', fallback: 'V' },
    // 整行避让：dimmed + trailing + trailingTone='danger' 三件**一起**出现，缺一红字就不渲染。
    trailing: '近期连败',
    trailingTone: 'danger',
    dimmed: true,
  },
]

/** 长枚举候选：`searchable` 的**唯一**生产用途是这一族（LoRA 文件名、长模型枚举）。 */
const LONG_ENUM_OPTIONS: NomiSelectOption[] = [
  { value: 'none', label: '不使用' },
  { value: 'film-grain-v3', label: 'film_grain_v3_fp16.safetensors' },
  { value: 'anime-lineart', label: 'anime_lineart_xl_v2.safetensors' },
  { value: 'portrait-detail', label: 'portrait_detail_enhancer_v11.safetensors' },
  { value: 'neon-city', label: 'neon_city_night_style_v4.safetensors' },
]

/**
 * 比例候选的**原始形状**——和档案给参数面板的一模一样：`{ value, text }`。
 * 含 `auto` 那档（`ratioShape` 对 isAuto 画 `IconAspectRatio`，不是画矩形），
 * 声明序刻意乱着写：下面要走生产的 `commonRatioSortKey` 排序，排完才是真机的顺序。
 */
const RAW_RATIO_OPTIONS: { value: string; text: string }[] = [
  { value: '4:3', text: '4:3' },
  { value: '1:1', text: '1:1' },
  { value: '16:9', text: '16:9' },
  { value: 'auto', text: 'auto' },
  { value: '9:16', text: '9:16' },
]

/**
 * 比例分段选项 = **生产那条链原样跑一遍**（`InlineParameterBar.tsx` 的 `renderOptions`）：
 * `localizeAutoOption` 收敛自动语义 → `commonRatioSortKey` 排常用序 →
 * `ratioShape` 出宽高比小图形 → `shapedGroupLabel` 竖排成「18px 图形槽 + 文字」双行 →
 * `title` 挂原文。夹具只提供上面那份数据，一行渲染逻辑都不重写。
 */
function ratioSegmentedOptions(autoLabel: string): NomiSegmentedOption[] {
  const entries = RAW_RATIO_OPTIONS.map((option) => {
    const localized = localizeAutoOption(option.value, option.text, autoLabel)
    return { ...localized, shape: ratioShape(localized.isAuto, localized.value, localized.text) }
  })
  // Array.sort 稳定：同键项保持声明相对序（与生产同一句）。
  const sorted = [...entries].sort(
    (a, b) => commonRatioSortKey(a.value, a.text) - commonRatioSortKey(b.value, b.text),
  )
  return sorted.map((entry) => ({
    value: entry.value,
    label: shapedGroupLabel(entry.text, entry.shape),
    title: entry.text,
  }))
}

/** 纯文字候选：设置页「工作方式」三档（`AutomationPermissionsSection.tsx:183`）的真实数据。 */
const MODE_OPTIONS: NomiSegmentedOption[] = [
  { value: 'guided', label: '每步都问' },
  { value: 'balanced', label: '均衡' },
  { value: 'policy-auto', label: '按策略自动' },
]

/** `NomiSelect` 的比例候选（pf-07 的 leadingLabel 格用）：那条路径不走分段，label 就是纯文本。 */
const RATIO_SELECT_OPTIONS: NomiSelectOption[] = RAW_RATIO_OPTIONS
  .filter((option) => option.value !== 'auto')
  .map((option) => ({ value: option.value, label: option.text }))

export const SELECTION_STATES: readonly LabState[] = [
  {
    id: 'pf-06-segmented-controls',
    name: 'DesignSegmentedControl（Mantine）vs NomiSegmented（原生）· 同轴两套并排',
    source: SOURCE_SEGMENTED,
    mirrors: [
      'src/workbench/generationCanvas/nodes/InlineParameterBar.tsx:400',
      'src/workbench/settings/AutomationPermissionsSection.tsx:183',
      'src/ui/onboarding/ConnectAssistantCard.tsx:248',
    ],
    coverage: 'shell',
    // 三格 = 三个真实调用点，不是三种「可以这么传」的组合：
    //   ① 比例分段（画布参数面板）—— compact + 双行图形 label，全仓最常见的分段形态；
    //   ② 纯文字分段（设置页工作方式）—— default 密度的真实用法长这样，不是比例；
    //   ③ Mantine 那套（接入向导）—— 真实调用点一律 `data={{label,value}[]}` + `fullWidth`。
    render: () => (
      <PrimitiveStage>
        <Specimen
          label="NomiSegmented · 比例组（density=compact · 画布参数面板）"
          align="stretch"
        >
          <Stateful initial="16:9">
            {(value, set) => (
              <NomiSegmented
                ariaLabel="画幅"
                density="compact"
                value={value}
                options={ratioSegmentedOptions('自动')}
                onChange={set}
              />
            )}
          </Stateful>
        </Specimen>
        <Specimen label="NomiSegmented · 纯文字组（density=default · 设置页）" align="stretch">
          <Stateful initial="balanced">
            {(value, set) => (
              <NomiSegmented ariaLabel="工作方式" value={value} options={MODE_OPTIONS} onChange={set} />
            )}
          </Stateful>
        </Specimen>
        <Specimen label="DesignSegmentedControl · Mantine 封装（size=xs · fullWidth）" align="stretch">
          <Stateful initial="claude-code">
            {(value, set) => (
              <DesignSegmentedControl
                size="xs"
                fullWidth
                value={value}
                onChange={set}
                data={[
                  { label: 'Claude Code', value: 'claude-code' },
                  { label: 'Codex', value: 'codex' },
                  { label: 'pi', value: 'pi' },
                ]}
              />
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
    mirrors: [
      'src/workbench/creation/storyboard/shotRow/ShotComposerBar.tsx:127',
      'src/workbench/creation/storyboard/ShotParamControls.tsx:48',
      'src/ui/onboarding/CustomCallScopeSelector.tsx:44',
    ],
    coverage: 'shell',
    // 收起态单独一格：pill 上「小标签 + 值 + 徽标 + ▾」四件东西挤在 28px 高里，
    // 最容易出事的是值被挤没。展开态在下一格。
    //
    // 2026-09-07 两处修正：
    //   · 补 `triggerMaxWidth`——48 个真实调用点里 **15 个**传它，而此前四格一个都没传。
    //     它正是「长模型名怎么在 pill 里截断」的开关；不传，基线就看不住截断行为。
    //   · 删 `tone: 'danger'` 徽标——两处真实 `triggerBadge` 全是 `accent`，
    //     danger/muted 生产零实例。原来的格子标着「三 tone」，多报了两档。
    render: () => (
      <PrimitiveStage>
        <Specimen label="size=xs（24px · 22/48 是它，分镜条/紧凑工具条的默认）">
          <Stateful initial="">
            {(value, set) => (
              <NomiSelect
                ariaLabel="模型"
                size="xs"
                placeholder="选择模型"
                triggerMaxWidth={150}
                value={value}
                options={MODEL_OPTIONS}
                onChange={set}
              />
            )}
          </Stateful>
          <Stateful initial="nano-banana">
            {(value, set) => (
              <NomiSelect
                ariaLabel="模型"
                size="xs"
                triggerMaxWidth={150}
                value={value}
                options={MODEL_OPTIONS}
                onChange={set}
              />
            )}
          </Stateful>
        </Specimen>
        <Specimen label="leadingLabel + size=xs（参数控件：小灰标签在值左边）">
          <Stateful initial="16:9">
            {(value, set) => (
              <NomiSelect
                ariaLabel="画幅"
                leadingLabel="画幅"
                size="xs"
                value={value}
                options={RATIO_SELECT_OPTIONS}
                onChange={set}
              />
            )}
          </Stateful>
        </Specimen>
        <Specimen label="size=sm（28px，默认）· triggerBadge tone=accent · disabled">
          <Stateful initial="kling-2-5">
            {(value, set) => (
              <NomiSelect
                ariaLabel="调用范围"
                leadingLabel="调用范围"
                value={value}
                options={MODEL_OPTIONS}
                onChange={set}
                triggerBadge={{ text: '已配置', tone: 'accent' }}
                triggerMaxWidth={220}
                className="max-w-full"
              />
            )}
          </Stateful>
          {/* 禁用格也接真 setter：占位 handler 会让这一格变成「画得像能点、点了永远没反应」的样本，
              而陈列屏正是用来定义「对的样子」的地方（check:controls 规则二）。 */}
          <Stateful initial="seedream-4-5">
            {(value, set) => (
              <NomiSelect
                ariaLabel="模型"
                value={value}
                options={MODEL_OPTIONS}
                onChange={set}
                triggerMaxWidth={150}
                disabled
              />
            )}
          </Stateful>
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'pf-08-nomi-select-open',
    name: 'NomiSelect · 展开态（供应商 chip 行 / 选中对勾 / 避让减淡行）',
    source: SOURCE_SELECT,
    mirrors: ['src/workbench/creation/storyboard/shotRow/ShotComposerBar.tsx:127'],
    coverage: 'shell',
    // 展开态由取景台**真的点一下触发钮**得到，不是另画一份下拉（见取景台头注纪律 1）。
    // 带 `onChipChange`：有 chip 的行是可点的第二层（点 chip 换供应商、不选中该行），
    // 而下拉宽度也因此从 280 变 380——这一格钉住的正是那套布局。
    render: () => (
      <OpenPopoverStage height={320}>
        {(portalTarget) => (
          <Stateful initial="seedream-4-5">
            {(value, set) => (
              <NomiSelect
                ariaLabel="模型"
                size="xs"
                triggerMaxWidth={150}
                value={value}
                options={MODEL_OPTIONS}
                onChange={set}
                onChipChange={() => undefined}
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
    name: 'NomiSelect · searchable 展开态（长枚举走搜索 + 长文件名换行）',
    source: SOURCE_SELECT,
    mirrors: ['src/workbench/generationCanvas/nodes/InlineParameterBar.tsx:383'],
    coverage: 'shell',
    // `searchable` 全仓**只有一个**调用点，这一格逐项照抄它：
    // `className="w-full justify-between"`（面板里的整宽字段，不是自适应宽的 pill）
    // + 纯 `{value,label}` 候选（无图标、无附注）+ 长文件名。
    // 此前那版拿 5 个带图标的模型行当搜索对象，搜索框看着是个摆设，
    // 而 `searchable` 存在的**理由**——长文件名的 `whitespace-normal break-all` 换行分支
    // （`NomiSelect.tsx:241`）——一次都没被渲染到。
    render: () => (
      <OpenPopoverStage height={340}>
        {(portalTarget) => (
          <Stateful initial="film-grain-v3">
            {(value, set) => (
              <NomiSelect
                ariaLabel="LoRA"
                searchable
                value={value}
                options={LONG_ENUM_OPTIONS}
                onChange={set}
                portalTarget={portalTarget}
                className="w-full justify-between"
              />
            )}
          </Stateful>
        )}
      </OpenPopoverStage>
    ),
  },
]
