# 结构评审：`electron` / `electron/capabilityCore` / `src/ui`（2026-09-14）

> 触发：`check:symptom-cluster` —— 2026-09-08 → 2026-09-14 七天内 `electron` 收到 22 份、`electron/capabilityCore` 收到 24 份、`src/ui` 收到 10 份根因合同（第 22/24 份是本日 `docs/fixes/2026-09-14-mcp-connection-truthfulness.root-cause.json`）。门岗的立场是对的：第三份合同是「这一层的结构不对」最便宜的证据，不是再修一次的理由。本文把这两簇合同的 `class_root` 逐条读过一遍，按**结构族**归并，给出这一层该长成什么样。
> 状态：✅ 评审已出；结构动作分「本 PR 已做」「后续每份合同必须对号入座」两档，不另开新 lane。

## 一、这两簇合同说的其实是五件事

把 46 份合同（去重后）按 `class_root` 归并，`electron` 与 `electron/capabilityCore` 的病根只有五个结构族——每份新合同都能对上其中一族，对不上的才是新病。

| 族 | 结构症状 | 这一周的合同（节选） |
|---|---|---|
| **F1 不变量没有 owner** | 一条「必须始终成立」的规则散落在每个调用者里，谁都能漏一处 | `2026-09-11-catalog-read-channels-reseed`（读目录前补种子，散在每条 IPC 频道）；`2026-09-11-director-lan-pairing-hardening`（三道准入各 return 一下）；`2026-09-11-shot-pricing-single-rule`（一镜价格主进程/渲染层各一份）；`2026-09-12-storyboard-plan-defaults-passthrough`（整片设置只被界面读）；`2026-09-08-ipc-trust-derived-not-declared`（信任在守卫里再推导）；**本日 `2026-09-14-mcp-connection-truthfulness`（客户端名单 5 抄 2 漏、写盘守卫装在包装层）** |
| **F2 读/写、显示/发送两条路各有一份真相** | 同一份状态有多扇门，其中一扇有守卫另一扇没有；或读路径带写副作用 | `2026-09-11-catalog-read-channels-reseed`；`2026-09-12-storyboard-plan-defaults-passthrough`；`2026-09-09-model-vendor-preference`（显示与解析各一套排序）；**本日：`readMcpInfo → clientInfo` 名字像读实为写** |
| **F3 写下去的事实没人读回校验** | 状态一旦落盘就被当成真，之后的判定不再对照现实 | `2026-09-10-apimart-direct-key-publish` / `2026-09-10-vendor-key-publish-class`（发布判据写死成 vendor 名）；`2026-09-11-self-check-must-never-demote`；`2026-09-12-spend-gate-outlived-the-spend`（闸活得比它守的东西久）；**本日：`NOMI_SETTINGS_DIR` 写进宿主配置后全文件只出现一次** |
| **F4 失败路径 / 缺席路径不是一等路径** | 主路径有 catch，catch 自己的失败无人兜底；必需依赖写成 optional，缺席时交出残废实例 | `2026-09-12-integration-run-failure-path`；`2026-09-11-comfyui-certification-wiring`；`2026-09-12-announced-card-never-rendered`（「没东西」与「没画出来」共用同一个返回值）；`2026-09-09-text-stream-destroyed-listener` |
| **F5 跨进程副本靠手抄** | main / preload / renderer 各抄一份词表、DTO、判据 | `2026-09-11-shot-pricing-single-rule`；`2026-09-10-b6-mcp-parity`（并行 transport schema）；`check:vocabularies` 里 67 条 debt 全是这一族；**本日：`McpConfigState` / `McpVerifyReason` 四份字面量联合** |

（agentLane 那一簇——`2026-09-08-agent-lane-*` 十余份——是阶段 4 重做期间的同一批结构迁移，class_root 基本都是 F1「shared owner 缺失」与 F2「presentation subset ≠ authoritative snapshot」，不单列。）

## 二、诊断：为什么是这一层

`electron/capabilityCore` 是 Nomi 对外的**全部**能力面：MCP stdio server、RPC、宿主配置、审批闸、handoff。它同时被四类调用者到达——渲染层 IPC、外部 MCP 客户端、启动期装配、走查/评测的隔离实例——而这一层的代码是按「一次一个功能」长出来的：每个功能给自己的调用者开一扇门，守卫装在自己那扇门上。四类调用者 × N 个功能，就是 F1/F2 的温床；每个功能各自落盘又各自判定，就是 F3；每个功能各自抄一份 DTO 到渲染层，就是 F5。

三个结构事实让它比别的层更容易复发：

1. **这一层的「状态」大多住在别人家的文件里**（`~/.claude.json`、`~/.codex/config.toml`、供应商目录、审批收据）。别人家的文件没有我们的类型系统，写错了编译器不响；只有把「写」收成一扇门，才有地方装守卫。
2. **隔离实例与真实实例共用同一套代码路径**，区别只在几个 env。任何没读 env 的写路径都会把测试的状态写进真实用户的世界（本日合同的 B1，以及 09-12 memory 里同一条）。
3. **跨进程契约没有中立层就一定被抄**：渲染层不能 import 主进程实现，所以要么中立契约（`electron/shared`），要么手抄。历史上默认是手抄。

## 三、结构动作

### 本 PR 已做（作为这一层的范式）

- **一扇写门 + 门上守卫**：宿主配置的全部写盘只经 `atomicWrite`，隔离实例（`NOMI_E2E=1` 或 `NOMI_SETTINGS_DIR≠userData`）对真实主目录的写在门上被拒；读路径（`readMcpInfo`/`clientInfo`/`verifyMcp`）零写盘。门表见合同 `doors`（26 → 22 扇）。
- **写了必读回**：`sameLauncher` 把写进配置的 `NOMI_SETTINGS_DIR` 读回来与本实例对照，judgement 与 verify 共用一份判据。
- **一个 owner 一份名单**：`electron/shared/mcpClientRegistry.ts`，编译器（key 字面量联合）+ 全仓扫描测试双拦。
- **中立契约层收词表**：`electron/shared/mcpConnectionContract.ts`，四条跨进程 debt 退役。

### 后续每份落在这两簇的合同必须对号入座

新合同的 `class_root` 必须写明属于 F1–F5 哪一族（或证明是第六族）；修法必须是该族的结构解，而不是再补一处：

| 族 | 结构解（唯一允许的形状） |
|---|---|
| F1 | 把不变量搬进一个只读它的 owner 模块，调用者只 derive；`node scripts/door-map.mjs` 数门，门表进合同 |
| F2 | 读路径禁副作用；写只经一扇门；守卫在门上不在包装层（R28） |
| F3 | 任何写进外部世界的值都要有对应的读回校验，且校验住在判定函数里而不是 UI 里 |
| F4 | 必需依赖构造期失败；失败路径写成一等路径（终态化不变量 + 逃生口）；「没东西」与「没做成」用不同返回值 |
| F5 | 跨进程词表/DTO/判据只住 `electron/shared`，两侧 derive；`check:vocabularies` 的 converged 记录是它落地的证据 |

### 不做的事

- 不给这一层再开「统一守卫中间件」之类的新抽象：F1/F2 的解是**少一扇门**，不是多一层拦截。
- 不追溯改写 09-08 以来已合入的 46 份合同；它们是这份评审的样本，不是待办。

## 三·五、`src/ui` 那一簇：渲染层是同一批病的显示端

`src/ui` 七天内的 10 份合同（`2026-09-09-credential-validate-before-save`、`2026-09-09-notification-policy`、`2026-09-09-provider-explicit-recovery`、`2026-09-09-toast-action-layout`、`2026-09-11-audio-reference-slot-gate`、`2026-09-11-comfyui-certification-wiring`、`2026-09-11-comfyui-combo-format-drift`、`2026-09-11-pr720-walkthrough-reds`、`2026-09-08-antigravity-cli-windows`、本日 `2026-09-14-mcp-connection-truthfulness`）里，只有 `toast-action-layout` 与 `pr720-walkthrough-reds` 是纯渲染层的病（几何参照系错、宽度预算缺）；其余八份的 `scope_paths` 之所以落进 `src/ui`，是因为**渲染层替主进程重新实现了一份判据或名单**（F5）——凭据可用性、供应商可恢复性、媒体种类枚举、客户端名单——主进程那份一改，渲染层这份就漂。结构解与 electron 侧是同一条：判据与词表只住 `electron/shared`，`src/ui` 只 derive、只渲染；渲染层新增的任何 `as const` 名单或 `type X = 'a' | 'b'` 词表，若主进程也有同名语义，就是 F5 复发。本 PR 在 `src/ui/onboarding` 做的正是这件事：`assistantActivationState.ts` 与 `mcpBridgeTypes.ts` 不再持有任何名单或词表。

## 四、对 `check:symptom-cluster` 的回应

本文点名的模块：`electron`、`electron/capabilityCore`、`src/ui`。日期 2026-09-14 ≥ 簇结束日。下一份落在这两簇的合同，若 `class_root` 对不上 F1–F5，请先补这份评审再修。
