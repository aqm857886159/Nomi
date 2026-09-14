# 结构评审（续）：`electron/integrationCertification` 的 owner 身份（2026-09-14）

状态：✅ 已交付

> 触发：`check:symptom-cluster` 报「同一模块 7 天内第五份根因合同」。
> 前一份评审是 [`docs/audit/2026-09-12-integration-layer-structural-review.md`](2026-09-12-integration-layer-structural-review.md)，
> 它在 §3.3 写下过一句预测：**「若 7 天内再出第四份合同且落在会话阶段，应当先给它一条对账不变量，而不是再修一次。」**
> 第四、第五份合同确实来了，也确实落在会话那一层。本文只回答一个问题：
> **前一份评审的那条元规律还够用吗，还是这两份合同露出了一条它没说到的轴？**

## 一、新到的两份

| 日期 | 合同 | 一句话 |
|---|---|---|
| 09-12 | `2026-09-12-spend-gate-outlived-the-spend` | 花钱的那一步 09-11 已经删掉了，为它而设的三段人工确认闸还立着；而它唯一的出口 `startConfirmedFromTrustedUi()` 第一行写死 `ownerClientId !== "nomi"` 就抛——非 Nomi 拥有的会话永远出不去 |
| 09-13 | `2026-09-13-mcp-session-owner-validation` | 落盘会话校验里手写着一份 owner 字面量清单（`external / nomi / claude / codex / cursor`），签名边界那边新增 `workbuddy` 之后它不会跟着动，于是 workbuddy 重新加载自己的会话被判非法 |

## 二、判断：元规律成立，但轴换了

前一份评审把这一层的病写成「**发布出去的状态与真相之间没有强制对账**」。这两份仍然是它的实例，
但对账失守的**不是阶段，是 owner 身份**：

- 09-12 那份：会话的 owner 是数据（每个会话各自带一个 `ownerClientId`），而出口把它当成了常量（`"nomi"`）。
- 09-13 那份：owner 的**合法取值集合**在仓里有两份——签名边界的 `BUILTIN_MCP_CLIENTS`（`electron/capabilityCore/security.ts`）
  与落盘校验里那行手写字面量。两份必然漂移，只是漂移的那天恰好叫 workbuddy。

合起来是一条比「阶段对账」更具体的结论：

> **`electron/integrationCertification` 把「谁拥有这个会话」当成了本层可以自己说了算的东西，
> 而 owner 的唯一 owner 在签名边界（`capabilityCore/security.ts`）。**

这条轴此前没有被点名，是因为在 09-11 之前接模型这条路事实上只有 Nomi 自己在走：
owner 恒等于 `"nomi"`，写死它和读它没有区别。09-11 把这条路对外开放给外部 MCP 宿主
（codex / claude / cursor / workbuddy）之后，同一行代码的含义就变了——**不是这两处代码写错了，
是它们的前提在 09-11 那天失效了，而没有任何机器会因此报错**。

## 三、结论与后续

1. **本轮不停工。** 两份合同的修法都已经是「搬给唯一持有者」那种形状：09-12 那份把已死的闸整段删除
   （闸没有了，就没有「只有 nomi 能出闸」这回事），09-13 那份把第二份 owner 清单改成读
   `BUILTIN_MCP_CLIENTS`。两次都在减少真相份数，不是再修一次症状。
2. **可机器化的下一步（登记，本轮不做）**：给 owner 这条轴一条门岗，判据是
   「`electron/integrationCertification/` 内不得出现 owner 身份的字面量集合或 `=== "nomi"` 这类硬比较；
   owner 的取值一律从 `capabilityCore/security.ts` 派生」。它的阳性对照现成——就是上面两份合同各自删掉的那一行，
   按 R17「加规则先验它会红」把两行分别还原一次即可。这条规则能覆盖的是同一族里**还没炸的**那些点，
   而不是等第六份合同。
3. **前一份评审 §3.3 的那条预测本身是有效的**：它准确地指出了下一份合同会落在会话那一层。
   保留它，并把本文这条轴（owner 身份）加进去作为第二条先验。
4. 本文不重复 §2 对 `electron/providerAdapter` 的结论（统计上的共处，不是结构证据），那一条没有变化。

## 四、复核线索

- 五份合同：`docs/fixes/2026-09-11-comfyui-certification-wiring`、`2026-09-11-mcp-onboarding-defects`、
  `2026-09-12-integration-run-failure-path`、`2026-09-12-spend-gate-outlived-the-spend`、
  `2026-09-13-mcp-session-owner-validation`（均在 `docs/fixes/`，后缀 `.root-cause.json`）
- owner 的唯一持有者：`electron/capabilityCore/security.ts` 的 `BUILTIN_MCP_CLIENTS`
- 本轮改动落点：`electron/integrationCertification/integrationSessionRecord.ts:86`（第二份清单改成读唯一那份）
