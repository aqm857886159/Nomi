// 设计实验室 · 屏「视频节点的下一步」· 截当前帧：旁边出一张图片卡并连线。
// 本文件由四轨（中浅 / 英浅 / 中暗 / 英暗）展开生成，改格子改生成输入而不是手改这里的重复项。
import React from 'react'
import type { LabState } from '../../labScreen'
import { SceneStage } from '../videoNodeNextCanvasKit'

const SOURCE = 'docs/plan/2026-10-09-video-node-next.md §2 截帧'

export const VN_FRAME_STATES: readonly LabState[] = [
  {
    id: 'vn-02-frame-done-zh',
    name: '截当前帧之后 · 原视频右侧新出一张图片卡（停在 0:07.2 的那一帧）并连上线，原视频不动（中文 · 浅色）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/extractVideoFrameToNode.ts:49',
    coverage: 'shell',
    render: () => <SceneStage locale="zh-CN" scene="frame-done" />,
  },
  {
    id: 'vn-02-frame-done-en',
    name: '截当前帧之后 · 原视频右侧新出一张图片卡（停在 0:07.2 的那一帧）并连上线，原视频不动（英文 · 浅色）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/extractVideoFrameToNode.ts:49',
    coverage: 'shell',
    render: () => <SceneStage locale="en" scene="frame-done" />,
  },
  {
    id: 'vn-02-frame-done-zh-dark',
    name: '截当前帧之后 · 原视频右侧新出一张图片卡（停在 0:07.2 的那一帧）并连上线，原视频不动（中文 · 暗色）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/extractVideoFrameToNode.ts:49',
    coverage: 'shell',
    scheme: 'dark',
    render: () => <SceneStage locale="zh-CN" scene="frame-done" />,
  },
  {
    id: 'vn-02-frame-done-en-dark',
    name: '截当前帧之后 · 原视频右侧新出一张图片卡（停在 0:07.2 的那一帧）并连上线，原视频不动（英文 · 暗色）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/extractVideoFrameToNode.ts:49',
    coverage: 'shell',
    scheme: 'dark',
    render: () => <SceneStage locale="en" scene="frame-done" />,
  },
]
