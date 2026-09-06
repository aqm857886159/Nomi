// 设计实验室 · 设置「隐私与诊断」那一格的四态。
//
// 顺序有意义：`labStates.mjs` 按本屏目录里 `NN-*.tsx` 的文件名排序解析，汇总口
// （`settingsStates.tsx`）按同样顺序拼接，走查再拿活页面的 `window.__designLabStates`
// 与解析结果逐项比对——三者对不上当场红。加状态时别打乱数字前缀。
//
// 为什么整块一起取景而不是只截导出那一行：这一格是**一格两半**——上半是
// 「要不要往外发匿名计数」（#522 的遥测），下半是「出事时怎么把本机证据交出来」（诊断包）。
// 拍板要看的正是这两半放在一起读不读得通，分开截就把那个判断删掉了。
import React from 'react'
import { TelemetrySection } from '../../../../workbench/settings/TelemetrySection'
import { DiagnosticsBundleSection } from '../../../../workbench/settings/DiagnosticsBundleSection'
import { SettingsStage } from '../settingsLabKit'
import type { LabState } from '../../labScreen'

function PrivacyBlock(): JSX.Element {
  return (
    <>
      <TelemetrySection />
      <DiagnosticsBundleSection />
    </>
  )
}

export const PRIVACY_DIAGNOSTICS_STATES: readonly LabState[] = [
  {
    id: 'privacy-01-idle',
    name: '隐私与诊断 · 默认（遥测关 · 未导出）',
    source: '现役 TelemetrySection.tsx + DiagnosticsBundleSection.tsx（docs/plan/2026-09-06-logging-and-diagnostics-bundle.md §4）',
    coverage: 'shell',
    render: () => (
      <SettingsStage behavior={{ ok: false, reason: 'canceled' }}>
        <PrivacyBlock />
      </SettingsStage>
    ),
  },
  {
    id: 'privacy-02-exporting',
    name: '正在打包（按钮禁用 · 文案换成「正在打包…」）',
    source: '现役 DiagnosticsBundleSection.tsx 的 busy 分支',
    coverage: 'shell',
    render: () => (
      <SettingsStage behavior="never-settles" autoExport>
        <PrivacyBlock />
      </SettingsStage>
    ),
  },
  {
    id: 'privacy-03-saved',
    name: '导出成功 · 结果行报条目数与体积',
    source: '现役 DiagnosticsBundleSection.tsx 的 ok 分支',
    coverage: 'shell',
    render: () => (
      <SettingsStage
        behavior={{ ok: true, filePath: '/tmp/nomi-diagnostics.zip', entryCount: 7, totalBytes: 3 * 1024 * 1024 }}
        autoExport
      >
        <PrivacyBlock />
      </SettingsStage>
    ),
  },
  {
    id: 'privacy-04-failed',
    name: '导出失败 · 结果行说人话并请再试',
    source: '现役 DiagnosticsBundleSection.tsx 的 failed 分支',
    coverage: 'shell',
    render: () => (
      <SettingsStage behavior={{ ok: false, reason: 'failed' }} autoExport>
        <PrivacyBlock />
      </SettingsStage>
    ),
  },
]
