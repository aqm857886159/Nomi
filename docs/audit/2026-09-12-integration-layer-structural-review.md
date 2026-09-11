# 结构评审：`electron/integrationCertification` 与 `electron/providerAdapter`（2026-09-12）

状态：✅ 已交付

> 触发：`check:symptom-cluster` 报「同一模块 7 天内第三份根因合同」。按 R21，第三份合同是
> 「这一层结构不对」最便宜的证据，不是再修一次的理由——先出这份评审，再继续修。
> 本文只回答一个问题：**这三份合同是同一个结构病，还是三件各自独立的事？**

## 一、两个模块，各三份合同

**`electron/integrationCertification`**

| 日期 | 合同 | 一句话 |
|---|---|---|
| 09-11 | `2026-09-11-comfyui-certification-wiring` | 运行时必需依赖被声明成 `optional`：注册处零参也能构造，能力照挂，用户点下去才在闭包第一行炸，错误还被统一 catch 洗成中性码 |
| 09-11 | `2026-09-11-mcp-onboarding-defects` | 面向模型发布的多步契约按「代码调用方」设计：schema / 错误词表 / 生命周期词表 / handle 格式各说各的，模型据此无法决定下一步 |
| 09-12 | `2026-09-12-integration-run-failure-path`（本轮） | 失败路径比主路径弱：终态写失败无人兜底，状态机永久停在中间态，cancel 被拒，错误原文丢失 |

**`electron/providerAdapter`**

| 日期 | 合同 | 一句话 |
|---|---|---|
| 09-08 | `2026-09-08-reference-slot-outbound-join` | 参考槽的出站拼装 |
| 09-09 | `2026-09-09-credential-validate-before-save` | 凭据先验后存 |
| 09-12 | `2026-09-12-integration-run-failure-path`（本轮） | 同上 |

## 二、判断：是同一个结构病，但不是同一条不变量

三份 `integrationCertification` 合同的共同形状可以写成一句话：

> **这一层里，「说自己是什么」和「真的是什么」之间没有强制对账。**

- comfyui-wiring：能力**说**自己挂上了（`certifyComfy` 照挂），真相是依赖缺席 → 用户点下去才炸。
- mcp-onboarding-defects：契约**说**自己需要什么、出了什么错、轮到谁，四张嘴四个答案，
  模型照着任何一张都走不到下一步。
- 本轮：run **说**自己「正在验证」（读接口不走锁，读得到 `certifying`），
  真相是负责推进它的那个 promise 早就死了。

三次都是同一条元规律：**这一层大量在「发布状态」，却没有任何机制保证发布出去的状态与
实际状态一致**。它之所以在这一层反复出现，是因为这一层的职责本身就是**把三方（用户、
驱动 Agent、供应商）粘起来**——粘合层天然要对外说很多话，而每一句话都是一次可能说谎的机会。

但**不是同一条不变量**，所以不该合成一次大重构：
- comfyui-wiring 的不变量是「必需依赖在构造期解决，缺席即炸」（归装配层）。
- mcp-onboarding-defects 的不变量是「对外发布的契约四面一致」（归工具面声明层）。
- 本轮的不变量是「状态机不许停在中间态」（归 `terminalGuarantee.ts`）。

三条各有明确的持有者，且三次修复都是把不变量**搬到一个新的、唯一的持有者**上
（构造期断言 / 单一声明处 / 终态保证模块）。这是同一种**解法形状**，不是同一处代码。

`providerAdapter` 那三份的关联更弱：reference-slot 是出站拼装、credential-validate 是
存取时序、本轮是状态机收尾，三者除了共处一个目录之外没有共同不变量。它同时被点名，
是因为本轮的合同把 `providerAdapter` 也写进了 `scope_paths`——这是**统计上的共处**，
不是结构证据。

## 三、结论与后续

1. **本轮不停工。** 三份合同指向同一种解法形状（把不变量搬给唯一持有者），本轮正是照此做的；
   停下来做一次「粘合层大重构」不会比三次各自收敛更快，反而会把三条互不相干的不变量绑成一个
   不可回滚的大改（违反 R3 的取舍纪律与本轮已写明的回滚策略）。
2. **记下这条元规律，作为下一次的先验**：`integrationCertification` 里任何「对外发布状态/
   能力/契约」的新代码，默认要回答一句「谁保证它和真相一致」。答不出就是下一份合同。
3. **可机器化的下一步（本轮不做，登记在此）**：这一层目前有三处「发布」而只有一处有对账——
   能力挂载（已有构造期断言）、工具契约（已有单一声明处 + `check:tool-face`）、
   run 状态（本轮新增终态保证）。第四处是**会话阶段**（`syncHttpCertification`），
   它目前靠「每次 get 时顺带同步」，没有独立的一致性断言。若 7 天内再出第四份合同且落在会话阶段，
   应当先给它一条对账不变量，而不是再修一次。
4. `providerAdapter` 的三份合同**不构成结构证据**，无需为它单独立项；本文点名它是为了让
   `check:symptom-cluster` 的记录完整可复核。

## 四、复核线索

- 本轮合同：`docs/fixes/2026-09-12-integration-run-failure-path.root-cause.json`
- 本轮方案（含门表与 H1/H2 审计结论）：`docs/plan/2026-09-12-integration-run-failure-path.md`
- 上游复盘（真机轨迹）：`docs/plan/2026-09-11-mcp-integration-quality.md`
