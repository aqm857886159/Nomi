// 设计实验室 · 剪辑面 · 快捷键面板
//
// 顺序有意义：`labStates.mjs` 按本屏目录（screens/editing/）里 `NN-*.tsx` 的文件名排序解析，
// 同目录的 `index.tsx` 按同样顺序拼接，走查再拿活页面的 `window.__designLabStates`
// 与解析结果逐项比对——三者对不上当场红。加状态时别打乱文件名的数字前缀。
//
// 它原本是 `TimelinePanel.tsx` 里一段内联 JSX，取不了景；为了这一格抽成了
// `TimelineShortcutsDialog`，同 commit 把内联那段删掉（P1：不留并行版）。
// 遮罩是 `fixed inset-0`，所以取景用 `FixedStage`——否则遮罩会铺满整个视口。
import React from 'react'
import { TimelineShortcutsDialog } from '../../../../workbench/timeline/TimelineShortcutsDialog'
import { FixedStage, NOOP } from '../editingLabKit'
import type { LabState } from '../../labScreen'

export const SHORTCUTS_STATES: readonly LabState[] = [
  {
    id: 'shortcuts-01-dialog',
    name: '快捷键面板 · 11 条键位',
    source: '现役 TimelineShortcutsDialog.tsx（走查 editing-real-user-pass 第 8 步逐条对账）',
    coverage: 'shell',
    render: () => (
      <FixedStage width={420} height={440}>
        <TimelineShortcutsDialog onClose={NOOP} />
      </FixedStage>
    ),
  },
]
