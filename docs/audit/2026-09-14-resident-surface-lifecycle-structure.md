# 结构评审：常驻生成面「装没装」这份状态，和它的三份影子

状态：单一评审者视角，不代表多位独立审批者。触发方式不是排期，是门岗——
`check:symptom-cluster` 在 `docs/fixes/2026-09-14-resident-generation-adapter-install.root-cause.json` 落盘时报出
`electron`（22 份）、`electron/agentLane`（38 份）、`electron/capabilityCore`（24 份）、`electron/productionRun`（16 份）、
`src/workbench`（92 份）五个模块在 2026-09-08 到 09-14 的 7 天里都已超过第三份根因合同。
这五个数字本身是一周大合并潮（#764 系列、lane 阶段 3/4、审批重做）的体量，不是一个结构缺口能解释的；
本文只回答**这一份合同所在的那条结构**：能力核装配 → 常驻生成面 → 两个读者（Agent lane、付费确认卡）→ 渲染层。
它横跨上面五个模块键中的四个（`electron`、`electron/capabilityCore`、`electron/productionRun`、`src/workbench`）
并经 `electron/agentLane` 的 lane 端口把结果交给模型，所以这五个键在本文里都有各自的那一段。

范围：`electron/main.ts` 的能力核启停决策、`electron/capabilityCore/appIntegration.ts` 的装配段、
`electron/capabilityCore/appIntegrationSpendConfirm.ts` 的读通道、`electron/productionRun/productionActionIpc.ts` 的 IPC、
`electron/agentLane/laneExtendedDesktopPorts.ts` / `laneExtendedTools.ts` 的失败通路、
`src/workbench/ai/v4/useAgentPanelSpendConfirm.ts` 的渲染层读侧。

## 1. 这条结构上的三份合同是不是同一类

| 合同 | 它说的根因 | 它动了哪一端 | 修完之后 |
|---|---|---|---|
| `2026-09-12-announced-card-never-rendered` | 「没有」和「读不到」共用一个返回值 | 读侧：`?? []` 改成「没装就抛」 | 对「装配抛了」对了；把「按配置关掉」也抛成了失败 |
| `2026-09-13-spend-surface-unavailable-error-boundary` | 可选能力既可能是缺函数、也可能是稳定错误码 | 渲染侧：加一个吞 `spend_confirm_surface_unavailable` 的 guard | guard 五个 commit 后仍是死导出，`refresh` 的 catch 从没调过它；就算接上，它会把真失败一起吞掉 |
| `2026-09-14-resident-generation-adapter-install`（本轮） | 「装没装、没装是为什么」没有 owner，三份 nullable 影子各自解释 undefined | 中间：给状态一个 owner，五种相各是各的 | 读侧按相回答，渲染侧只在真拒绝时出卡，lane 把相说给模型 |

三份是同一类，而且前两份正好互为反例：**一份在读侧把 null 变严，一份在渲染侧把错变松，两份都没有碰到那个 null 本身。**
这是「症状修法在链路两端来回摆」的标准形状——每一端单看都言之成理，合起来是同一个问题：
`main.ts` 的 `desktopGenerationAdapterFactory`、`appIntegrationSpendConfirm.ts` 的 `actions` 与 `installFailure`，
三份状态、四种现实（按配置关掉 / 还在起 / 装配抛了 / 已停）、一个 `undefined`。

## 2. 缺口在哪一层

**在装配层，不在读侧也不在渲染侧。** 相变只发生在四个时刻，全部住在两处装配点：

| 时刻 | 位置 | 修前 | 修后 |
|---|---|---|---|
| 决定本会话起不起能力核 | `electron/main.ts:140` | `capabilityCoreDisabled` 只是一个布尔，决定完就没人记得 | `bootResidentSurfaceLifecycle` 判断并记录 `disabled{env|low-memory}` |
| 能力核开始装 | `appIntegration.ts:142` | 无 | `starting` |
| 两条面装齐 | `appIntegration.ts:511` | `onGenerationReady` 回调写进 main.ts 的私有变量 | `ready{factory}`（lane 的工厂只从这里派生） |
| 装配抛了 | `appIntegration.ts:519 / :660` | `recordPendingSpendInstallFailure` 只告诉付费卡一边 | `install-failed{reason}`（两个读者读到同一句原话） |
| 退出 / 重启能力核 | `appIntegration.ts:684` | `installPendingSpendActions(null)` 又是一个 null | `stopped` |

读者从此不解释 undefined：付费卡读通道 `switch` 五种相（TypeScript 穷举），lane 的缺席文案按相说话，
渲染层只在主进程真的**拒绝**时出那张会说话的卡。`check:announced-card` 的 LOUD_MARKERS 改认 `markResidentSurfaceInstallFailed`，
「catch 完假装没事」这一族的棘轮继续有效。

## 3. 各模块键上还剩什么（本轮不动、要记账的）

- **`electron`（main.ts）**：窗口先于能力核创建（`createWindow` 之后才 `startDesktopCapabilityCore`），渲染层的头几次轮询理论上落在 `starting`。
  两个真实探针（禁用/开启能力核各一次 `blank-pan`）都没观察到 console error，`starting` 现在是显式的相；但没有这条竞态的阳性对照测试。
- **`electron/capabilityCore`**：`startCapabilityCore` 是一个 ~500 行的单函数装配段，`appIntegration.ts` 已被 R9/R12 顶到 680 行。
  相变的五个写门都塞在这一个函数里，下一次再往里加一条面（比如 MCP 外部宿主的付费卡）就是第六扇门。
  更长远的形状是把「装配一条常驻面」做成可注册的步骤，每步自带自己的相变——那是另一份 plan，不是本轮。
- **`electron/productionRun`**：IPC 只是透传 `PendingSpendRead`；`revise/discard/confirm` 三条动作在 `actions === null` 时回 `{ok:false, code:'unavailable'}`，
  这个 `unavailable` 是又一个不带相的 code。它今天走不到（off 相下没有卡可点），但它是同一形状的种子。
- **`electron/agentLane`**：`laneExtendedTools.ts:20` 的静态 nextAction「Do not repeat an unknown paid submission.」挂在所有失败上，
  包括从未提交过任何付费的 `generation_surface_unavailable`；gen-surface-root-cause §1 已指出它会吓到用户。本轮只把域端口的 message 带给了模型，文案分流另开合同。
- **`src/workbench`**：低内存模式下用户只能从 Agent 的回复里得知「付费生成在本会话不可用」，面板没有专门的提示。
  加可见文案要走 R8 样张 + R15 i18n，不塞进根因修复。

## 4. 什么能拦住第四份

1. **类型**：`ResidentSurfaceLifecycle` 是判别联合，读者必须 `switch` 穷举；加一种相，所有读者当场不编译（R28 最早那层）。
2. **owner 测试**：`residentSurfaceLifecycle.test.ts` 钉五种相各是各的；`appIntegrationSpendConfirmInstall.test.ts` 钉「同一种相在读者那里得到一致的答案」。
3. **fail-closed 不变**：真的装配失败仍然抛、仍然 console.error、走查与性能门仍然硬红。本轮没有降级任何一条 console error。
4. **教训**：`docs/lessons/not-installed-is-not-install-failed.md` —— 看到「surface unavailable」类症状先读那次运行自己的主进程日志，有没有 ERROR 决定你在修哪一类问题。
