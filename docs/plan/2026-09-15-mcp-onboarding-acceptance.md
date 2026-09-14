# MCP 接模型验收：题库进 CI + 外部宿主走通用中转路径接 APIMart 最新图/视频模型

> 2026-09-15 · 分支 `test/mcp-onboarding-acceptance-20260915` · 基线 = PR #754（`feat/mcp-onboarding-tool-face-20260911`，接模型工具面收成 4 个工具）合 `origin/main`
> 对应任务：T-MO-05（验收进 CI）· T-MO-08（接中转别手抄模型名）· 顺带核 T-MO-03 / T-MO-04 / T-MO-10

## 这份方案在解决哪个真实摩擦

用户 2026-09-11 在群里的原话是三件事：**验证会扣积分**、**切供应商跳回 ApiMart**、**那个大页面是干嘛的**。
往下追是同一个摩擦：**接一家我们没预适配过的中转站，用户和 Agent 都不知道自己走到哪一步了**。
09-11 的基线数字把它量出来了——Codex 挂 Nomi MCP 只看官方文档接 DeepSeek：58 次调用、入参一次写对 62%、
9 个回合只成 1 个、人工介入 10 次。

#754 把工具面从 6-action 的一个工具收成 4 个工具之后，真实模型臂上这个数变成 100%
（[`docs/evidence/2026-09-11-tool-face/README.md`](../evidence/2026-09-11-tool-face/README.md)）。
但那份数字**住在证据目录里**，不在任何门岗上——下一次谁把描述改回去，没有任何东西会红。
所以本轮做三件事：① 把那 30 句做成会红的门岗；② 换一个我们没跑过的宿主（Claude Code CLI）
走一次真实闭环，真花钱出一张图一段视频；③ 走不通的地方分成「我们的」和「供应商/网络的」两堆，
前者修在 owner 层并复跑给数字，后者如实标着不兜底。

## 用户要权衡的那个核心东西

「接中转」这条路上只有一个真取舍：**key 到底谁来贴**。
工具描述里明写「任何参数里都不许出现 key，Nomi 自己在本地页面问用户」——这是对的，但它的代价是
**这条路一定会停一次，等一个真人**。所以「人工介入 0」这个目标只对「接完之后的步骤」成立；
「贴 key」那一停不是缺陷，是设计。本轮把这一停明确记成一次人工介入并说清理由，而不是想办法绕开它
（绕开的唯一办法是让 key 从聊天里进来，那是更坏的产品）。

## 先查别人

### 池子一 · 框架/宿主原生已经提供的

- **只用这一份 MCP 配置**：Claude Code CLI 原生有 `--mcp-config <file>` + `--strict-mcp-config`，
  后者让宿主**只**认命令行给的那份、忽略 `~/.claude.json`。我们不需要自己写一层宿主配置隔离。
  文档：https://docs.claude.com/en/docs/claude-code/cli-reference
  这一条是硬约束不是优化：这台机器上用户真实的 `~/.claude.json` 里挂着一个真的 `nomi` server
  （指向 `/Applications/Nomi.app`），不加 `--strict-mcp-config` 就会同时看到两个 nomi、工具名撞车——
  09-11 的 Codex 读数 31/31 正是这么作废的。
- **逐调用事件流**：`--output-format stream-json --verbose` 原生把每个 `tool_use` / `tool_result`
  按行发出来，含 `is_error`。所以不需要像真实模型臂那样再起一个探针 server 去记调用
  （对比 `scripts/tool-face-bank/probe-server.mjs`：那边必须自己记，因为它要替换掉真后端）。
- **模型自动发现**：pi-ai provider 的 `resolve` 原生能列出该 provider 的模型，
  `electron/agentLane/laneModelProvider.mts:174` 附近已经在用 `createProvider`。
  T-MO-08「接中转最痛是手抄模型名」的答案在框架里，不在我们这边再写一个发现器。

### 池子二 · 生态里已有的

- **参数校验**：draft-07 语义由 Ajv 拿着，`electron/capabilityCore/mcpArgValidation.ts:16`
  一行 `new Ajv({...})`。本轮门岗量「入参一次写对」时直接复用它，不另写一个校验器——
  否则量到的是我那份校验器的宽严，不是我们广播出去的契约。
- **MCP stdio 传输与 initialize 握手**：`electron/capabilityCore/mcpProtocol.ts` 已经实现了
  官方 2025-11-25 的换行分帧 JSON-RPC，`tests/ux/_mcpJourney.mjs:277` 已经有一份真进程客户端。
  外部宿主这一路只需要生成配置，不需要第二份传输实现。
- **Stripe 语义的重放恒等**：幂等键由宿主自己按 `(setupId, action, args 的 SHA-256)` 派生
  （`electron/capabilityCore/modelOnboarding/idempotency.ts`），模型面上根本没有这个字段。
  基线 62% 里有 6 次失败是旧面要模型自己算 `expectedRevision` 一族——这条已经用行业既有语义解掉了，
  本轮不再碰。

### 池子三 · 我们自己已经有的（本轮全部复用，一份都没再造）

- **隔离实例装配**：`evals/lib/isoApp.mjs:26` 的 `prepareIsolation` / `launchIsolatedApp`。
  手拷设置文件自拼隔离环境会漏 `provider-adapters.json` 等文件，症状长得像「key 解不开」
  （[`../lessons/iso-walkthrough-key-seeding-traps.md`](../lessons/iso-walkthrough-key-seeding-traps.md)）。
- **宿主客户端身份**：`tests/ux/_mcpJourney.mjs:247` 的 `seedMcpClientIdentityEnv`——
  token 从隔离 capability 目录读、proof 是 HMAC。生产绑定拒绝没有身份的连接，这一份不能手搓。
- **题库与初始世界**：`tests/fixtures/tool-selection/2026-09-11-onboarding-bank.json` 的 30 句 +
  `scripts/tool-face-bank/envelope.mjs` 的信封。本轮把世界数据从 envelope 的 switch 搬进题库
  `_worlds.byState`（P1：同 commit 删掉 switch），让零额度臂和真实模型臂读**同一份**世界。
- **零额度 loopback 套件**：`electron/capabilityCore/modelOnboardingLoopback.test.ts` 已在跑
  「主路径 + 不可逆格 + 旧面阳性对照」。新门岗挂进这同一个文件，不另开一套。

## 三个交付与验收门

| # | 交付 | 验收判据 |
|---|---|---|
| 1 | 30 句进 CI：`check:onboarding-usecases` | 入参一次写对率 ≥90%（题库 `targets.firstTryArgumentRate.goal`）；阳性对照（司机只看 schema 顶层 required）必须塌到 <0.5；R17 变异验证：删掉描述里的条件必填 → 门岗 exit 1 |
| 2 | 真实闭环：Claude Code CLI 挂 Nomi MCP，接 APIMart 最新图/视频模型并各出一件 | 真产物落盘（字节数 + 截图）；花钱 ≤¥30 且每笔都过报价卡；与 09-11 基线并排出表（入参写对率 / 回合成功 / 人工介入） |
| 3 | 缺陷处置 | 工具面/说明书/发现流程的 → owner 层修 + 复跑给数字；供应商/网络的 → 如实标，不写兜底 |

## 不动项

- 不改 4 个工具的契约形状（一个工具 = 一种后果，09-11 拍板）。
- 不动内置 APIMart 供应商档的适配器与种子声明。
- 不接 Codex（额度 19 日才回）。
- 不改用户真实 `~/.claude.json` / `~/.codex/config.toml`（跑前跑后核 `mcpServers` 指纹）。

## 回滚

三个交付各自独立：门岗一条 package.json 脚本 + 一个测试块；验收脚本是 `tests/ux/*.paid.mjs` 不进任何链；
缺陷修复各带自己的根因合同。任一项回滚不影响其余两项。
