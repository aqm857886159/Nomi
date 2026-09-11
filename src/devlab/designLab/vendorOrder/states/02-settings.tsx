// 设计实验室 · 供应商偏好屏 · 设置区（设置 → AI 策略 → 优先供应商）。
//
// 渲染的就是现役 `VendorPreferenceOrderSection`：没有桥的环境里 `useVendorPreferenceOrder()`
// 取不到已存顺序、静默回落成空数组，于是显示顺序 = 传进去的 entries 顺序——正好让这一格
// 用夹具决定「排第几」，不用去碰 IPC。
import React from 'react'

import { VendorPreferenceOrderSection } from '../../../../workbench/settings/VendorPreferenceOrderSection'
import { CONFIGURED_VENDOR_ENTRIES, MODEL_BOX_MODELS, MODEL_BOX_PREFERENCE } from '../vendorOrderFixtures'
import { ModelBoxSettingsStage, SettingsStage } from '../vendorOrderLabKit'
import type { LabState } from '../../labScreen'

// `source` 逐条写字面单引号串，理由同 01-picker.tsx（那把源码正则只认这种形状）。
export const SETTINGS_STATES: readonly LabState[] = [
  {
    id: 'vo-07-settings-order',
    name: '默认走哪家 · 三家可排序',
    source: 'docs/design/nomi-design-system.md §1.7.2 接入 vs 策略 · 用户 2026-09-06 返工要求',
    coverage: 'shell',
    render: () => (
      <SettingsStage>
        <VendorPreferenceOrderSection entries={CONFIGURED_VENDOR_ENTRIES} />
      </SettingsStage>
    ),
  },
  {
    id: 'vo-08-settings-two-vendors',
    name: '默认走哪家 · 两家（首尾两端的禁用态）',
    source: 'docs/design/nomi-design-system.md §1.7.2 接入 vs 策略 · 用户 2026-09-06 返工要求',
    coverage: 'shell',
    // 只有两家时上移/下移各有一个是禁用的。禁用态必须看得出「点不了」而不是「点了没反应」
    // （设计系统 §1.6 C1）。
    render: () => (
      <SettingsStage>
        <VendorPreferenceOrderSection entries={CONFIGURED_VENDOR_ENTRIES.slice(0, 2)} />
      </SettingsStage>
    ),
  },
  {
    id: 'vo-09-settings-model-box',
    name: '模型框里显示哪些、排在哪 · 含「已隐藏 · 2」找回组',
    source: 'docs/plan/2026-09-11-model-box-tidy.md §5 + 样张 Main.dc.html · 用户 2026-09-11 拍板',
    coverage: 'shell',
    // 「已隐藏 · 2」这一组是整块设计里最容易被做丢的一半（藏了找不回来 = 隐藏等于删除），
    // 所以这一格刻意种了两个隐藏项，把它钉在基线里。
    render: () => <ModelBoxSettingsStage preference={MODEL_BOX_PREFERENCE} models={MODEL_BOX_MODELS} />,
  },
]
