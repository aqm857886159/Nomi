# Legacy real-process MCP journey — measured metrics vs 2026-08-17 baseline

日期：2026-08-18 ｜ 交付：T5（R16 真实任务测试系统）｜ 分支：`claude/wonderful-bhabha-205252`
Harness：已退役的早期 MCP 旅程（+ 共享设施 `tests/ux/_mcpJourney.mjs`）｜当前回归入口：`pnpm run test:mcp-journey`
指标产物（每步一行 JSONL）：`test-results/mcp-journey-metrics.jsonl`

这份报告把 **J-MCP1 实测跑**（真进程、真 stdio、mock vendor 零额度）与 2026-08-17 那次真实拍片的
基线（见 `docs/plan/2026-08-18-mcp-experience-overhaul.md` §一）逐环节对账，落实用户点名的三类可见性指标：
**每步 —— 有没有失败/报错/重试、耗了多久、用户在聊天里能看到什么**。

## 一、跑的是什么（真实任务的最小复刻）

外部 agent（声明 elicitation 能力 + 长调用带 `_meta.progressToken`）经 **真实 in-Electron MCP stdio server**
（`electron <repoRoot>` + `NOMI_MCP_STDIO=1`，无窗口、`app.dock.hide`、磁盘网关）驱动 Nomi 拍《影子罢工了》：
建项目 → **一批 14 节点**（2 锚：character+scene；12 个 video 镜头）→ 连 3 条参考边 → 列模型 →
生 2 张图 + 1 条视频（mock vendor）→ 读回产物 → 读画布。全程隔离临时
`NOMI_SETTINGS_DIR / NOMI_PROJECTS_DIR / NOMI_CAPABILITY_DIR`，绝不碰真实 `~/.nomi`、安装版 App 或
`~/Documents/Nomi Projects`。付费不走 `NOMI_LOOP_SPEND_OK` 逃生口，而是走 **elicitation 真人确认 →
makeConfirmedGateway 铸令牌**（`mcpStdioServer.ts:99`），证明「聊天里确认、零 App 弹窗」的 headless 花费路。

## 二、实测每步指标（逐行取自 JSONL；两连跑确定性一致）

| # | 步骤 | 工具 | ok | errorCode | retries | durationMs | progressNotifs | imageBlocks | deepLink | elicitationUsed | appDialogShown |
|---|---|---|:--:|---|:--:|---:|:--:|:--:|:--:|:--:|:--:|
| a | initialize | initialize | ✅ | — | 0 | 208 | 0 | 0 | — | — | false |
| b | create_project | nomi_create_project | ✅ | — | 0 | 23 | 0 | 0 | — | — | false |
| c | add_nodes_batch（14） | nomi_add_nodes | ✅ | — | 0 | 16 | 0 | 0 | — | — | false |
| d | connect_nodes（3 边） | nomi_connect_nodes | ✅ | — | 0 | 16 | 0 | 0 | — | — | false |
| e | list_models | nomi_list_models | ✅ | — | 0 | 37 | 0 | 0 | — | — | false |
| f1 | generate_image_1 | nomi_generate | ✅ | — | 0 | 72 | 1 | **1** | ✅ | ✅ | false |
| f2 | generate_image_2 | nomi_generate | ✅ | — | 0 | 51 | 1 | **1** | ✅ | ✅ | false |
| g | generate_video_1 | nomi_generate | ✅ | — | 0 | 54 | 1 | 0¹ | ✅ | ✅ | false |
| h | get_artifact（读回产物） | nomi_read_canvas² | ✅ | — | 0 | 0 | 0 | 1³ | — | — | false |
| i | read_canvas | nomi_read_canvas | ✅ | — | 0 | 1 | 0 | 0 | — | — | false |

汇总：**10 步全 ok，0 报错，0 工具重试，0 `{cancelled:true}`，0 App 弹窗**；全程 485ms（远内 180s 上限）；
非模型单步开销均 <2s（实测 ≤208ms，绝大多数 <40ms）；mock vendor 共接 3 个请求 = **零真实额度**。
（`initialize` 的 `retries` 记的是 Electron 冷启动期间握手的重试次数——本机热跑为 0，CI 冷启动可能 >0；这与
「工具调用因报错而重试」是两回事，后者全程为 0，正是相对基线 2 次 key-error 重试的改善。）

¹ **视频无 image block 是对的**（T2 诚实规则）：fallback 视频本地化 `thumbnailUrl:null`、不抽帧；有 poster 才出图块。harness 照记 `imageBlocks` 但只在有 poster 时才断言 —— 此处无 poster、不强断。
² **步 h 用 `nomi_read_canvas` 而非 `nomi_get_artifact`**：后者是 Production-Run 作用域（`production.artifact`），从 `nomi_generate` 这条路够不着。按 brief「(or generate-result asset)」，改为经真实传输读回画布上产物节点、并校验产物字节确为磁盘上一张非空真图（83 bytes）。步 f 已断言过配套 image content block，此处复核其可取回。
³ 步 h 的 `imageBlocks:1` = 该产物在生成时（步 f）已随结果带出的图块仍可取回，非本步新发一帧。

## 三、与 2026-08-17 基线逐环节对账

| 环节 | 2026-08-17 基线（真实拍片） | J-MCP1 实测（本 harness） | 改善 |
|---|---|---|---|
| 加 14 节点（一批） | ❌ `{ids:[],cancelled:true}`——App 内弹窗 65s 无人点自动取消；被迫拆 1+4+4+5 四批、用户在 App 里点 3 次允许、~3 分钟 | ✅ **一批 14 全落**，`cancelled:false`，16ms，0 次 App 弹窗、0 次人工点 | 取消→成功；3 分钟→16ms；3 次点确认→0 次 |
| 聊天里的进度 | **0 条 progress**（全程黑箱） | 每次 generate **≥1 条** `notifications/progress`（带 token）| 0→有实时进度 |
| 聊天里的图 | **0 张可见图** | 每张产图结果 **含 1 个 MCP image content block** + 结构化 `openInNomi` 深链 | 0→缩略图直接画在结果里 |
| 生图 | 6 调 4 成 2 败（volcengine「API key missing」、kie 无 key）、换渠道 ×2 重试 | 2 张全成、**0 重试**、0 误导性 key 错（mock vendor keyStatus=ok）| 2 次重试→0；诚实目录先挡住没 key 的 |
| 生视频 | 2 调 **0 成**（apimart 双参考被 L3 闸拒发、kie 无 key）| 1 条成、0 报错 | 0 条→1 条产出 |
| 模型目录真话 | kie 无 key 也列为「可用」→ 白白往返报缺 key | `list_models` 把 mock vendor 标 `keyStatus=ok`、把留着的无 key vendor 如实标 `missing`（不隐藏、不谎报可用）| 谎报→逐条 keyStatus 真话 |
| 节点布局 | 一竖排难看（硬编码 x=0） | 14 节点 **跨 2 个不同 x 列、0 AABB 重叠**（共享工厂 + 批量分层布局）| 单列→分层多列 |
| 60s 盲等 / 串库 | 加首帧节点 60s 盲等后「did not become ready」，此后串到 fixture 库 | 隔离 `NOMI_CAPABILITY_DIR` + 无 GUI advert，全程无盲等、无串库（该故障的库指纹修复归 T6，本 harness 只保证隔离不复现它）| 3+ 分钟盲等→无 |
| 用户可见产物总量 | **0 张图、0 条进度** | 3 条 progress + 2 个 image block + 3 个深链，产物真落磁盘 | 全黑箱→全可见 |

## 四、这套 harness **覆盖到**什么（结构保证）

- **P0-A**（确认往返）：断言「一批 14 节点 → 0 次 `{cancelled:true}`、0 次 App 弹窗」。headless 下方案门自动放行（`confirmPlan→true`），花费走 elicitation。
- **P0-B**（聊天可见性）：断言「每个产图结果必含 ≥1 image content block + 结构化 `nomi://` 深链」「每个带 progressToken 的 generate 必收 ≥1 progress 帧」。图块由真实 `nativeImage` 从产物真图缩略而来（走真实 `dispatchAndEnrich`）。
- **P1-C/D**（节点同构 + 布局）：断言「14 节点全部建成、跨 >1 个 x 列、0 AABB 重叠」。
- **P2-E**（目录真话）：断言「mock vendor `keyStatus=ok`、留着的无 key vendor 标 `missing` 且不被隐藏」。
- **性能**：断言「非模型单步开销 <2s」「整程 <180s」。
- **零额度 / 确定性 / CI-ready**：唯一「vendor」是 loopback HTTP server，回一张真 PNG 的 `data:` URL；真实请求管线 + 资产落库全跑，无任何供应商调用。两连跑指标一致。收尾杀子进程、删临时目录。

## 五、这套 harness **覆盖不到**什么（诚实敞口）

- **App 打开时的方案 elicitation 路**：只在 App 开着 + 客户端声明 elicitation 时触发（`mcpProtocol.ts` 的 elicitation-first 分支要求 `isAppOpen()`）。headless 无窗口 → 走不到，改由**单测** `mcpPlanConfirm.test.ts` 钉死。
- **bare-Node `mcpNodeLauncher.js` 启动路**：launcher 的 `invoke` 恒 `callViaRpc(ensureLiveInstance())`，它保证的是一个 **GUI** 实例；未打开项目的花费经 `createHybridGateway` → 渲染层 `spend.confirm` 卡，headless 无人点 → 走不到「零弹窗花费」。故本 harness 走**同为真实进程、真实 stdio、真实富化**的 in-Electron stdio server（与 `production-mcp-journey.e2e.mjs` 同一真进程传输）。launcher 自身的启动/转发另由 `packaged-mcp-smoke.e2e.mjs` 覆盖。
- **真实 vendor 延迟 / 真实上游报文差异**：mock vendor 同步秒回，不代表真实生图/生视频的耗时与错误面。真额度冒烟由 `mcp-draft-loop.e2e.mjs`（`NOMI_R16_GEN=1` 花一次真图额度）与 `evals/` 侧覆盖。
- **P3-F 库指纹快速失败**：本 harness 靠隔离**保证不复现**串库，但不主动制造两库竞争去断言「秒级人话报错」——那条并发用例归 T6。

## 六、复现

```bash
pnpm run build          # harness 跑 dist-electron 产物
pnpm run test:mcp-journey
cat test-results/mcp-journey-metrics.jsonl   # 每步一行指标
```

CI：已挂进 `.github/workflows/desktop-rc.yml` 的「Release-critical feature journeys」，紧随
`production-mcp-journey.e2e.mjs`（零额度、确定性；当前由独立生产旅程命令触发）。
