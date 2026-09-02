# MCP 项目会话链真走查审计（#202 式）

日期：2026-09-02 · 基线：`origin/main@e8477aa2`  
性质：M3 施工前审计，先审计后实现；本片只记录，不修生产代码。  
方法：真 Electron（`electron <repoRoot> + NOMI_MCP_STDIO=1`）+ 真 MCP stdio JSON-RPC 客户端，凭据由 `tests/ux/_mcpJourney.mjs:279-295` 的 `seedMcpClientIdentityEnv` 注入；隔离 settings/userData/projects/capability 四目录。调用链覆盖 session_open、租约重开、项目切换、并发打开、第二进程、SIGKILL、持久化项目恢复和真实 5 分钟过期。

## 0. 诚实记分

**真走通：** 34 条记录（S-01..S-27，包含轮询记录），协议握手、A/B 项目创建、会话打开、canvas 读、错误项目范围、同连接并发请求、跨连接拒绝、SIGKILL、磁盘项目恢复、真实 lease expiry 均有活体结果。过期段按最多 60 秒一段前台轮询，未注入时钟、未改 token、未使用 `NOMI_LOOP_SPEND_OK`。

**控制组红灯：** `pnpm run build` 通过；随后 `pnpm run test:mcp` 在真实 stdio 初始化后，于旧调用 `nomi_create_project` 失败：`未知工具: nomi_create_project`。M2 已将模型/MCP 面收敛到 `nomi_project_create`（`electron/capabilityCore/mcpToolCatalog.ts:278-286`），旧 J-MCP1 仍是未迁移的红灯，不把它算成 session 运输通过。

**证据边界：** 这次是真 MCP stdio + Electron 主进程链，不是 GUI renderer 审批卡；没有生成、付费、Host resident shell 或跨机器网络链。项目恢复证明的是持久化项目可重新选择，不证明原连接、原 sessionId 或原 lease 可跨进程复活。

## 1. S-01..S-27 活体记录

| ID | 现象 / 证据 | 影响 | 修法一句 |
|---|---|---|---|
| S-01 | `initialize` 返回 MCP `2025-11-25`，server `nomi-capability-core@0.1.0` | 运输层真实启动 | 保持 initialize 与 tools/list 使用同一协议版本真相源 |
| S-02..S-03 | `nomi_project_create` 成功，返回 `id + projectSelectionHandle`，但 `structuredContent` 为空 | 客户端必须从 text 抠续链字段 | 项目创建结果把稳定 id/selection handle 进入 `structuredContent.nomiOutcome` |
| S-04..S-06 | `session_open(selectionHandle)` 成功，lease 可用于 `nomi_read(target=canvas)` | 基本会话链可用 | 保留 lease 验证先于能力执行的顺序 |
| **S-07..S-09** | 同一 selection handle 再开 lease，token 变化但 `expiresAt` 不变；旧 lease 仍可读 | “续租”看似成功，实际只重发同一有效窗口 | 明确命名为 re-open，或提供显式 renew；不得让客户端误以为 expiry 被延长 |
| S-10..S-13 | 打开 B 后用 A lease + B project hint，返回 `project_scope_changed`，带 `reselect_project` | 交叉项目写/读被正确阻断，但恢复要靠客户端自己重选 | 错误结果继续返回来源项目和可重选句柄来源 |
| **S-14a..S-15** | A/B 两个 `session_open` 并发成功，但返回完全相同的 `sessionId`（只生成不同 lease） | “并发 session”实际是同一连接级 session；无法按 sessionId 区分并发上下文 | 将 sessionId 的连接级语义显式化，或为并发会话分配独立 session identity；二者择一并进合同 |
| **S-16..S-18** | 第二个真实 stdio 进程复用 A selection handle，返回 `lease_invalid`；原因是连接绑定不匹配 | 进程/客户端重启不能复用原选择句柄 | 提供 connection-independent 的受控恢复凭据，或明示只能重新选择并返回可达选择入口 |
| S-19 | 发送 SIGKILL，旧 Electron 进程确实以 `signal=SIGKILL` 退出 | 验证不是优雅 close 假装崩溃 | 保持恢复测试使用进程级 crash，不只测 terminate |
| S-20..S-23 | 新进程可读 A/B 项目；可创建 C 并用新 handle 开新 session | 项目数据可恢复，但原 session 不可恢复 | 恢复 projection 分开报告 `project_recovered` 与 `session_reconnected`，后者没有证据不得宣称 |
| **S-24..S-27** | 真实等待约 300 秒后，旧 selection handle 的 `session_open` 与旧 lease 的 canvas read 均 `lease_expired`，均带 `reselect_project` | expiry fail-closed；没有自动续租、剩余时长或 renew action | 在 session projection 中回传剩余 TTL/expiry reason，并给真实可执行的重新选择入口 |

## 2. 代码锚点与根因分层

### R-01（P0，链路合同漂移）

- **症状：** 旗舰 `test:mcp` 在 initialize 后调用已删除的 `nomi_create_project`，立即收到 `未知工具`。
- **直接原因：** M2 语义面已将建项目入口收敛为 `nomi_project_create`，旧旅程仍引用旧名；当前目录由 `mcpToolCatalog.ts:278-286` 注册新名，`mcpSurfaceCollapse.test.ts:238-240` 只验证新路由。
- **类根因：** 工具删除后的真实旅程没有和工具目录同一触发面迁移，导致运输通过被误报成业务链通过。
- **影响：** M3 的 session 链回归入口在第一业务步红，任何后续上下文/技能验收都可能没有真实调用地基。
- **修法：** 让旗舰旅程从 `MCP_TOOL_RESOLVER`/语义工具合同派生入口并删除旧调用；不保留旧 alias fallback。

### R-02（P0，稳定续链字段没有进入结构化真相）

- **症状：** S-02、S-04 的 id、projectSelectionHandle、leaseHandle、projectId 等字段只在 JSON text，`structuredContent.nomiOutcome` 为空。
- **直接原因：** `mcpProjectSessionTool.ts:2-27` 只定义输入/build；`dispatcher.ts:332-369` 直接返回创建/会话对象；协议层的通用结果投影没有为这两个工具提供稳定 outcome。
- **类根因：** MCP 结果的“人读 text”和“模型续链 structuredContent”没有在会话边界统一定义。
- **影响：** 外部 agent 必须解析 prose 才能续链，解析失败会把后续错误误判成项目/租约问题。
- **修法：** 在会话/项目结果的唯一投影边界生成严格 schema 的 `nomiOutcome`，text 只做可读转述；加入创建→打开→读的真实类级合同。

### R-03（P1，并发身份语义缺口）

- **症状：** S-14a/S-14b 并发打开 A/B 返回同一个 `sessionId`，虽然 lease token 各自不同。
- **直接原因：** `ProjectSessionAuthority.open` 把 `issued.lease.sessionId` 原样返回（`projectSessionAuthority.ts:163-172`）；lease 的 `sessionId` 来自连接上下文而不是一次 open。
- **类根因：** “连接 identity”“MCP session”“项目 lease”三个生命周期未在对外合同中明确区分。
- **影响：** M3 上下文快照若按 sessionId 做 key，会把 A/B 项目的动态事实、技能和最近 Items 混在一起。
- **修法：** 先冻结生命周期语义：一个连接一个 session 还是一次 open 一个 session；随后让 context owner 使用不歧义的 `(connectionId, lease/project binding)` key。

### R-04（P1，恢复只能重建不能续接）

- **症状：** S-17 第二连接拿旧 selection handle 返回 `lease_invalid`；S-20..S-23 只能读项目并新建 session。
- **直接原因：** selection/lease 都校验 `sessionId + connectionNonce`（`projectLease.ts:233-244`）；`session_open` 也只接受当前连接绑定的 handle（`projectSessionAuthority.ts:157-160`）。
- **类根因：** 持久化项目身份与短期连接授权被设计为同一续链入口，没有单独的 crash-resume contract。
- **影响：** 重启后 Host 可恢复文件，但模型上下文、编译 hash、最近回合不能安全恢复，只能从项目重新开始。
- **修法：** 在 M3 只消费明确的 durable context checkpoint；若产品不允许跨连接续接，就把“重新选择项目并新建上下文”写成唯一恢复动作。

### R-05（P1，租约过期可拒绝但不可观测）

- **症状：** S-25/S-26 正确返回 `lease_expired` + `reselect_project`，但成功响应没有 issuedAt/剩余 TTL，错误没有可定位的 expiry timestamp，也不存在 renew 工具。
- **直接原因：** 默认 TTL 为 5 分钟（`projectLease.ts:210-220`），lease 被 selection handle 的 expiry cap（`projectLease.ts:302-317`）限制；错误投影只给通用下一步。
- **类根因：** 生命周期 guard 已有，但 session context 没有把 lease 生命周期作为可观测输入。
- **影响：** 长任务无法提前安排恢复；M3 context 编译可能在即将过期时继续生成一轮无效 prompt。
- **修法：** 编译前消费 session lifecycle projection，显式标记 TTL/expiry；过期时停止依赖该 lease 的编译并输出重新选择动作，不伪造续租成功。

## 3. M3 红灯建议（施工前应先红）

| 红灯 | 可复演断言 | 今天预期 |
|---|---|---|
| R1 | `pnpm run test:mcp` 使用当前语义工具目录走通 create→open→read，不再调用 `nomi_create_project` | 红 |
| R2 | create/open 的 `structuredContent.nomiOutcome` 同时含 `projectId/projectSelectionHandle` 与 `sessionId/leaseHandle/expiresAt/effectiveScope` | 红 |
| R3 | 同连接 A/B 并发 session 的 identity 语义明确：若允许独立 session，`sessionId` 不相同；若连接级复用，结果显式声明 `connectionSessionId` 且 context key 不用它冒充 turn session | 红 |
| R4 | 第二连接/崩溃后旧 handle 不可复用时，错误给出可执行的重新选择入口；若支持恢复，则必须用新的真实连接完成同一 thread checkpoint replay | 红 |
| R5 | lease expiry 前编译返回剩余 TTL；expiry 后旧 lease 所有依赖调用 fail-closed，并包含 expiry reason + reselect action | 红 |
| R6 | 100-turn context 记录中，项目/session 切换不会复用上一项目的 dynamic facts、Skill body 或最近 Items | 红 |

## 4. 对 M3 的施工约束

1. Context compiler 不得把 `sessionId` 当作唯一项目/线程 owner；至少绑定当前 lease 的 immutable project identity 与 context revision。
2. structured session outcome 是 F-A5 后续“Skill 载入→账本事件→下一轮出站上下文”的前置续链字段；没有它，不能把 Skill 三层验收称为真实上下文验收。
3. Skill body、项目文本、MCP 外部结果仍按方案放在稳定 policy 后面，并带 source revision/hash/trust；本审计只证明 session 生命周期，未证明 prompt 注入正确。
4. 本片没有扩展 `agentHostEnabled`，保持 false；没有触碰 Electron 高风险生产代码，因此片 A 不新增根因 v3 合同。

## 5. 活体命令与结果边界

- 构建：`pnpm run build`：通过。
- 控制组：`pnpm run test:mcp`：红，失败点为已删除旧工具 `nomi_create_project`。
- 审计：使用 `tests/ux/_mcpJourney.mjs` 的真实 `spawnMcpStdioClient`，隔离目录、真实 Electron stdio、真实 MCP RPC；活体记录为本文件 S-01..S-27。
- 结论：transport/session guard 基本 fail-closed，但“结构化续链、并发 session identity、crash resume、expiry observability、旧旅程迁移”仍是 M3 红灯，不得把本审计称为 M3 完成。
