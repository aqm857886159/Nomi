# 外部 MCP 付费确认：卡开着时项目被保存，确认不再作废（L-c9）

> 根因合同：`docs/fixes/2026-10-06-mcp-gate-receipt-sealed-revision.root-cause.json`。
> 拍板来源：付费卡① 第 14 条（`docs/plan/2026-09-30-paid-card-per-shot.md` 第 6 条；概念 `production.spend-approval-binding`）。本次没有新的花钱语义，只是把这条已定的规矩补到漏掉的那一扇门上。

## 设计卡

```
改动名：外部 MCP 决门不再读项目此刻的版本     线/负责人：L-c9     类别：[花钱]
```

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 用户在 Codex / Claude 里让 Nomi 生成，Nomi 窗口开着；确认卡（客户端里的确认，或 Nomi 兜底卡）弹出，用户看一眼点确认，生成开跑。以前：卡开着期间只要项目被保存一次（Nomi 自己落画布、别的镜出片、用户挪了个节点、打开项目后的自动保存），点完确认就被拒成「此确认已失效，请在 Nomi 重新确认」，而卡上批的东西一个字没变。不做：不改卡的样子、不改价格 / 额度、不改「信任降档」和创意门（它们照旧比项目此刻的版本）。真实任务：① 外部客户端让 Nomi 出四镜，卡开着时画布在落别的镜；② 卡开着时用户在 Nomi 里挪节点再点确认；③ 卡开着时这次操作被取消，再点确认必须被拒、不碰供应商。主指标：外部 MCP 确认后被拒成 receipt_invalid 的次数（目标 0，前提是信封里的事实没变）；护栏：信封事实变了 / 门已不等批准时，100% 拒且供应商 0 次请求。 | `electron/capabilityCore/mcpSemanticGenerationConfirmation.test.ts`；`tests/ux/mcp-l2-journeys.e2e.mjs` C9 |
| ★2 谁说了算 | 「收据比哪个项目版本」归 `production.spend-approval-binding`：封了信封的付费门比信封封好时的版本，主人是 `runOwnedGenerationGateAuthority.assertReceiptMatchesAuthorization` 和 `productionRunApprovalReceipt.revisionRuleFor`。传输门 `generationDispatcher.requireApprovalReceipt` 只核签名、租约、调用方自报的字段，不再自带第二份版本规则。碰 1 个概念。 | `node scripts/door-map.mjs requireApprovalReceipt assertCurrentProjectRevision assertReceiptMatchesAuthorization verifySuppliedReceipt`（5 扇门，见合同） |
| ★3 一致与复用 | App 内付费卡从 10-01 起就按信封版本批；这次让外部 MCP 两个确认面走同一条规矩，删掉派发器里那份活版本比较。没有新写任何通用能力。 | `git grep projectRevisionResolver electron/capabilityCore` |
| ★4 全状态 | 成功：确认后开跑（不变）。失败：信封事实不符 / 门已不等批准 → 结构化拒绝，文案沿用现有 receipt_invalid / 拒绝文案（zh / en 已有，没新增文案）。取消中：卡开着时取消 → 点确认被拒，不开跑。过期：沿用 receipt_expired。没有界面改动。 | 不适用新文案：沿用 `mcpToolErrorResults.ts` |
| 5 中途表 | 卡开着 × 停 / 关窗 / 断网 / 重启 / 连点：行为都不变（本改动只删一处版本比较）。新增的唯一差别：卡开着时项目被保存 → 以前拒、现在照常批；花费按信封里冻住的那份算，回执在 Run 的 gate.decide 记录里（`projectRevision` 记信封版本）。 | 集成测试两个确认面各一条 |
| 6 外部数据与失败 | 外部来源只有 MCP 客户端的调用参数：客户端自报的 `projectRevision` 必须等于收据上的版本，否则 receipt_invalid。 | `generationDispatcher.ts` bodyBinding |
| 7 性能预算 | 不适用：删掉一次项目清单读盘，决门少一次 IO。 | 人工 |
| 8 真实条件 | Windows：集成测试已跑（vitest）；MCP 走查在 Windows 开发版跑不起来（开发版 Electron 在 Windows 上收不到 stdin，`initialize` 超时），Linux 走查要靠 CI 重跑。英文界面 / 真付费：unverified（没有界面和价格改动；不花额度）。 | 报告里的复现记录 |
| ★9 验收与回滚 | 验收：另一条线跑 `npx vitest run electron/capabilityCore/mcpSemanticGenerationConfirmation.test.ts`（改回旧派发器必红 2 条），CI 上 E2E Walkthroughs (Linux) 连跑多次看 C9；回滚：revert 本提交（回到活版本比较，C9 回到时红时绿）。 | `## 独立验收` 由协调会话指派 |

### 功能分类
- [ ] 新界面 / 改交互
- [x] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式

## 没解决、要另开的

- #1002 那次的形状（确认卡 20 秒没出来）没证实是这扇门。最可能的另一类根因：MCP 进程和 GUI 进程同时写同一个 Run 目录，而 Run 锁抢不到就**立刻**抛 `run_lock_busy`、不等（#1042 那次日志里 GUI 的落画布绑定就是这么输的）；如果输的是 MCP 那边的封信封，gate 请求直接报错、卡不出来。这次让走查在卡没出来时把 gate 的原话打出来，下次红了就能定位。
