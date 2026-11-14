# 异步生成任务「结果取回」层：一条路取、不靠猜、失败看得见（#1213 扩大）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 设计卡（暂停点①），9 格全填。2026-10-16，F-1213 线。公开仓：不写金额、价格、供应商商务内容。
> 触发：issue #1213（自建中转 Seedance 出片已结算，Nomi 取不回）；用户 10-16 拍板「这个事儿是通用的……要做通用的优化、通用的 bug 修复」。
> 已落地的三刀（本分支 409eaaf96 / d9f38d9a2）是这张卡的第一批：A 通道只认合同证据、B 中转查询合同按官方源码、C 可找回保留并显示原话。下面是把它们收成一个通用层的设计。

```
改动名：异步生成结果取回层          线：F-1213（实现）/ 独立验收线由协调派          类别：[花钱][长跑][可打断]
```

## 类根因（一句话）

「上游这次到底成没成、结果在哪、没取到卡在哪一步」没有一个 owner：状态词表有 3 份（引擎 A `resolveTaskStatus`、引擎 B `queryTask` 自读 rawStatus + `reconcile` 自带一张 knownStatuses、渲染层 `normalizeCatalogTaskResult` 再判一次），结果地址有 3 套读法（mapping 的 response_mapping、`extractAssetUrl` 兜底 12 条路径、引擎 B `extractMaterializationOutputs` 完全不看 mapping），失败只剩一句话、没有阶段。于是「上游成了」在不同入口被判成失败、空成功、或者永远等，原因还被丢掉。

## 五条原则 → 落点

| 原则 | 现状（证据） | 落点 |
|---|---|---|
| 1 上游说成了就不能判失败 | `ensureAsyncMediaOutput` 把「成功 + 零产物」改成 failed（taskResultQuery.ts:92）；渲染层 `catalogTaskResultParse.ts:126` 再抛 noVideoUrl；`unrecognizedStatusExhausted` 2 分钟后把认不出的动词判 failed | 新结论 **`retrieval-pending`**：上游成功但没取到地址 / 认不出状态 → 节点落「可找回」，存上游原话；不再判 failed、不打红叉 |
| 2 不靠猜 | A 已改：原生通道只认合同证据、错切的开机降回 | 补「查询持续非瞬时失败自动退回」：同一模型在原生通道上查询连续 N 次非瞬时失败（4xx/5xx 非 429、非网络抖动）→ 由体检 owner 降回通用、记日志、这一单免费用通用查询再试一次；通道名写进失败原话与模型 meta |
| 3 一条路取结果 | 引擎 A：首次轮询与重新拉取**已是同一函数**（`fetchTaskResult` → `executeTaskQuery`，缓存命中 / 无状态重建只差上下文来源，已核）；引擎 B（制作 Run / Agent 走的 `createCatalogGenerationProvider`）有自己的 query 解析与产物抽取 | 新模块 `electron/tasks/taskResultReading.ts`：`readTaskResponse()` 唯一实现「状态 + 结果地址 + 失败原话 + 用了哪条规则」；引擎 A `buildProfileTaskResult`、引擎 B `queryTask` / `materialize` / `reconcile` 都调它，删掉各自的读法 |
| 4 失败看得见 | C 已改：recoverable 保留原话并在面板显示 | 失败带**阶段码** `submit / query / parse / download / outbound-blocked / timeout`（复用 `nomiErrorCodes` 的稳定机器码标记，不新造通道）；面板「技术详情」里显示阶段；遥测 `generation.completed.errorType` 由阶段码派生（`retrieval-query` 等，值仍是类别码、不含原文） |
| 5 用真实返回验证 | 已有 relay 8 形状夹具 | 矩阵测试：目录里**每个**视频查询形状（内置 108 条映射、11 种 response_mapping 形状 + 中转两种）都登记一份真实返回夹具（来源：官方文档 / 官方源码 / 仓库里已有的真实记录），过同一组断言；**普查门岗**：出现没登记夹具的新查询形状 → 测试红 |

## 解析顺序（`readTaskResponse` 的合同）

1. **状态**：通道声明的 statusMapping → 共享词表（大小写不敏感：queued / pending / submitted / not_start / running / processing / in_progress / generating / succeeded / success / completed / complete / done / finished / failed / failure / error / rejected / cancelled / expired …，按官方源码与文档补全）→ 认不出：`unknown`（继续等，不当失败；到硬上限落可找回，带上游原动词）。
2. **结果地址**：先按通道合同（response_mapping）；取不到且状态是成功 → **通用规则**：在响应里按优先级找 `result_url / video_url / url / content.* / data.* / output.* / results[*] / videos[*]`，只收 http(s)/data: 地址；**按期望媒体类型核对**（扩展名 / 已知结果域，下载时再按 content-type 核一次）；**排除回显的参考图地址**（引擎 A：本次请求 extras 里的参考 URL；引擎 B：提交时封存的 body ∪ 冻结合同的参数）；**合同读到的地址过同一道筛**（回显 + 类型，要音频时收视频容器是唯一例外——V-1213 复验）；读取层认不出的（无扩展名、重建后没有请求地址）交给**落盘关口按期望类型核字节**（V-1213 第 2 次复验）；记下用了哪条规则（`contract` / `generic:<path>`）进日志与结果 provenance。
3. **失败原话**：response_mapping.error_message → 现有 `taskFailureMessageFromResponse`（不改，已是唯一读点）。

## 9 格

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我生成一条视频（画布单镜 / 制作批次 / Agent），上游出了片，我想片子回到节点上；取不回时我想知道卡在哪、点「重新取回」能拿回来。步骤：选模型 → 生成 → 等 → 出片落节点；或 → 可找回面板看原话 → 重新取回。**不做**：不改提交、不改计费确认、不自动重新提交（重提 = 再扣一次钱）。**真实任务**：① 自建 new-api 中转 + Seedance fast 4s 一条；② APIMart Kling / Veo 一条；③ 方舟直连 Seedance 一条（均由协调按最小量真跑）。主指标：上游成功的任务取回率（目标 100%，基线 #1213 为 0）；护栏：重复扣费 0、误判失败 0 | 逃逸账本 USER-20261016-video-result-not-retrieved；真实任务由独立验收线跑 |
| ★1b 连带界面 | 可找回面板（服务商原话 / 复制详情 / 技术详情 + 阶段）；分镜行悬停说明（读同一 node.error）；任务中心「未取回」行；制作 Run 的取回失败卡（引擎 B 的结论也走同一读法）；Agent 回执里「已生成未取回」的说法不变 | `NodeRecoverableReport.test.tsx`；中英亮暗截图 `docs/evidence/2026-10-16-recoverable-reason/` |
| ★2 谁说了算 | 概念「异步任务结果读取」→ 唯一 owner `electron/tasks/taskResultReading.ts`；「中转视频走哪条通道」→ 唯一 owner `relayNativeWireUpgrade.ts`（升级 / 降级 / 运行中退回都只经它）；「结局带的原因」→ `nodeRunOutcome.outcomeError`。消费者：引擎 A `buildProfileTaskResult`、引擎 B provider、渲染层只读结论不再自判。同一份事实存 1 份 | `node scripts/door-map.mjs resolveTaskStatus / extractAssetUrl / extractMaterializationOutputs / ensureAsyncMediaOutput`（现 3+3+1+2 扇，合并后各 1 个实现） |
| ★3 一致与复用 | 复用：`resolveTaskStatus`（扩词表后成唯一词表）、`taskFailureMessageFromResponse`、`nomiErrorCodes` 机器码、失败卡三件套（NodeFailureDetails）、`hardenedFetch` 的 content-type 诊断。删掉：引擎 B `reconcile` 里的 knownStatuses 表、`extractMaterializationOutputs` 的独立路径表、渲染层对「成功无地址」的再判 | `git grep knownStatuses / extractMaterializationOutputs / noVideoUrl` |
| ★4 全状态 | 排队 / 生成中：照旧进度；成功取回：落节点；**上游成功未取到地址**：可找回 + 原话 + 阶段 parse；**查询报错**：45s 后可找回 + 原话 + 阶段 query；**下载失败**：可找回 + 阶段 download；**出站被拦**：可找回 + 阶段 outbound-blocked（已有）；**等到上限**：可找回 + 阶段 timeout + 上游最后的动词；**上游明说失败**：红色失败卡 + 原话；取消中：照旧（不在本卡改）；能力不可用（通道查不了）：可找回 + 原话 + 下一步「重新取回 / 到中转后台核对」。文案只用现有 i18n 键 + 阶段名（新增阶段名中英各 6 个） | `check:i18n`；截图 |
| 5 中途表 | 见下表 | 单测 + 走查 |
| 6 外部数据与失败 | 来源：官方 new-api（rc.10–rc.44 源码）、方舟查询文档 1520757、APIMart / KIE / RunningHub / fal / Runway / MiniMax / Higgsfield / Agnes / 即梦 各自 mapping 的 `sources` 链接与仓库已有真实记录。偏差：new-api 信封、旧版地址在 fail_reason、OpenAI-video 不带地址（要鉴权取 /content，本卡只做诚实可找回，不做取回）。失败时用户看到上游原话，不甩锅给 key | 合同夹具文件头逐条注明来源 |
| ★7 性能 | 不适用：不新增用户操作；解析是每次轮询一次的纯函数（响应 ≤ 几十 KB），通用规则只在合同读不到时跑 | — |
| 8 真实条件 | Windows ✅（本机）；英文界面 ✅（截图）；真付费 `unverified`（协调按最小量跑 3 条）；方舟对假任务号的真实回答 `unverified`（需一把方舟或代理方舟中转的 key 免费 GET 一次） | `docs/evidence/2026-10-16-recoverable-reason/*.png`（已亲眼看过） |
| 拍板图清单 | 不适用：不新画界面，只在现有可找回面板复用失败卡三件套（协调 10-16 裁定 C 的条件） | 协调消息 |
| ★9 验收与回滚 | 验收：独立线对着本卡逐格核；`pnpm vitest run electron/tasks electron/catalog src/workbench/generationCanvas` + 矩阵测试 + `node tests/ux/recoverable-reason.walk.mjs`；真付费 3 条由协调跑。硬门 ⑫（点了 = 以为的：点「重新取回」要么拿回、要么说清卡在哪）。回滚：按提交逐个 revert（修复提交与门岗 / 文档提交分开，可单独回补 release/0.23.x） | PR `## 独立验收` |

### 中途表（状态 × 打断）

| 状态 | 停 / 取消 | 关窗 | 断网 | 重启 | 连点重新取回 |
|---|---|---|---|---|---|
| 生成中 | 停止轮询，任务号留在节点 · 已扣（上游在跑）· 运行记录 | 同左 | 查询失败 45s → 可找回（阶段 query）· 已扣 · 节点 error | 加载时 running → 可找回（已有）· 已扣 · 节点 | 不适用 |
| 上游成功未取到地址 | 不适用 | 可找回原样落盘 · 已扣 · 节点 error + 运行记录 | 重新取回失败 → 可找回（阶段 query/download） | 无状态重建重读目录 · 已扣 · 节点 | 主进程同一 taskId 的查询是只读、幂等；按钮 pending 期间不可再点（已有） |
| 查询报错 / 下载失败 | 不适用 | 同上 | 同上 | 同上（降级后的通道在重启时生效） | 同上 |
| 上游明说失败 | 不适用 | 红色失败卡落盘 · 上游一般退款（中转账单可见）· 原话 | 不适用 | 不适用 | 不适用（不提供重新取回） |

## 协调裁定（10-16）与落地

1. **开机静默切换**：0.23.2 维持 ①——开机只在拿到原生合同证据时升级、拿不到就降级（已落），外加运行中退回。
   **下一步（0.24，另开设计线）= ②**：去掉开机升级，只留开机降级与旧查询刷新；接入时 / 「测试连接」时验证并写进模型 meta，接入页加一行「走哪条通道」（新界面，走设计管线、给用户看样张）。
2. **遥测阶段码**：协调要求先证明服务端收任意合规字符串。本机 intake 缓存（只看聚合计数）里出现过的 errorType 值全部是 `generation.completed.errorType` 上线（10-01）**之前**就存在的类别码，证明不了「无白名单」。按裁定**不新增值**：取回失败现在落「可找回」，本来就不是终态、不上报 `generation.completed`；终态失败的类别码不变。把阶段写进遥测要等服务端契约确认后另开一刀（见报告）。
3. **运行中退回 N=3**：只数按合同认出的非瞬时错误（404 路由 / 任务不存在、400 任务号无效、「无可用渠道」/ model_not_found）；普通 5xx、429、网络抖动不算。单向退回、logWarn `relay-native-wire-fell-back-at-runtime`，失败原话里写清「已从 X 通道退回 Y」，这一单只用通用查询免费再查一次，不重新提交。（`relayNativeWireUpgrade.noteRelayQueryOutcome`）
4. **OpenAI-video 不带地址、要鉴权取 /content**：要让下载那一步带上用户的 key（同 origin），牵涉凭据出站绑定与出站策略两道门岗、需要安全评审，超出半天，本 PR 只做到**诚实可找回**（阶段 parse / download，原话可见），另开一刀。实际影响面小：Nomi 的通用中转查询走 `/v1/video/generations/{id}`，官方 new-api 在这条路由回信封（带 result_url），只有 Gemini / Vertex 渠道没有上游地址时才给 `/v1/videos/{id}/content` 代理地址。
5. **真付费**：3 条最小量方案与要的 key 见报告；方舟对假任务号的真实回答同样待一把 key 免费核对。

## 提交组织（可回补 0.23.x）

1. 已落：`fix(relay)` A+B；`docs(fixes)` 合同 / 方向检查 / 账本；`fix(canvas)` C；`test(ux)` 走查截图。
2. 本轮：`fix(tasks)` 共享词表 + 结果唯一读法（两台引擎）；`fix(tasks)` 上游说成了不判失败 + 取回阶段码 + 运行中退回；`test(catalog)` 视频通道矩阵 + 普查门岗；`docs` 卡 / 方向检查 / 合同 / 账本。每个修复提交单独可回补，门岗与文档提交分开；碰热点的修复提交带 `Direction-Check: docs/engineering/direction-checks/2026-10-16-async-result-retrieval.md`。

## 回补 0.23.x（V-1213 第 8 节，临时分支试摘结论）

从 v0.23.1（66d6eafed）按下列顺序 cherry-pick，冲突全部只在「0.23.1 没有、main 后来才有」的邻接内容上，按下表解；解完 electron / app 两份 tsc 干净、`check-file-sizes` 过、相关 581 个测试文件 6309 条全绿（试摘分支 `tmp/backport-0231-1213`，本地、未推送）：

| 顺序 | 提交 | 冲突 | 解法 |
|---|---|---|---|
| 1 | 409eaaf96 | 无 | — |
| 2 | d9f38d9a2 | `NodeRecoverableReport.tsx`：0.23.1 没有 `recoverableCopy`（c4c4e0215）与统一按钮键（911873697） | 取修复版组件，标题 / 说明 / 按钮改回 0.23.1 的 `generationCommon.recoverable.*` 键；`BaseGenerationNode` 补传 `node`。**不连带回补** c4c4e0215 / 911873697（前者还带 MCP 改动，后者删旧键，都与本修复无关） |
| 3 | 465f1b9e4 | 两个文件的 import 区（0.23.1 的 import 邻居不同） | 保留 0.23.1 其余 import，读取层 / 产物 / 词表那几行取修复版 |
| 4 | b74062b18 | 无 | — |
| 5 | a1c712be9 | `nomiErrorCodes.ts`（0.23.1 没有 output-retrieval-failed / local-processing）；`desktopStrings.ts`（邻接的出站文案在 0.23.1 是旧措辞） | 只加 retrieval-* 四个码；文案只替换 completedWithoutOutput、加 retrievalStage / wireFellBack 键，其余保持 0.23.1 原文 |
| 6 | ee47be844 | `productionGenerationSubmission.ts` import 区 | 去掉旧词表 import，取修复版那一行 |
| 7–11 | 4a7117c10、31e72c476、c67730125、ad46b995d、5ce949038 | 无（5ce949038 正是为回补把 VendorRequestError 改成两参构造） | — |
| 12 | c140540a0 | 目录执行器 import 区 | 同 3（这一刀让该文件在 0.23.1 上回到 795 行，低于 800 行上限） |
| 13–14 | 309a9b26e、913216322 | 无 | — |
| 15 | 1c83d754f | `scripts/check-file-sizes.mjs`（runtime 基线按 main 的数） | 只取矩阵测试，基线留 0.23.x 自己的数 |
| 16 | e24f32d62 | `modelOnboarding/declaredProviderProduction.test.ts`（0.23.1 没有这个文件）；0.23.1 的 `GenerationProviderTaskContext` 只有 modelId / mode | 删掉那个测试文件；上下文类型补 `"parameters"` 一个词。目录执行器在 0.23.1 上 798 行（上限 800） |
| 17 | 666c586e1 | 0.23.1 的 `restoreWorkbenchProjectPayload` 只收一个参数 | 测试里去掉第二个参数 |
| 18–20 | 42736b307、df728c339、78787c0c4 | **摘不干净**：0.23.1 没有 `generatedAssetStaging`（#1208 之后才有），关口是 `projectAssetStore.validatedGenerated`（同步）；写入口名字不同（`writeAsset` / `writeDeterministicAsset` / `moveAssetFile`） | 不摘，改为两个 0.23.x 移植提交：同一规则落在 `validatedGenerated`，写入口与调用方同样类型必填；provider 上下文必填同 main。测试同 main 一组（0.23.x 写入口同步，包一层 Promise；引擎 A 回环用实验夹具 origin 放行） |

16–17 摘上去后（试摘分支上另记一个 `chore(backport)` 提交放这两处邻接差异）：electron / app 两份 tsc 与测试类型门干净、`check-file-sizes` 过；相关 290 个测试文件 3710 条，满载并行时一条 MP4 导出用例超时，单跑与按目录重跑（587 条）全绿。

文档 / 登记提交（a4ce72ee7、9f895af14、1b6131693、854cd0db6 等）与走查截图提交不必回补到发版分支。
