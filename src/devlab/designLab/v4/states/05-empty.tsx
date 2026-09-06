// 设计实验室 · Agent 面板 v4 · **冷启动空态**（三个面各一格）。
//
// v4 定稿的 57 张态里从来没有这一格：所有板都从「已经聊了几轮」画起，于是新项目第一眼
// 看到的那块面板——主体一片白——从来没被人看过、也就没被评过。这三格补的就是它。
//
// 为什么三格而不是一格：空态那三条起手是**按面派生**的（`agentPanelV4EmptyState.ts` 从
// 已注册能力表取），创作面能读文稿、生成面能读画布、预览面能读时间轴，三处给的话不一样。
// 只画一格就等于把「派生」这件事从接触表里藏掉了。
//
// 走 `ShellStage`（真投影 store + 真 shell），不是给面板喂 props：空态的触发条件是
// 「宿主真相里一条 item 都没有」，喂 `flow={[]}` 只能证明「给它空数组它长这样」，
// 证不了「宿主真的空的时候它会出现」。生成面这一格同时是原 `v4-wired-empty` 的证据
// （上下文环写「—」不是「0%」——那一刻我们连模型多大都不知道）。
import React from 'react'
import type { LabState } from '../../labScreen'
import { ShellStage, labHostState } from '../agentPanelV4LabHost'

function EmptyCreation(): JSX.Element {
  return <ShellStage surface="creation" snapshot={labHostState({ items: [] })} />
}

function EmptyGeneration(): JSX.Element {
  return <ShellStage surface="generation" snapshot={labHostState({ items: [] })} />
}

function EmptyPreview(): JSX.Element {
  return <ShellStage surface="preview" snapshot={labHostState({ items: [] })} />
}

export const V4_EMPTY_STATES: readonly LabState[] = [
  {
    id: 'v4-empty-creation',
    name: '空态 · 创作面（写脚本 / 拆分镜 / 改文稿）',
    source: '2026-09-06-agent-panel-v4.md · 空态（定稿缺这一格，2026-09-06 补）',
    coverage: 'shell',
    span: 2,
    render: () => <EmptyCreation />,
  },
  {
    id: 'v4-empty-generation',
    name: '空态 · 生成面（生成选中 / 拆参考片 / 检查画布；环写「—」不是 0%）',
    source: '2026-09-06-agent-panel-v4.md · 空态（定稿缺这一格，2026-09-06 补）',
    coverage: 'shell',
    span: 2,
    render: () => <EmptyGeneration />,
  },
  {
    id: 'v4-empty-preview',
    name: '空态 · 预览面（检查时间轴 / 修剪片段 / 导出成片）',
    source: '2026-09-06-agent-panel-v4.md · 空态（定稿缺这一格，2026-09-06 补）',
    coverage: 'shell',
    span: 2,
    render: () => <EmptyPreview />,
  },
]
