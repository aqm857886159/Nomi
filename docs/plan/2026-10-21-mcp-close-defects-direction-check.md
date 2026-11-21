# 方向检查：MCP 连接卡与 canvas.write 说明「说的和做的对不上」（D2 + D4）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 触发：`node scripts/fix-churn.mjs` 命中——`src/ui/onboarding/ConnectAssistantCard.tsx` 14 天已有 4 个 fix（这是第 5 个）；
> `electron/shared/agentCapabilities/canvasWrite.ts` 14 天已有 2 个 fix（这是第 3 个）。
> 本文档由实现线出，结构性结论交协调会话 / 用户拍板；下面两个提交先本地挂着，未推送。

## 0. 一句话根因

**界面或说明里「承诺了什么」和「实际能做 / 实际放行什么」是两处各写各的**：按钮文案按一处写（修复接入），点下去走另一处（改写配置）；工具说明按一处写（text 不能当参考源），准入闸门是另一处（放行文字上下文）。缺的是一层：承诺从做事的那一份判据里派生。

## 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 8b2e31d58 端口被占时状态卡如实说明原因（C-5） | 正文改对了，主按钮没跟着改 | 文案与动作分处 |
| 本次 D2 端口被占仍写「修复接入」 | 主按钮永远接 `installMcp`（改写配置），释放不了端口 | 文案与动作分处 |
| 本次 D4 canvas.write 说明 vs 准入 | 说明手抄了「text 不能当参考源」，闸门放行文字当提示词上下文 | 文案与判据分处 |

## 2. 为什么会一直出现

「原因 → 动作」只存在于人脑和各处的三元表达式里，没有一张表，也没有测试把「标签」和「处理函数」绑在一起。canvas.write 说明是手写散文，没有任何东西核它和闸门一致。落到铁律 ⑫「点了 = 以为的」（D2）；D4 是说明与闸门对账，不在三条铁律里，结构上归同一类。

## 3. 不改结构会冒什么（可验证预测）

| 预测 | 怎么验证 |
|---|---|
| 再加一种验证失败原因（`McpVerifyReason` 新成员），主按钮默认仍写「修复接入」并改写配置 | 现在 `BROKEN_ACTION_BY_REASON` 是 `Record<McpVerifyReason, …>`，漏归类过不了 `tsc`；`assistantBrokenAction.test.ts` 逐原因对表 |
| 准入再放行 / 收紧一类节点，说明继续说旧话 | `canvasWriteEdgeDescription.test.ts` 逐节点种类拿闸门核说明点名的集合 |

## 4. 靶子独立性

D2 的对照表和测试是同一条线写的；真点击证据（点主按钮后 `verifyMcp` 调用数 +1、`installMcp` 调用数 0）来自设计实验室里的生产组件，不是单测里的假组件。独立验收线（Codex V-mcpfix）应自己重点一次。

## 5. P0：是我们独有的吗

不是：这是普通的「按钮标签派生自状态」和「文档生成自 schema」。没有成熟库能替我们决定「端口被占该做什么」；这份判据（原因 → 动作）是领域事实。文案生成自判据，用的是仓库已有的 `edgeAdmission` 与 `McpVerifyReason`，没有新依赖。

## 6. 对比表

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 无适用的库（理由见 5） | — | — | 否 |
| 补（本次做法） | 加一个共享投影 `resolveAssistantBrokenAction`（穷举 Record），卡片按它分流；说明从 `edgeAdmissionFactsForModels()` 生成 | 新增 ~40 行 + 两份测试 | 卡片文件仍是热点 | **是**：本次是把两处各写一份**合并成一份**，不是再叠一个特例分支 |
| 重写卡片 | 把 `ConnectAssistantCard`（550 行）拆成状态机 + 视图 | 大 | 回归面大，设计实验室基线要重来 | 否（不在本线范围） |
| 删 | 删掉失效框主按钮 | 用户失去入口 | 违背「改设计不能丢功能」 | 否 |

## 7. 用户要权衡的核心

热点文件上这一刀是「合并两份成一份」而不是「再补一个分支」，是否放行；放行的话卡片的下一次大改应改成状态机，不再逐个原因加分支。

## 特征测试清单

- D2：`src/ui/onboarding/assistantBrokenAction.test.ts`（12 项，修复前全红）、`AssistantStatusBox.test.tsx`（原有，未动）、设计实验室 `host-config-03-status-broken-*`（原有，未动）。
- D4：`electron/shared/agentCapabilities/canvasWriteEdgeDescription.test.ts`（4 项，修复前全红）；`check:model-face-frozen` 基线随说明更新。
