// 设计实验室 · 屏「画布 · 分组框头（对齐拍板样张）」的十格。
//
// 样张：Nomi-交接-20261008/V-1136-approved-renders/Main-1280.png（亮）、Main-dark-1280.png（暗）。
// 十格分别钉：默认、悬停、选中露出工具条、拖动中计数、改名编辑、长组名、空组、普通组、英文、暗色。
// `coverage: 'component-only'`：框头组件在实验室里已搭成真内容，但真机界面还没有数据路径走到它；拍板并接进生产后改成 shell。
//
// 顺序有意义：`labStates.mjs` 按本屏目录里 `NN-*.tsx` 的文件名排序解析。
import React from 'react'

import { CanvasGroupHeaderStage, FRAME_BOUNDS, SIX_MEMBERS, makeGroup } from '../canvasGroupHeaderLabKit'
import type { LabState } from '../../labScreen'

const SIX_IDS = SIX_MEMBERS.map((member) => member.id)

const STORY = makeGroup('grp-story', { name: '雨夜便利店', categoryId: 'shots', nodeIds: SIX_IDS, frameBounds: FRAME_BOUNDS })

// `source`、`id`、`name`、`coverage` 逐条写成字面串、紧挨着（labStates.mjs 按这个形状解析）。
export const CANVAS_GROUP_HEADER_STATES: readonly LabState[] = [
  {
    id: 'hdr-01-default-storyboard',
    name: '分镜组 · 默认：组名 · 镜数 · 生成全部（框内一行）',
    source: '拍板样张 V-1136 Main-1280.png 的 .grp-h；源 design-approved-1008/source/Main.dc.html:53-57',
    coverage: 'component-only',
    render: () => (
      <CanvasGroupHeaderStage locale="zh-CN" group={STORY} members={SIX_MEMBERS} header={{ previewCount: null }} />
    ),
  },
  {
    id: 'hdr-02-hover',
    name: '悬停 · 「生成全部」的悬停底（以 hover 类强制渲染）',
    source: '现役 WorkbenchButton 的 hover 变体（src/design/actions.tsx）',
    coverage: 'component-only',
    render: () => (
      <CanvasGroupHeaderStage locale="zh-CN" group={STORY} members={SIX_MEMBERS} header={{ previewCount: null, forceHover: true }} />
    ),
  },
  {
    id: 'hdr-03-selected-toolbar',
    name: '选中 · 分组工具条露出（框头与工具条不重叠）',
    source: '现役 CanvasGroupToolbar.tsx + groupToolbarPlacement.ts（GROUP_LABEL_RISE 待删，见差异 D5）',
    coverage: 'component-only',
    render: () => (
      <CanvasGroupHeaderStage locale="zh-CN" group={STORY} members={SIX_MEMBERS} header={{ previewCount: null }} selected />
    ),
  },
  {
    id: 'hdr-04-drag-count',
    name: '拖动中 · 计数「6 → 5」在框内标题行可见',
    source: '现役 GroupFrameHeader.tsx 的 countPreview（生产里该计数是 sr-only，见差异 D2）',
    coverage: 'component-only',
    render: () => (
      <CanvasGroupHeaderStage locale="zh-CN" group={STORY} members={SIX_MEMBERS} header={{ previewCount: 5 }} />
    ),
  },
  {
    id: 'hdr-05-rename',
    name: '改名编辑态 · 双击组名进入输入框',
    source: '现役 GroupFrameHeader.tsx 的 nameField（双击标题进编辑态，F4）',
    coverage: 'component-only',
    render: () => (
      <CanvasGroupHeaderStage locale="zh-CN" group={STORY} members={SIX_MEMBERS} header={{ previewCount: null, editing: true }} />
    ),
  },
  {
    id: 'hdr-06-long-name',
    name: '长组名 · 标题截断，计数与按钮不被挤走',
    source: '样张未覆盖；按 F3 与 ★4 全状态补的一格',
    coverage: 'component-only',
    render: () => (
      <CanvasGroupHeaderStage
        locale="zh-CN"
        group={makeGroup('grp-long', { name: '雨夜便利店的深夜与清晨两段长对话拍摄组（重拍版）', categoryId: 'shots', nodeIds: SIX_IDS, frameBounds: FRAME_BOUNDS })}
        members={SIX_MEMBERS}
        header={{ previewCount: null }}
      />
    ),
  },
  {
    id: 'hdr-07-empty-group',
    name: '空组 · 0 镜，「生成全部」禁用，框是虚线',
    source: '样张未覆盖；按 ★4 空状态补的一格。现役 GroupFrame 的 empty 虚线规则',
    coverage: 'component-only',
    render: () => (
      <CanvasGroupHeaderStage
        locale="zh-CN"
        group={makeGroup('grp-empty', { name: '未命名分镜', categoryId: 'shots', nodeIds: [], frameBounds: FRAME_BOUNDS })}
        members={[]}
        header={{ previewCount: null, generateDisabled: true }}
      />
    ),
  },
  {
    id: 'hdr-08-normal-group',
    name: '普通组（非分镜）· 无「分镜 · 」前缀，计数不带「镜」',
    source: '样张只有分镜组；普通组按 F3 的分类规则补的一格',
    coverage: 'component-only',
    render: () => (
      <CanvasGroupHeaderStage
        locale="zh-CN"
        group={makeGroup('grp-normal', { name: '角色组', categoryId: 'cast', nodeIds: SIX_IDS, frameBounds: FRAME_BOUNDS })}
        members={SIX_MEMBERS}
        header={{ previewCount: null }}
      />
    ),
  },
  {
    id: 'hdr-09-en-storyboard',
    name: '英文 · Storyboard 前缀、Generate all、6 shots',
    source: '样张的中英两轨（★4 文案走 i18n）',
    coverage: 'component-only',
    render: () => (
      <CanvasGroupHeaderStage
        locale="en"
        group={makeGroup('grp-story-en', { name: 'Rainy night store', categoryId: 'shots', nodeIds: SIX_IDS, frameBounds: FRAME_BOUNDS })}
        members={SIX_MEMBERS}
        header={{ previewCount: null }}
      />
    ),
  },
  {
    id: 'hdr-10-dark-storyboard',
    name: '暗色 · 分镜组默认（样张 Main-dark-1280.png）',
    source: '拍板样张 V-1136 Main-dark-1280.png；暗色 token 只在 :root[data-mantine-color-scheme=dark] 上',
    coverage: 'component-only',
    scheme: 'dark',
    render: () => (
      <CanvasGroupHeaderStage locale="zh-CN" group={STORY} members={SIX_MEMBERS} header={{ previewCount: null }} scheme="dark" />
    ),
  },
  {
    id: 'hdr-11-en-dark',
    name: '英文 · 暗色 · Storyboard 前缀、Generate all（样张 Main-dark-1280.png 的英文对照）',
    source: '拍板样张 V-1136 Main-dark-1280.png；英文轨与暗色叠加（★4 中英两轨）',
    coverage: 'component-only',
    scheme: 'dark',
    render: () => (
      <CanvasGroupHeaderStage
        locale="en"
        group={makeGroup('grp-story-en-dark', { name: 'Rainy night store', categoryId: 'shots', nodeIds: SIX_IDS, frameBounds: FRAME_BOUNDS })}
        members={SIX_MEMBERS}
        header={{ previewCount: null }}
        scheme="dark"
      />
    ),
  },
]
