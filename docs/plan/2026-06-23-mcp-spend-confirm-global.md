# 外部 MCP 付费确认黑洞治本 — 全局确认卡

日期：2026-06-23
触发：用 MCP 驱动 Nomi 生成时，app 停在项目库首页 / 开着别的项目 → 生成静默失败、零反馈。
用户拍板：**A 方案 = 全局弹确认卡、不打断**（不自动切前台）。

## 根因（agent 报告，file:line 已核）

- `rpcServer.ts:63` `makeGateway`：仅当 `isProjectOpen(target) && isRendererAvailable()` 才走渲染层网关（能弹卡）；否则磁盘网关。
- `gateway.ts:64` 磁盘网关 `confirmSpend`：env 没设就**立即返回 null**（不弹卡、不等待）→ 无授权令牌 → `runTask` fail-fast 抛「未确认」秒回。
- 放大器：`SpendConfirmDialog` 只挂 studio 视图（`NomiStudioApp.tsx:598`）；`localProjectStore.ts:84` SWR `revalidateOnFocus:false` → 外部新建项目库列表不刷新。
- 真实用户高频撞：Claude Code 驱动生成时 app 不在那个项目 → 纯静默黑洞，无自救线索。

## 安全不变量（绝不破，本次只扩 UX 不削确认）

**令牌只由「真人点击确认卡」铸造**：`mintSpendGrant` 仍只在渲染层 reply `confirmed:true` 后由主进程铸（`gateway.ts:87`），消费仍在 `runTask` 内 `assertAndConsumeSpendGrant` 硬闸。外部 MCP 进程够不到那条 IPC。本次改动**只让确认卡能在「窗口活着但目标项目没在前台」时也弹出来**，不改「谁能铸令牌」。

## 改动（7 文件，无并行版）

主进程：
1. `gateway.ts`：`SpendConfirmInfo` 加 `projectName?`；新增 `createHybridGateway(projectId)` = 磁盘读写 + 渲染层 confirmSpend（复用 `createRendererGateway` 的 confirmSpend，不另造）。
2. `rpcServer.ts` `makeGateway` 三态：项目在前台→Renderer；窗口活着但项目没在前台→**Hybrid**（读写走盘不动非活动 store + 付费确认弹全局卡）；无窗口→Disk。
3. `core.ts` `generateOnProject`：`readProject(projectId)?.name` 填进 confirmSpend info。

渲染层：
4. `capabilityApplyHandler.ts`：活动项目校验**只拦画布读写**（canvas.read-doc/apply），放开 `spend.confirm`（非活动项目也能弹卡）；卡 details 加「项目」行显示 projectName；`SpendConfirmPayload` 加 projectName。
5. `SpendConfirmDialog.tsx`：`absolute inset-0` → `fixed inset-0` + z 提到顶（z-[3500]），成真·全屏模态，任意视图盖满。
6. `NomiStudioApp.tsx`：库视图分支也挂 `<SpendConfirmDialog />`（同一全局 store，任一时刻只一个分支渲染 → 不双弹）。

兜底：
7. `localProjectStore.ts`：`revalidateOnFocus: true` —— 从 Claude Code 切回 Nomi 聚焦即刷新项目列表（治坑1：外部新建项目看得到）。

## 验收

- 五门绿。
- 真机走查（R13）：①app 停库页/开别的项目时，MCP 触发生成 → 全局弹 agent 确认卡（带项目名）→ 确认后真生成、结果落盘（打开该项目可见）。②确认卡在库页/studio 都盖满、可点。③切回 Nomi 列表自动刷新看到外部新建项目。
- 安全回归：未确认/超时仍 fail-fast 无令牌；canvas 读写对非活动项目仍走盘不串台。

## 关联

直接解锁 [[onboarding-journey-tour]] 的 S4（示例片真成图——之前正卡在这个黑洞上）。
