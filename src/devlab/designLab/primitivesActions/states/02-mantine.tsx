// 设计实验室 · primitive 陈列 · 动作族（Mantine 封装的那半）。
//
// `DesignButton` / `IconActionButton` 是同一根轴上的**另一套**实现（Mantine `Button` / `ActionIcon`
// 外面裹一层 token className）。设计系统优化方案 D-3 把「DesignButton vs WorkbenchButton 的
// 半途迁移」列为近重复合并候选——把两套并排陈列，正是让这件事从「文档里的一句话」
// 变成「一眼能看见的两排按钮」。
//
// 这一屏不做取舍、不改源码：合并是 D 档的事（只出方案）。陈列只负责把现状摆出来。
//
// ⚠️ 2026-09-07 修正（用户抓到的系统性缺陷）：陈列格「渲染的是现役组件本体」只管住了
// **组件**，管不住 **props**。此前两处失真：
//   · `DesignButton variant="outline"` —— 全仓**零调用点**（真实分布：subtle 18 / filled 18
//     / light 16 / default 3），而它此前摆在第一行最显眼处，看着像一等公民；
//   · `IconActionButton` 的 `light` / `filled` / `loading` —— 13 个真实调用点里
//     **0 个**传 `variant`、**0 个**传 `loading`；且 13/13 都传 `className` 改尺寸、
//     13/13 都同时传 `aria-label` + `title`。此前那格三样全没画对。
// 现在两格钉住真实分布，`mirrors` 写明镜像哪一行（门岗第五项验它）。
import React from 'react'
import {
  IconChevronDown,
  IconChevronUp,
  IconDownload,
  IconRefresh,
  IconSettings,
  IconTrash,
} from '@tabler/icons-react'

import { DesignButton, IconActionButton } from '../../../../design'
import { PrimitiveStage, Specimen } from '../../primitives/primitivesLabKit'
import type { LabState } from '../../labScreen'

const SOURCE_MANTINE = 'src/design/actions.tsx（Mantine 封装）· 优化方案 D-3 近重复合并候选'

export const MANTINE_ACTION_STATES: readonly LabState[] = [
  {
    id: 'pa-05-design-button-variants',
    name: 'DesignButton · 生产真实用到的四变体（outline 零调用，不摆）',
    source: SOURCE_MANTINE,
    mirrors: [
      'src/ui/onboarding/KnownVendorKeyConnectPage.tsx:153',
      'src/ui/onboarding/IntegrationSelfCheckPanel.tsx:122',
      'src/ui/onboarding/AdapterVerificationScreen.tsx:234',
    ],
    coverage: 'shell',
    // 变体按真实分布摆：subtle / filled / light 各十几处，default 3 处，outline **0 处**。
    // 真实 DesignButton 几乎总是**成对**出现在页脚（返回 + 确认），单独一颗是例外——
    // 所以这里也成对摆，不是排成一行变体样本。
    render: () => (
      <PrimitiveStage>
        <Specimen label="页脚那对：light（返回）+ filled（确认）· 最常见的真实形态">
          <DesignButton variant="light">返回</DesignButton>
          <DesignButton variant="filled">确认接入</DesignButton>
        </Specimen>
        <Specimen label="subtle / default（次级动作）">
          <DesignButton variant="subtle">跳过</DesignButton>
          <DesignButton variant="default">高级设置</DesignButton>
        </Specimen>
        <Specimen label="图标两写法：leftSection（28 处）与 icon 作 children（约等量）">
          <DesignButton leftSection={<IconDownload size={14} />}>导出</DesignButton>
          <DesignButton variant="filled">
            <IconRefresh size={14} /> 重试
          </DesignButton>
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'pa-06-design-button-busy',
    name: 'DesignButton · disabled / loading（生产 loading 恒配 disabled + type=submit）',
    source: SOURCE_MANTINE,
    mirrors: [
      'src/ui/onboarding/DirectScriptDraftForm.tsx:125',
      'src/ui/onboarding/ModelAdapterStatusSection.tsx:125',
    ],
    coverage: 'shell',
    // 2026-09-07 修正：真实 loading 按钮**从不单独出现**——每一处都同时传 `disabled`
    // （loading 不自动禁用，与 WorkbenchButton 不同，这是两套按钮的一处真实差异），
    // 且多数是表单里的 `type="submit"`。此前那格只画了裸 `loading`，
    // 于是「必须自己再禁一次」这条本仓约定在陈列里完全看不见。
    render: () => (
      <PrimitiveStage>
        <Specimen label="disabled（light / filled · 页脚那对同时禁用）">
          <DesignButton disabled variant="light">返回</DesignButton>
          <DesignButton disabled variant="filled">确认接入</DesignButton>
        </Specimen>
        <Specimen label="loading + disabled + type=submit（表单提交：真实形态）">
          <DesignButton type="submit" variant="filled" disabled loading>
            正在验证
          </DesignButton>
          <DesignButton disabled loading>正在启动</DesignButton>
        </Specimen>
      </PrimitiveStage>
    ),
  },
  {
    id: 'pa-07-icon-action-button',
    name: 'IconActionButton · 真实形态（subtle 默认 · className 改尺寸 · aria-label + title 成对）',
    source: SOURCE_MANTINE,
    mirrors: [
      'src/workbench/settings/VendorPreferenceOrderSection.tsx:84',
      'src/ui/onboarding/CapabilityModeEditor.tsx:120',
    ],
    coverage: 'shell',
    // 13 个真实调用点的画像，逐条都与此前那格相反：
    //   · **0 个**传 `variant`（全走 subtle 默认）→ light / filled 不再摆；
    //   · **0 个**传 `loading` → 这一档删掉，它在生产里不存在；
    //   · **13/13** 传 `className` 且都改尺寸——最常见的是响应式触控靶
    //     `size-11 sm:size-8`（10 处逐字复制），设置页那两颗箭头是 `size-7`；
    //   · **13/13** 同时传 `aria-label` + `title`——提示是真实用法的一部分，不是可选装饰。
    render: () => (
      <PrimitiveStage>
        <Specimen label="size-7 + 禁用（设置页排序箭头：首尾必有一个是禁用的）">
          <IconActionButton
            aria-label="上移"
            title="上移"
            disabled
            className="size-7 text-nomi-ink-40 hover:text-nomi-accent disabled:bg-transparent"
            icon={<IconChevronUp size={15} stroke={1.7} aria-hidden="true" />}
          />
          <IconActionButton
            aria-label="下移"
            title="下移"
            className="size-7 text-nomi-ink-40 hover:text-nomi-accent disabled:bg-transparent"
            icon={<IconChevronDown size={15} stroke={1.7} aria-hidden="true" />}
          />
        </Specimen>
        <Specimen label="size-11 sm:size-8 响应式触控靶（10 处逐字复制的那套）">
          <IconActionButton
            aria-label="删除这一档"
            title="删除这一档"
            className="size-11 sm:size-8"
            icon={<IconTrash size={16} />}
          />
          <IconActionButton
            aria-label="重试"
            title="重试"
            className="size-11 sm:size-8"
            icon={<IconRefresh size={16} />}
          />
          <IconActionButton
            aria-label="设置"
            title="设置"
            className="size-11 sm:size-8"
            icon={<IconSettings size={16} />}
          />
        </Specimen>
        <Specimen label="⚠️ 组件默认尺寸（size-8 裸态）：13/13 调用点都被 className 盖掉，生产实际见不到">
          <IconActionButton aria-label="设置" title="设置" icon={<IconSettings size={16} />} />
        </Specimen>
      </PrimitiveStage>
    ),
  },  {
    id: 'pa-08-design-button-sizes',
    name: 'DesignButton · size 三档（2026-09-08 修复前 size 是死的，三档全渲染成 sm）',
    source: SOURCE_MANTINE,
    mirrors: [
      'src/ui/onboarding/AdapterVerificationScreen.tsx:234',
      'src/ui/onboarding/CapabilityModeEditor.tsx:202',
      'src/ui/onboarding/ModelAdapterStatusSection.tsx:130',
    ],
    coverage: 'shell',
    // 为什么这格必须存在：`size` 此前**完全不生效**——包装层把 `h-8 px-3 text-body-sm`
    // 硬编码进 className，而生成的 CSS 里 Tailwind 整段排在 `@mantine/core/styles.css`
    // 之后（scripts/build-tailwind.mjs:42-51），同特异度后来者胜，Mantine 按 size 生成的
    // `--button-height / --button-padding-x / --button-fz` 全被盖掉。7 处 `size="xs"`
    // 因此静默无效，而想要 36px 的三处只能写 `className="h-9"` 绕过去。
    // 修法 = 尺寸走本地映射表（`DESIGN_BUTTON_SIZE`）；这一格是它还活着的视觉证据。
    render: () => (
      <PrimitiveStage>
        <Specimen label="xs 28px（失败恢复行内动作 / 编辑器「添加一项」· 7 处）">
          <DesignButton size="xs" variant="light">重试这一个</DesignButton>
          <DesignButton size="xs" variant="subtle">手动接入</DesignButton>
        </Specimen>
        <Specimen label="sm 32px · 默认档（不传 size 时就是它）">
          <DesignButton variant="light">返回</DesignButton>
          <DesignButton variant="filled">确认接入</DesignButton>
        </Specimen>
        <Specimen label="md 36px（页头/状态条主动作 · 原先写作 className=&quot;h-9&quot;）">
          <DesignButton size="md" variant="light">重新检测</DesignButton>
          <DesignButton size="md" variant="filled">开始接入</DesignButton>
        </Specimen>
      </PrimitiveStage>
    ),
  },
]
