# Agent 长对话渲染冻结修复计划

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

## 问题与证据

0.22.1 Windows 安装包上，21 回合 Agent 长对话（建 20 个草稿节点并持续输出长回复）会随着历史增长冻结渲染进程：f1–f7 的 100ms 采样最长无响应为 0.1–0.3s，f11 为 1.1s，f13 为 2.6s，f15 为 33s，f17 为 16s，f19 为 22s；16 分钟内累计阻塞 242s，最长连续 93s。主进程全程健康，最长仅 142ms。

CPU profile（渲染进程 busy 515s）显示 i18next `translate()` 占 327s。`V4FlowRow` 每行每次渲染调用 `useV4Labels()`，该 hook 每次创建完整 labels 对象并调用 64 次 `t()`；对话流派生还会在每次 store 更新时重算全部历史工具条目的 `toolSummary`/`toolLabel`。因此一次流式增量的工作量随历史行数增长。

## 不变量

Agent 面板一次流式更新的渲染代价与对话长度无关：只更新最后一条 assistant 时，最多重画变动的 1–2 行；labels 翻译和工具摘要调用次数保持常数级。

## 改法

1. 在 `src/workbench/ai/v4/agentPanelV4Labels.ts` 的 `useV4Labels` 共享边界按 `i18n.resolvedLanguage ?? i18n.language` 缓存 labels 对象。同一语言返回同一引用，切换语言才构建新对象；调用方保持原用法。
2. 在 `src/workbench/ai/v4/AgentPanelV4Panel.tsx` 将 `V4FlowRow` 包装为 `React.memo`，并在面板边界用稳定的、ref 转发到最新宿主回调的 handlers 对象，避免宿主的内联 props 令所有行失去 memo 命中。
3. 在 `src/workbench/ai/v4/useAgentPanelV4Data.ts` 的现有 flow 派生边界缓存工具名 + 参数身份对应的 `toolLabel`/`toolSummary`，并对 `laneViewModel` 与 `collapseV4Flow` 的结果做按 identity 的结构共享；未变化的条目沿用上一轮对象引用。
4. 只补回归测试、计划、根因合同和 TODO 登记，不改变任何可见文案、布局、交互或其他画布/任务/生成概念。

## 先查别人

- React 官方 `memo` 文档说明组件只有在 props 改变时才需要重新渲染，且应保持传入对象/函数引用稳定：[react.dev/reference/react/memo](https://react.dev/reference/react/memo)。
- React 官方 `useMemo` 文档说明可在依赖不变时复用计算结果，引用稳定性是 memo 生效的前提：[react.dev/reference/react/useMemo](https://react.dev/reference/react/useMemo)。
- react-i18next 的 `useTranslation` 文档说明 hook 返回翻译函数并订阅语言变化；本修复把语言作为缓存边界，语言切换时重新取值：[react.i18next.com/latest/usetranslation-hook](https://react.i18next.com/latest/usetranslation-hook)。i18next 的 API 文档把 `t` 定义为按 key 做翻译查找，说明逐行重复调用会直接叠加成本：[www.i18next.com/overview/api](https://www.i18next.com/overview/api)。
- Vercel AI Chatbot 的聊天列表将每条消息交给独立的消息组件，流式更新时保留历史消息组件边界，可对照 [components/chat.tsx](https://github.com/vercel/ai-chatbot/blob/main/components/chat.tsx) 与 [components/message.tsx](https://github.com/vercel/ai-chatbot/blob/main/components/message.tsx)。
- TanStack Query replaceEqualDeep reference: https://github.com/TanStack/query/blob/main/packages/query-core/src/utils.ts . Its recursive ordinary-object/array comparison reuses equal subtrees; this fix follows that structure-sharing rule instead of a V4FlowItem-kind field checklist.
- Test infrastructure reuse: src/workbench/ai/v4/testReactRenderer.ts resolves the installed reconciler through @react-three/fiber; both asyncReadIdentity.test.ts and the class regression test use that shared harness.

## 不动项

- 不改任何现有 i18n key、可见字符串、样式、布局和交互语义。
- 不改主进程、Agent 协议、画布、任务、生成、模型目录和持久化结构。
- 不增加 fallback、开关、并行旧实现或第二个概念 owner。

## 回滚

回滚本次工作区改动即可恢复现有 labels、flow 派生和行组件实现；没有数据迁移、协议变更或持久化格式变更。

## 验收门

- `useV4Labels` 同语言两次渲染返回同一对象，切换语言后返回新对象。
- 真实 `AgentPanelV4Panel` 列表在 N=50 与 N=300 时只更新最后一条 assistant：V4FlowRow hook-render counter 统计重渲染行数 ≤2，i18next `t` 调用次数与历史长度无关且两组相同。
- 先记录修复前红色输出，再记录修复后绿色输出。
- `npx vitest run src/workbench/ai/v4`、新增测试、`pnpm run typecheck`、改动文件 eslint、`pnpm run check:i18n`、根因合同和 symptom-cluster 门岗通过。

