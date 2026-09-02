# harness 的 catch 会把自己的 bug 洗成产品结论

> 📎 教训 · 首次记录 2026-08-25 · 状态：现行
> **触发场景**：验收/走查脚本报出一句**具体、可信、指向产品**的失败结论（「某某前提不满足」「没有可用的 X」），你正准备照着它去修产品或写进验收文档。

**结论**：测试/验收 harness 里 `catch (e) { return { ok: false, msg: … } }` 这种写法，会把**脚本自己的基础设施错误**（`ReferenceError` / 拼错的变量 / 作用域取不到）**翻译成一句领域结论**，读起来和真正的产品判定一模一样。**报某条腿失败前，先分清那句失败文案是「断言产生的」还是「catch 兜出来的」。**

**为什么会踩**：

2026-08-25 实例，`tests/ux/p4-s6p5-multishot-paid.e2e.mjs`：`driveRework` 里用了 `leaseProjectId`，但那是**顶层 `try` 块内的 `const`**，函数作用域根本取不到 → `ReferenceError` → 被自家 catch 接住 → 报「第 1 镜没有可返工的终态 job（返工前提不满足）」。**这句话被当成产品结论记进了 plan 的实跑记录。**

同一个文件里还有 `totalSubmits` **从未声明**（付费路径跑完必崩在记账处）。两个都是 `node --check` 查不出、只有真跑到那一行才炸的坑，而付费腿平时被 `DRY_RUN` 闸挡着**根本跑不到**。

这类假失败比假成功更阴——它给你一个具体、可信、指向产品的错误结论，你会照着它去修产品（甚至写进验收文档），而真因在脚本自己身上。**「跑出来是红的」不等于「被测对象是坏的」。**

**怎么用**：

- 报某条腿失败前，先看那句失败文案是**断言产生的**还是 **catch 兜出来的**；catch 兜出来的，先把 `e.message` / `e.stack` 打出来看一眼是不是 `ReferenceError` / `TypeError`。
- **catch 里别只回领域话术，把原始 error 带上**：`msg: \`…：${e?.message}\``，否则证据当场丢失。
- 干跑闸（`*_DRY_RUN_*`）会让后半段代码**长期没人执行**，那里的变量名错误可以潜伏很久。改到这类脚本时，对干跑覆盖不到的段落至少做一次「未声明变量」全量 grep。
- **干跑绿 ≠ 改动被验证**：干跑在半路 `throw` 停下，你改的路径它一行都没跑。谁验证了改动要说清楚（那次真正验证它的是三条先验证会红的单测，不是那次干跑）。

**出处**：`tests/ux/p4-s6p5-multishot-paid.e2e.mjs`（2026-08-25 实录）。相关：[`nomi-get-run-mcp-projection-shape`](nomi-get-run-mcp-projection-shape.md)、[`dead-selector-lies-both-ways`](dead-selector-lies-both-ways.md)、[`piped-test-runs-mask-exit-codes`](piped-test-runs-mask-exit-codes.md)、[`assert-you-are-in-the-situation-you-claim`](assert-you-are-in-the-situation-you-claim.md)。
