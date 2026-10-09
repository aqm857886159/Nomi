// 设计实验室 · 屏「应用内更新提醒」· 发现：顶栏胶囊（攒批版只有胶囊）、热修版多一条项目库横幅、下载中、下载失败。
// 格子渲染的是生产组件的 View 件（夹具数据）；真页面 / 真顶栏见 updateReminderLabKit.tsx 顶部说明。
import React from 'react'
import type { LabState } from '../../labScreen'
import { AppBarStage, LibraryStage } from '../updateReminderLabKit'

const SOURCE = '协调会话 10-08 brief-D-update：应用内更新提醒推荐方案（胶囊进顶栏 / 热修横幅 / 当前语言摘要弹窗 / 退出时装 / Mac 三步 / 更新后卡片）'

export const UPDATE_DISCOVER_STATES: readonly LabState[] = [
  {
    id: 'update-01-badge-library-zh',
    name: '① 攒批版 0.24：项目库窗口栏右侧多一颗「新版本 0.24」，和模型 / 浏览器 / 设置同一族，不浮在内容上（中文）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <LibraryStage locale={'zh-CN'} badge={{ phase: 'available', version: '0.24.0' }} />,
  },
  {
    id: 'update-01-badge-library-en',
    name: '① 攒批版 0.24：项目库窗口栏右侧多一颗「新版本 0.24」，和模型 / 浏览器 / 设置同一族，不浮在内容上（English）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <LibraryStage locale={'en'} badge={{ phase: 'available', version: '0.24.0' }} />,
  },
  {
    id: 'update-01-badge-library-zh-dark',
    name: '① 攒批版 0.24：项目库窗口栏右侧多一颗「新版本 0.24」，和模型 / 浏览器 / 设置同一族，不浮在内容上（中文 · 暗色）',
    source: SOURCE,
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <LibraryStage locale={'zh-CN'} badge={{ phase: 'available', version: '0.24.0' }} />,
  },
  {
    id: 'update-01-badge-project-zh',
    name: '① 攒批版 0.24：项目里的顶栏右簇最前面一颗胶囊，画布上什么都不出（中文）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <AppBarStage locale={'zh-CN'} badge={{ phase: 'available', version: '0.24.0' }} />,
  },
  {
    id: 'update-01-badge-project-en',
    name: '① 攒批版 0.24：项目里的顶栏右簇最前面一颗胶囊，画布上什么都不出（English）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <AppBarStage locale={'en'} badge={{ phase: 'available', version: '0.24.0' }} />,
  },
  {
    id: 'update-01-badge-project-zh-dark',
    name: '① 攒批版 0.24：项目里的顶栏右簇最前面一颗胶囊，画布上什么都不出（中文 · 暗色）',
    source: SOURCE,
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <AppBarStage locale={'zh-CN'} badge={{ phase: 'available', version: '0.24.0' }} />,
  },
  {
    id: 'update-02-hotfix-banner-zh',
    name: '② 热修版 0.23.1：胶囊 + 项目库顶部一次性横幅（发版说明标题句 + 看看 + ✕）（中文）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <LibraryStage locale={'zh-CN'} badge={{ phase: 'available', version: '0.23.1' }} scenario={{ platform: 'darwin' }} />,
  },
  {
    id: 'update-02-hotfix-banner-en',
    name: '② 热修版 0.23.1：胶囊 + 项目库顶部一次性横幅（发版说明标题句 + 看看 + ✕）（English）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <LibraryStage locale={'en'} badge={{ phase: 'available', version: '0.23.1' }} scenario={{ platform: 'darwin' }} />,
  },
  {
    id: 'update-02-hotfix-banner-zh-dark',
    name: '② 热修版 0.23.1：胶囊 + 项目库顶部一次性横幅（发版说明标题句 + 看看 + ✕）（中文 · 暗色）',
    source: SOURCE,
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <LibraryStage locale={'zh-CN'} badge={{ phase: 'available', version: '0.23.1' }} scenario={{ platform: 'darwin' }} />,
  },
  {
    id: 'update-05-badge-downloading-zh',
    name: '⑤ 下载中：胶囊直接写进度 42%，不弹窗（中文）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <LibraryStage locale={'zh-CN'} clipHeight={140} badge={{ phase: 'downloading', version: '0.24.0', percent: 42 }} />,
  },
  {
    id: 'update-05-badge-downloading-en',
    name: '⑤ 下载中：胶囊直接写进度 42%，不弹窗（English）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <LibraryStage locale={'en'} clipHeight={140} badge={{ phase: 'downloading', version: '0.24.0', percent: 42 }} />,
  },
  {
    id: 'update-08-failed-badge-zh',
    name: '⑧ 下载失败：胶囊变「更新没下完 · 重试」（危险色），后台检查失败不出（中文）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <LibraryStage locale={'zh-CN'} clipHeight={140} badge={{ phase: 'error', version: '0.24.0' }} />,
  },
  {
    id: 'update-08-failed-badge-en',
    name: '⑧ 下载失败：胶囊变「更新没下完 · 重试」（危险色），后台检查失败不出（English）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <LibraryStage locale={'en'} clipHeight={140} badge={{ phase: 'error', version: '0.24.0' }} />,
  },
  {
    id: 'update-01-badge-compact-zh',
    name: '① 窄窗口：胶囊收成带点的图标（标签收起，点开仍是同一个弹窗）（中文）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <AppBarStage locale={'zh-CN'} badge={{ phase: 'available', version: '0.24.0', compact: true }} />,
  },
  {
    id: 'update-01-badge-compact-en',
    name: '① 窄窗口：胶囊收成带点的图标（标签收起，点开仍是同一个弹窗）（English）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <AppBarStage locale={'en'} badge={{ phase: 'available', version: '0.24.0', compact: true }} />,
  },
  {
    id: 'update-01-badge-ready-zh',
    name: '⑥ 下好了：胶囊变「重启以更新」（中文）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <AppBarStage locale={'zh-CN'} badge={{ phase: 'downloaded', version: '0.24.0' }} />,
  },
  {
    id: 'update-01-badge-ready-en',
    name: '⑥ 下好了：胶囊变「重启以更新」（English）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <AppBarStage locale={'en'} badge={{ phase: 'downloaded', version: '0.24.0' }} />,
  },
]
