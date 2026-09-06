# 设计实验室 57 张基线全绿 ≠ 那套组件能接线

> 📎 教训 · 首次记录 2026-09-06 · 状态：现行
> **触发场景**：交接单/任务书写「组件已拍板落基线，这一轮只要**接到真实状态**」；或你要接手一套只被 `src/devlab/designLab/` 引用的组件；或你在估「换 UI」的工期。

**结论**：设计实验室的视觉基线只证明**长相**，一个字都不证明**能用**。接手前先跑两条 30 秒的判据——
**① 组件有没有回调 props；② 它在 `src/` 里有没有非实验室的 importer**。两条都空 = 这不是「接线」，是**从零建交互层**，工期差一个数量级。

## 怎么踩的（2026-09-06 · Agent 面板 v4）

PR #534 把 v4 落进仓库：9 个组件 2068 行、57 张视觉基线全绿、逐板对账文档 18 处出入逐条写明、
`check:design-lab` 视觉道 104 passed。任务书据此写「把已拍板落基线的 v4 组件**接到真实宿主状态**」。

实际逐个读完 9 个文件后：

| 判据 | 结果 |
|---|---|
| 回调 props（`onSend`/`onStop`/`onConfirm`/`onReject`/`onAdopt`/`onUndo`） | **一个都没有**。`AgentPanelV4Panel.tsx` 的 props 只有 `flow / slot / queue / context / composer / width / height / darkMode` |
| composer 的「发送」做什么 | `AgentPanelV4Composer.tsx:96` `const submit = React.useCallback(() => setValue(''), [])` —— **清空输入框** |
| 模型弹层 / Skill 弹层的内容 | 组件内**硬编码字面量**（走了 i18n，所以 `check:i18n` 也绿） |
| `src/workbench/` 下的 importer | **零**。只有 `src/devlab/designLab/v4/` 引用 |

也就是说：**每一道门都绿，而这套组件按下任何一个按钮都不会发生任何事**。

## 为什么门岗看不见

各门岗管的东西都对，只是**没有一道门问「它接得上吗」**：

- `check:design-lab` 视觉道：截图比对——按钮长得对就绿，有没有 `onClick` 它不看。
- `check:i18n`：文案走了 `t()` 就绿——硬编码的**夹具数据**照样绿（这正是实验室夹具刻意走 i18n 的副作用）。
- 单测 `agentPanelV4Blocks.test.ts`（56 条）：断言的是「渲染出这个 `data-*` 了吗」，不是「点了会怎样」。
- `typecheck`：props 里没有回调，就没有类型可对不上。

## 判定法（便宜且决定性）

```bash
# ① 有没有回调面：一个 handler 都搜不到 = 纯展示件
grep -rlE 'on[A-Z][a-zA-Z]*\??:' src/<组件目录>/ | grep -v test

# ② 有没有真实消费者：只出现在 devlab/ = 它从没被产品用过
grep -rn '<组件名>' src/ --include='*.tsx' | grep -v devlab
```

两条都空，就在动手前把工期与范围**重估一遍再答应**，别按「挪一下」排。

## 附带的第二个量：换 UI 的真实代价在 DOM 测试锚点上，不在组件行数上

同一次实查：现役面板发出 **141 个**不同的 `data-agent-*` 属性，`tests/ux/` 下 **23 个**走查/e2e 绑在上面
（含每日闸 `golden-path.e2e.mjs`）；v4 只发 ~17 个 `data-v4-*`，`grep -rn "data-v4" tests/` **零命中**。
组件换掉的那一刻，23 个文件同时红。

```bash
grep -rohE 'data-agent[a-z0-9-]*' src/workbench/ai/ | sort -u | wc -l   # 141
grep -rl 'data-agent-' tests/ux/ | wc -l                                # 23
```

**估「换 UI」的工期，先数这两个数**——它们通常比组件本身大一个量级，而且在读组件代码时完全看不见。

## 相关

- [gates 全绿 ≠ 走查真的跑过](gates-green-does-not-mean-walkthrough-ran.md) —— 同一族：门绿了，但门管的不是你以为的那件事。
- 本次的完整映射与决策清单：`docs/plan/2026-09-06-agent-panel-v4-wiring.md`
