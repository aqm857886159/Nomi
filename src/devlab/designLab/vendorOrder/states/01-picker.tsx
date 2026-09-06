// 设计实验室 · 供应商偏好屏 · 模型下拉的各形态。
//
// 每条注册项带：稳定 id、人话名字、来源、coverage 档位，以及**用现役组件**渲染的夹具。
// 顺序有意义：`labStates.mjs` 按 `states/` 目录名排序解析，`vendorOrderStates.tsx` 按同样顺序拼接，
// 走查再拿活页面的 `window.__designLabStates` 与解析结果逐项比对——三者对不上当场红。
import React from 'react'

import {
  CONFIGURED_MODELS,
  MIXED_MODELS,
  NO_RUNNABLE_VENDORS,
  RUNNABLE_VENDORS,
  VENDOR_APIMART,
  VENDOR_KIE,
} from '../vendorOrderFixtures'
import { ModelPickerStage } from '../vendorOrderLabKit'
import type { LabState } from '../../labScreen'

// `source` 逐条写成字面单引号串（不是抽个常量再拼）：`labStates.mjs` 那把源码正则按
// 「id / name / source / coverage 四行紧挨着的单引号串」解析注册项，模板串或标识符会解析不出来。
export const PICKER_STATES: readonly LabState[] = [
  {
    id: 'vo-01-picker-preferred',
    name: '有偏好 · 偏好那家排第一并高亮',
    source: 'docs/design/nomi-design-system.md §2 token + §1.5 控件层级 · 用户 2026-09-06 返工要求',
    coverage: 'shell',
    render: () => (
      <ModelPickerStage
        models={CONFIGURED_MODELS}
        runnableVendorKeys={RUNNABLE_VENDORS}
        preferredVendorKeys={[VENDOR_KIE, VENDOR_APIMART]}
      />
    ),
  },
  {
    id: 'vo-02-picker-no-preference',
    name: '无偏好 · 按供应商分级（官方在前）',
    source: 'src/config/modelIdentity.ts sortModelProviders · 用户 2026-09-06 返工要求',
    coverage: 'shell',
    // 没设过偏好时**不该退化成厂商名字母序**：这一格钉住「火山方舟（官方）排在两家中转前面」。
    render: () => <ModelPickerStage models={CONFIGURED_MODELS} runnableVendorKeys={RUNNABLE_VENDORS} />,
  },
  {
    id: 'vo-03-picker-hides-unconnected',
    name: '有没接入的家 · 它们直接不出现（不是灰显沉底）',
    source: 'src/config/modelCatalogCache.ts keepRunnableVendorOptions · 用户 2026-09-06 拍板',
    coverage: 'shell',
    // 夹具喂的是**整份**目录：RunningHub 独家的 Kling 3 / Wan 2.6 都在里面，屏上必须一行都看不见，
    // Seedream 4.5 的 chip 也只剩接入了的两家。筛掉它们的是生产代码，不是夹具。
    render: () => (
      <ModelPickerStage
        models={MIXED_MODELS}
        runnableVendorKeys={RUNNABLE_VENDORS}
        preferredVendorKeys={[VENDOR_APIMART, VENDOR_KIE]}
      />
    ),
  },
  {
    id: 'vo-04-picker-empty-no-vendor',
    name: '一家都没接入 · 诚实空态：说清现状 + 一步去接入',
    source: 'src/workbench/common/useDedupedModelSelect.ts connectVendorOption · 用户 2026-09-06 拍板',
    coverage: 'shell',
    // 没接入的模型不再沉底显示，于是新装机上这个下拉会**一条都不剩**。空白下拉读起来像「坏了」，
    // 所以这一格钉住：必须有一行说「还没接入供应商」，且点它就是去接入。
    render: () => <ModelPickerStage models={MIXED_MODELS} runnableVendorKeys={NO_RUNNABLE_VENDORS} />,
  },
  {
    id: 'vo-05-picker-selected-row',
    name: '选中态 · 对勾与 chip 同行不打架',
    source: 'docs/design/nomi-design-system.md §2 token + §1.5 控件层级 · 用户 2026-09-06 返工要求',
    coverage: 'shell',
    // 选中行同时有：加粗模型名 + 一排 chip + 最右对勾。这三样挤在一行里最容易把模型名压没，
    // 所以单独立一格钉住。
    render: () => (
      <ModelPickerStage
        models={CONFIGURED_MODELS}
        runnableVendorKeys={RUNNABLE_VENDORS}
        preferredVendorKeys={[VENDOR_APIMART]}
        selected="seedream-4-5"
      />
    ),
  },
]
