# 两台发动机合并 · 一个生成引擎（步骤 A + 步骤 B 的范围书）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：步骤 A 实施中（本文件随步骤 A 一起入库）｜分支 `integration/core-a-salvage-20260921`
> 上游裁决：`user-decisions.md`「两条生成路径一定要合并（09-21 用户拍板）」「执行器合并 = 发版前做」
> 现状证据：`sweep-one-intent-many-engines.md` A2/A3/A5、`sweep2-entrypoint-completeness.md` BL-1 与第二节表 1、
> `design-model-onboarding-floor.md` §6/§6.5、`report-A-pass3b.md` §9②、`report-lane-mcp.md` §approvalPolicy、
> `report-A-pass3e.md` §PermissionTier。

## 1. 为什么（底层逻辑，用户镜头）

同一张脸下面有两台发动机：

| 用户做的事 | 走哪台 | 今天的结果 |
|---|---|---|
| 画布节点/分镜行上按生成 | 引擎 A（`electron/runtime.ts runTask`） | 参数照发、@ 引用投影成 `@image1`、任何供应商都能跑 |
| Agent 付款卡 / 外部 MCP / 全自动 Run | 引擎 B（`capabilityCore` Run 路径） | **卡上改的参数被整包丢掉**、**@ 引用原样发给供应商**、**只装得下 APIMart**、**拿不到用户的权限档** |

用户镜头里这不是「两条实现」，是「同一个按钮，有时候听我的、有时候不听」：
卡上选 2K、供应商收到 1k、节点还印 2K（花的是真钱，拿回来的是错东西）；
@ 过参考图的镜头交给 Agent 重拍，供应商收到一串 `@[asset:nomi-local%3A%2F%2F…]`；
设置里选了「全自动」，外部 MCP 仍然每一步问人。

## 先查别人

> 2026-09-21 合并 ① 补：这一节当时漏了。这一刀是**把本仓两条内部路径合成一条**，所以「别人」
> 首先是「我们自己已经有的那一份」——下面每条都带 file:line，是现查的。

- **两台发动机已经共享报文骨架**：`electron/catalog/profileHttpRequest.ts:38` `buildProfileHttpRequest`
  同时被手动路与 Run 路调用。所以「合并」不是从零造，差的只是骨架**外面**那几步
  （参数怎么定、prompt 投影做不做）——这决定了修法是把那几步收进同一个编译口，而不是重写发动机。
- **参数缺省也已经共享**：`electron/catalog/taskParams.ts:124` `applyHeadlessParamDefaults`。
  两边吃同一份缺省，却对「用户改过的那些键」各答一次——分歧只可能出在白名单那一格。
- **提示词投影函数本来就住共享层**：`electron/shared/storyboard/promptMentions.ts:112`
  `projectPromptForSend`（渲染层只是再导出）。**缺的不是实现，是调用**——`grep -rn "projectPromptForSend" electron/`
  在改动前除定义处零命中。所以这一项是「接上去」，不是「再写一份」（P1：没有第二份投影规则）。
- **生态里已有？/ TikHub？** 本轮**没做**，如实登记：这条是两条内部路径的收敛，外部没有可抄的对象；
  真正要对外查的那一格（参考图落哪个 wire 键、各家怎么约定）已经按 R5⑤ 逐条对账过供应商官方文档，
  结论写在 `electron/catalog/apimartVideos.ts` 各 mapping 的注释里（Seedance / Wan 2.7 / Wan 3.0 三处）。

## 2. 范围（做什么 / 不做什么）

### 步骤 A（本次）——不铺开执行器也能先收口的四件 + 两条评估
1. **参数编译从档案/声明派生**：`modelParameterSchema` 从「几乎总是空的 onboarding.fields + defaultParams」
   改成从 **那条 mapping 自己的 create op 引用了哪些参数键**（`wireReferencedParamKeys`，body + 进程 argv 一起算）
   ∪ 档案 wire 默认（`ARCHETYPE_WIRE_DEFAULTS`）∪ onboarding.fields ∪ defaultParams 派生；
   `compileParameters` 的「不认识的键静默丢弃」改成**显式报错并列出合法键**。
2. **提示词投影两路同吃**：`projectPromptForSend`（已住 `electron/shared/storyboard/promptMentions.ts`）
   在 Run 路径也跑一次；编号规则（按 kind 计数、按实际发送顺序）抽成共享纯函数 `numberPromptReferences`。
3. **权限档只有一个 owner**：用户的权限档（`ProjectAgentApprovalPolicy`）由主进程持有一份权威值并持久化；
   `TrustLevel` 由它**派生**（纯函数 + 穷举测试）；Agent 面板、外部 MCP、全自动调度读同一个值；
   调用方永远不能自报（Pass 3e 的 `assertCallerDeclaredTrustLevel` 从此比对的是**用户真的选过的那一档**）。
4. **外部 MCP 发起生成开闸**：`NOMI_MCP_GENERATION_SINGLE_SHOT_V1` / `_E1_V1` 两个 env flag 及其
   `feature_disabled` / `phase_not_ready` / `not_ready` 分支按 P1 整条删除（没有界面能关它 = 它不是开关，
   是一道只会把 `tools/list` 上广告着的工具打回去的墙）。
5. Pass 3c 留下的两条（`generation.present` 重写顶层 `candidate`；`ProductionActionResult` 拆
   「账本事实 / 语义码」）——评估后小修或写清为什么留到步骤 B。

### 不动项（本步骤明确不碰）
- **不铺开执行器**：provider 参数化、按 vendor 造 provider（BL-1 / A3）属**步骤 B**。
  顺序理由（采纳 sweep2 的顺序警告）：引擎 A/B 有七项差异（结果缓存 / multipart / custom-call /
  imageEditGuard / chat-image fallback / async transform / antigravity preflight），今天大部分**打不到**，
  因为引擎 B 只服务 APIMart；铺开的那一刻七项同时变成真 bug。**先对等矩阵，再铺开。**
- `electron/capabilityCore/modelOnboarding/**`、`mcpToolCatalog*`、`mcpToolErrorResults*`、`mcpToolResults*`
  归 MCP lane；渲染层 `src/**` 归渲染层 lane。本 lane 对渲染层只做 import 级接线。
- 未知价规则（Pass 3a 已开闸）、付费卡 ×（渲染层 lane）、批次 B/C 不在本文件范围。

### 步骤 B（矩阵与三条 lane 合并之后另派）
- `apimartGenerationProvider` 的 8 处写死 `"apimart"` 参数化 + `apimartTaskQueryPath()` 改读 `mapping.query`；
- `generationProviderBootstrap` 按**每个已发布 vendor** 造 provider（照 `Vendor.assetIngestion` 的声明式模式）；
- 重新裁决 `isBuiltinDirectKeyVendor` / `hasBuiltinCuratedExecution` 这几道「只信策展合同」的信任闸；
- 七项引擎差异逐项收成对等测试；
- 边界门岗：只许一个模块发供应商请求。

## 3. 回滚
每一项一个独立本地 commit，互不依赖，可逐条 `git revert`：
- 项 1 回滚 = 参数表退回目录派生（回到「静默丢弃」，行为与 `fa3cfe34a` 逐字相同）；
- 项 2 回滚 = Run 路径不再投影 prompt（`@[asset:…]` 重新外泄，但不影响无 @ 的绝大多数镜头）；
- 项 3 回滚 = `trustLevel` 恒 `key_confirm`（更严，不会放松任何门）；
- 项 4 回滚 = 恢复 flag 文件与两处分支（外部 MCP 生成重新关上）。
没有数据迁移：项 3 新增的设置文件缺失时读默认值，删掉它等于回到今天。

## 4. 验收门
1. **对等测试矩阵**（另一条 lane 在写，落 `tests/parity`）——同一输入 → 各入口出站报文逐字节相同；
   本步骤新增两条必须绿的用例：① 卡上改清晰度 → 出站 body 是改后的值；② 带 @ 引用的 prompt → 出站是 `@image1`。
2. `npx vitest run electron src`（相关 + focused）、typecheck、lint:ci、
   `check:root-cause-contracts` / `check:door-map` / `check:symptom-cluster` / `check:boundaries` /
   `check:vocabularies` / `check:tool-face` / `check:i18n`。
3. 真机：`pnpm build` 后 spend 五条走查 + `mcp-l2-journeys.e2e.mjs` + `mcp-generation-elicitation-first.e2e.mjs`；
   新增「付款卡改 2K → 确认 → loopback 供应商收到 2K」与「@ 引用节点经 Agent 付款卡生成 → 供应商收到投影后的写法」。
4. 权限档：穷举测试证明三档 × 两条 spend 轴 → `TrustLevel` 的映射唯一且没有第二处写法。

## 5. 五问（每项动手前的答案，证据见根因合同）
见 `docs/fixes/2026-09-21-run-path-parameter-compilation.root-cause.json`、
`docs/fixes/2026-09-21-run-path-prompt-projection.root-cause.json`、
`docs/fixes/2026-09-21-permission-tier-single-owner.root-cause.json` 的
`same_class_entry_points` / `doors` / `class_regression_tests` 三节——那里的每一条都是命令输出，不是回忆。
