// 设计实验室 · 供应商偏好屏 · 模型下拉的各形态。
//
// 每条注册项带：稳定 id、人话名字、来源、coverage 档位，以及**用现役组件**渲染的夹具。
// 顺序有意义：`labStates.mjs` 按 `states/` 目录名排序解析，`vendorOrderStates.tsx` 按同样顺序拼接，
// 走查再拿活页面的 `window.__designLabStates` 与解析结果逐项比对——三者对不上当场红。
import React from 'react'

import {
  ALL_UNCONFIGURED_MODELS,
  CONFIGURED_MODELS,
  MIXED_MODELS,
  VENDOR_APIMART,
  VENDOR_KIE,
} from '../vendorOrderFixtures'
import { ModelPickerStage } from '../vendorOrderLabKit'
import type { LabState } from '../../labScreen'

const SOURCE = 'docs/design/nomi-design-system.md §2（token）+ §1.5（控件层级）· 用户 2026-09-06 返工要求'

export const PICKER_STATES: readonly LabState[] = [
  {
    id: 'vo-01-picker-preferred',
    name: '有偏好 · 偏好那家排第一并高亮',
    source: SOURCE,
    coverage: 'shell',
    render: () => (
      <ModelPickerStage models={CONFIGURED_MODELS} preferredVendorKeys={[VENDOR_KIE, VENDOR_APIMART]} />
    ),
  },
  {
    id: 'vo-02-picker-no-preference',
    name: '无偏好 · 按供应商分级（官方在前）',
    source: `${SOURCE}｜排序规则见 src/config/modelIdentity.ts sortModelProviders`,
    coverage: 'shell',
    // 没设过偏好时**不该退化成厂商名字母序**：这一格钉住「火山方舟（官方）排在两家中转前面」。
    render: () => <ModelPickerStage models={CONFIGURED_MODELS} />,
  },
  {
    id: 'vo-03-picker-unconfigured-group',
    name: '含未配置分组 · 能跑的在上、没配 key 的沉底灰显',
    source: SOURCE,
    coverage: 'shell',
    render: () => (
      <ModelPickerStage models={MIXED_MODELS} preferredVendorKeys={[VENDOR_APIMART, VENDOR_KIE]} />
    ),
  },
  {
    id: 'vo-04-picker-all-unconfigured',
    name: '全部未配置 · 整张单子只剩「未配置」那一组',
    source: SOURCE,
    coverage: 'shell',
    render: () => <ModelPickerStage models={ALL_UNCONFIGURED_MODELS} />,
  },
  {
    id: 'vo-05-picker-selected-row',
    name: '选中态 · 对勾与 chip 同行不打架',
    source: SOURCE,
    coverage: 'shell',
    // 选中行同时有：加粗模型名 + 一排 chip + 最右对勾。这三样挤在一行里最容易把模型名压没，
    // 所以单独立一格钉住。
    render: () => (
      <ModelPickerStage
        models={CONFIGURED_MODELS}
        preferredVendorKeys={[VENDOR_APIMART]}
        selected="seedream-4-5"
      />
    ),
  },
]
