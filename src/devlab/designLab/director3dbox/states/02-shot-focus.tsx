// 设计实验室 · 导演视图（3D-BOX）· 「正在改：镜头 N」七态（Claude Design 画布「3D-BOX · 正在改：镜头 N」，用户 10-06 拍板）。
//
// 每一格都是现役 DirectorEditor（开关开）+ 现役 Agent 面板，点的是界面上的真镜头卡（Ctrl 加选也是真点击事件）。
// 七态与画布一一对应：① 没选中 ② 选中一镜（= 01 屏的 d3-courtyard-director-zh，这里不重复）③ Ctrl 加选两镜 ④ 超过 3 镜
// ⑤ Agent 改完（计划经现役补丁应用器改第 2 镜为特写）⑥ 英文（= d3-courtyard-director-en）⑦ 亮色（产品里导演台锁暗，见取景台注释）。
import React from 'react'
import type { LabState } from '../../labScreen'
import { Director3dBoxFocusTagOnlyLazyStage, Director3dBoxLazyStage } from '../director3dboxLazyStage'
import type { LabStep } from '../director3dboxCell'

const SOURCE = 'Claude Design 画布「3D-BOX · 正在改：镜头 N」（https://claude.ai/artifact/XinCtPmPiQXFT1cHWBSbzq）'
const card = (n: number) => `[data-testid="director-shot-${n}"]`
const TWO: readonly LabStep[] = [{ click: card(1) }, { clickWith: { selector: card(3), modifier: 'ctrl' } }]
const MANY: readonly LabStep[] = [{ click: card(1) }, { clickWith: { selector: card(2), modifier: 'ctrl' } }, { clickWith: { selector: card(3), modifier: 'ctrl' } }, { clickWith: { selector: card(4), modifier: 'ctrl' } }]

export const SHOT_FOCUS_STATES: readonly LabState[] = [
  {
    id: 'd3-focus-1-none-zh',
    name: '① 没选中：输入框上没有标签（中文）',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="courtyard" />,
  },
  {
    id: 'd3-focus-3-two-zh',
    name: '③ Ctrl 加选：正在改：镜头 1、3（中文）',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="courtyard" steps={TWO} />,
  },
  {
    id: 'd3-focus-4-many-zh',
    name: '④ 超过 3 镜：正在改：4 个镜头（中文）',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="courtyard" steps={MANY} />,
  },
  {
    id: 'd3-focus-5-after-zh',
    name: '⑤ Agent 改完第 2 镜：标签仍在、实测已更新，对话里复述被覆盖的手改（中文）',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="zh-CN" fixture="courtyard-after" drive="shot-2" conversation="after-patch" />,
  },
  {
    id: 'd3-focus-5-after-en',
    name: '⑤ After the agent edit (English)',
    source: SOURCE,
    coverage: 'shell',
    scheme: 'dark',
    capture: 'viewport',
    render: () => <Director3dBoxLazyStage locale="en" fixture="courtyard-after" drive="shot-2" conversation="after-patch" />,
  },
  {
    id: 'd3-focus-7-light-zh',
    name: '⑦ 亮色：标签本身（产品里导演台锁暗，不可达）（中文）',
    source: SOURCE,
    coverage: 'component-only',
    scheme: 'light',
    capture: 'viewport',
    render: () => <Director3dBoxFocusTagOnlyLazyStage locale="zh-CN" />,
  },
]
