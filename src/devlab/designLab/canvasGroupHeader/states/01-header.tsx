// 设计实验室 · 分组框（10-10 拍板后的生产组件）的状态清单。
//
// 框、框头、工具条、折叠卡都是生产组件本体；这里只管夹具。顺序有意义：`labStates.mjs` 按文件名排序解析。
// `coverage: 'shell'`：生产里已接好，真机界面能走到这些形态。
import React from 'react'

import { CanvasGroupHeaderStage, CollapsedGroupStage, FRAME_BOUNDS, SIX_MEMBERS, STORYBOARD_STAMP, makeGroup } from '../canvasGroupHeaderLabKit'
import type { LabState } from '../../labScreen'

const SIX_IDS = SIX_MEMBERS.map((member) => member.id)

const STORY = makeGroup('grp-story', { name: '雨夜便利店', nodeIds: SIX_IDS, frameBounds: FRAME_BOUNDS, ...STORYBOARD_STAMP })
const NORMAL = makeGroup('grp-normal', { name: '角色组', categoryId: 'cast', nodeIds: SIX_IDS, frameBounds: FRAME_BOUNDS })

// `id` / `name` / `source` / `coverage` 逐条写成字面串、紧挨着（labStates.mjs 按这个形状解析）。
export const CANVAS_GROUP_HEADER_STATES: readonly LabState[] = [
  {
    id: 'grp-01-default-storyboard',
    name: '分镜组 · 默认：框内左上「分镜 · 组名 · 6 镜」、右上「生成全部」，无边框，底色中性灰',
    source: '拍板 2026-10-10 · 用户原话「默认框里面的颜色做区分」；框头 GroupFrameHeader.tsx',
    coverage: 'shell',
    render: () => <CanvasGroupHeaderStage locale="zh-CN" group={STORY} members={SIX_MEMBERS} />,
  },
  {
    id: 'grp-02-normal-group',
    name: '普通组 · 无「分镜 · 」前缀，计数写「6 个」',
    source: '拍板 2026-10-10 · D1（普通组只显示组名，计数写「N 个」）',
    coverage: 'shell',
    render: () => <CanvasGroupHeaderStage locale="zh-CN" group={NORMAL} members={SIX_MEMBERS} />,
  },
  {
    id: 'grp-03-selected-toolbar',
    name: '选中 · 工具条露出，框体不加任何描边',
    source: '拍板 2026-10-10 追加 · 选中不加描边，选中态靠工具条表示',
    coverage: 'shell',
    render: () => <CanvasGroupHeaderStage locale="zh-CN" group={STORY} members={SIX_MEMBERS} options={{ selected: true }} />,
  },
  {
    id: 'grp-04-drag-count-leave',
    name: '拖动出框 · 计数「6 → 5」可见，框变虚线',
    source: '拍板 2026-10-10 · D2 计数可见；拖动反馈不用蓝色',
    coverage: 'shell',
    render: () => <CanvasGroupHeaderStage locale="zh-CN" group={STORY} members={SIX_MEMBERS} options={{ membership: 'leave', previewCount: 5 }} />,
  },
  {
    id: 'grp-05-drag-count-join',
    name: '拖入框 · 计数「6 → 7」可见，底色加深一档（不用蓝色）',
    source: '拍板 2026-10-10 追加 · 落点反馈改为底色加深一档',
    coverage: 'shell',
    render: () => <CanvasGroupHeaderStage locale="zh-CN" group={STORY} members={SIX_MEMBERS} options={{ membership: 'join', previewCount: 7 }} />,
  },
  {
    id: 'grp-06-rename-editing',
    name: '编辑态 · 组名与说明两个输入框（菜单「编辑」打开）',
    source: '拍板 2026-10-10 · P1 说明字段并入菜单「编辑」',
    coverage: 'shell',
    render: () => <CanvasGroupHeaderStage locale="zh-CN" group={STORY} members={SIX_MEMBERS} options={{ editing: true }} />,
  },
  {
    id: 'grp-07-long-name',
    name: '长组名 · 标题截断，计数与「生成全部」不被挤走',
    source: '框头 GroupFrameHeader.tsx（truncate）',
    coverage: 'shell',
    render: () => (
      <CanvasGroupHeaderStage
        locale="zh-CN"
        group={makeGroup('grp-long', { name: '雨夜便利店的深夜与清晨两段长对话拍摄组（重拍版）', nodeIds: SIX_IDS, frameBounds: FRAME_BOUNDS, ...STORYBOARD_STAMP })}
        members={SIX_MEMBERS}
      />
    ),
  },
  {
    id: 'grp-08-empty-group',
    name: '空组 · 0 镜，「生成全部」禁用，框是虚线',
    source: '框头 GroupFrameHeader.tsx（disabled）+ GroupFrame 的 empty 虚线规则',
    coverage: 'shell',
    render: () => (
      <CanvasGroupHeaderStage
        locale="zh-CN"
        group={makeGroup('grp-empty', { name: '未命名分镜', nodeIds: [], frameBounds: FRAME_BOUNDS, ...STORYBOARD_STAMP })}
        members={[]}
      />
    ),
  },
  {
    id: 'grp-09-en-storyboard',
    name: '英文 · Storyboard 前缀、6 shots、Generate all',
    source: '拍板 2026-10-10 · 中英两轨（check:i18n）',
    coverage: 'shell',
    render: () => (
      <CanvasGroupHeaderStage
        locale="en"
        group={makeGroup('grp-story-en', { name: 'Rainy night store', nodeIds: SIX_IDS, frameBounds: FRAME_BOUNDS, ...STORYBOARD_STAMP })}
        members={SIX_MEMBERS}
      />
    ),
  },
  {
    id: 'grp-10-collapsed-neutral',
    name: '折叠成卡 · 默认中性灰底（同一规则）',
    source: '拍板 2026-10-10 · D4 折叠态的组卡跟同一规则；CollapsedGroupCard.tsx',
    coverage: 'shell',
    render: () => <CollapsedGroupStage locale="zh-CN" name="雨夜便利店" memberCount={6} />,
  },
  {
    id: 'grp-11-collapsed-ocean',
    name: '折叠成卡 · 选了海蓝：底色换 ocean soft，无描边',
    source: '拍板 2026-10-10 · D4',
    coverage: 'shell',
    render: () => <CollapsedGroupStage locale="zh-CN" name="雨夜便利店" memberCount={6} colorToken="ocean" />,
  },
  {
    id: 'grp-12-en-dark-storyboard',
    name: '英文 · 暗色 · 分镜组（底色中性灰暗档）',
    source: '拍板 2026-10-10 · 暗色 token（tailwind.config.ts 暗档）',
    coverage: 'shell',
    scheme: 'dark',
    render: () => (
      <CanvasGroupHeaderStage
        locale="en"
        group={makeGroup('grp-story-en-dark', { name: 'Rainy night store', nodeIds: SIX_IDS, frameBounds: FRAME_BOUNDS, ...STORYBOARD_STAMP })}
        members={SIX_MEMBERS}
        options={{ scheme: 'dark', selected: true }}
      />
    ),
  },
  // ── 六色 × 亮 ──
  {
    id: 'grp-13-light-ocean',
    name: '六色 · 亮 · ocean（海蓝：底色 ocean soft，无边框，无圆点）',
    source: '拍板 2026-10-10 · D4 颜色 token 六色亮档（tailwind.config.ts / nomi-tokens.css）',
    coverage: 'shell',
    render: () => (
      <CanvasGroupHeaderStage
        locale="zh-CN"
        group={makeGroup('grp-light-ocean', { name: 'ocean 组', nodeIds: SIX_IDS, frameBounds: FRAME_BOUNDS, colorToken: 'ocean', ...STORYBOARD_STAMP })}
        members={SIX_MEMBERS}
      />
    ),
  },
  {
    id: 'grp-14-light-teal',
    name: '六色 · 亮 · teal（青绿：底色 teal soft，无边框，无圆点）',
    source: '拍板 2026-10-10 · D4 颜色 token 六色亮档（tailwind.config.ts / nomi-tokens.css）',
    coverage: 'shell',
    render: () => (
      <CanvasGroupHeaderStage
        locale="zh-CN"
        group={makeGroup('grp-light-teal', { name: 'teal 组', nodeIds: SIX_IDS, frameBounds: FRAME_BOUNDS, colorToken: 'teal', ...STORYBOARD_STAMP })}
        members={SIX_MEMBERS}
      />
    ),
  },
  {
    id: 'grp-15-light-amber',
    name: '六色 · 亮 · amber（琥珀：底色 amber soft，无边框，无圆点）',
    source: '拍板 2026-10-10 · D4 颜色 token 六色亮档（tailwind.config.ts / nomi-tokens.css）',
    coverage: 'shell',
    render: () => (
      <CanvasGroupHeaderStage
        locale="zh-CN"
        group={makeGroup('grp-light-amber', { name: 'amber 组', nodeIds: SIX_IDS, frameBounds: FRAME_BOUNDS, colorToken: 'amber', ...STORYBOARD_STAMP })}
        members={SIX_MEMBERS}
      />
    ),
  },
  {
    id: 'grp-16-light-coral',
    name: '六色 · 亮 · coral（珊瑚：底色 coral soft，无边框，无圆点）',
    source: '拍板 2026-10-10 · D4 颜色 token 六色亮档（tailwind.config.ts / nomi-tokens.css）',
    coverage: 'shell',
    render: () => (
      <CanvasGroupHeaderStage
        locale="zh-CN"
        group={makeGroup('grp-light-coral', { name: 'coral 组', nodeIds: SIX_IDS, frameBounds: FRAME_BOUNDS, colorToken: 'coral', ...STORYBOARD_STAMP })}
        members={SIX_MEMBERS}
      />
    ),
  },
  {
    id: 'grp-17-light-violet',
    name: '六色 · 亮 · violet（紫：底色 violet soft，无边框，无圆点）',
    source: '拍板 2026-10-10 · D4 颜色 token 六色亮档（tailwind.config.ts / nomi-tokens.css）',
    coverage: 'shell',
    render: () => (
      <CanvasGroupHeaderStage
        locale="zh-CN"
        group={makeGroup('grp-light-violet', { name: 'violet 组', nodeIds: SIX_IDS, frameBounds: FRAME_BOUNDS, colorToken: 'violet', ...STORYBOARD_STAMP })}
        members={SIX_MEMBERS}
      />
    ),
  },
  {
    id: 'grp-18-light-rose',
    name: '六色 · 亮 · rose（玫瑰：底色 rose soft，无边框，无圆点）',
    source: '拍板 2026-10-10 · D4 颜色 token 六色亮档（tailwind.config.ts / nomi-tokens.css）',
    coverage: 'shell',
    render: () => (
      <CanvasGroupHeaderStage
        locale="zh-CN"
        group={makeGroup('grp-light-rose', { name: 'rose 组', nodeIds: SIX_IDS, frameBounds: FRAME_BOUNDS, colorToken: 'rose', ...STORYBOARD_STAMP })}
        members={SIX_MEMBERS}
      />
    ),
  },
  // ── 六色 × 暗 ──
  {
    id: 'grp-19-dark-ocean',
    name: '六色 · 暗 · ocean（海蓝：暗档底色）',
    source: '拍板 2026-10-10 · D4 颜色 token 六色暗档',
    coverage: 'shell',
    scheme: 'dark',
    render: () => (
      <CanvasGroupHeaderStage
        locale="zh-CN"
        group={makeGroup('grp-dark-ocean', { name: 'ocean 组', nodeIds: SIX_IDS, frameBounds: FRAME_BOUNDS, colorToken: 'ocean', ...STORYBOARD_STAMP })}
        members={SIX_MEMBERS}
        options={{ scheme: 'dark' }}
      />
    ),
  },
  {
    id: 'grp-20-dark-teal',
    name: '六色 · 暗 · teal（青绿：暗档底色）',
    source: '拍板 2026-10-10 · D4 颜色 token 六色暗档',
    coverage: 'shell',
    scheme: 'dark',
    render: () => (
      <CanvasGroupHeaderStage
        locale="zh-CN"
        group={makeGroup('grp-dark-teal', { name: 'teal 组', nodeIds: SIX_IDS, frameBounds: FRAME_BOUNDS, colorToken: 'teal', ...STORYBOARD_STAMP })}
        members={SIX_MEMBERS}
        options={{ scheme: 'dark' }}
      />
    ),
  },
  {
    id: 'grp-21-dark-amber',
    name: '六色 · 暗 · amber（琥珀：暗档底色）',
    source: '拍板 2026-10-10 · D4 颜色 token 六色暗档',
    coverage: 'shell',
    scheme: 'dark',
    render: () => (
      <CanvasGroupHeaderStage
        locale="zh-CN"
        group={makeGroup('grp-dark-amber', { name: 'amber 组', nodeIds: SIX_IDS, frameBounds: FRAME_BOUNDS, colorToken: 'amber', ...STORYBOARD_STAMP })}
        members={SIX_MEMBERS}
        options={{ scheme: 'dark' }}
      />
    ),
  },
  {
    id: 'grp-22-dark-coral',
    name: '六色 · 暗 · coral（珊瑚：暗档底色）',
    source: '拍板 2026-10-10 · D4 颜色 token 六色暗档',
    coverage: 'shell',
    scheme: 'dark',
    render: () => (
      <CanvasGroupHeaderStage
        locale="zh-CN"
        group={makeGroup('grp-dark-coral', { name: 'coral 组', nodeIds: SIX_IDS, frameBounds: FRAME_BOUNDS, colorToken: 'coral', ...STORYBOARD_STAMP })}
        members={SIX_MEMBERS}
        options={{ scheme: 'dark' }}
      />
    ),
  },
  {
    id: 'grp-23-dark-violet',
    name: '六色 · 暗 · violet（紫：暗档底色）',
    source: '拍板 2026-10-10 · D4 颜色 token 六色暗档',
    coverage: 'shell',
    scheme: 'dark',
    render: () => (
      <CanvasGroupHeaderStage
        locale="zh-CN"
        group={makeGroup('grp-dark-violet', { name: 'violet 组', nodeIds: SIX_IDS, frameBounds: FRAME_BOUNDS, colorToken: 'violet', ...STORYBOARD_STAMP })}
        members={SIX_MEMBERS}
        options={{ scheme: 'dark' }}
      />
    ),
  },
  {
    id: 'grp-24-dark-rose',
    name: '六色 · 暗 · rose（玫瑰：暗档底色）',
    source: '拍板 2026-10-10 · D4 颜色 token 六色暗档',
    coverage: 'shell',
    scheme: 'dark',
    render: () => (
      <CanvasGroupHeaderStage
        locale="zh-CN"
        group={makeGroup('grp-dark-rose', { name: 'rose 组', nodeIds: SIX_IDS, frameBounds: FRAME_BOUNDS, colorToken: 'rose', ...STORYBOARD_STAMP })}
        members={SIX_MEMBERS}
        options={{ scheme: 'dark' }}
      />
    ),
  },
]
