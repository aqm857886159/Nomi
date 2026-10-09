// 设计实验室 · 屏「应用内更新提醒」· 「为什么更新」弹窗（UpdaterDialog 改造版的身体）：只显示当前语言段、按分组每组 ≤3 条加粗短语。
// 格子渲染的是生产组件的 View 件（夹具数据）；真页面 / 真顶栏见 updateReminderLabKit.tsx 顶部说明。
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
    render: () => <DialogStage locale={'zh-CN'} view="failed" version="0.23.0" errorMessage="net::ERR_CONNECTION_RESET" errorStage="download" errorReason="interrupted" />,
  },
  {
    id: 'update-08-failed-dialog-en',
    name: '⑧ 下载失败的弹窗：人话 + 原始错误一行小字，稍后 · 重试（English）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <DialogStage locale={'en'} view="failed" version="0.23.0" errorMessage="net::ERR_CONNECTION_RESET" errorStage="download" errorReason="interrupted" />,
  },
  {
    id: 'update-05-dialog-downloading-zh',
    name: '⑤ 下载中的弹窗：进度条 + 一句「下载在后台进行，可以继续做片」，只有「知道了」（中文）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <DialogStage locale={'zh-CN'} view="downloading" version="0.23.0" percent={42} />,
  },
  {
    id: 'update-05-dialog-downloading-en',
    name: '⑤ 下载中的弹窗：进度条 + 一句「下载在后台进行，可以继续做片」，只有「知道了」（English）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <DialogStage locale={'en'} view="downloading" version="0.23.0" percent={42} />,
  },
  {
    id: 'update-08-failed-offline-zh',
    name: '⑧ 离线 / 断网时的下载失败：说「网络没连上」，稍后 · 重试，一次点击就重下（中文）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <DialogStage locale={'zh-CN'} view="failed" version="0.23.0" errorMessage="getaddrinfo ENOTFOUND github.com" errorStage="download" errorReason="offline" />,
  },
  {
    id: 'update-08-failed-offline-en',
    name: '⑧ 离线 / 断网时的下载失败：说「网络没连上」，稍后 · 重试，一次点击就重下（English）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <DialogStage locale={'en'} view="failed" version="0.23.0" errorMessage="getaddrinfo ENOTFOUND github.com" errorStage="download" errorReason="offline" />,
  },
  {
    id: 'update-08-install-failed-zh',
    name: '⑧ 安装失败：标题「更新没装上」，重试直接再装（中文）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <DialogStage locale={'zh-CN'} view="failed" version="0.23.0" errorMessage="spawn EACCES" errorStage="install" errorReason="other" />,
  },
  {
    id: 'update-08-install-failed-en',
    name: '⑧ 安装失败：标题「更新没装上」，重试直接再装（English）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <DialogStage locale={'en'} view="failed" version="0.23.0" errorMessage="spawn EACCES" errorStage="install" errorReason="other" />,
  },
  {
    id: 'update-07-dialog-blocked-zh',
    name: '⑦ 点「重启以更新」被主进程拒绝（有任务在跑、数量未知）：回到「有任务在跑，退出时自动装好」，只有「知道了」（中文）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <DialogStage locale={'zh-CN'} view="ready" version="0.23.0" installBlocked />,
  },
  {
    id: 'update-07-dialog-blocked-en',
    name: '⑦ 点「重启以更新」被主进程拒绝（有任务在跑、数量未知）：回到「有任务在跑，退出时自动装好」，只有「知道了」（English）',
    source: SOURCE,
    coverage: 'component-only',
    render: () => <DialogStage locale={'en'} view="ready" version="0.23.0" installBlocked />,
  },
]
