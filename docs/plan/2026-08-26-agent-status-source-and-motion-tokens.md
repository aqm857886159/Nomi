# 2026-08-26 Agent 状态真相源修正 + 动效 token 补齐

## 背景

三项独立的正确性/管道改动，不涉及视觉输出变化（视觉设计尚待用户拍板）。

## 范围

### Item 1 — isPending 改从 message.status 派生，停止字符串匹配哨兵

- **文件**：`src/workbench/generationCanvas/components/AssistantTimeline.tsx`
- **改动**：`isPending` 从 `message.status === 'pending' || message.status === 'streaming'` 派生，不再字符串匹配 `'处理中...'`
- **哨兵内容**：`CanvasAssistantPanel.tsx` 在 `status:'pending'` 时仍保留 `content:'处理中...'`（以兼容旧 session 的 undefined status；只有 status 字段才是可靠真相源）。经 grep 确认没有其它路径读 content 推状态。
- **回归测试**：在 `src/workbench/generationCanvas/components/assistantTimeline.isPending.test.tsx` 新增测试，在 content 为任意字符串但 status='pending' 时断言 streaming prop 为 true。

### Item 2 — CanvasAssistantPanel 终止路径补 status:'cancelled'

- **文件**：`src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx`
- **改动**：`sendGenerationCanvasAgentMessage` 返回后检查 `result.raw?.cancelled`（与 CreationAiPanel:402 同义），若为 true 则对末尾气泡调用 `setMessageStatus(activeId, 'cancelled')` 而非 `'done'`；空壳气泡（已删）不需操作。
- **渲染侧**：`AssistantTimeline.tsx:247` 已有 `cancelled={message.status === 'cancelled'}`，无需修改。

### Item 3 — 动效 duration token 补入 token 层

- **文件**：`tailwind.config.ts`（运行时唯一真源）+ `src/theme/nomi-tokens.css`（同步参考）+ `docs/design/nomi-design-system.md` §2.7
- **新增 token**：
  - `--nomi-motion-settle`: 340ms（对齐 `generation-canvas-v2-node-in` 已有的 340ms）
  - `--nomi-motion-breath`: 2400ms
  - `--nomi-motion-orbit`: 5600ms
- **本次不 retrofit 现有组件**，只建 token。

## 不动项

- `AssistantMessageView.tsx`：纯展示组件，不改
- `CreationAiPanel.tsx`：已正确处理 cancelled，不改
- `CanvasAssistantPanel.tsx` 的 '处理中...' 字面量：item 1 后继续保留在 content 里（旧 session 兼容），仅 AssistantTimeline 停止读它推状态
- 任何视觉样式：不改，视觉待用户拍板

## 回滚

git revert 任一 commit（三项各自独立提交，可逐个回滚）。

## 验收门

1. `pnpm run gates` 全绿
2. `assistantTimeline.isPending.test.tsx` 在旧字符串匹配版本下 fail，在新 status 版本下 pass
3. `grep '处理中' src/workbench/generationCanvas/components/AssistantTimeline.tsx` 输出零行
