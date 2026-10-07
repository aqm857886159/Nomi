# 3D-BOX 段 3b：工具面 + 预演出片 + 花钱闸 设计卡

> 状态：🚧 实施中（2026-10-04）。方案正本 `docs/plan/2026-10-04-director-3dbox-phase3.md` §5 / §8 / §9 / §10「3b」行。§6（覆盖层 / 最小改动）归 3c，本段只给补丁接口留位。

改动名：3D-BOX 3b · 线/负责人：`feat/director-3dbox-3b` · 类别：[花钱][长跑][可打断][其他]（花钱 = 碰生成准入；长跑 = 离屏预演渲染；可打断 = 预演可失败 / 重试 / 关窗；不新增界面文件，只给现有节点卡补状态文案）

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当创作者在右侧 Agent 面板说「面馆门口两个人说话，正反打，最后慢慢推近」时，我想 Agent 搭出白盒预演并挂到那一镜的视频节点上，以便确认后由生成环节出片。步骤：① Agent `look_at_canvas` 看画布；② 有视频镜头就 `stage_shot{target:{shotId}, plan}` 首次交整份计划（没有镜头就省略 target，建独立预演）；③ 宿主编译 → 返回修订号、规范化计划、问题清单、逐 cut 实测景别/运镜、预演状态；④ 预演离屏渲染（免费、本地），完成后挂到视频节点 video_ref；⑤ 用户说「第二镜改成特写」→ Agent 交 `stage_shot{target:{directorNodeId}, baseRevision, edits}` 补丁；⑥ 用户说「出片」→ `generate` 出确认 / 报价卡（既有付费流程，不改）。**不做**：覆盖层 / 手改保留（3c）、镜头条选中联动（3c）、UAL 动作切换（3R）、编译器内部（S1 线）、对外 MCP 面。**已知坑**：预演 > 10 秒（240 帧上限）本段直接判失败并说明，不分段；编辑器开着时 Agent 写入走 3a 的唯一外部写口，但 ⌘Z 回退后编辑器 store 不重载（3a/3c 的「一本历史」未完）。**真实任务**（门槛 ① 用）：T1「面馆门口两个人说话，正反打，最后慢慢推近」（新建；题库 t3-cafe 是咖啡馆，避开）；T2 在 T1 上「第二镜改成特写」（补丁）+「已经是正反打了」（应 `unchanged:true`）；T3「女孩雨夜街头奔跑，侧跟后拉远」挂到已有视频节点 → 说「出片」到确认卡为止。 | 真实任务脚本：`tests/ux/director-3dbox-3b-agent.walk.mjs`（实施中写）；门槛 ① 见格 8 |
| ★2 谁说了算 | 碰 6 个概念，全部沿用方案 §3 owner：**3D-BOX 开关** → `electron/shared/featureFlags/director3dbox.ts`（引导模块，开机写进 `globalThis` 的冻结值；新增的 `director3dboxFace.ts` 只是共享层的**只读视图**，渲染端读 preload 证明，读早于安装即抛）；**stage_shot 契约** → 新 `electron/shared/agentCapabilities/directorWrite.ts`（`director.write`，`exposure: internal_only`，无 `aliases.mcp`），开关开时注册，`canvas.write` 的 pi 附加别名同一处去掉 `stage_shot`——任一构建只装配一份；**计划补丁与修订号** → `electron/shared/director/planPatch.ts`；**导演工程唯一写者** → 3a 的 `directorSessionRegistry.writeExternalDirectorProject`（编辑器开着）/ 节点 meta（关着）；**预演挂接** → `attachCameraMoveToTarget.ts#computeAttachCameraMove`（扩输入，不写第二个）；**花钱准入** → `generationRunController.ts#canRunGenerationNode`（全部付费提交的唯一咽喉 `runGenerationNode` 与生成钮都过它），判据住 `nodes/director/model/directorPreviewState.ts` 一处，`generate` 的 present 在出卡前调同一判据拿原因。状态全在渲染端节点 meta（导演节点 `directorPlan` / `directorPreview`），主进程只做契约校验与审批。 | `node scripts/door-map.mjs canRunGenerationNode` → 3 扇门（composer / runGenerationNode / 索引）全经同一函数；`node scripts/door-map.mjs runGenerationNode` → 1 扇 |
| ★3 一致与复用 | 传输不另开通道：`director.write` 走画布写的 surface port（capture / execute 两条现成 IPC），审批、收据、changeId、撤销日志全复用 `applyProposalBatch`；准入证据复用 `canvasWriteBatchRawEvidence`（把批量准入的「引用 id → 锁 / 过期」抽成共用函数，不抄第二份）；补丁语义参照 RFC 6902（add / remove / replace，路径用计划里的名字不用下标）；修订号 = 规范化计划的内容哈希（复用 `synchronousSha256`）；离屏渲染复用 `DirectorHeadlessCapture` 已有的 `cameraIdAt` / `waitForActionClips`，节目机位复用 `programCameraIdAt`；渲染常驻 Host 复用 `CameraMoveCaptureHost` 的重试 / 看门狗（加一种请求，不另起 Host）；逐 cut 实测复用 `summarizeDirectorShots`。自写只有：计划补丁应用器（领域：路径按镜头 / 角色 / 场景件的名字寻址，是导演计划独有的语义）与预演状态判据（领域：按镜头的花钱语义）。 | `pnpm run check:self-written`；`git grep -n "computeAttachCameraMove\|programCameraIdAt"` |
| ★4 全状态 | stage_shot 结果分级（方案评审 S11）：schema 不过 = 工具错误（模型自修）；修订过期 = 工具错误 `capability_target_stale` + 当前修订号；编译失败（引用不存在）= 工具错误带逐条原因；编译成功带问题 = 成功 + 问题清单；补丁不改变计划 = 成功 `unchanged:true`、不写画布、不重渲染；预演：`rendering`（节点卡「预演渲染中」，生成钮置灰并说明原因）/ `ready`（已挂 video_ref，或模型无槽 → 已写提示词兜底并明说精度低）/ `failed`（节点卡「预演失败 · 重试」，生成钮置灰）/ `too_long`（> 10 秒，失败的一种，文案说明上限）。取消中：审批被拒 = 画布不变；预演渲染无硬取消，删导演节点即解除。zh / en 文案走 `director` locale。 | `pnpm run check:i18n`；结果分级单测 |
| 5 中途表 | 见下表（状态 × 五种打断，每格：看到什么 · 钱 · 回执）。 | 单测 + `tests/ux` 走查（Windows 真窗口 `unverified` 待 3d） |
| 6 外部数据与失败 | 外部输入只有模型交来的计划 / 补丁：同义词无损归一（`normalizeDirectorPlan` 的无损子集，宿主不猜方向 / 不补运镜），其余按 schema 拒；坏补丁路径逐条报「哪条路径、为什么」。视频模型无 video_ref 槽 → 沿用现有降级：只写运镜 / 动作提示词并在结果与节点上明说「这个模型不接参考视频，运镜只能靠文字，精度会低」。供应商 API 本段不调。 | `planPatch.test.ts`；`attachCameraMoveToTarget.test.ts` |
| 7 性能预算 | 记录不阻断：预演 24fps × ≤240 帧，720p 短边；编译 + 实测在渲染端同步做，3 镜 12 秒计划目标 < 150ms（`summarizeDirectorShots` 4fps 采样）；`look_at_canvas` 每个 3D-BOX 节点只加一行（修订号 / 镜头名 / 角色名 / 问题数，≤ 300 字符），不撑爆共用的 7500 字符预算。 | 单测内计时打印；`canvasReadCompact` 单测 |
| 8 真实条件 | Windows：本机 Windows 11 跑单测与门岗（环境红与干净 main 对比）；真窗口走查、英文界面、最小窗口、干净安装 = `unverified`（3d）；真付费 = **永不发起**，门槛 ① 跑到确认 / 报价卡出现即停；门槛 ① 真实 Agent 模型：DeepSeek（协调会话 10-04 提供，进程环境加载）少量回合，按方案 §1.10 替身结果**不算切换门槛**，只证明「一句话 → stage_shot → 预演 → 挂节点 → 确认卡」端到端能走通。 | 报告里的门槛 ① 收据（回合数 / token 估计） |
| ★9 验收与回滚 | 验收（另一条线）：开关关 → `check:model-face-frozen`（原基线逐字节）、MCP `tools/list` 与 preload 白名单快照测试；开关开 → 新 CI job 跑 `check:model-schema` / `check:tool-face` / `check:model-face-frozen`（`scripts/model-face-baseline.director3dbox.json`）/ `check:agent-tool-face-usecases` / `check:skill-tool-binding`；真实任务 T1–T3 走到确认卡。回滚：revert 本段提交，或构建 `NOMI_DIRECTOR_3DBOX=false`（开关关时本段全部分叉不装配）。独立验收报告：待协调会话指派（验收线 ≠ 本线）。 | `pnpm run check:model-face-frozen`；`pnpm run check:director3dbox-face`（新增，CI 同名 job） |

## 5 中途表

钱的总规则：`stage_shot` 与预演渲染永远不花钱；只有 `generate` / 节点生成钮会花钱，它们在下表 B、C 状态一律拒绝（不出卡）。

| 状态 \ 打断 | 用户停 / 拒绝 | 关窗（关项目） | 断网 | 重启 App | 连点 / 重复发 |
|---|---|---|---|---|---|
| A. stage_shot 待审批 / 应用中（事务内） | 拒绝审批 → 画布不变 · 不扣 · 回执 = 无（`cancelled`） | 事务被项目切换判过期 → 补偿回滚，画布不变 · 不扣 · 收据 aborted | 不涉网（本地编译）→ 照常完成 · 不扣 | 收据停在 preparing → 重开时按既有恢复路径补偿 · 不扣 · 收据记录 | 同一 toolCallId 只认一次审批；第二次补丁带旧 baseRevision → 修订过期拒 · 不扣 |
| B. 预演渲染中（导演节点 `directorPreview.status=rendering`） | 删导演节点或撤销 → 渲染随标志消失而停，视频节点回到撤销前 · 不扣 · changeId 撤销回执 | 渲染结果只认原项目（`isProjectExecutionContextCurrent`），换项目即丢弃；标志留在项目文件，重开项目后重新渲染 · 不扣 | 渲染本地进行，不受影响 · 不扣 | 标志在节点 meta 里持久，重启后 Host 扫到即重渲 · 不扣 | 生成钮置灰并写原因；Agent `generate` 返回「预演还在渲染」· **不出卡、不扣** |
| C. 预演失败（`failed` / `too_long`） | 用户点「重试」→ 回到 B；不点 → 一直挡着生成 · 不扣 | 状态持久，重开仍是失败 + 重试 | 同左 | 同左 | 生成钮置灰；`generate` 返回「预演失败，先重试或改短」· **不出卡、不扣** |
| D. 预演已挂（`ready`） | 撤销 stage_shot → 导演节点删除，视频节点 meta / 提示词恢复到 stage_shot 之前 · 不扣 | 已落盘，关窗无影响 | 无影响 | 无影响 | 再交同一计划 → `unchanged:true`，不重渲不重挂 |
| E. 修订过期（Agent 拿旧 baseRevision） | — | — | — | — | 拒绝 `capability_target_stale` + 当前修订号，画布不变 · 不扣；Agent 重读后再交 |
| F. `generate` 已出确认 / 报价卡 | 既有付费流程（本段不改） | 既有 | 既有 | 既有 | 既有（报价卡出卡前已过 B/C 判据） |

## 自写清单（P0）

| 自写 | 为什么必须（领域约束） |
|---|---|
| `planPatch.ts`：按名字寻址的计划补丁 + 修订号 | RFC 6902 的通用库按数组下标寻址；导演计划的镜头 / 角色 / 场景件要按**名字**寻址（Agent 说「第二镜」时手里只有名字），且补丁后必须过导演计划自己的跨字段校验。只借语义不借实现。 |
| `directorPreviewState.ts`：预演状态判据 | 「这一镜的参考预演没好就不许花钱」是按镜头的花钱语义（`self-written.json` 领域目录）。 |
| `directorWrite.ts` 契约 | 契约本身是领域声明，写法照现有契约。 |

## 给 3c 留的接口

- 结果里 `reorderedOverrides: []`、`changedEntities: []` 两个字段本段恒为空数组，3c 填；字段已进结果 schema。
- `planPatch.ts` 返回补丁**直接改到的实体 id**（`touched`：`shot:<id>` / `actor:<id>` / `setPiece:<id>`，与编译器的稳定 id 同一套写法），3c 用它决定丢哪条覆盖。

## 真机结果（门槛 ① 替身回合，2026-10-04）

证据：`docs/evidence/2026-10-04-director-3dbox-3b/README.md`。真实 DeepSeek 在真 App 里：一句话 → `draft_shots` → `stage_shot` 整份计划 → 离屏预演以 video_ref 挂到视频镜头 → 按名字补丁改末镜为特写（新修订号、实测回读特写、重渲重挂）——**通**。
到「出片」这一步**没通**：见下。

## 预演怎么进到真正付费的那份载荷（2026-10-04 协调会话拍板 A，已实现）

**事实**：Agent 的 `generate` 派发的是草稿**候选**（主进程制作流程的账本），不是画布节点 meta；候选 → 节点是单向投影（`useAgentPanelSpendConfirm.ts` 头注释）。
预演挂接（`computeAttachCameraMove`）改的是**节点**（切全能参考、填参考视频），候选里没有这条预演——第 4 跑派发的信封就是 `t2v`、`references: []`。
花钱闸（`directorPreviewSpendBlock`）照样对：渲染中 / 失败时不出卡；但「就绪后出的卡」里没有预演。手动点节点生成钮那条路（`runGenerationNode`）读节点，是带预演的。

| 选项 | 做法 | 代价 |
|---|---|---|
| A（推荐） | 预演就绪时登记成项目素材（有 assetId），`look_at_canvas` / `stage_shot` 结果给出它；`generate` 出卡前预检再加一条：这一镜有就绪预演而候选没带它 → 不出卡，告诉模型用 `draft_shots` 改这一镜（参考 = 预演 assetId、模式 = 有参考视频槽的那个）。候选仍只有 `draft_shots` 一个写者 | 预检要读一次候选（生成面现成的 read）；多一次模型回合 |
| B | 预演挂接时渲染端顺手改候选（走 `generation.revise`） | 候选多一个写者，破「候选 → 节点单向」；与付费卡的覆写账本抢同一份载荷 |
| C | 维持现状，Agent 路径只出「文字兜底」，带参考出片只走节点生成钮 | 一句话到出片的主路径拿不到预演，3D-BOX 的价值在 Agent 路上落空 |

**实现（A）**：预演 mp4 本来就落成项目素材（`framesToVideo` 返回 assetId），ready 时记进导演节点 `directorPreview.assetId`，`stage_shot` 结果的 `preview.assetId` 与 `look_at_canvas` 的 `previewAssetId` 给出它（都是结果字段，模型参数面一个字不加，两份基线不变）。`generate` 出卡前预检多一步只读：主进程读草稿每一镜候选带了哪些素材，交给渲染端同一个判据 `directorPreviewBlocksForOperation`——预演已就绪、以参考视频挂上、而候选没带这份素材 → 不出卡，告诉模型用 `draft_shots` 改这一镜（references 加素材 id、换能收参考视频的模式）。读不到候选 = 不出卡（fail-closed）。以文字兜底挂上的（模型没有参考视频槽）不要求。

## 方向检查：V-3b 验收打回的两处缺陷（L-3b-fix，2026-10-04）

### 0. 一句话根因
「这条参考是图还是视频」这个事实有两个来源——素材本身（媒体类型）和调用方填的 `kind`——而传输层只信后者；`pinAssetReference` 补哈希和版本时只补身份、不补种类，于是模型只给 `assetId` 的参考（`draft_shots` 全部如此）永远没有 `kind`，预演 mp4 被当图片发走。

### 1. 归类表

| bug | 直接原因 | 类 |
|---|---|---|
| 预演 mp4 进了 `image_urls`、报价卡显示「图已失效」 | 参考无 `kind`，`apimartGenerationProjection` 只有 `kind==="video"` 才进 `video_urls`；报价卡 `kind ?? 'image'` 把它放进图片槽 | 同一事实两个来源，边界没把它钉成唯一来源 |
| 开关开时单镜草稿 `generate` 永不出卡 | `readShotReferenceAssetIds` 只认 `operation.shots`，单镜草稿没有这个数组就当「找不到 operation」 | 一个读取口只认多镜形状，单镜形状被当成「不存在」 |

### 2. 为什么会一直出现
候选的参考身份由宿主补，但补的是「哈希 + 版本」这一对，种类被当成调用方的语义字段留了下来；任何不带 `kind` 的入口（模型、外部宿主、将来的新动词）都会掉进图片通道。

### 3. 预测与验证
| 预测 | 验证 |
|---|---|
| 其它只给 `assetId` 的视频 / 音频参考（不只预演）此前都进错通道 | `verify985PreviewPayload.test.ts`：素材种类 → `video_urls`；图片仍进 `image_urls` |
| 调用方填了与素材不一致的 `kind`，以素材为准 | 同文件第三条（新钉住的、已钉住的、缺 `kind` 的三种形状） |
| 只要读取口再多一种草稿形状就会再被当成「找不到」 | `verify985SingleShotRead.test.ts`：单镜按一镜读、真不存在的 operation 仍抛 |

### 4. 现成方案（P0）
不新增机制：`assetKindFromContentType` 已是全仓唯一的媒体类型分类，`resolveProjectAssetReferenceIdentity` 已是唯一的参考身份来源；这次只让它多返回一个 `kind`，`pinAssetReference`（全仓唯一的补身份处，door-map：写入口 2 扇——`mcpGenerationTools` 的 patch 与 `semanticGenerationCandidate` 的 create，都走这一个函数）顺手带上。已钉住身份的参考也会对一次种类，但哈希 / 版本逐字节不变。

### 5. 补 / 重写 / 删
补（一个边界函数多一个字段）。不重写。

### 已知限制
外部 MCP 的 `generate` 不走 `generate` 出卡前预检（只有内置 Agent 路径有），留给发动机收敛那一刀统一处理。单镜草稿的参考键约定为 `""`（没有镜头 id 的那一镜），主进程与渲染端各一处用到，写在两处注释里。
