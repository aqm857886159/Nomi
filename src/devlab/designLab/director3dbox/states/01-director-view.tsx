// 设计实验室 · 导演视图（3D-BOX）· 两态 × 中英两轨。
//
// 每一格都是现役 DirectorEditor（开关开）+ 现役 Agent 面板，夹具只给数据与只读桥（见 director3dboxLabKit.tsx，经轻量外壳动态加载）。
// 三态对应样张 `director-3dbox-mockup`（布局 A + v2 镜头条）里要拍板的三个画面：
//   · 空工程的导演视图（还没有镜头）；
//   · 庭院对峙工程的导演视图，用户点了第 2 张镜头卡（播放头停在第 2 镜开头）；
// 「精修」的格子 2026-10-04 起住屏 director-refine（精修改成「选中才出」，用户拍板），这里不再留一份旧样子。
// 工程是 S1 oracle 计划 courtyard-standoff 经现役编译器编出来的：样张画的就是这一题（4 镜 · 12 秒）。
import React from 'react'
import type { LabState } from '../../labScreen'
import { Director3dBoxLazyStage } from '../director3dboxLazyStage'

const SOURCE = 'docs/plan/2026-10-04-director-3dbox-phase3a-shell.md · 导演视图 v2（样张 director-3dbox-mockup，布局 A + v2 镜头条）'

export const DIRECTOR_VIEW_STATES: readonly LabState[] = [
  {
    id: 'd3-empty-director-zh',
    name: '空工程 · 导演视图（中文）',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="empty" />,
  },
  {
    id: 'd3-courtyard-director-zh',
    name: '庭院对峙 · 导演视图 · 点第 2 镜（中文）',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="courtyard" drive="shot-2" />,
  },
  {
    id: 'd3-empty-director-en',
    name: '空工程 · 导演视图（英文）',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="en" fixture="empty" />,
  },
  {
    id: 'd3-courtyard-director-en',
    name: '庭院对峙 · 导演视图 · 点第 2 镜（英文）',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="en" fixture="courtyard" drive="shot-2" />,
  },
]
