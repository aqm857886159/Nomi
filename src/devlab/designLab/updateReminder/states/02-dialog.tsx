// 设计实验室 · 屏「应用内更新提醒」· 「为什么更新」弹窗（UpdaterDialog 改造版的身体）：只显示当前语言段、按分组每组 ≤3 条加粗短语。
// 改造件是样张（生产未接），所以 coverage 一律 component-only；真页面 / 真顶栏见 updateReminderLabKit.tsx 顶部说明。
import React from 'react'
import type { LabState } from '../../labScreen'
import { DialogStage } from '../updateReminderLabKit'

const SOURCE = '协调会话 10-08 brief-D-update：应用内更新提醒推荐方案（胶囊进顶栏 / 热修横幅 / 当前语言摘要弹窗 / 退出时装 / Mac 三步 / 更新后卡片）'

export const UPDATE_DIALOG_STATES: readonly LabState[] = [
  {
    id: 'update-03-dialog-windows-zh',
    name: '③ Windows 有新版（0.23.0 真实说明）：标题句 + 前 4 组摘要 + 安装包大小 + 「项目都在你电脑上」，底栏 完整说明｜稍后 · 下载更新（中文）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <DialogStage locale={'zh-CN'} view="available" version="0.23.0" />,
  },
  {
    id: 'update-03-dialog-windows-en',
    name: '③ Windows 有新版（0.23.0 真实说明）：标题句 + 前 4 组摘要 + 安装包大小 + 「项目都在你电脑上」，底栏 完整说明｜稍后 · 下载更新（English）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <DialogStage locale={'en'} view="available" version="0.23.0" />,
  },
  {
    id: 'update-03-dialog-windows-zh-dark',
    name: '③ Windows 有新版（0.23.0 真实说明）：标题句 + 前 4 组摘要 + 安装包大小 + 「项目都在你电脑上」，底栏 完整说明｜稍后 · 下载更新（中文 · 暗色）',
    source: SOURCE,
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <DialogStage locale={'zh-CN'} view="available" version="0.23.0" />,
  },
  {
    id: 'update-04-dialog-mac-steps-zh',
    name: '④ Mac 点「去下载新版」后的第二屏（0.23.1 真实说明）：三步换版（中文）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <DialogStage locale={'zh-CN'} view="mac-steps" version="0.23.1" canAutoInstall={false} />,
  },
  {
    id: 'update-04-dialog-mac-steps-en',
    name: '④ Mac 点「去下载新版」后的第二屏（0.23.1 真实说明）：三步换版（English）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <DialogStage locale={'en'} view="mac-steps" version="0.23.1" canAutoInstall={false} />,
  },
  {
    id: 'update-06-dialog-ready-zh',
    name: '⑥ 下好了、没有任务在跑：稍后 · 重启以更新；不点也会在退出时装好（中文）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <DialogStage locale={'zh-CN'} view="ready" version="0.23.0" />,
  },
  {
    id: 'update-06-dialog-ready-en',
    name: '⑥ 下好了、没有任务在跑：稍后 · 重启以更新；不点也会在退出时装好（English）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <DialogStage locale={'en'} view="ready" version="0.23.0" />,
  },
  {
    id: 'update-07-dialog-ready-running-zh',
    name: '⑦ 下好了、3 个任务在跑：不给重启按钮，说清现在重启会中断、退出时自动装好，只有「知道了」（中文）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <DialogStage locale={'zh-CN'} view="ready" version="0.23.0" runningTasks={3} />,
  },
  {
    id: 'update-07-dialog-ready-running-en',
    name: '⑦ 下好了、3 个任务在跑：不给重启按钮，说清现在重启会中断、退出时自动装好，只有「知道了」（English）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <DialogStage locale={'en'} view="ready" version="0.23.0" runningTasks={3} />,
  },
  {
    id: 'update-07-dialog-ready-running-zh-dark',
    name: '⑦ 下好了、3 个任务在跑：不给重启按钮，说清现在重启会中断、退出时自动装好，只有「知道了」（中文 · 暗色）',
    source: SOURCE,
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <DialogStage locale={'zh-CN'} view="ready" version="0.23.0" runningTasks={3} />,
  },
  {
    id: 'update-08-failed-dialog-zh',
    name: '⑧ 下载失败的弹窗：人话 + 原始错误一行小字，稍后 · 重试（中文）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <DialogStage locale={'zh-CN'} view="failed" version="0.23.0" errorMessage="net::ERR_CONNECTION_RESET" />,
  },
  {
    id: 'update-08-failed-dialog-en',
    name: '⑧ 下载失败的弹窗：人话 + 原始错误一行小字，稍后 · 重试（English）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <DialogStage locale={'en'} view="failed" version="0.23.0" errorMessage="net::ERR_CONNECTION_RESET" />,
  },
]
