# 转发壳能让「命令一字不改」的复核纪律失真

> 📎 教训 · 首次记录 2026-09-03 · 状态：现行
> **触发场景**：你要按一份旧记录里**钉死的复现命令**逐条复核（红灯清单 / QA 记录 / 合同的 `regression_tests`），或者你正准备把一个被删模块的测试文件改成 `import './别的.test'` 保住路径。

**结论**：**钉死的是命令文本，不是它验的东西。** 复核前先确认命令指向的文件**现在还测不测原来那件事**——`git log --follow` 看它有没有被掏空成转发壳，用例数对不对得上。路径存在 ≠ 覆盖存在。

反过来：**迁移时不许留转发壳**（P1 已有此条，这里是它的测试面实例）。被删模块的测试要么随模块一起删、要么真的重建覆盖；留一个 `import './别的.test'` 的壳，等于让所有引用这个路径的门岗和记录**继续报绿**，而它们守的东西已经没了。

## 为什么会踩

2026-09-01 `0b6441c6`（M1 round-2 transplant）删掉了 `electron/projectAgentHost/hostLifecycle.ts`，连同它那份 80 行 5 用例的测试，原路径只留 3 行：

```ts
// Compatibility entrypoint for the immutable M0 red-light command.
import './projectAgentHost.test'
```

后果有三层，**每一层单独看都是绿的**：

1. **复核纪律失真**：`docs/qa/2026-09-01-agent-m0-red-lights.md` 的 RL3 复现命令一个字都没改，但它先记 **「5/5 lifecycle tests passed；`markDeviated` 是唯一持久化写入路径」**，后记 **「绿 10/10」**——后者跑的已经是 `projectAgentHost.test.ts` 这套完全不同的 Host reducer/repository 测试。那份记录明确写着「原命令一字不改逐条复核」，字面上做到了，想守的东西却被架空。
2. **门岗被壳满足**：4 份 R21 根因合同（`rc-01/02/05/06`）把这个路径列为**唯一** `regression_tests`；`check:root-cause-contracts` 查的是 `pathExists`，壳在，就一直绿。
3. **原命题无人认领**：RL3 的主角 `markDeviated` 已从全仓消失（`grep -rn markDeviated electron/` 零命中）；`deviated` 字段还在校验闸里用，但**测试里每一处都是 fixture 赋值 `deviated: false`，没有一条断言**。红灯既没有原覆盖、也没有等价替代，却记在「已通过」里。

顺带：这个壳还让 `projectAgentHost.test.ts` 整套跑两遍（vitest 按文件收集，壳文件 = 第二次完整执行），当时最重的那条测试单独就要 14–37s。

## 怎么用

- **复核钉死的命令前先验对象**：`git log --follow --oneline <测试文件>` + 看用例数。用例数从 5 变 10 而结论仍写「同一条红灯已复核」= 出事了。
- **删模块时同 commit 处理它的测试**：删掉，或重建真覆盖。**不留 `import './别的.test'`**（P1「搬家不留转发壳」的测试面）。
- **把测试路径写进合同/记录前，问它证的是哪条不变量**，而不只是「这个文件跑得起来」。合同里 `regression_tests` 的价值全在「这个文件里有一条断言守着我这条 invariant」。
- **发现壳之后别急着改指**：先逐条读后继测试的断言，确认哪几条 invariant 真被覆盖、哪几条没有，**没覆盖的要写进 `residual_risks` 明着标**，不要为了让门岗变绿而改指到一个没验过的文件——那是把覆盖缺口洗成绿灯（见 [`harness-catch-launders-bugs-into-verdicts`](harness-catch-launders-bugs-into-verdicts.md)）。
- 相关：[`dead-selector-lies-both-ways`](dead-selector-lies-both-ways.md)（同族：证据物失效但报绿）、[`gates-green-does-not-mean-walkthrough-ran`](gates-green-does-not-mean-walkthrough-ran.md)、[`complexity-invariants-need-counters-not-wall-clock`](complexity-invariants-need-counters-not-wall-clock.md)（同一次事故的另一面）。
