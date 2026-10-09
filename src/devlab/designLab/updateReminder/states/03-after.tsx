// 设计实验室 · 屏「应用内更新提醒」· 更新后：第一次打开新版本，项目库顶部一次性卡片；跳了几版合成一张。
// 格子渲染的是生产组件的 View 件（夹具数据）；真页面 / 真顶栏见 updateReminderLabKit.tsx 顶部说明。
import React from 'react'
import type { LabState } from '../../labScreen'
import { LibraryStage } from '../updateReminderLabKit'

const SOURCE = '协调会话 10-08 brief-D-update：应用内更新提醒推荐方案（胶囊进顶栏 / 热修横幅 / 当前语言摘要弹窗 / 退出时装 / Mac 三步 / 更新后卡片）'

export const UPDATE_AFTER_STATES: readonly LabState[] = [
  {
    id: 'update-09-updated-card-zh',
    name: '⑨ 更新后第一次打开：已更新到 0.23.1 + 标题句 + 3 条 + 完整说明 + ✕，只出一次（中文）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <LibraryStage locale={'zh-CN'} scenario={{ updatedCard: { to: '0.23.1', chain: ['0.23.1'] } }} />,
  },
  {
    id: 'update-09-updated-card-en',
    name: '⑨ 更新后第一次打开：已更新到 0.23.1 + 标题句 + 3 条 + 完整说明 + ✕，只出一次（English）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <LibraryStage locale={'en'} scenario={{ updatedCard: { to: '0.23.1', chain: ['0.23.1'] } }} />,
  },
  {
    id: 'update-09-updated-card-zh-dark',
    name: '⑨ 更新后第一次打开：已更新到 0.23.1 + 标题句 + 3 条 + 完整说明 + ✕，只出一次（中文 · 暗色）',
    source: SOURCE,
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <LibraryStage locale={'zh-CN'} scenario={{ updatedCard: { to: '0.23.1', chain: ['0.23.1'] } }} />,
  },
  {
    id: 'update-09-updated-card-merged-zh',
    name: '⑨ 跳版合成：从 0.22.5 更新到 0.23.1（0.23.1 + 0.23.0 两份说明合成一张，取最新标题、从新到旧 3 条）（中文）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <LibraryStage locale={'zh-CN'} scenario={{ updatedCard: { from: '0.22.5', to: '0.23.1', chain: ['0.23.1', '0.23.0'] } }} />,
  },
  {
    id: 'update-09-updated-card-merged-en',
    name: '⑨ 跳版合成：从 0.22.5 更新到 0.23.1（0.23.1 + 0.23.0 两份说明合成一张，取最新标题、从新到旧 3 条）（English）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <LibraryStage locale={'en'} scenario={{ updatedCard: { from: '0.22.5', to: '0.23.1', chain: ['0.23.1', '0.23.0'] } }} />,
  },
]
