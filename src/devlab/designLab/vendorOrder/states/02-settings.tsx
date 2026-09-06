// 设计实验室 · 供应商偏好屏 · 设置区（设置 → AI 策略 → 优先供应商）。
//
// 渲染的就是现役 `VendorPreferenceOrderSection`：没有桥的环境里 `useVendorPreferenceOrder()`
// 取不到已存顺序、静默回落成空数组，于是显示顺序 = 传进去的 entries 顺序——正好让这一格
// 用夹具决定「排第几」，不用去碰 IPC。
import React from 'react'

import { VendorPreferenceOrderSection } from '../../../../workbench/settings/VendorPreferenceOrderSection'
import { CONFIGURED_VENDOR_ENTRIES } from '../vendorOrderFixtures'
import { SettingsStage } from '../vendorOrderLabKit'
import type { LabState } from '../../labScreen'

// `source` 逐条写字面单引号串，理由同 01-picker.tsx（那把源码正则只认这种形状）。
export const SETTINGS_STATES: readonly LabState[] = [
  {
    id: 'vo-06-settings-order',
    name: '优先供应商 · 三家可排序',
    source: 'docs/design/nomi-design-system.md §1.7.2 接入 vs 策略 · 用户 2026-09-06 返工要求',
    coverage: 'shell',
    render: () => (
      <SettingsStage>
        <VendorPreferenceOrderSection entries={CONFIGURED_VENDOR_ENTRIES} />
      </SettingsStage>
    ),
  },
  {
    id: 'vo-07-settings-two-vendors',
    name: '优先供应商 · 两家（首尾两端的禁用态）',
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
]
