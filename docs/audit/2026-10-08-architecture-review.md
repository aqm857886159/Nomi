# 架构评审：为什么老出「没人统管」的事故，以及怎么统一管理

> 状态：✅ **终稿**（第 2 阶段，2026-10-08）。未提交、未推送。
> 基线：`main@e0f7dccf3`。窗口：近 30 天（2026-09-08 起）。
> 事实来源：第 1 阶段评审自查 + Codex 九份查事实报告（下文按名字引用：**R-arch-1** 09-26 进展、**R-arch-2** 分层与依赖、**R-arch-3** IPC / 共享类型 / 配置、**R-arch-4** 横切基础设施、**R-arch-5** 测试架构与流程、**R-arch-6** 生命周期参与者、**R-arch-7** 平台与进程形态、**R-arch-8** 落盘族与证据 runner、**R-arch-9** 治理有效性）+ 协调会话的 R-life-a / R-life-b / R-life-c / R-untrustedipc 体检报告 + [`2026-10-01 门岗账本`](2026-10-01-gate-ledger.md)。
> 命名：09-26 方案的 A/B/C 是**领域**三条线，本文记 **D1 / D2 / D3**；用户 10-08 批准的 A/B/C 是**宿主**三件事，本文记 **H1（生命周期唯一 owner）/ H2（落盘格式登记 + 发布样本矩阵）/ H3（Mac 生命周期端到端进 CI）**。
> 在途、本文不重复建议的：0.23.1 热修 RC（#1104 退出 / #1102 旧项目打不开，等用户 Mac 验）；#1117（vocabularies 只在 HEAD 含 origin/main 时比它）；**F-quitdrains**（退出唯一 owner + 排空登记「必需 / 可选 + 截止时间」+ ESLint 禁别处订阅 will-quit / before-quit + 关窗确认纳入总时限）；**L-lifee2e**（无 runner 的生命周期 e2e 接进 CI + 新 e2e 必须登记 runner）；**L-gateslock**（gates 的 python3 锁改 node 锁）；Codex PR 推送前对抗评审线；#1096（项目文件只经主进程单写口）。

---

## 给用户的话（≤300 字）

**为什么老出问题？** Nomi 有两类病。一类在地基：启动、退出、存盘格式、升级没人统管，每个功能自己钻孔，一出事就是「所有项目打不开」「退不出去」。另一类在业务：同一件事（参数、画布上的结果）有好几处在算、在写，所以「界面说的≠发出去的」「花了钱的结果被撤销吞掉」。检查认名字不认行为，测试在 Linux 上跑、你在 Mac 上用，所以总是你先撞见。

**我们要做什么？** 先立地基：退出只有一个管家，存盘格式登记且每次发版留样本，Mac 每晚真跑一遍。再让参数从模型到出站只算一次。同时砍掉只产文档的检查，让「写错地方」直接编译不过。

**你要权衡的：** 接下来两周，三条线里拿两条去打地基、0.24 少带新功能，还是继续边做边修。

---

## 拍板结果（2026-10-08，用户）

- 拍板点 1：**做**——宿主层边界做成「写错地方就红」的结构约束（ESLint / 依赖检查），新违规即红，存量进棘轮只减不增；concept-owners 门岗仍保持只提示。
- 拍板点 2：**2/3 实现线打地基 + 1/3 做用户反馈与小功能**；0.24 以「上一版升级打开不坏 + Mac 退出矩阵全绿」为发版门。
- 拍板点 3：**不作为拍板点**——仓库在个人账号下，GitHub merge queue 不可用（只对组织仓库开放）。改为：合并脚本合并前自动把落后 main 的代码 PR 同步到最新 main 并等 CI，再加现有的合并后收据（红即停）。另外「30 个合并里 17 个 48 小时内同文件又进 fix」多数是同一功能的后续修，不能直接算作「合并组合出错」，所以不为它付串行合并的代价。
- 拍板点 4：**协调会话定合同和必红测试（接口 / 状态机 / 结构约束），Codex 按合同实现**，推送前另派 Codex 对抗评审；这样结构改动的质量靠机器判据，不靠评审眼力。

---

## 一句话结论

**两个根，一种病。** 宿主层（进程生命周期、落盘格式、IPC 契约、平台差异）爆炸半径最大，一坏就是整机或全部项目；领域层的「项目文档」和「生成合同」出事最频繁，10 月 89 份根因合同里占 20 份。两边是同一种病：**边界契约不是一等公民**。Electron 的 `app` / `ipcMain` / `fs`、渲染层的项目文档、渲染层拼的出站请求，都允许任何模块直接写，「只有一个 owner」靠约定和事后登记维持。现行治理认的是「同名定义」，认不出「第二个订阅者 / 第二个写者 / 没写版本的格式 / 没人跑的回归」，所以账上写着已收敛，事故照样从用户那里回来。**修法不是再加登记和门岗，而是把这些边界做成结构：写错地方就编译 / lint 不过；格式变了不升版本就红；回归测试不在 runner 里就不算数。**

---

## 1. 第 1 阶段判断的核对结果

| # | 第 1 阶段判断 | 结果 | 依据 |
|---|---|---|---|
| 1 | 真正的问题在宿主层，不是「一个概念多个 owner」 | **修正** | 按次数算，宿主层只占 10 月合同的 9/89；领域层（画布文档 11、生产 Run 10、生成合同 9、分镜 3）共 33/89，是最大的一块（§2 表）。宿主层是**爆炸半径**最大，不是**频率**最高。改成：两个根（宿主层、领域层的项目文档与生成合同），同一种病（边界契约不是一等公民） |
| 2 | 10-07 那一类（可取消阶段做不可逆的事、多个退出否决者）在 main 上还活着 | **证实并扩大** | R-arch-6 参与者表：除第 1 阶段列的 3 个否决者外，`electron/capabilityCore/mcpProfiles.ts:48-53` 的 `fs.watchFile` 没有 dispose；`electron/director/mobileBridgeServer.ts:238-254` 的本机 server 没有全局退出钩子；export 以外的子进程退出时没人汇总回收。F-quitdrains 在修 |
| 3 | 治理把假收敛记成「已收敛」 | **证实（样本），全量未测** | 退出样本已证实。R-arch-9 的 N7 / N9 全量核对因 `door-map.mjs` 缺 `typescript` 依赖而 unverified。本评审补抽 3 条 host 概念，按**行为**看 2 条不成立：`host.quit-teardown`（三个否决者）；`host.background-idle-exit`（登记写「不新增第二份」，但 `electron/backgroundLaunch.ts:39` 自带一份 Run 状态列表，经 `electron/main.ts:635` 直接决定后台实例能不能退）。`host.cross-origin-isolation` 成立 |
| 4 | 登记表粒度等于事故粒度 | **证实** | 182 个文件、179 条 `converged`（R-arch-9 与本评审一致）；113 条是 `rule`；10 月 8 天新增 85 条。R-arch-5 写的「约 78 条」与此冲突，见 §11 |
| 5 | 为事故写的回归测试没人跑 | **证实，措辞修正** | R-arch-8：10 月 89 份合同引用 261 个唯一测试路径，**8 个已不存在**，只有 42 个能在 runner 配置里直接找到，其余 219 个多半被 Vitest glob 间接收集，**不能算没跑**。真正确定没接线的是显式枚举的 `*.e2e.mjs`：82 个里 40 个没有 runner，含 `quit-teardown-real` / `upgrade-0225-to-0230-open` / `project-open-stages` / `cold-start`。L-lifee2e 在接 |
| 6 | 验证跑在错误的环境里 | **证实并扩大** | R-arch-7：workflow `runs-on` 计 Ubuntu 21 / macOS 4 / Windows 6，常规门在 Ubuntu，Mac 只打包。**新增**（R-arch-5）：连 Linux 夜跑的信号都很弱。324 条走查首跑 149 过、169 红、6 超时；红灯里 32% 是选择器 / 文案过期，46% 判不了产品信号，疑似真回归只占 14% |
| 7 | 09-26 六条里 #3、#6 进展最差 | **修正** | #5（耐久身份 / durable commit）**进展最差**：commit marker、crash injection、冷重启证据一项未做（R-arch-1）。#3 范围最大（宿主层契约）。#6 比我估计的好：付费 POST 已收成一个出口（#1100），钱和状态已收进 Run。#4 我原写「明显改善」，**部分推翻**：R-arch-2 抽到渲染层 10 处仍在判可用性、准入、要不要确认花费 |
| 8 | 项目文档没有唯一写者 | **证实** | R-arch-8：renderer localStorage 草稿 + 主进程 canonical project，物理上双写面。R-arch-3：项目数据在内存 / IPC / 磁盘至少 3 种形状。#1096 在途 |
| 9 | H1 必须是「参与者协议 + 结构禁止」 | **已被采纳** | F-quitdrains 的任务书已含排空登记、ESLint 禁订阅、关窗确认纳入总时限 |
| 10 | 根在交付模型 | **证实并加强** | R-arch-9 N12：最近 30 个 PR 合并后 48 小时内 **17/30** 又有同文件 fix。分支保护 `strict: false`，不要求分支与 main 同步再合（`gh api …/branches/main/protection`），PR 在各自的旧 main 上绿。R-arch-5 §3：并行线各自造 helper，合并后才被门岗发现。今天 3 个 PR 都是本地没跑 CI 同款门岗 |

**新增的事实（第 1 阶段没有）：**
- **分层只在目录名上**（R-arch-2）：`src → electron` 692 条 import 边，其中 127 条直达非 shared 实现；`electron/shared` 反向依赖实现（`shared/canvas/videoDepthModels.ts → downloads/verifiedAssetCache.ts`）；25 个强连通环。已有 `check:boundaries`（dependency-cruiser，棘轮冻结 67 条存量），没有「shared 不许依赖实现」这条规则。
- **配置没有 owner**（R-arch-3）：生产代码 119 处读 `process.env`，分布在 56 个文件；E2E 夹具开关在 4–5 处各自解释。
- **IPC 运行时校验几乎为零**（R-arch-3）：258 个注册点（218 handle + 40 on）。严格口径下，在接收边界做全形状 schema 校验的只有 1 个（`nomi:log:renderer`）；宽口径上限 36 个。
- **横切能力「局部有 owner、旁路很多」**（R-arch-4）：网络出口 5 类，渲染层仍有直接 `fetch`，`credentialElicitationHttp.ts:153` 是主进程裸 fetch；超时 / 重试至少 4 套机制；「状态未知」在 Run 之外还有 `needs_reconcile`、tryModel 的 `submission_unknown`；IPC 大量裸 `throw new Error`；`setTimeout` 239 处。
- **项目会话没有超时也没有降级分级**（R-arch-6）：`canvasReadSurfaceRegistry.ts:368-384,433-492` 的 await 全无 deadline，失败只有「打不开」一种出口；切项目时不重建全局服务，只靠 release / revoke / epoch。
- **Mac 退出时序**（N14）仍 **unverified**：工作树里没有 Electron 源码，也不许联网。第 1 阶段的推断（关窗确认取消了退出、确认后不续退出）保持「推断」。F-quitdrains 让关窗确认走状态机，修好后不依赖这个推断成立与否。
- **pre-push 只留痕不拦**：`scripts/claude-hooks/pre-push-check.sh:37-38,86-91` 绕过只写日志。而且它是 Claude 会话的 hook，Codex 执行时不跑。

---

## 2. 事实底座：10 月事故按层 × 发现渠道

R-arch-9 没能给出这张表：合同字段不统一（728 份里只有 76 份有 `detected_by`，逃逸账本 71 份全无），而且工具缺依赖。下表是**本评审按每份合同的 `class_root` 逐份人工归类**（分组明细见附录 B），发现渠道用合同自带的 `detected_by`。

| 层 | 10 月合同 | 用户 / 发布后 | 走查 | 评审 | CI | 未填 | 爆炸半径 |
|---|---|---|---|---|---|---|---|
| 交付设施（门岗 / CI / 测试 harness） | 13 | 0 | 1 | 3 | 4 | 5 | 开发产能 |
| UI 投影与交互 | 12 | **7** | 4 | 1 | 0 | 0 | 单个界面 |
| **D 画布文档**（撤销 / 外部写 / 删除 / 落地 / 自动保存） | **11** | 2 | 2 | 7 | 0 | 0 | **已花钱的结果丢失** |
| D 生产 Run（付费卡 / 批准 / 派发 / 停止） | 10 | 0 | 2 | 4 | 1 | 3 | 花错 / 重复花 |
| **D 生成合同**（参数 / 模式 / 参考 / 准入） | 9 | 3 | 5 | 0 | 0 | 1 | 界面说的 ≠ 发出的 |
| X 网络出口（上传 / 取回 / 付费 POST） | 7 | 2 | 1 | 3 | 0 | 1 | 失败 / 可能重复提交 |
| 导演台 | 6 | 0 | 5 | 1 | 0 | 0 | 单功能 |
| X 失败语义（错误信封 / 未知态） | 5 | 2 | 0 | 1 | 0 | 2 | 用户与 Agent 被误导 |
| **H 生命周期**（启动 / 打开 / 退出 / 进程形态） | 5 | 2 | 2 | 1 | 0 | 0 | **整机 / 全部项目** |
| X 时间预算 | 4 | 1 | 0 | 2 | 0 | 1 | 白等 / 白花 |
| D 分镜 | 3 | 2 | 0 | 1 | 0 | 0 | 分镜面 |
| **H IPC** | 2 | 1 | 1 | 0 | 0 | 0 | 功能静默失效 |
| **H 落盘** | 2 | 1 | 0 | 1 | 0 | 0 | **升级后全部项目** |
| **合计** | **89** | **23** | **23** | **25** | **5** | **13** | |

逃逸账本 70 条（不含 `_meta`）的分布与此吻合：`parameter-contract` 16 条（9 条未结）、`interaction-semantics` 18 条（10 条未结）、`claims-and-outcomes` 13 条。用户最常撞上的是**参数不一致**和**交互不符预期**；最伤的几次（打不开、退不出）在宿主层。

**读法：**
1. CI 抓到的 5 份里 4 份是交付设施自己的问题；产品层的类根因 CI 几乎抓不到。
2. 画布文档 11 份里 7 份由评审先发现，这一族已经在被主动挖（#1065 / #1072 / #1073 / canvas-write-boundary 已合，#1096 在途）。
3. 宿主层 9 份里 4 份由用户先发现，比例最高，后果也最重。

---

## 3. 问题清单（终稿）

每条按「现象 / 证据 / 类根因 / 伤害 / 置信度」写，已按 §1 的核对结果更新。

### 宿主层

**P1 应用与项目会话的生命周期没有 owner**
- 现象：10-07 进程活着、通道已拆，所有项目恢复失败；10-08 Mac 退出无响应；更新安装可被关窗确认打断；新版本被老进程的单实例锁挡在门外。
- 证据：
  - `will-quit` 上 3 个独立否决者，各自重入 `app.quit()`：`electron/quitTeardown.ts:28-30,73`、`electron/ai/antigravityIpc.ts:18-24`、`electron/tasks/taskIpcHandlers.ts:22-27`；另有 4 个监听（`electron/main.ts:658`、`electron/mainProcessLifecycle.ts:80`、`electron/screenshot/screenshotHotkey.ts:265`、`electron/video/depthVideoIpc.ts:66`）。
  - `electron/ai/antigravityIpc.ts:15-17,42` 在 before-quit 把 `exiting` 置真、永不复位，退出被取消后这项能力永久失效。
  - 关窗确认无超时（`electron/windowCloseConfirmation.ts:30-46`）。
  - `registerIpc()`（`electron/main.ts:383-597`）约 70 条注册语句，任一同步抛错整机退出（`:661-664`）。
  - 项目会话的 await 全无 deadline（R-arch-6）；还有未回收的 watcher、server、子进程（R-arch-6）。
  - 至少 5 种进程形态靠 env 分支区分：GUI、Electron 内 MCP stdio、bare-Node launcher、后台 / E2E 多实例、Preview（R-arch-7）。
  - `electron/video/depthVideoIpc.ts:64-65` 的注释写明：为避开 main.ts 巨壳，把退出钩子挂在了子模块里。
- 类根因：Electron 生命周期是全局事件，谁都能订阅、谁都能否决；Nomi 没有「阶段状态机 + 参与者协议（关键 / 可选、截止、排空、拆除）」，也没有结构禁止。
- 伤害：整机卡死、半死进程、更新装不上、全部项目打不开。
- 置信度：高。Mac 精确时序为推断。

**P2 落盘格式没有跨版本契约**
- 证据：
  - 14 个落盘族里只有 Agent proposal receipt 有逐发布版样本（`electron/capabilityCore/__fixtures__/published-receipts/`）。
  - 项目 manifest 只有 `version:2`（`electron/workspace/workspaceTypes.ts:6`），没有 schemaVersion。
  - registry 无版本，坏 JSON 直接抛（`electron/workspace/workspaceRegistry.ts:16-24`）。
  - Run 的 JSONL 坏一行，恢复就进 needs_attention（R-arch-8）。
  - 近 60 天至少 4 个提交改了持久化写路径或字段形状（`61738de3f`、`f2631ad79`、`058f6fa03`、`66d930816`），仓库里没有任何「形状变了必须升版本」的机制（R-arch-8）。
  - 原子写有 3 份 helper（`electron/jsonFile.ts:64`、`electron/configFileStore.ts:231`、`electron/integrationCertification/certificationPersistence.ts:32`）。
- 类根因：格式演进靠人记得；没有「族登记 + 读策略 + 发布样本 + 改形状检测」。
- 伤害：升级后打不开项目；或静默回默认、丢历史。
- 置信度：高。

**P3 跨进程契约是「局部单源、全局多源」**
- 证据：
  - 258 个 IPC 注册点，严格口径只有 1 个在接收边界做全形状校验，宽口径上限 36 个（R-arch-3）。
  - preload（`electron/preload.ts:58-296`）、渲染层桥类型（`src/desktop/bridge.ts`）、handler 签名三处各写一遍；返回值靠 `as Promise<…>` 断言（`electron/preload/runtimeBridge.ts:64-108`）。
  - 同一份数据在内存 / IPC / 磁盘至少 3 种形状（R-arch-3）。
  - 119 处 `process.env` 读点分布在 56 个文件（R-arch-3）。
  - 渲染层直接 import 主进程实现 127 条边，shared 反向依赖实现，25 个环（R-arch-2）。
  - `UntrustedIpcSenderError` 那 8 次的来源**待用户日志**（N13）。
- 类根因：09-26 类根因 #3 在进程边界的表现；没有一张通道表派生 preload、类型和解析。
- 伤害：通道缺失、静默失效、半份事实过界。
- 置信度：高。

**P4 平台专属路径没有端到端覆盖**
- 证据：PR 上的 Mac job 只打包并 `codesign --verify`（`.github/workflows/quality-gate.yml:477-503`）；夜跑走查只跑 Ubuntu + xvfb（`.github/workflows/nightly-walkthroughs.yml:19,56`）；`process.platform` 在 electron 103 行、scripts 47 行（R-arch-7）。
- 伤害：最近三起宿主事故都是 Mac 用户日志先报的。
- 置信度：高。

### 领域层

**P5 项目文档没有唯一写者，系统事实寄居在用户可编辑层**
- 证据：
  - 渲染层整份 record 经 `nomi:projects:save-async` 写盘（`electron/projects/projectsIpc.ts:61`），localStorage 还有一份草稿面（R-arch-8）。
  - 10 月同族合同 11 份（§2），class_root 原话：一个节点混着编辑层和事实层，没有单一写边界（`docs/fixes/2026-10-07-canvas-write-boundary.root-cause.json`）。
  - V-1072 仍指出 `proposalUndo.ts:449` 的 restore-snapshot 风险，跨提案撤销 × 生产 detach × 重落地的组合没有测试（R-arch-1）。
- 类根因：主进程的事实（花了钱的结果、运行状态）要「注入」一份由渲染层持有、可撤销、可被外部整张写回的文档。
- 伤害：已花钱的结果被吞。
- 置信度：中高。#1096 方向正确，在途。

**P6 生成合同：一台钱和状态发动机 + 两个传输适配器，编译仍两套**
- 证据：
  - 画布单镜已进 Run（`electron/capabilityCore/appIntegrationCanvasShot.ts:267-490`）。
  - 但 `canvasTransportProvider.ts:157-168` 把渲染层拼好的请求原样包成 `canvas:<vendor>`，模式 / 变体 / 参数仍在渲染层编译（R-arch-1）。
  - 渲染层仍在判可用模型、准入、要不要确认花费（R-arch-2 的 10 处样本，例如 `src/workbench/generationCanvas/spend/spendConfirm.ts:162-215`、`src/workbench/generationCanvas/runner/usableVendorModel.ts:42-65`）。
  - MCP 仍有 5 个手写生成工具（`electron/capabilityCore/mcpGenerationToolCatalog.ts:67-142`）。
  - 作者账 `StoryboardDesign` 与执行快照 `generationPlan` 语义已分开，物理字段仍重叠，旧 `generationPlan.editorial` 仍兼容读（R-arch-1）。
  - 跨入口 canonical payload 对等至今不是门岗。
- 伤害：「界面说的 ≠ 发出的」，是逃逸账本里最大、未结最多的一类。
- 置信度：高。

**P7 耐久提交没有落地（09-26 #5，进展最差）**
- 证据：Run journal + intent log + approval / budget side-ledger 的 commit marker、恢复矩阵、crash injection 一项未做；冷重启 / 切项目 / Windows 存储证据 PARTIAL（R-arch-1）；`electron/productionRun/` 里 grep 不到 `commitId`。
- 伤害：潜在风险，10 月没有对应事故。崩溃落在提交中途时，系统说不清「花没花」。
- 置信度：高。

### 横切与治理

**P8 横切能力局部有 owner、旁路很多**
- 证据：见 §1 新增事实与 R-arch-4。时间预算和失败语义在 10 月贡献 9 份合同。
- 判断：网络出口已有三层 owner（`appFetch` / `hardenedFetch` / `vendorHttp`），缺的是**收旁路**，不是再造；**截止时间原语**和**「未知 / 失败」信封**还没有 owner。
- 置信度：中高。

**P9 治理在量上增长、在效上失灵**
- 证据：
  - 30 天 1020 个 fix 提交、469 份根因合同、门岗脚本新增 85 / 删除 17、`gates:contracts` 98–100 道（口径差见 §11）。
  - 10 月合同 CI 发现 5 份（其中 4 份是交付设施自身）；728 份合同只有 76 份填了 `detected_by`，逃逸账本 0 份（R-arch-9）。
  - 普适性证明是自由文本，10-07 样本已被证伪。
  - 8 个回归测试路径已经消失（R-arch-8）。
  - 10-01 门岗账本：静态门岗 60% 的阻断是纸面。
  - 夜跑红灯三分之一是剧本漂移（R-arch-5）。
- 类根因：§5。
- 置信度：高。

**P10 交付模型里没有「层」的 owner，合并验证的不是合并后的东西**
- 证据：
  - 五个组合根 30 天 229 次被提交触碰，标题含 fix 的 149 次（R-arch-9）；`electron/main.ts` 14 天 15 个 fix（R-arch-6）；`Direction-Check` 尾注 30 天只命中 22 次。
  - 同时改 `src/` 与 `electron/` 的提交 289 个（R-arch-9）。
  - 合并后 48 小时同文件返修 17/30（R-arch-9）。
  - 分支保护 `strict:false`，不要求与 main 同步；Quality Gate 用 `cancel-in-progress` 且 E2E 用 `continue-on-error`（R-arch-5）。
- 类根因：P2「修在最早共享边界」在没有层级地图时，每条线只能在自己视野里造一个局部边界；验证对象是各分支快照，不是合并后的组合。
- 置信度：中高。

---

## 4. 09-26 六条类根因：今天还成立多少（终稿）

| # | 类根因 | 今天 | 最强证据 | 判断 |
|---|---|---|---|---|
| 1 | 领域事实不是一等对象 | 部分成立 | owner 一条条收回（变体、首帧、参考、方案身份）；`canvas.zoom` 仍 pending；`productionShotPhase.ts` 私有 `jobsForShot` 从 #921 挂在基线里至今；语义 parity 与跨入口同 handler 扫描没做（R-arch-1） | 在走，按事故收，没有按层盘点 |
| 2 | 两台生成发动机 | 钱和状态已一台；编译和传输两套 | P6 | 第一刀真落地，难的一半在后面 |
| 3 | 跨边界放半份事实 | **范围最大** | P3（IPC 1/258、3 种形状、env 119 处）、P2（落盘无版本契约） | 宿主层整片没覆盖 |
| 4 | 投影层替领域做决定 | 部分改善 | 任务中心只剩一份投影；渲染层仍有 10 处领域判断（R-arch-2） | 收了展示，没收判断 |
| 5 | 耐久身份被进程内状态替代 | **进展最差** | P7；宿主层的新形态见 P1（`exiting` 标志、半死进程） | 原语都有，提交协议没落地 |
| 6 | 入口统一只统一第一层 | 改善中 | 付费 POST 一个出口、钱进 Run；MCP 5 个手写工具、附属付费口仍铸进程内令牌（`electron/spendGrant.ts:28`，例外到 11-15）；退出只统一了阶段，没统一否决权 | 仍会以「只收了眼前几个调用者」的形式复发 |

**对 09-26 方案本身的意见：**
1. 它整个排除了宿主层，而最近最伤的事故都在那一层。
2. 最便宜的部分（登记表 v2 + 门岗）先落地，在账上制造了「已收口」的观感；它自己写的 Phase 1 准入条件（durable commit、crash injection）12 天后仍是零。

方向不需要推翻，次序和范围要改：本文 §7 把宿主层并进来，把 durable commit 排进路线图。

---

## 5. 为什么门岗 + 账本 + 规则没挡住，补救够不够

**七个机制：**
1. **判形状不判行为**：`check:concept-owners` 只判同名定义。事件订阅、重复字面量列表（`backgroundLaunch.ts:39`）、没写版本的格式、没有截止时间的等待，它都看不见。
2. **登记粒度等于事故粒度**：账上没有「层」，「宿主层没有 owner」在账上不存在。
3. **普适性证明是自由文本**，由写合同的同一条线判定。合同模板把结论引向「缺一个 owner」，补法于是趋同为「再登记一个」。
4. **证据不等于回归**：8 个引用路径已消失；显式枚举的 e2e 有一半没有 runner。
5. **验证环境不对**：Linux 为主，夜跑信号三分之二是噪声或判不了。
6. **门岗有副作用**：文件体积棘轮把生命周期钩子推进子模块；纸面红灯吃产能。
7. **合并验证的不是合并后的东西**：`strict:false`、各分支在旧 main 上绿，17/30 合并后返修。

**对今天补救的评估：**

| 补救 | 解决了什么 | 没解决什么 |
|---|---|---|
| L-gateslock（python3 锁 → node 锁） | Windows 上本地能跑 gates 了，**必要** | 能跑 ≠ 会跑：pre-push 只留痕不拦，Claude hook 在 Codex 执行时不跑；本地 tier（focused / full）与 CI 按路径选的 tier 是否一致，**待查** |
| Codex PR 推送前对抗评审 | 能抓单 PR 内的逻辑错和改坏有意设计（如 #1117 第一版） | 同族模型盲点相近；抓不到合并后组合（17/30）和跨 PR 重复实现（R-arch-5 §3）；也不让错误「写不出来」 |
| L-lifee2e | 生命周期 e2e 有 runner，新 e2e 必须登记 | 合同里 8 个消失的测试路径没人报；夜跑噪声池没分流 |

**还缺四件（按性价比排）：**
1. **把「写错地方」变成写不出来**：生命周期事件（F-quitdrains 在做）、IPC 注册位置、`process.env` 读取位置、裸 `fetch`、shared 反向依赖，做成 ESLint / dependency-cruiser 规则，存量进棘轮。对较弱的模型，这比多一轮评审有效：错的代码过不了编译和 lint，不靠评审眼力。
2. **合并验证合并后的组合**：开 GitHub merge queue，或把分支保护改成 `strict`。workflow 已经有 `merge_group` 触发（`quality-gate.yml:10`），差的是仓库设置。见拍板点 3。
3. **任务形状匹配模型强弱**：给 Codex 的任务带「机器能判的完成标准」（类型、对拍测试、lint 规则）。宿主层和跨模块结构的设计与首刀实现由更强的模型做，Codex 做有编译器兜底的机械迁移和查事实。见拍板点 4。
4. **先查 owner 移到派工时**：任务书里由协调会话先附 owner / 入口表。R-arch-5 发现 prior-art 实际在合并后才被门岗查。

---

## 6. 因果图（终稿）

```
[根 R0] 交付模型：多条 AI 线并行；验证的是分支快照（strict:false，17/30 合并后返修）；
        没有「层」的 owner；先查 owner 发生在合并后
   │                                   │
   ▼                                   ▼
[根 R1] 边界契约不是一等公民                 [根 R3] 治理按事故增量生长
  宿主：生命周期 / 落盘 / IPC / env / 平台      登记=事故粒度；认名字不认行为；
  领域：项目文档两写者；生成合同两处编译          证明不核；证据不绑 runner；纸面红灯
   │                                   │          ▲
   ├──► 宿主事故（少、爆炸半径最大）           │          │ 每起事故 → 合同 + 登记 + 门
   ├──► 领域事故（多：画布文档 11 / Run 10 /    │          │
   │     生成合同 9，§2）                      ▼          │
   │                              「converged」「enforced」假象 ──► 掩盖 R1
   ▼
[放大器 R4] 验证环境：Linux 为主；Mac 只打包；夜跑 2/3 噪声；生命周期 e2e 无 runner
   │
   ▼
[用户看到] 10 月 23/89 类根因由用户先发现，宿主层比例最高；CI 只抓到 5 份
   │
   └─► 更多合同 / 登记 / 门 → PR 摩擦与纸面红灯 → 结构工作没产能 → 回到 R1（闭环）
```

打破闭环的抓手，按杠杆从大到小：
1. R1 改成结构（编译 / lint / 格式检测器）；
2. R0 改合并模型和派工形状；
3. R4 补 Mac 与升级；
4. R3 做减法。

---

## 7. 目标架构：「统一管理」在这个代码库里具体指什么

### 7.1 三层，每层一个 owner、一张契约、一条结构约束

| 层 | 管什么 | 唯一 owner（建议落点） | 边界契约 | 结构约束（让第二个 owner 写不出来） |
|---|---|---|---|---|
| **H 宿主层**（主进程） | 进程形态与阶段、退出 / 更新 / 单实例、项目会话开关、IPC 通道、落盘格式、平台差异 | ① 应用生命周期模块（F-quitdrains 在建）；② 项目会话状态机（在 `canvasReadSurfaceRegistry` 之上收拢）；③ IPC 通道表；④ 落盘格式登记表 | ① 参与者 `{ id, required/optional, start(deadline), drain(deadline), dispose() }`，阶段：启动 → 就绪 → 降级 → 退出中 → 排空 → 已拆；② 会话阶段：核心（读盘 → 迁移 → 画布提交 → 可见）与附属（Agent lane、回执恢复、资产健康），每段截止，附属失败只降级；③ `通道 → 请求 zod → 回复 zod → 发送者角色 → 与进程同寿`，preload 与渲染层类型从它派生；④ `族 → 路径 → 写者 → 锁 → 版本 → 读策略（迁移 / 隔离 / 回默认 / 拒绝）→ 是否挡打开 → 发布样本` | ESLint：生命周期事件和 `quit/exit/relaunch/quitAndInstall` 只许在①；`ipcMain.handle/on` 只许在通道表目录；dependency-cruiser：shared 不许依赖实现；格式检测器：已登记族的 schema 指纹变了而版本没变即红 |
| **X 横切层** | 网络出口、截止时间、「未知 / 失败」语义、日志、配置 | 网络：`appFetch` / `hardenedFetch` / `vendorHttp`（已有，收旁路）；截止时间：一个 deadline 原语；未知 / 失败：Run 的 `submission_unknown / reconciling` 为唯一耐久未知态 + 一个 IPC 错误信封（码、类别、可否重试、上游证据）；配置：一个 env 读取模块 | 每个外部等待声明预算；三态「成功 / 失败 / 未知」一套词；错误统一**码**，不统一文案 | ESLint：裸 `fetch` 只许在网络 owner；`process.env` 只许在配置模块（棘轮） |
| **D 领域层**（09-26） | 生成合同、生产 Run、作者内容、项目文档 | 生成合同：`capabilityCore` 编译链（`PlanCandidate → ExecutionContractV1`）；执行：`ProductionRun`；作者：`StoryboardDesign`；**项目文档：主进程单写**（#1096 方向），系统事实层与编辑层分开 | 09-26 的生命周期映射表不变；跨入口 canonical payload 对等（GUI / Agent / MCP 同输入、同出站语义） | 渲染层只提交意图（候选），不拼出站请求；对等测试进 PR CI |

### 7.2 哪些地方**不该**统一

- **不造框架**：不引入 DI 容器、插件系统、通用服务框架；参与者协议就是一个接口加一个注册表。
- **不合库**：落盘不合进一个数据库；格式登记只管「什么版本、读坏了怎么办、样本在哪」，各族仍各写各的文件。
- **不改 RPC 形态**：IPC 不改成一个通用 RPC，通道照旧，只是从一张表派生；存量 258 个通道**改到再迁**，先迁花钱、项目、lane 三类高危。
- **不并 store**：画布实时交互状态（拖拽、视口、选择）留在渲染层；不把画布 / 分镜 / Run 并成一个 store。
- **文案不统一**：失败只统一码和「未知」语义，不同界面该说不同的话。
- **平台不抽象**：只登记差异，在对应平台上跑测试。
- **锁不强并**：`productionRunLock`、workspace 目录锁、MCP 实例广告保护的是不同资源，登记清楚即可（R-arch-4）。
- **导演台 3D 子系统**：10 月 6 份合同都在它内部，不跨层，按它自己的线收，不纳入本次统一。

---

## 8. 路线图（按痛点排：频率 × 爆炸半径；先普查、再合并）

### 8.1 第一屏：最先做的 3 步

| 步 | 做什么 | 解决哪类事故（§2 表） | 代价（粗估） | 风险 | 怎么证明不回来 |
|---|---|---|---|---|---|
| **1** | **收完 H1 + H3 的生命周期部分**：F-quitdrains、L-lifee2e 合入后，补项目会话第二层（核心 / 附属分级、每段截止）、启动降级（可选注册失败不整机退出）、更新安装与单实例交接走状态机；Mac + Windows 夜跑退出矩阵 | H 生命周期 5 + H IPC 2（10 月 7 份，3 份用户先发现），爆炸半径「整机 / 全部项目」 | 在途之外再 8–12 人日、3–4 个 PR | 状态机写错就退不出或丢在途结果：在途付费 Run 必须重开可认领；Mac runner 不稳 | ESLint 禁订阅；退出矩阵（取消退出后能力全在、⌘Q ≤5s、在途 Run 重开可认领）在 Mac / Win 夜跑；把修复改回旧行为，矩阵必红 |
| **2** | **H2 + H3 的升级部分**：落盘格式登记、发版流水线自动采真实 profile 样本、schema 指纹变了不升版本即红、读策略统一；先做挡启动 / 打开的 6 族（项目 manifest 与备份、registry、catalog、Run、lease / lock，回执已有）；原子写收成一份 helper | H 落盘 2（含 0.22.5 → 0.23 打不开）；**0.24 是攒批大版本，升级面最大** | 10–14 人日、3–4 个 PR | 迁移写坏用户文件：迁移前留备份，坏读一律隔离不覆盖；样本含隐私：脱敏 + 只存结构 | 每个发布样本 × 每族读策略的矩阵进 PR CI；检测器变异测试（改字段不升版本必红）；Mac 夜跑用上一版样本 profile 升级打开 |
| **3** | **生成合同只编译一次**（引擎第二刀）：渲染层只提交候选，不拼出站请求；`canvas:<vendor>` 适配器退役；与 10-08 已拍板的「分镜 / 画布同一份镜头」并成一条线；跨入口对等测试进 CI | D 生成合同 9 + D 分镜 3（10 月 12 份）；逃逸账本 `parameter-contract` 16 条（9 条未结），用户最常撞的「界面说的 ≠ 发出的」 | 15–25 人日、4–6 个 PR | 改到所有付费出站报文：先上对等测试（同输入 GUI / Agent / MCP 出站逐字比，去掉合法包装），旧报文作对照基线；真付费验证取最小量 | 对等测试在 PR CI；`spendConfirm.ts` / `usableVendorModel.ts` 一类渲染层判断改为读 read model，旧判断删除 |

**不进前三的理由：**
- 画布文档（11 份，最多）的根已由 #1096 在途处理。合入后补一条结构测试（系统事实层不可被编辑层写），不另开线。
- durable commit 是最大的**潜在**风险，但 10 月没有对应事故，排第 6。

### 8.2 其余步骤

| 步 | 做什么 | 解决哪类 | 代价（粗估） | 验证 |
|---|---|---|---|---|
| 4 | **IPC 通道表**：通道 → zod → 角色 → 寿命，preload / 类型派生；先迁花钱 / 项目 / lane 三类，其余改到再迁；ESLint 只许在通道表注册（棘轮） | H IPC、X 失败语义的一部分 | 基础设施 4–6 人日 + 渐进迁移 8–12 人日、5+ 个 PR | 通道表与注册点逐个对账（脚本）；新通道无 schema 即红 |
| 5 | **横切 X**：deadline 原语 + 每个外部等待声明预算；IPC 错误信封统一码；`needs_reconcile` 等平行「未知」词收进 Run 词表；收裸 `fetch` 与 `process.env` 旁路（棘轮） | X 时间预算 4 + 失败语义 5 + 网络出口 7 | 8–12 人日、3 个 PR | 「超时 / 未知 / 拒绝」三态在 lane、Run、tryModel 用同一枚举的类测试 |
| 6 | **durable commit**（09-26 Phase 1 欠账）：commit marker + 恢复矩阵 + crash injection | 潜在：崩溃后花没花说不清 | 8–12 人日、2–3 个 PR | 09-26 恢复矩阵逐格 crash injection |
| 7 | **渲染层领域判断收回 read model**：R-arch-2 的 10 处；`check:boundaries` 加「shared 不许依赖实现」；25 个环只减不增 | UI 投影与交互的一部分 | 8–10 人日 | dependency-cruiser 规则 + 删掉的判断不再被引用 |
| 并行 | **G 治理减法与结构化**（§9） | 交付设施 13 | 4–6 人日 | 纸面红灯占比、`detected_by` 覆盖率、合并后返修率三个读数 |

**口径：** 人日 = 一条实现线一天的工作量，含 CI 往返。粗估，不含用户验收等待。

---

## 9. 设计卡：H1 / H2 / H3

### 设计卡 H1 应用与项目会话生命周期唯一 owner

改动名：H1 应用与项目会话生命周期唯一 owner　线 / 负责人：F-quitdrains（在途）+ 后续宿主线　类别：[长跑][可打断]（退出时可能有在途付费工作）

- ★1 用户怎么用：
  - 场景：「当我按 ⌘Q / 点关窗 / 点安装更新 / 再双击图标时，我想程序几秒内照我的意思退出或回到窗口，以便不丢东西、不留半死进程。」
  - 步骤：开项目 → 有在途生成 → ⌘Q → 确认关窗 → 进程退出 → 重开 → 在途生成被认领。
  - 不做：崩溃自动重启；退出时替用户取消已提交的付费任务。
  - 已知坑：Mac 关最后一个窗不退进程；关窗确认会取消退出；`quitAndInstall` 的事件顺序；新实例被老进程的锁挡住。
  - 真实任务：①开着有 2 个在途视频生成的真实项目按 ⌘Q，确认后进程 ≤5s 消失，重开后两个 Run 被认领；②点安装更新 → 关窗确认点取消 → 打开另一个项目，不出现「恢复失败」，Agent 可用；③老进程排空时再双击图标，新实例给明确提示，或老进程在截止内退出后新实例正常启动。
  - 指标：主指标为退出到进程消失 p95 ≤5s（Mac / Win）；质量指标为取消退出后已拆通道数 = 0；护栏指标为在途付费 Run 重开可认领率 = 100%。基线：当前 3s 拆除 + 无界的关窗确认。样本来源：逃逸账本 `FB-20261007-quit-teardown-orphaned-lane`、10-08 Mac 反馈。
- ★2 谁说了算：
  - 概念：新增层级概念 `host.app-lifecycle`，并入并替代 `host.quit-teardown`；`host.project-session` 收拢 `canvasReadSurfaceRegistry` 的阶段。
  - 唯一 owner：生命周期模块。只有它订阅 app / 主窗口生命周期事件，只有它调 `quit/exit/relaunch/quitAndInstall`。
  - 参与者只能登记排空，不能自己 `preventDefault`。
  - 「正在退出」只有 1 份状态。不靠「窗口没了」猜意图，退出意图是显式状态。
  - 证据：ESLint 规则 + `grep -rn "app.on(\"will-quit\"" electron` 只剩 owner。
- ★3 一致与复用：
  - 复用 Electron 原生事件、现有 `quitTeardown` 的截止模式、`backgroundIdleExit` 判据；不引入生命周期框架。
  - 自写理由（领域约束）：Electron 只给事件、不给编排；Nomi 要按「在途付费工作」决定能否退。
  - 后台空闲退出改读 Run owner 的在途判据，删掉 `backgroundLaunch.ts:39` 的状态列表。
  - 证据：`check:self-written`。
- ★4 全状态：
  - 运行中；
  - 退出确认中：等用户点；
  - 排空中：Mac 无窗时 Dock 不响应新操作；有窗时显示「正在收尾」；
  - 取消退出：所有能力仍在；
  - 排空超时：强退，日志记哪个参与者超时；
  - 可选参与者失败：降级继续；
  - 启动时可选能力失败：主窗照常，该能力入口显示「暂不可用」+ 下一步「重试」；
  - 项目附属失败：项目照常打开，附属区显示原因 + 重连。
  - 文案走 i18n zh / en，不写钱。证据：样张（新界面部分）、`check:i18n`。
- 5 中途表（看到什么 · 花费 · 回执在哪）：

  | 状态 \ 打断 | 用户停（取消） | 关窗 | 断网 | 重启 / 崩溃 | 连点 |
  |---|---|---|---|---|---|
  | 退出确认中 | 回到窗口，能力全在 · 不扣 · 无 | 同一次确认，不叠第二个 · 不扣 · 无 | 不影响确认 · 不扣 · 无 | 下次启动正常 · 已交的照常 · Run journal | 只弹一个确认 · 不扣 · 无 |
  | 排空中 | 不可取消（已过确认），截止后退 · 已交的照常 · journal | 无窗可关 · 同上 · journal | 排空不等网络，截止即退 · 已交的进未知态 · outbox | 重启后认领在途 Run · 不重复交 · journal + outbox | 再次 ⌘Q 被合并 · 不扣 · 无 |
  | 启动中 | 关窗即退 · 不扣 · 无 | 同左 · 不扣 · 无 | 可选能力降级，主窗照常 · 不扣 · 日志 | 下次启动正常 · 不扣 · 日志 | 第二实例聚焦老窗 · 不扣 · 无 |
  | 打开项目中 | 回到库 · 不扣 · 无 | 走退出流程 · 不扣 · 无 | 附属降级，项目照开 · 不扣 · 日志 | 下次打开重放事件尾 · 不扣 · 事件日志 | 只开一次 · 不扣 · 无 |
  | 更新安装中 | 取消则不装，能力全在 · 不扣 · 无 | 同一次退出 · 不扣 · 无 | 不影响已下载包 · 不扣 · 无 | 重启后仍是旧版或新版，不半装 · 不扣 · 更新日志 | 只装一次 · 不扣 · 无 |

- 6 外部数据与失败：
  - 规范来源：Electron `app`（https://www.electronjs.org/docs/latest/api/app）、`BrowserWindow` close 事件、electron-updater `quitAndInstall`。
  - 我们的偏差：Mac 关最后一个窗不退（产品选择）。
  - 失败时用户看到：超时强退并在下次启动给一行说明。Mac 实际时序 N14 未实证，验收时在 Mac 上实录。
- 7 性能预算：退出 p95 ≤5s；登记参与者不让首窗变慢 >50ms；项目打开核心段截止 15s，附属段不阻塞可见（只记录，不阻断）。
- 8 真实条件：Mac 打包版（arm64）、Windows 安装版、英文界面、干净安装、从上一版升级、在途真付费 1 笔（最小量，协调会话亲自跑）、键盘全程（⌘Q / Alt+F4）。Gatekeeper 下的真实更新安装 = `unverified`，进发版清单人工。
- ★9 验收与回滚：
  - 验收线（≠ 实现线）：在 Mac / Win 跑三条真实任务 + 退出矩阵；ESLint 规则的变异测试（在别处加一个 `app.on("will-quit")` 必红）；把修复改回旧行为，`quit-teardown-real` 必红。
  - 回滚：revert 对应 PR，ESLint 规则保留。
  - 独立验收报告链接写在 PR 正文 `## 独立验收`。
- 功能分类：[x] 长跑 / 可打断　[x] 数据格式（排空写盘）　[ ] 花钱（不新增花钱路径，但验收含在途付费）。

### 设计卡 H2 落盘格式契约 + 发布样本矩阵

改动名：H2 落盘格式契约 + 发布样本矩阵　线 / 负责人：宿主线（建议 Claude 实现首刀）　类别：[其他：数据格式]

- ★1 用户怎么用：
  - 场景：「当我把 Nomi 升到新版本（或装回上一版）时，我想所有项目照常打开、设置不丢，以便升级不再是赌博；某个附属文件坏了，只影响那一项并明说。」
  - 不做：跨设备同步格式；云端存储。
  - 已知坑：Windows 文件被占用；同步盘（OneDrive / iCloud）半写；用户手动回装旧版。
  - 真实任务：①0.22.5 建的、含 Agent 回执 / Run / 画布版本卡的真实项目（脱敏样本）升级到当前版本打开；②当前版本写过的项目在 0.23.1 打开（降级读）；③某项目 Run journal 末行被截断，项目照常打开，该 Run 显示「需要处理」。
  - 指标：主指标为发布样本 × 族的读矩阵 100% 按读策略通过；质量指标为升级后首开 `project-restore-failed` 遥测 = 0；护栏指标为静默回默认次数 = 0（每次回默认都有日志 + 可见提示）。样本来源：逃逸账本 `REC-20261007-receipt-upgrade-quarantine`。
- ★2 谁说了算：
  - 新增层级概念 `host.persisted-format`。owner = 格式登记表（主进程）；各族的写者不变，仍是现有 store。
  - 登记 `{ 族, 路径, 写者, 锁, 版本字段, schema, 读策略, 挡打开?, 样本 }`。
  - 原子写只留一份 helper：`jsonFile.writeJsonFileAtomic`，并入 `configFileStore`、`certificationPersistence` 的两份。
  - 项目数据 3 种形状里登记表只管磁盘那一种。
  - 有两个写者的族（项目：渲染层草稿 + 主进程 canonical）由 #1096 收成主进程单写。
- ★3 一致与复用：
  - 推广现成的回执发布矩阵（`electron/capabilityCore/__fixtures__/published-receipts/README.md`）。
  - schema 指纹用现有 zod（3.25）的 schema 结构序列化，不自写解析器。
  - 写入沿用 `electron/durability.ts`。
  - `self-written.json` 的 `durable-json` 从 under-review 结论化。
- ★4 全状态：
  - 读成功；
  - 迁移成功（回写前留备份）；
  - 隔离：改名 `.quarantined-*`，一行提示 + 下一步「打开诊断 / 从备份恢复」；
  - 回默认：一行提示 + 设置页标出；
  - 更新版本写的文件：只读打开 + 提示「此项目由更新版本保存」+ 下一步「去下载最新版」；
  - 文件被占用：重试 + 提示「被其他程序占用」+ 下一步「关闭同步盘后重试」；
  - 能力不可用：该族所属能力置为不可用并给出下一步。
  - zh / en。
- 5 中途表（看到什么 · 花费 · 回执在哪）：

  | 状态 \ 打断 | 用户停 | 关窗 | 断网 | 重启 / 断电 | 连点 |
  |---|---|---|---|---|---|
  | 读 / 校验 | 回到库 · 不扣 · 无 | 走退出流程 · 不扣 · 无 | 不涉网 · 不扣 · 无 | 下次重读 · 不扣 · 无 | 只读一次 · 不扣 · 无 |
  | 迁移写回 | 不可取消（几十毫秒）· 不扣 · 备份 | 等写完再关（排空参与者）· 不扣 · 备份 | 不涉网 · 不扣 · 无 | 原子写，要么旧要么新，备份在 · 不扣 · `.bak` | 迁移幂等 · 不扣 · 无 |
  | 隔离 | 已隔离，可恢复 · 不扣 · 隔离文件 | 同左 | 同左 | 同左 | 不重复隔离 · 不扣 · 无 |
  | 发版采样（CI） | 取消即不入库 · 不扣 · 无 | 不适用：CI 无窗 | 重跑 · 不扣 · CI 日志 | 重跑 · 不扣 · CI 日志 | 同版本只采一次 · 不扣 · 无 |

- 6 外部数据与失败：
  - 外部来源：OS 文件系统语义（Windows sharing violation、APFS / NTFS 原子 rename、同步盘延迟写）；用户手动回装旧版。
  - 偏差：同步盘上的原子性不保证，按「坏读 → 隔离」处理。
  - 失败时用户看到：一行原因 + 下一步，不甩给用户「文件损坏」了事。
- 7 性能预算：打开项目时的格式校验 ≤20ms / 族；样本矩阵测试在 PR CI ≤60s（只记录）。
- 8 真实条件：Windows NTFS + OneDrive 目录、Mac APFS + iCloud 目录、从 v0.22.0 起每个发布版的样本（更早版本 `unverified`）、干净安装、英文界面。
- ★9 验收与回滚：
  - 验收线：跑三条真实任务 + 矩阵 + 检测器变异测试（改一个已登记族的 schema 字段而不升版本必红）。
  - 发版流水线：自动采样提交进样本目录。
  - 回滚：revert PR；已入库的样本保留；迁移写回前的备份可手动恢复。
- 功能分类：[x] 数据格式　[x] 长跑 / 可打断（迁移写回）。

### 设计卡 H3 Mac / Windows 生命周期与升级端到端进 CI

改动名：H3 平台生命周期端到端　线 / 负责人：L-lifee2e（在途）+ 后续测试设施线　类别：[其他：测试设施]

- ★1 用户怎么用：
  - 使用者是协调会话 / 验收线。场景：「当我准备合并宿主层改动或发版时，我想在 Mac / Windows 打包版上自动跑过『启动 → 开项目 → 取消退出 → 再开项目 → 退出 → 用上一版样本升级打开』，以便不再等用户在 Mac 上撞见。」
  - 不做：Gatekeeper / 公证 / 真实自动更新安装（GitHub runner 证明不了，进发版清单人工）。
  - 真实任务：①`quit-teardown-real` 在 Mac 上跑；②`upgrade-0225-to-0230-open` 用仓库内样本（H2 产出）跑；③`project-open-stages` + `cold-start` 在 Win 上跑。
  - 指标：主指标为宿主层「用户先发现」的逃逸每版 → 0（10 月为 4）；质量指标为 Mac 夜跑可判率 ≥95%（红灯能归到「真回归 / 环境 / 漂移」之一）；护栏指标为 macOS 分钟 / 周上限（协调会话定）。
- ★2 谁说了算：
  - owner = runner 登记（L-lifee2e 引入的「e2e 必须登记 runner 或进不进 CI 清单」）。
  - workflow 只引用登记表，不各写一份文件清单。
  - 概念 `delivery.platform-lifecycle-matrix`。
- ★3 一致与复用：复用 `tests/ux/_launchApp.mjs`、已有的 4 个 e2e、`desktop-rc.yml` 的 macOS job、Playwright 1.60 的 Electron 支持；不新写 harness。
- ★4 全状态（对一次夜跑）：
  - 通过；
  - 真回归：标红并带复现命令；
  - 环境不可用（runner 镜像 / 签名）：标灰，不计红；
  - 剧本漂移（选择器过期）：进漂移池，带 owner 与到期日；
  - 超时：按 job 上限截断，计红并附日志；
  - 取消中：取消班不出收据，下一班补跑。
- 5 中途表（看到什么 · 花费 · 回执在哪）：

  | 状态 \ 打断 | 手动取消 | runner 被回收 | 断网 | 重跑 | 并发触发 |
  |---|---|---|---|---|---|
  | 排队 | 不跑 · 不扣 · 无 | 不适用：未开始 | 排队不受影响 · 不扣 · 无 | 正常排 · 不扣 · 无 | 同 SHA 合并为一班 · 不扣 · 无 |
  | 运行 | 结果记「取消」不计绿 · 不扣 · CI 日志 | 记「环境」· 不扣 · CI 日志 | 本地走查不联网，夹具 loopback · 不扣 · 日志 | 只自动重跑 1 次，再红即红 · 不扣 · 两次日志 | 各 SHA 各一班 · 不扣 · 各自日志 |
  | 汇总 | 报告标「不完整」· 不扣 · 报告 | 同左 | 不涉网 · 不扣 · 报告 | 以最后一次为准并保留首次 · 不扣 · 报告 | 按 SHA 分报告 · 不扣 · 报告 |

  付费：本 job 不跑真付费，「花费」一列恒为「不扣」，由夹具 `test-harness.network-guard` 保证。
- 6 外部数据与失败：
  - GitHub macOS / Windows runner 文档（https://docs.github.com/actions/using-github-hosted-runners）。
  - 偏差：runner 无真实用户 profile、未签名构建，用 H2 样本代替真实 profile。
  - 失败时给「环境 / 回归 / 漂移」分类，不混在一起。
- 7 性能预算：Mac 生命周期 job ≤25 分钟；单条 ≤10 分钟（只记录）。
- 8 真实条件：macOS arm64 runner、Windows runner、英文界面一条、未签名包。Gatekeeper / 真更新 = `unverified`，发版清单人工跑并留截图。
- ★9 验收与回滚：
  - 验收线：在一个临时分支把 H1 的修复改回旧行为，确认 Mac job 变红；恢复后变绿。
  - 回滚：关掉该 workflow 触发（保留脚本与登记）。
  - 放在哪一档跑见拍板点 2 的推荐：夜跑 + RC 必跑，PR 上只在改到宿主层文件时跑。
- 功能分类：[x] 长跑（CI）。

---

## 10. 治理调整

原则：**删 > 结构 > 门岗 > 文字。** 不新增登记类门岗；能做成编译 / lint / 检测器的就不用登记。

| 对象 | 动作 | 证据 | 代价 |
|---|---|---|---|
| `check:concept-owners` | **保持只提示**（按用户拍板），不建议改阻断：它判名字，改成阻断也拦不住 10-07→10-08 那种复发 | §1 #3；09-26 取舍 4 | 无 |
| 概念登记表 | 加一级「层」（约 12 条：应用生命周期、项目会话、落盘格式、IPC 通道、网络出口、截止时间、失败信封、配置、生成合同、生产 Run、项目文档、作者内容），`rule` 挂在层下；`converged` 必须指向一条行为级核对（lint 规则 / 检测器 / 对等测试），否则记 `registered` | 2/3 host 抽检不成立；113/181 是 rule | 一次性整理 2 人日 |
| 宿主边界 | **新增结构约束**（ESLint / dependency-cruiser，存量棘轮）：生命周期事件（F-quitdrains 在做）、`ipcMain` 注册位置、`process.env` 读取位置、裸 `fetch`、shared 反向依赖 | R-arch-2 / 3 / 4 | 每条规则 0.5–1 人日 + 存量基线 |
| 根因合同 | ① `generality_proof` / `disposition: enforced` 必须指向一条机器核对，否则自动记 `unverified`；② 合同和账本引用的测试路径必须存在（便宜、事实型，阻断）；③ `detected_by` 在合同与逃逸账本都必填且为枚举；④ 必填字段收窄（10-01 账本已指出偏宽） | 8 个消失路径；76/728 填了 `detected_by`；逃逸账本 0 | 1–2 人日 |
| 证据 × runner | L-lifee2e 在做。补一条：合同 `class_regression_tests` 里的 e2e 若不在任何 runner，不能结账 `fixed` | §1 #5 | 并入 L-lifee2e |
| 夜跑 | 分流：漂移池（选择器 / 文案过期，带 owner 与到期日）与环境池（凭据 / 平台）移出红灯；夜跑「红」只指疑似真回归 | 夜跑红灯 32% 漂移、46% 判不了 | 2 人日 |
| 文件体积门 | 不改。生命周期 ESLint 落地后，它推散生命周期钩子的副作用自然消失；组合根按 §7 的 owner 拆 | `depthVideoIpc.ts:64-65` | 无 |
| 合并验证 | 见拍板点 3（merge queue 或 `strict`） | 17/30 合并后返修；`strict:false` | 见表 |
| pre-push | L-gateslock 合入后再定：pre-push 是否从「留痕」改为「拦截」，以及本地 tier 是否必须等于 CI 按路径选的 tier（**待查**） | `pre-push-check.sh:37-38,86-91` | 待查 |
| `ARCHITECTURE-NOW.md` | 加宿主层几行（现在 0 行）；H1 / H2 合入时同 PR 更新 | 最后核对 09-26 | 每次 PR 顺带 |

---

## 11. 需要用户拍板的点

### 拍板点 1：宿主层边界要不要做成「写错地方就红」的结构约束？

| 选项 | 会发生什么 | 代价 | 推荐 |
|---|---|---|---|
| A 结构约束，新违规即红，存量进棘轮（生命周期事件、IPC 注册位置、env 读取、裸 fetch、shared 反向依赖） | 第二个退出管家、第 259 个没 schema 的通道写不进来；Codex 写错位置当场红 | 写错地方的 PR 要改到正确位置；每条规则一份存量基线 | ✅ |
| B 同样的规则只提示 | 有记录，没人拦 | 无摩擦；10-07 → 10-08 的复发模式继续 | |
| C 不做，靠评审 | 和现在一样 | 评审成本最高、漏得最多 | |

**一句话点破：** 你要的是「写错地方 PR 当场红」的摩擦，还是「同类事故从用户那里回来」的风险。这和 concept-owners 保持只提示不冲突：那道门认名字，认不出这些。

### 拍板点 2：接下来两周（到 H1 + H2 合入、0.24 发版前）产能怎么分？

| 选项 | 会发生什么 | 代价 | 推荐 |
|---|---|---|---|
| A 3 条实现线里 2 条做路线图前三步，1 条做用户反馈与小功能；0.24 以 H2 矩阵 + Mac 退出矩阵全绿为发版门 | 0.24 是第一个「升级不坏、退得出去」有机器证明的版本 | 0.24 新功能少；约 2 周 | ✅ |
| B 只拿 1 条线做结构 | 结构工作拖到 4–6 周，期间发版仍有升级风险 | 新功能照常 | |
| C 全部线做结构，冻结新功能 | 最快收完 | 用户反馈积压，用户体感「两周没动静」 | |

**一句话点破：** 0.24 多带几个新功能，还是 0.24 保证升级不坏、退得出去、参数说的就是发的。

### 拍板点 3：合并时要不要验证「合并后的组合」？

| 选项 | 会发生什么 | 代价 | 推荐 |
|---|---|---|---|
| A 开 GitHub merge queue（workflow 已有 `merge_group` 触发），代码 PR 进队，纯文档不进 | 每次合并的都是验证过的组合，「合并后才红」与 17/30 返修应明显下降 | 每个 PR 合并多等一轮 CI（约 40–60 分钟），排队时串行 | ✅ |
| B 分支保护改 `strict: true`（必须与 main 同步再合） | 效果接近 A | 每合一个，其他 PR 都要同步 main 再跑一轮，并行越多越堵 | |
| C 维持现状（`strict:false`，收据并行取） | 合得快 | 合并后组合红由下一个 PR 修，产能被返修吃掉 | |

**一句话点破：** 合得快，还是合进去就是对的。现在快是借来的，17/30 的返修就是在还。

### 拍板点 4：宿主层和跨模块结构改动由谁来写？

| 选项 | 会发生什么 | 代价 | 推荐 |
|---|---|---|---|
| A 宿主层 / 跨模块结构的设计与第一刀由 Claude（Opus）实现；Codex 做查事实、有编译器或对等测试兜底的机械迁移、按明确规则补存量 | 结构改动一次做对的概率高，返修少；Codex 的产出有机器判据兜底 | 多用 Claude 额度（约路线图前三步的首刀，估 10–15 人日） | ✅ |
| B 全部派 Codex + 推送前对抗评审 | 省 Claude 额度 | 结构改动正是最难评审的；今天 3 个 PR 的模式会在更高风险的地方重演 | |

**一句话点破：** 省额度，还是让最难回滚的那几刀一次做对。

---

## 12. 与 Codex 事实的冲突、事实不足之处

1. **概念登记条数**：R-arch-5 写「约 78 个概念条目」，R-arch-9 与本评审都数到 182 个文件 / 179 条 `converged`。R-arch-5 很可能沿用了 09-26 方案里的旧数（76）。**以 182 为准。**
2. **`gates:contracts` 门岗数**：R-arch-5 是 100，本评审是 98（正则口径不同：是否计 `lint:ci` / `typecheck` / 重复项）。不影响结论。
3. **「只有 42 个测试在 runner 里」**：R-arch-8 原文是「42 个能直接找到配置线索，219 个 unverified」，并明说 Vitest glob 会间接收集。不能说成「219 个没跑」。确定没接线的是显式枚举的 e2e（40/82）。
4. **事故按层表**：R-arch-9 没能给出（字段不统一 + 缺依赖），§2 是本评审按 `class_root` 人工归类。按层的**判断**有主观成分，次数可复现（附录 B）。
5. **N7 / N9 全量**：假收敛率、普适性证明不实率都是 **unverified**（`door-map.mjs` 缺 `typescript`）。本评审只有 1 份合同、3 条概念的抽样。
6. **N14 Mac 退出时序**：**unverified**（无 Electron 源码、不许联网）。H1 的验收必须在 Mac 上实录。
7. **N13 UntrustedIpcSenderError 来源**：**待用户日志**，P3 里只作为未定项。
8. **R-arch-2 的 127 条渲染层 → 主进程实现边**与 `scripts/boundaries-baseline.json` 冻结的 67 条口径不同：前者含 devlab 与纯类型 import，后者是 dependency-cruiser 规则口径。两者都说明存量很大，以门岗口径做棘轮。
9. **近 60 天「改形状不升版本」**：R-arch-8 只核了 6 个代表提交，完整统计 **unverified**。H2 的检测器上线后由它给出真数。
10. **成本估算**：路线图的人日是评审粗估，没有历史数据校准。

---

## 附录 A：复现命令（仓库根目录执行）

```bash
# 提交量与 fix 占比
git log --since=2026-09-08 --no-merges --oneline | wc -l
git log --since=2026-09-08 --no-merges --format=%s | grep -ciE '^(fix|hotfix)'

# fix 热点
git log --since=2026-09-08 --no-merges --format='@@%s' --name-only \
  | awk '/^@@/{f=($0 ~ /^@@(fix|hotfix)/)?1:0; next} f && NF' \
  | grep -vE '\.(test|spec)\.|__fixtures__|^docs/|^tests/|\.json$|\.md$|locales' \
  | sort | uniq -c | sort -rn | head -20

# 生命周期监听与退出调用点
grep -rnE "app\.(on|once)\(\s*['\"](before-quit|will-quit|window-all-closed|activate|second-instance)" electron --include=*.ts --include=*.mts | grep -v '\.test\.'
grep -rnE "app\.(quit|exit|relaunch)\(|quitAndInstall\(|process\.exit\(" electron --include=*.ts --include=*.mts | grep -v '\.test\.'

# 10 月根因合同的 detected_by
node -e 'const fs=require("fs");const by={};for(const f of fs.readdirSync("docs/fixes").filter(f=>/^2026-10-/.test(f)&&f.endsWith(".root-cause.json"))){const j=JSON.parse(fs.readFileSync("docs/fixes/"+f,"utf8"));const d=j.detected_by||"(未填)";by[d]=(by[d]||0)+1}console.log(by)'

# 概念登记状态
node -e 'const fs=require("fs"),p="docs/engineering/concept-owners/";const s={},k={};for(const f of fs.readdirSync(p).filter(f=>f.endsWith(".json")&&f!=="_meta.json")){const j=JSON.parse(fs.readFileSync(p+f,"utf8"));s[j.migration_status]=(s[j.migration_status]||0)+1;k[j.fact_kind]=(k[j.fact_kind]||0)+1}console.log(s,k)'

# 不被任何 runner 引用的 e2e
node -e 'const fs=require("fs"),path=require("path");const walk=(d,o=[])=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.name==="node_modules"||e.name.startsWith("."))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p,o);else if(/\.(mjs|cjs|js|ts|json|ya?ml)$/.test(e.name)&&!/escapeLedger/.test(p))o.push(p)}return o};const c=[...walk("scripts"),...walk(".github/workflows"),"package.json",...walk("tests/system"),...walk("tests/ux/full-walk")].map(f=>fs.readFileSync(f,"utf8")).join("\n");const e=fs.readdirSync("tests/ux").filter(f=>f.endsWith(".e2e.mjs"));const o=e.filter(f=>!c.includes(f));console.log(e.length,o.length,o.join(" "))'

# 分支保护（只读）
gh api repos/aqm857886159/Nomi/branches/main/protection --jq '.required_status_checks.strict'
```

## 附录 B：10 月 89 份根因合同的分层归类（§2 的明细，文件名去掉日期与后缀）

- **交付设施（13）**：canvas-classifier-display-owners, gate-slimming, rewrite-decision-merges-r21-2, site-data-drift, ci-job-timeouts, mockup-contract-real-lab, control-copy-action-registry, mcp-real-client-isolation, nightly-walk-report-checkout, rc-ref-guard-first, tests-no-network, walkcoverage-routing, windows-local-gates
- **UI 投影与交互（12）**：canvas-high-frequency-projection, grouping-interaction, storyboard-row-menu-dismiss, storyboard-table-structure, canvas-node-shell-rerender-on-drag, capability-unavailable-dead-end, floating-toolbar-update-loop, open-mount-render-cost, open-render-media-shimmer, popup-covers-trigger, timeline-default-span, video-frame-node-landing
- **D 画布文档（11）**：switch-project-landing, agent-undo-turn-hang, director-external-write-persistence, unified-undo, agent-receipts-from-landing, autosave-keeps-rename, canvas-write-boundary, deleted-node-keeps-arriving-outcome, external-write-keeps-landed, undo-keeps-landed-results, storyboard-empty-group
- **D 生产 Run（10）**：paid-card-consent-follows-clicks, paid-card-per-shot, generate-remaining-stop, stop-outcome-race, task-status-terminal-owner, canvas-claim-attempt-id, canvas-paid-into-production-run, paid-card-in-conversation, mcp-gate-receipt-sealed-revision, stopped-run-keeps-watching-paid-work
- **D 生成合同（9）**：paid-card-shot-kind, card-revise-merge-rule, paid-card-canvas-reference-mode, declared-provider-production-handoff, agent-aspect-ratio-semantic, authored-duration-admission, draft-revision-merge-params, param-alias-dedupe, spend-card-references-one-owner
- **X 网络出口（7）**：paid-submit-no-blind-resend, apimart-upload-follows-base, retrieval-trusts-connection-origin, claim-release-unsent-attempt, reference-upload-channel, asset-upload-channel-boundary, paid-post-single-exit
- **导演台（6）**：director-3dbox-ruler, director-assets-native-ual, director-judge-blind-review, director-s1r3, headless-capture-reuse, director-character-label-overlap
- **X 失败语义（5）**：agent-panel-raw-leaks, agent-write-receipt-stuck, deterministic-retrieval-failure-settles, provider-explicit-rejection, agent-feedback-batch
- **H 生命周期（5）**：canvas-submit-in-flight-switch, mcp-launcher-relaunch, agent-runtime-lazy-load, open-project-read-path-writes, quit-teardown-not-before-quit
- **X 时间预算（4）**：agent-request-input-budget, try-model-async-queued, try-model-submit-budget, remove-background-download
- **D 分镜（3）**：storyboard-plan-single-owner, storyboard-ratio-and-merge, storyboard-reuse-canvas-composer
- **H IPC（2）**：director-bootstrap-ipc-startup, ipc-on-untrusted-sender-dialog
- **H 落盘（2）**：windows-legacy-file-identity, agent-proposal-receipt-read-recovery
