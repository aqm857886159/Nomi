# 带状态的 UI 元素要立双层一致性合同

> 📎 教训 · 首次记录 2026-09-02 · 状态：现行
> **触发场景**：要新加或验收任何**显示状态的 UI**（计数、金额、徽章、进度、「已完成 ✓」）；或评审一份「界面做完了」的交付，怀疑某个元素只是画上去的。

**结论**：每个带状态的 UI 元素 = **设计断言**（长得对不对）+ **功能承诺**（背后是不是真的），两层各立合同、各自勾账、互不抵扣。功能承诺按三层验证，缺一层就可能收到装饰性 UI：

- **(a) 契约层**：状态机 / 账本级测试——那个事实真的会发生、会持久化、有唯一 owner；
- **(b) 投影层**：UI 所示 === 账本事实——从唯一事实源读事实、从真实 DOM 读所示、同一个具名比较器深比对（禁两边各自换算后再比）；
- **(c) 走查层**：真实任务真机走到它（R13 手法，截图人眼判断）。

**为什么会踩**：装饰性 UI 全绿套件看不出来。前科是 `deviated`：coordinator + helpers 共 **9 处硬编码 `false`**（`projectAgentExecutionCoordinator.ts` 6 处 + `projectAgentExecutionHelpers.ts` 3 处，实测于 `pr223-finish@46066ed0`），UI 只读不置真，全仓没有任何写 `true` 的入口，类型甚至钉成字面量 `false`——「有出入」这个元素**在界面上存在、在系统里永不发生**。只测「元素渲染了」的设计层断言对此完全免疫，必须有 (a) 逼问「这个事实有没有 owner」才拦得住。同族前科共五类（每条合同至少压一类）：① 装饰性 UI（元素在、功能无）② 投影撒谎（UI 所示 ≠ 账本事实）③ 断言假绿（expectAbsent 采样早 / 死选择器 / harness catch 洗白）④ 档位不生效（设置切了、行为没变）⑤ 数字漂移（金额、用量与计价计量脱钩）。

**怎么用**：
- 交付前逐元素问三句：这个状态的**事实 owner** 是谁（a）？UI 上这个数字和账本**同一比较器**对过吗（b）？真实任务里**真机走到过**它吗（c）？
- 投影断言按「三点一线」写：事实源读事实 → 真实 DOM 读所示 → 具名比较函数深比对；比较器自己要有阳性对照测试。
- 勾账制：实施 PR body 逐条引用合同编号打勾并附证据命令输出；设计层勾完不抵功能层。
- 事实源唯一：每个事实域钉死一个读法（禁从 renderer store / UI 文案 / 模型自述反推事实）。

**出处**：Agent UI 验收合同的双层实例——设计层 `docs/design/2026-09-02-agent-ui-conformance-testspec.md` + 功能层 `docs/design/2026-09-02-agent-ui-functional-conformance-testspec.md`（含五类前科与事实源表）；`deviated` 恒 false 的收编裁决见 `docs/architecture/agent-m-line-rulings.md` R-M-1。同族：[走查断言必须有真信号](walkthrough-assertions-need-a-real-signal.md)、[expectAbsent 会通过得太早](expect-absent-passes-too-early.md)。
