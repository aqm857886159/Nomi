// 设计实验室 · 屏「视频节点的下一步」· 按镜头拆：拆成图片 / 视频片段。
// 本文件由四轨（中浅 / 英浅 / 中暗 / 英暗）展开生成，改格子改生成输入而不是手改这里的重复项。
import React from 'react'
import type { LabState } from '../../labScreen'
import { SplitStage } from '../videoNodeNextSplit'
import { SceneStage } from '../videoNodeNextCanvasKit'

const SOURCE = 'docs/plan/2026-10-09-video-node-next.md §4 按镜头拆'

export const VN_SPLIT_STATES: readonly LabState[] = [
  {
    id: 'vn-08-split-image-zh',
    name: '按镜头拆 · 面板底栏多一个「拆成：图片｜视频片段」，默认图片（和今天一样）（中文 · 浅色）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/NodeShotCutPanel.tsx:336',
    coverage: 'component-only',
    render: () => <SplitStage locale="zh-CN" mode="image" />,
  },
  {
    id: 'vn-08-split-image-en',
    name: '按镜头拆 · 面板底栏多一个「拆成：图片｜视频片段」，默认图片（和今天一样）（英文 · 浅色）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/NodeShotCutPanel.tsx:336',
    coverage: 'component-only',
    render: () => <SplitStage locale="en" mode="image" />,
  },
  {
    id: 'vn-08-split-image-zh-dark',
    name: '按镜头拆 · 面板底栏多一个「拆成：图片｜视频片段」，默认图片（和今天一样）（中文 · 暗色）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/NodeShotCutPanel.tsx:336',
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <SplitStage locale="zh-CN" mode="image" />,
  },
  {
    id: 'vn-08-split-image-en-dark',
    name: '按镜头拆 · 面板底栏多一个「拆成：图片｜视频片段」，默认图片（和今天一样）（英文 · 暗色）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/NodeShotCutPanel.tsx:336',
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <SplitStage locale="en" mode="image" />,
  },
  {
    id: 'vn-09-split-video-zh',
    name: '按镜头拆 · 选「视频片段」，面板按 5 段显示（每段一格、起止区间），标题 5 个镜头，主按钮拆成 5 段视频（中文 · 浅色）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/NodeShotCutPanel.tsx:336',
    coverage: 'component-only',
    render: () => <SplitStage locale="zh-CN" mode="video" />,
  },
  {
    id: 'vn-09-split-video-en',
    name: '按镜头拆 · 选「视频片段」，面板按 5 段显示（每段一格、起止区间），标题 5 个镜头，主按钮拆成 5 段视频（英文 · 浅色）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/NodeShotCutPanel.tsx:336',
    coverage: 'component-only',
    render: () => <SplitStage locale="en" mode="video" />,
  },
  {
    id: 'vn-09-split-video-zh-dark',
    name: '按镜头拆 · 选「视频片段」，面板按 5 段显示（每段一格、起止区间），标题 5 个镜头，主按钮拆成 5 段视频（中文 · 暗色）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/NodeShotCutPanel.tsx:336',
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <SplitStage locale="zh-CN" mode="video" />,
  },
  {
    id: 'vn-09-split-video-en-dark',
    name: '按镜头拆 · 选「视频片段」，面板按 5 段显示（每段一格、起止区间），标题 5 个镜头，主按钮拆成 5 段视频（英文 · 暗色）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/NodeShotCutPanel.tsx:336',
    coverage: 'component-only',
    scheme: 'dark',
    render: () => <SplitStage locale="en" mode="video" />,
  },
  {
    id: 'vn-10-split-done-zh',
    name: '拆成视频片段之后 · 一组连好的视频卡（现役编组框），原视频不动（中文 · 浅色）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/extractShotCutsToNodes.ts:80',
    coverage: 'shell',
    render: () => <SceneStage locale="zh-CN" scene="split-done" zoom={0.5} offset={{ x: 110, y: 30 }} width={1280} height={470} />,
  },
  {
    id: 'vn-10-split-done-en',
    name: '拆成视频片段之后 · 一组连好的视频卡（现役编组框），原视频不动（英文 · 浅色）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/extractShotCutsToNodes.ts:80',
    coverage: 'shell',
    render: () => <SceneStage locale="en" scene="split-done" zoom={0.5} offset={{ x: 110, y: 30 }} width={1280} height={470} />,
  },
  {
    id: 'vn-10-split-done-zh-dark',
    name: '拆成视频片段之后 · 一组连好的视频卡（现役编组框），原视频不动（中文 · 暗色）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/extractShotCutsToNodes.ts:80',
    coverage: 'shell',
    scheme: 'dark',
    render: () => <SceneStage locale="zh-CN" scene="split-done" zoom={0.5} offset={{ x: 110, y: 30 }} width={1280} height={470} />,
  },
  {
    id: 'vn-10-split-done-en-dark',
    name: '拆成视频片段之后 · 一组连好的视频卡（现役编组框），原视频不动（英文 · 暗色）',
    source: SOURCE,
    mirrors: 'src/workbench/generationCanvas/nodes/extractShotCutsToNodes.ts:80',
    coverage: 'shell',
    scheme: 'dark',
    render: () => <SceneStage locale="en" scene="split-done" zoom={0.5} offset={{ x: 110, y: 30 }} width={1280} height={470} />,
  },
]
