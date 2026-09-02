# 断言前先证明你在你以为的现场

> 📎 教训 · 首次记录 2026-08-20 · 状态：现行
> **触发场景**：要验「X 状态下 Y 该成立」；或参数化 / 遍历式测试全绿而你没验证每个维度都真被覆盖到；或某个功能「点了没反应」而你还没查置顶模态。

**结论**：写测试 / 走查验「X 状态下 Y 该成立」时，**先断言自己确实处在 X**，否则绿灯可能来自一个完全不同的现场。自检问一句：「如果我其实在另一个状态，这条断言会不会照样绿？」会 = 先加一条状态断言。

## 为什么会踩

这类假绿在观测上和真绿**完全一样**——测试通过、截图产出、流程走完。

它和「走查断言需要真信号」是同一个病的两个变种：那条讲「**没看到**坏东西」需要基线，这条讲「**看到**好东西」也需要先证明你看的是对的那一屏。

## 2026-08-20：修「全能参考连了视频点不了」时同一个坑连踩两次

1. **不变量测试**：遍历「模式 × 资产」时写成「这个模式收图就只喂图」——而 omni 图和视频都收，**喂图那条恒绿，把「只连视频时点不动」整个盖住**。改成**每种资产各测一条边**（一次只放一条）才当场红 26 条，扫出尾帧接力、`source_video` 两处同类死路。

2. **走查**：`store.updateNode` 注入 `archetype: { modeId: 'omni' }` 后**不能信它**——这台机器没配 vendor，模型被换成另一个可用档案，**落回它的默认模式「图生视频」**。截图里高亮的是「图生视频」，验的其实是首帧接力那条路。修法：点真实的模式 tab（`button[aria-pressed]` + `hasText`）再 `toHaveAttribute('aria-pressed', 'true')`，**关键断言前后各证一次**。

## 2026-08-25 又添两个变种（一次误诊全案，害一个 agent 空转一轮）

1. **文字模式探针瞎掉置顶模态**：按「执行计划 | 被拦」等模式过滤 DOM 文本找状态，置顶的确认卡文案不含这些词 → **两次把「卡在等确认」误诊成「按钮死了」**。先查 topmost modal / `[data-portal]` 有没有东西，再谈「无反应」。

2. **量几何要量对对象 + 没截图不许说「不可见」**：Mantine Modal 的 root 壳结构性恒 `h=0`（子层全 `position:fixed` 脱流），拿 `[data-confirm-dialog]`（落在 root）量出 0 高就断言「渲染塌缩不可见」——**真卡 380×134 一直可见可点**。量可见性要用 `[data-confirm-dialog-surface]`（PR #168 加的测量表面）或 `[role=dialog]`；**下「不可见」结论前必须截图亲眼看**（R13 眼见链）。

## 怎么用

- 断言前问：「如果我其实在另一个状态，这条断言会不会照样绿？」会 → 先加一条状态断言。
- **参数化测试尤其要查**：有没有哪个维度被「优先取第一个满足的」悄悄折叠掉了。
- 状态要按**真实交互路径**进入（点 tab），不要靠往 store 里注入——注入的 meta 会被生产逻辑归一掉。

**出处**：PR #168（`data-confirm-dialog-surface` 测量表面）。

**相关**：[walkthrough-assertions-need-a-real-signal](walkthrough-assertions-need-a-real-signal.md)、[walkthrough-default-profile-is-isolated](walkthrough-default-profile-is-isolated.md)、[dead-selector-lies-both-ways](dead-selector-lies-both-ways.md)、[expect-absent-passes-too-early](expect-absent-passes-too-early.md)
