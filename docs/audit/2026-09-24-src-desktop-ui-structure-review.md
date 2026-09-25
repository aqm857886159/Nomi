# src/desktop 与 src/ui 结构评审（症状簇触发，2026-09-24）

触发：`check:symptom-cluster` 在 `2026-09-24-renderer-failure-evidence` 这份合同加入后报了两个模块——
`src/desktop`（2026-09-19 到 09-24，5 份合同）与 `src/ui`（2026-09-18 到 09-24，4 份）。
R21 的要求：第三份合同出现后，先回答「这一层的结构有没有问题」，再继续修。

## src/desktop：五份合同放在一起看

| 合同 | 碰到 src/desktop 的哪个文件 | 本层是缺陷所在，还是顺带 |
|---|---|---|
| `2026-09-19-composer-lifecycle` | `productionRunBridgeTypes.ts` | 顺带：主进程生产流水线的契约变了，渲染层桥类型跟着改 |
| `2026-09-19-generation-scope-and-dismissal` | `productionRunBridgeTypes.ts` | 顺带：同上（owner 在 `electron/productionRun/productionRunReducer.ts`） |
| `2026-09-22-credential-probe-paid-without-consent` | `bridgeModelCatalogSurface.ts` | 顺带：花钱确认的 owner 在 `electron/catalog/credentialProbePolicy.ts`，桥面多一个方法 |
| `2026-09-22-shot-cut-truncation` | `bridgeMedia.ts` | 顺带：「结果给全了没有」的判据 owner 在 `electron/shared/canvas/shotTable.ts` |
| `2026-09-24-renderer-failure-evidence`（本次） | 新增 `rendererLog.ts`，改 `bridge.ts` | **是**：渲染层没有失败证据的持久出口，owner 落在这一层 |

**结论：前四份不是本层的缺陷，是同一个结构特征的四次体现**——`src/desktop/*BridgeTypes.ts` / `bridge*.ts`
是主进程 IPC 契约在渲染层的**手抄镜像**。主进程侧的契约一改，这里就得跟着改一次，于是每份修契约的合同都会把本层算进去。
这是「第二份类型」的维护成本，不是行为缺陷：运行时的 owner 都在主进程，这一层只有类型与薄访问器。

本次新增的桥面没有再手抄：`log.report` 的报文类型直接 `import` 自 `electron/shared/contracts/rendererLog.ts`
（主进程、preload、渲染层同一份）。**建议**：新桥面一律照此办理（契约放 `electron/shared/contracts/`，桥类型只 `import type`）；
存量手抄镜像按「改到哪个就顺手改成 import」的方式逐步收，不单独开一次大迁移——它不产生行为错误，只产生多改一处的成本。

本次是这一层第一份「缺陷就在这里」的合同：渲染层原来没有失败证据的出口。它现在的形状是**一个 owner**
（`src/desktop/rendererLog.ts`，唯一调 `bridge.log.report` 的地方）+ 一条 lint 硬零（`src/**` 禁 `console.error/warn`），
没有给本层留下第二个写口。

## src/ui：四份合同放在一起看

| 合同 | 碰到 src/ui 的哪个文件 | 本层是缺陷所在，还是顺带 |
|---|---|---|
| `2026-09-18-vendor-upsert-drops-fields` | `src/ui/onboarding/*`（字段丢失提示） | 顺带：缺陷是主进程写路径的白名单式保留（owner `electron/catalog/upsertDraft.ts`），界面只加了提示 |
| `2026-09-22-credential-probe-paid-without-consent` | `src/ui/onboarding/KnownVendorKeyConnectPage.tsx` | 顺带：花钱确认的判据在主进程，界面只呈现确认 |
| `2026-09-22-vendor-connection-identity` | `src/ui/onboarding/` | 部分：界面上按域名判断「是不是某家」的写法是症状之一，已由 `electron/shared/builtinVendorIdentity.ts` + `check:builtin-vendor-literals` 收口 |
| `2026-09-24-renderer-failure-evidence`（本次） | `src/ui/ErrorBoundary.tsx`、`src/ui/chunkBoundary.tsx` | **是**：两个错误边界各自 cast `window` 直连一条自由文本的崩溃通道 |

前三份集中在 `src/ui/onboarding`，共同点是**界面在替主进程记账**（字段保留、花钱与否、供应商身份），三份都已把判据收回主进程或 `electron/shared`，
界面退回纯呈现。这个方向是对的；本评审不再追加动作，只记一条判据留给后来的人：**onboarding 界面里再出现「判断某件事是否成立」的代码，先问 owner 在不在主进程**。

本次暴露的是另一个形状：**错误边界绕过类型化的桥**。两个边界各有一份一字不差的 `reloadRendererWindow`，
都用 `(window as unknown as {...}).nomiDesktop` 直接 cast，绕开 `src/desktop/bridge.ts` 的 `getDesktopBridge()`——
崩溃上报原来也是这么接的（所以它能收一段自由文本、被 200 字截断也没人发现）。本 PR 已做：

- 崩溃上报改走 `logRendererCrash`（同一个 owner、结构化报文）；
- 两份 `reloadRendererWindow` 合成一份，住进 `src/desktop/bridge.ts`，走 `getDesktopBridge()`，两个边界 import 它。

仓内剩下的同形状：`src/workbench/ai/lane/laneClient.ts:35` 仍自己声明一份 `window.nomiDesktop.agentLane` 的类型再读——
不属于本层、也不在本次范围，记在这里作为下一次碰 lane 桥时顺手收的项。

## 结论

- `src/desktop`：结构没有行为缺陷；成簇来自「桥类型手抄主进程契约」的维护成本。新桥面改为 import 共享契约，存量逐步收。
- `src/ui`：onboarding 那一簇已各自把判据收回主进程；本次那一簇（错误边界绕过类型化的桥）已在本 PR 收掉。
- 两个模块都**不需要**在继续修之前先做结构改造；可以继续。
