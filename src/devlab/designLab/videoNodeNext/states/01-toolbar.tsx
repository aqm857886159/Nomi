// 设计实验室 · 屏「视频节点的下一步」· 选中视频节点的浮条。
// 本文件由四轨（中浅 / 英浅 / 中暗 / 英暗）展开生成，改格子改生成输入而不是手改这里的重复项。
import React from 'react'
import type { LabState } from '../../labScreen'
import { ToolbarStage } from '../videoNodeNextToolbarKit'

const SOURCE = 'docs/plan/2026-10-09-video-node-next.md §1 浮条'

export const VN_TOOLBAR_STATES: readonly LabState[] = [
  {
    id: 'vn-01-frame-menu-zh',
    name: '视频节点选中 · 浮条「截帧▾」展开：当前帧（带播放头时间码）/ 首帧 / 尾帧（中文 · 浅色）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/NodeVideoFrameToolbar.tsx:56',
    coverage: 'component-only',
    capture: 'viewport',
    render: () => <ToolbarStage locale="zh-CN" open="capture-frame" />,
  },
  {
    id: 'vn-01-frame-menu-en',
    name: '视频节点选中 · 浮条「截帧▾」展开：当前帧（带播放头时间码）/ 首帧 / 尾帧（英文 · 浅色）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/NodeVideoFrameToolbar.tsx:56',
    coverage: 'component-only',
    capture: 'viewport',
    render: () => <ToolbarStage locale="en" open="capture-frame" />,
  },
  {
    id: 'vn-01-frame-menu-zh-dark',
    name: '视频节点选中 · 浮条「截帧▾」展开：当前帧（带播放头时间码）/ 首帧 / 尾帧（中文 · 暗色）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/NodeVideoFrameToolbar.tsx:56',
    coverage: 'component-only',
    capture: 'viewport',
    scheme: 'dark',
    render: () => <ToolbarStage locale="zh-CN" open="capture-frame" />,
  },
  {
    id: 'vn-01-frame-menu-en-dark',
    name: '视频节点选中 · 浮条「截帧▾」展开：当前帧（带播放头时间码）/ 首帧 / 尾帧（英文 · 暗色）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/NodeVideoFrameToolbar.tsx:56',
    coverage: 'component-only',
    capture: 'viewport',
    scheme: 'dark',
    render: () => <ToolbarStage locale="en" open="capture-frame" />,
  },
]
