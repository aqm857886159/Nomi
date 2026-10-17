# 方向检查：「可找回」节点的原因被投递层丢掉（#1213 C 刀）

> 触发：`node scripts/fix-churn.mjs` 命中两处热点——`src/workbench/generationCanvas/store/nodeRunOutcome.ts`（文件 14 天第 7 个 fix；概念「生成结局投递到运行所属项目」第 8 个）与 `src/workbench/generationCanvas/nodes/NodeRecoverableReport.tsx`（第 3 个 fix）。来源：逃逸账本 `USER-20261016-video-result-not-retrieved`。根因合同：`docs/fixes/2026-10-16-relay-video-result-retrieval.root-cause.json`。

## 0. 一句话根因

「结局附带的原因」没有一个对所有结局状态都成立的规则：投递层只给 `error` 状态留原因，`recoverable` 一律置空，而界面、分镜行、运行记录都以为它在。

## 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 0e41296c8 / e2b9daa97 / 6f4bce242 / 782317953（10-07） | 撤销 / 外部写 / 删节点时，已到达的结局被别的写入盖掉或找不到节点 | 结局投递与画布其它写入的先后（投递 owner 收口，已在 nodeRunOutcomePatch） |
| 911873697 / c4c4e0215（10-05） | 「重新取回」按钮名与取回失败的说法三处不一致 | 可找回的文案 owner（已收口到 recoverableCopy） |
| #1213（本次） | statusPatch 对 recoverable 置空 error；面板只渲染固定文案 | **结局附带的原因**：不是先后问题，是「哪种结局带原因」没有规则 |

本次不是前面那批（先后 / 文案）的第 N 刀：前面收口的是「结局落到哪」「说哪句」，这次是「带不带原因」。三者都住在同一个投递 owner 里，所以触发热点。

## 2. 为什么这一类会一直出现

结局有五种（success / error / recoverable / running / idle），「带什么」由 `statusPatch` 里一行三元式决定，只写了 error 一支。`recoverable` 是后来加的状态（2026-09 超时找回），加状态时没人回头问「它带不带原因」；而它的两个来源（查询连续失败、出站被拦）恰恰都**有**原因、且原因决定下一步。读者那边（`storyboardRowStatus.ts`、`StoryboardShotFrame.tsx`）早就按「recoverable 有 error」在读，一直读到空值——没有测试会红。

铁律对照：⑫「点了 = 以为的」。用户点「重新拉取」以为会拉回来，实际撞同一堵墙且看不到墙是什么。证据：`NodeRecoverableReport.test.tsx` 断言面板显示原话；`nodeRunOutcome.test.ts` 断言节点与运行记录都留着原因。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 再加一种结局状态（如「已取消可续」），同样默认丢原因 | `outcomeError` 是唯一出口；新增状态不写分支就是「不带」，测试表要随之加一行 |
| 分镜表 / 任务中心对可找回镜头显示空原因 | `rg "recoverable" src/workbench/creation/storyboard/exec/storyboardRowStatus.ts`：读 `node?.error`，本次修后有值 |
| 出站被拦（fake-ip）的可找回节点用户仍不知道去开代理 | `outbound.fakeIpBlocked` 文案走 raw；面板「技术详情」可见，「服务商原话」不印（不是服务商的话） |

## 4. 靶子独立性检查

- 测试由本线写，但断言的是用户可见事实（面板含原话、节点与运行记录含原因），不是实现细节。
- 无「修对了反而掉分」先例。靶子本身无错。

## 5. P0：这些是我们独有的吗

结局投递与可找回是我们独有的花钱语义（已付费、免费取回），无现成库。界面三件套已存在于失败卡，本次复用同一份实现（抽成 `NodeFailureDetails.tsx`，样式逐字搬），不新造元素。

## 6. 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 无对应库 | — | — | — |
| 补（本次） | `outcomeError` 一处写清每种结局带不带原因：error 带（无则兜底句），recoverable 带传进来的（无则不编），其余不带；面板复用失败卡三件套 | 一个函数 + 一个共享组件文件 | 低：只多保留一个本来就传进来的字符串 | ✅ |
| 重写 | 把结局建模成判别联合（`{status:'recoverable', reason?}`），类型上不能丢 | 改动 10 个写入口与全部读者 | 中：碰撞正在收口的投递概念 | 以后结局再加状态时再做 |
| 删 | 去掉 recoverable，统一成 error + 取回按钮 | 大：用户会被推向付费重试 | 高 | ❌ |

## 7. 用户要权衡的核心

要不要现在就把「结局」改成类型上带原因的判别联合（彻底做不出丢原因），还是先用单一出口函数 + 测试守住、等下次加状态时再重写。本线按后者做。

## 特征测试清单

- `src/workbench/generationCanvas/store/nodeRunOutcome.test.ts`：recoverable 保留原因（节点 + 运行记录）、纯超时不编原因
- `src/workbench/generationCanvas/nodes/NodeRecoverableReport.test.tsx`：面板显示服务商原话 / 复制详情 / 技术详情；无原因时面板不变
- 既有：`nodeRunOutcome.test.ts` 其余用例、`runner/*` 投递测试全绿（未改行为）
