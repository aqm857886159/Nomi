# Nomi Skill 聚合区与全屏 Agent 工作台执行方案

日期：2026-09-05
基线：`origin/main` / `89dcd9131025cc8d5f74e5afe3432ea9eb142faf`
状态：📋 方案待拍板；尚未宣称任何新功能已实现

## 1. 目标与判断

用户真正卡住的不是“缺一个更大的面板”，而是同一个创作决定在文本、分镜、画布、预览之间被拆散：不知道该用哪种方法、结果落在哪里、改动是否真的保存。方案的主线因此是**一个 Agent 身份 + 多个工作面投影 + 一个可追溯的 Skill 来源层**。

核心取舍：先把可复用的来源/状态/验收边界做真，再扩大工作台视觉面积。若先做大 UI，用户会看到“能点”的壳，却仍不能证明脚本、分镜、生成结果和重启读回属于同一个作品。

## 2. 当前真实基线

| 领域 | 已确认事实 | 证据定位 | 不能据此宣称 |
|---|---|---|---|
| Agent UI | 已合入 v3.1 正常态、P0 异常态和可计算合同；Resident Shell 通过 Portal 投射到现有工作区，Agent Host 默认闸门仍关闭 | `src/workbench/ai/ProjectAgentResidentShell.tsx:56,327-389,597-659,767-786`；`src/workbench/WorkbenchShell.tsx:153-168,341-377`；`docs/design/agent-ui-spec.generated.json` | 全屏统一 Agent 已完成 |
| Agent 身份 | Host/bridge/client 已有 `ProjectAgentHostState`、revision、proposal receipt 接口；当前发送路径仍显式使用 ephemeral history，area/session 仍需按 #472 M1 收口 | `src/workbench/ai/projectAgentClient.ts:47-77`；`src/workbench/ai/agentSessionKey.ts:1-20`；`src/workbench/ai/ProjectAgentResidentShell.tsx:597-659`；`docs/ARCHITECTURE-NOW.md` | 跨创作/生成/预览已是一个 Thread |
| Skill runtime | `skill.json` 已支持版本、工具、provider、权限、inputs/examples、stages；`requestedCapabilities` 才是 Host 收窄依据 | `electron/skills/skillManifestSchema.ts:91-126`；`docs/skill-pack-format.md` | 外部 Skill 已具备版权/来源治理或聚合市场 |
| Skill 入口 | Skill 列表在 composer 内，当前 `filteredSkills = skills`，Skill library 事件会切到 generation；尚无独立聚合区、真实搜索/版权/下架状态 | `src/workbench/ai/ProjectAgentResidentShell.tsx:665-680`；`src/workbench/WorkbenchShell.tsx:232-241` | Skill 发现/选择/下载/启动已闭环 |
| 资源库 | 项目、提示词、技能、素材仍是分开的 store/API；统一发现适配器不保存外部正文，也不提供统一下载/举报入口 | `src/workbench/library/libraryDiscovery.ts`；`src/workbench/library/libraryAdapters.ts`；`docs/ARCHITECTURE-NOW.md` | Skill 聚合区已存在 |
| 分镜 | 分镜表是画布节点的投影；已有表格编辑、Agent 规划和 canonical patch 结构，但 Agent surface 仍把 storyboard 归为 creation | `src/workbench/creation/storyboard/StoryboardShotTable.tsx`；`src/workbench/generationCanvas/agent/storyboardPlan.ts`；`src/workbench/WorkbenchShell.tsx:167`；`tests/ux/storyboard-agent-canonical-patch.e2e.mjs` | 视频理解表格已覆盖全部用户要求列 |
| 视频拆解 | 有真实 Electron 入口和 gated E2E，已覆盖视频导入、拆镜、关键帧、画面/景别、对白等部分字段 | `tests/ux/video-deconstruct.e2e.mjs:42-125`；`docs/fixes/2026-09-01-video-deconstruction-engine.root-cause.json` | URL 转换、字幕、完整表格编辑/导出在所有环境已闭环 |
| 设计链 | #315/#438/#445/#447/#471 已合入；#472 已合入 M0-M5 执行方案 | Git merge receipts：`18cca097`、`303bba3`、`4f012f9`、`ff50486`、`89dcd91`、`ac00ecdc` | open PR 标题等于完成 |
| 明确排除 | PR #454 的 anchor/parameter rail 方向不作为本任务视觉来源 | `gh pr view 454` 标题与现有设计定稿冲突 | 可把旧样张重新带回生产 |

## 3. 两条并行工作线

### A. Skill 资源研究与聚合区

先建立**来源记录而非内容搬运**。每条候选至少有：`id/title/summary/useCases/author/originUrl/repository/versionOrPublishedAt/license/copyrightStatus/redistribution/adaptation/contentTypes/preview/sourceEvidence/contact/takedown/status`。正文只在用户明确许可、版本固定且来源可追溯时进入 Nomi；默认只保存元数据、预览引用和启动/使用入口。

三类核心场景：

1. 剧本创作：标题、摘要、输入/输出类型、示例入口为主，不默认展示长正文。
2. 电影感图文/视频：展示真实预览图/视频缩略图及来源许可，点击后放入 prompt bar 或打开原始来源。
3. 剪辑：只纳入与脚本→分镜→时间线闭环直接相关的少量工作流；不扩成泛素材市场。

聚合区第一版的信息架构：左侧“剧本创作 / 电影感图文视频 / 剪辑”，中间搜索/标签/排序/收藏，主区卡片，详情抽屉显示来源、版本、许可、预览和“复制 / 下载 / 导出 / 在 Nomi 中启动 / 原作者 / 举报下架”。空、加载、失败、重复、下架、离线、恶意内容都必须可见且可恢复。

安全边界：外部正文与预览是数据，不是权限；Skill manifest 只能缩小 Host capability ceiling，不能绕过权限、费用、provider 认证或项目绑定。来源/许可状态进入 receipt/provenance，避免 UI 从正文猜版权。

### B. 全屏 Agent 工作台

全屏模式只是同一 Agent Host 的更大 surface，不新增第二套消息 store。右侧 composer 维持五个主要控件：最左附件/参考资料，其次模型与 Skill，中部 prompt 呼吸区，最右模式与发送/生成；Skill 选择后进入 prompt bar，不能出现空白“技能”栏。

工作面按用户任务组织：左侧固定栏放新项目、素材库、功能库和三类分类；主区可显示脚本、分镜、图片预览、视频播放器和调整对话。脚本/分镜可以在 Agent 内改；图片/视频节点大量微调本轮不做。生成画布仍使用 React Flow 单内核，节点添加必须有可启动的非空态，类型收进加号菜单。

统一真相源约束：文档/分镜/画布/时间线是各自领域事实源，Agent 只提交 typed proposal；Thread/Turn、模型、Skill、附件、引用、权限、目标 surface 和 revision 在发送前冻结为一个 snapshot；effect 产生 receipt，关闭重启从事实源和 receipt 读回。

## 4. 沿用 #472 的 M0-M5，小 PR 映射

本表不重新定义里程碑。M0–M5 沿用已合入的 #472：M1 Host 生命周期、M2 canonical 工具/写入、M3 context/Skill/ledger、M4 trust/费用、M5 packaged/全链路；本任务的 Skill、全屏 Agent、视频拆解是挂在这些里程碑下的产品切片。

| 阶段 | 小 PR 目标 | 依赖 | 不纳入 | 完成门 |
|---|---|---|---|---|
| M0 | M0-A：研究包、Skill catalog/版权 schema、来源状态词表；M0-B：owner map、真实任务 manifest、当前 SHA 重基线 | 当前 `origin/main`；#472 方案 | 生产 UI、外部正文导入 | schema 可校验；H/B/E/T/N 矩阵齐全；历史/当前/blocked 分开 |
| M1 | M1-A：Host 生命周期、Thread/Turn/receipt/revision/重启；M1-B：项目绑定、取消/超时/网络错误 | M0；现有 Host/bridge/client | 全屏视觉、外部 Skill 下载、真实付费生成 | Host 终态与 receipt 真实持久化；拒绝无副作用；冷启动不重放 |
| M2 | M2-A：canonical storyboard `nomi_canvas_plan(operation=patch_shots)`；M2-B：selection→preview→approve/deny→undo→receipt；M2-C：旧 bare alias 删除 | M1；现有 document/storyboard/canvas capabilities | #454 anchor/parameter rail；第二套写入路径 | 未点名字段保留；revision/lease/operationId 正确；Electron/MCP 真实读回 |
| M3 | M3-A：Skill 目录→manifest→正文 hash→Host projection；M3-B：全屏 Agent Host seam/工作区 surface；M3-C：脚本→分镜上下文交接与账本投影 | M1 receipt；M2 canonical effect；#471 UI contract | 第二个 Skill store、第二个 Agent composer、第二套 canvas renderer | Skill 只授方法不授权；全屏/四工作面同一 Thread；真实 context→effect→receipt |
| M4 | M4-A：视频 URL/本地视频→转换→关键帧/字幕/对白/分镜表→编辑/导出；M4-B：外部来源 taint、费用/授权闸门 | M2 canonical write；现有 video engine；真实 provider 仅按预检执行 | 未认证 TikHub/ASR/付费 provider；假定 OCR/HyperFrames 已接通 | 真实 Electron；网络/转换/部分镜失败诚实；来源/费用/权限进入 receipt |
| M5 | M5-A：图片/视频结果回显、播放与调整；M5-B：引导、供应商排序、隐私设置/审计；M5-C：packaged + MCP/HyperFrames 真实接通收口 | M1-M4；能力认证和实际连接 | 默认 telemetry、静态 completion、未验证 HyperFrames | 当前 SHA binary；默认关闭/可退出/删除/导出；冷启动/回滚/全链路通过 |

依赖图：`M0 → M1 → M2 → M3 → M4 → M5`。研究、现状审计、真实用户任务契约可并行；任何新 UI 视觉分歧先走 Prompt Brief → image2 → 用户确认 → design contract，再进入 M3/M5 实现。

## 5. 每个阶段的 H/B/E/T/N 验收合同

这里沿用项目 QA 定义：Human（真实用户入口）、Behavior（可观察行为）、Evidence（落盘/receipt/结果证据）、Technical boundary（权限/provider/版本/网络边界）、Negative path（失败/拒绝/取消/回滚）。每类先在当前基线让**同一断言红**，再实现，再用同一命令绿；边界 mock 只能在 transport/provider seam，不能 mock 用户点击、Host、项目 repository、持久化或结果投影。

每个 PR 必须同时记录：

- `source locator`、适配规则、expected/actual/delta；
- H/B/E/T/N 的 stable assertion id、红证据、绿证据、positive control；
- unit/integration/real Electron/packaged/restart/visual 的适用状态；
- provider 状态：`documented | simulated | loopback | live-certified | blocked`；
- 根因记录与剩余 blocked；不把按钮点击、fixture、store 注入、静态 HTML、loopback 当 live completion。

关键真实用户任务：

1. 进入全屏 Agent → 选 Skill → 切模型 → 上传/引用素材 → 发送 → 看到可编辑结果。
2. 在 Agent 内修改脚本/分镜 → 预览/确认 → 生成结果落画布 → 关闭重启后读回。
3. 播放图片/视频结果 → 发一条调整 → receipt/revision 不丢且未点名字段保留。
4. 视频 URL 输入 → 转换 → 关键帧/字幕/对白/分镜表 → 编辑行列 → 导出。
5. 网络失败、401/403、超时、部分镜失败、下架/重复资源、恶意 Skill 正文 → 用户看到人话原因且无未授权副作用。

## 6. 关键不可逆/高风险边界

- 不自动复制受版权保护正文、预览或视频；下载/改编以 `licenseSnapshot` 与 `redistribution` 状态为前置。
- 用户反馈和 Alex 聊天：本轮只采用本地真实可访问的导出/链接/授权。当前命令行与已暴露工具没有可验证聊天入口，故状态为 `blocked`，下一步需要用户提供导出或链接。
- TikHub/抖音/小红书/X：低频、真实页面证据；登录墙、robots、服务条款或速率限制导致不可达时记录 `blocked`，不推断已看过。
- Provider/API key：只在 provider/sample/预算预检通过后做一次最小、可逆 canary；凭据不写文件、日志、PR 或回复。不为研究先花额度。
- HyperFrames/MCP：只有真实 capability handshake、请求/响应、产物 ID、持久化/restart 才能升为 live-certified；设计稿或“跳转按钮”不算接通。
- 供应商偏好只影响展示排序，不改变 capability、认证、权限和费用判定。
- telemetry 默认关闭；即便 opt-in 也只收低敏频率、失败类别、耗时分桶，不收 prompt、媒体、密钥、原始项目。

### 历史群反馈（已核实，但不可当作当前反馈）

当前本地可读的最近两份 Nomi 群导出都导出于 2026-08-17，分别 1747 条和 386 条消息，元数据显示未上传。脱敏关键词计数显示：两份合计“视频”92 条、“生成”125 条、“模型”83 条、“供应商/API”95 条、“画布”52 条、“分镜”30 条、“Skill/技能”21 条；这只能作为需求热度信号，不能代替逐条用户研究，也不能升级成 2026-09 的结论。原始文件留在私有目录，不进入仓库。

从现有历史反馈线索提炼的待验证摩擦是：模型/接口能力边界与费用不清、视频能力和任务状态不透明、画布/分镜产出是否真正落地。它们正好对应本方案的能力/费用/receipt/重启验收，但下一轮仍需用新反馈或真实任务复核。

## 7. 第一低风险 slice

先交付 M0：本方案、研究包 [README](../research/2026-09-05-skill-resource-catalog/README.md)、[来源表](../research/2026-09-05-skill-resource-catalog/report-source.md)、machine-readable catalog schema/版权字段、[当前状态审计](../research/2026-09-05-skill-resource-catalog/nomi-current-state-audit.md) 和 [真实任务矩阵](../research/2026-09-05-skill-resource-catalog/acceptance-matrix.md)。它不改变运行时，不引入第二套资源/状态 owner，能先把后续研究与 PR 的证据格式固定下来。M0 通过后先进入 #472 既定 M1 Host 前置，再开 M3 的 Skill/全屏 UI；在没有用户确认的新视觉方向前，不直接改现有 Agent 外壳。

### M0 回滚与验收

回滚只需删除本 PR 新增文档/研究包，不触碰运行时、现有 Skill、用户项目或模型目录。验收包括：JSON schema 自校验；文档能定位所有现状结论；研究条目具有来源状态；H/B/E/T/N、provider、persistence、restart、visual 字段无空白；所有不可达项明确 owner/替代证据/下一步。

## 8. 当前阻塞

| 阻塞 | 证据 | 处理 |
|---|---|---|
| 依赖未安装 | 当前 worktree 无 `node_modules`；`pnpm run radar:models` 报 `tsx: command not found` | 记录“今日模型雷达未查成”；需要进入代码验证前在本 worktree 安装依赖 |
| 用户群/Alex 聊天不可验证 | 当前可用本地文件/工具无聊天导出或连接器入口 | 用户提供导出、链接或明确授权后补证据 |
| 部分外部平台 | 是否可达要以当前登录态/条款/速率结果为准 | 逐站记录 blocked，不编造结果 |
| 全屏 Agent 视觉拍板 | 已有 #315/#438/#445/#447/#471 设计链，但当前新需求的“全屏信息架构”尚未形成用户确认的 image2 contract | 先做信息架构/状态契约；大面积 UI 实现前走视觉门 |
