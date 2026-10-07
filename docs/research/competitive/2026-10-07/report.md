# 竞品学习周期报告：2026-10-07

> 状态：partial。完成五家公开来源、五组 TikHub 检索、TapNow/LibTV 登录态页面取证及扩展对象公开页深挖；真实鼠标录制、LibTV 插件页与 B 站原站播放仍受阻。

## 周期与检查点

| 字段 | 值 |
|---|---|
| cycle_id / mode | 2026-10-07 / cycle |
| schedule_anchor / scheduled_for / next_due | 2026-09-22T10:00:00+08:00 / 2026-10-07T10:00:00+08:00 / 2026-10-10T10:00:00+08:00 |
| attempted_at / completed_at | 2026-10-07T18:04:00+08:00 / 留空（partial） |
| status | partial |
| observation_window / baseline | TikHub 2026-09-30 起；官方公开页观察 2026-10-07；上次成功基线为 2026-10-01 公开页/TikHub，无成功登录旅程基线 |
| executor / branch / PR | Codex / `research/competitive-radar-2026-10-07` / pending |
| Nomi build / commit | `5944e92b7`（origin/main 工作树，未启动应用） |
| evidence_root | `outputs/competitive-radar/2026-10-07/` |
| next_action / next_due | 恢复可录制的 Chrome/CUA；补 LibTV 插件/Blender 与 TapNow 完整生成、取消/恢复；核 RunningHub 工作台旅程 / 2026-10-10 |

## 本轮结论

1. TapNow 把“今天要做点什么？”置于登录后首页首屏，直接给自然语言入口，并把 3D 预演、动效、深度影视、角色工坊等技能作为可点的任务起点；更新日志显示 Seedance 2.5 草稿→最终独立节点、Depth Filmmaking 重拍和节点堆叠/再生成保留历史。证据：`E-TAPNOW-APP`、`E-TAPNOW-CHANGELOG`、`C-TAPNOW-12S`。对 Nomi 的可用启发是把“任务入口→生成→结果回流”作为一条可观察链，而非增加设置项；需先以真实用户任务验证。
2. Higgsfield 官网把 AI Influencer、Genjutsu、Ads Studio、Cinema Studio、MCP/ChatGPT 插件、Supercomputer 并列成“创作角色/工作室”入口，首页卡片同时给可见结果和下一步 CTA；但这是官方声明与展示视频，不等于登录后流程跑通。证据：`E-HIGGSFIELD`、`C-HIGGSFIELD-05S`。
3. RunningHub 中文/英文首页把模型上新、限时额度、社区作品、ComfyUI/无限画布/API/Blender 入口和创作者激励放在同一导航体系；MiniMax 官方首页明确把 `design.minimax.io` 作为独立产品入口。两者的产品实体/登录后工作流仍未完整验证。证据：`E-RH-CN`、`E-RH-EN`、`E-MINIMAX`。

## 覆盖矩阵与变化

状态按本轮实际证据填写；`unverified` 不表示无变化。

| 对象 | 官方更新 | 新手教程 | 官网具体页 | 登录应用 | 官方社媒 | 社区 | 本轮深挖与缺口 |
|---|---|---|---|---|---|---|---|
| LibTV | unverified（主站连接被关闭） | unverified | partial（插件页连接失败；登录画布可见） | partial（已有登录态画布；显示网络异常） | unverified | checked（TikHub 32 条，非官方身份未全核） | 画布节点/TV Director/资产与生成历史可见；插件、Blender、成功生成与录制未完成 |
| TapNow | checked：v2.18.13，2026-09-24 | checked：文档侧栏含 Agent/Canvas/Apps 入门链 | checked：changelog 与 app 首页 | partial（首页可见，未提交生成） | unverified | checked（TikHub 22 条；小红书窗口 empty） | 首页任务入口与技能卡；需补真实输入、取消/重试、导出/复用 |
| Higgsfield | unverified（官网展示新模型/工作室，未单独核公告） | checked（Academy 入口可见，内容未跑） | checked：MCP/API/AI Influencer/Genjutsu/Ads/Cinema | unverified | checked（TikHub 27 条；官方账号需官网反链继续核） | checked（TikHub 27 条） | 主页展示视频与工作室分类；未登录生成、未验证 MCP 安装 |
| MiniMax Design | unverified（MiniMax 总站新闻，不等同 Design 更新） | unverified | checked：总站→`design.minimax.io`、Membership | unverified | checked（TikHub 26 条，账号实体未完全核实） | checked（TikHub 26 条） | 产品实体已确认；Design 应用、教程与计费未验证 |
| RunningHub | unverified（首页活动/模型 banner，不等同 changelog） | unverified | checked：中/英文首页、ComfyUI、API、模型、VibeX、rhTV | unverified | checked（TikHub 31 条） | checked（TikHub 31 条） | 中英文首页差异与实时视频卡可见；工作台、插件、API 首次成功未验证 |

### 变化记录

| change_id | 对象/维度 | before→after | 观察 | 证据 | Nomi 影响 |
|---|---|---|---|---|---|
| CH-001 | TapNow / Agent+Canvas | 10-01 未有登录态基线 → 10-07 首页可见自然语言入口、技能卡与版本 `v2.19.7` | 2026-10-07 | E-TAPNOW-APP | 值得试验任务首屏与结果回流，但不是开发授权 |
| CH-002 | TapNow / 更新 | 上次公开页基线 → v2.18.13：Seedance Draft、Depth Filmmaking、Pile/Spread、再生成不覆盖旧结果 | 2026-09-24（页面声明） | E-TAPNOW-CHANGELOG | 关注可逆性与比较历史；需 Nomi 真实任务对照 |
| CH-003 | Higgsfield / 定位与生态 | 公开页分散入口 → 同屏列 MCP、ChatGPT、API、Supercomputer、工作室与社区 | 2026-10-07 | E-HIGGSFIELD | 值得观察“按创作角色命名工具面”的认知收益，暂不转 TODO |
| CH-004 | RunningHub / 商业与内容 | 10-01 静态页受阻 → 10-07 中/英文页可读，出现 H3、Seedance 2.5、GPT Image 2.5、限时额度与创作者激励 | 2026-10-07 | E-RH-CN/E-RH-EN | 商业 banner 与产品导航混排，需实测首次任务是否被打断 |

## 旅程卡

### J-TP-20261007：TapNow 首页→任务入口（partial）

- 对象/维度/任务：TapNow / 定位、引导、Agent；从登录后首页找到一个可执行的创作任务。成功标准：输入真实需求并生成可继续编辑的结果。
- 环境：Chrome 日常登录态；网页 `https://app.tapnow.ai/`；中文；版本文本 `v2.19.7`；素材未上传。
- 发现入口→输入→关键操作：首屏“今天要做点什么？”文本框→“自动生成”；下方提供白模视频预演、深度影视工坊、角色工坊与技能入口；本轮未提交生成，避免产生额度消耗。
- 反馈/状态：页面可见首页、技能、TapTV、竞技场、模板区；真实提交、等待、取消/恢复、导出未验证。
- 指标：入口计数 1；跨页 0；首次结果时间 unverified；输入负担 unverified。
- 页面/动效/引导：任务问句降低格式学习；技能卡用任务名+一句效果说明；代价是首页信息量大、促销与社区并列。
- Nomi 对照：Nomi 现役 Agent 为 pi lane、生成画布为 React Flow 单内核；Nomi 真实同任务未启动，结果差距 unverified。
- 证据/回看：`E-TAPNOW-APP`、`C-TAPNOW-12S`；截图已人工查看；无连续录屏，故 partial。

### J-LT-20261007：LibTV 登录画布观察（partial）

- 对象/维度/任务：LibTV / 工作流、状态、资产；检查已有项目能否从画布继续生成。
- 环境：Chrome 日常登录态；`https://www.liblib.tv/canvas?...`；中文；已有项目；账户层级未知。
- 发现入口→操作：画布显示 TV Director、资产管理、关键元素、剧本/图片/视频节点、生成历史/素材库/角色造型室；当前反馈“网络异常”，可见多个“待确认后生成”节点。
- 正常/取消/错误恢复：网络异常按钮提供“点击重试”，本轮未重试生成；成功视频/音频结果、撤销/导出未验证。
- 指标：已可见节点数与模型标签，操作步数/等待/首次结果均 unverified。
- Nomi 对照：Nomi 有生成画布、Director、历史/导出领域工具，但同任务未启动；不能把结构相似写成体验等价。
- 证据/回看：`E-LIBTV-APP`、`E-LIBTV-CANVAS`；截图已人工查看；无录屏，partial。

## 内容卡

### C-TAPNOW-12S

- 对象/平台：TapNow 官网/登录后首页内嵌作品展示；URL `https://app.tapnow.ai/`。
- 观察：10-07；选取首个时长 93.367 秒的首页展示视频，在原站页面视频元素中 seek 至 00:12，暂停并截图；媒体 URL 与本地截图记录在 `E-TAPNOW-VIDEO`。
- 画面/节奏：首屏先给“今天要做点什么？”任务入口，再用 Astra Studio/技能卡和作品区证明可做什么；00:12 关键帧显示首页作品/技能视觉而非模型参数。
- 作用与限制：把能力按创作任务陈列，降低从空白开始的负担；无法由该片证明生成质量、转化或登录后完整成功。
- Nomi 内容实验（简报，不发布）：以“从一句目标到可编辑首稿”为主张，真实录制 Nomi Agent→画布→时间轴，指标为首次可用结果时间、跨页数、回退成功率；停止条件为任一关键状态不可回退。

### C-HIGGSFIELD-05S

- 对象/平台：Higgsfield 官方中文官网首页；URL `https://higgsfield.ai/zh`。
- 观察：10-07；选取首页第二张 15.333 秒卡片视频，在原站视频元素中 seek 至 00:05，暂停并截图；媒体 URL 为 `https://static-public-media.higgsfield.ai/cards/6e0b1c30-6596-4f32-9452-c4b9f8890329.mp4`。
- 画面/节奏：卡片用强视觉片段+标题（Higgsfield Ads Studio）+一句收益文案“Get your next winning static ads with less work”；导航同时展示 MCP、ChatGPT 插件、Supercomputer 等生态入口。
- 作用与限制：先给“结果长什么样”再给工作室入口，可能降低理解成本；页面视频/文案不能证明用户完成生成或商业转化。
- Nomi 内容实验（简报，不发布）：测试“结果关键帧→继续编辑→导出回执”的三镜头顺序；指标为观众能否复述下一步、真实任务首成功率；停止条件为关键帧无法沿证据回查。

## 自媒体来源（TikHub）

本轮每家一个唯一查询目录，查询词为品牌名，平台 `all`，窗口 `since=2026-09-30`，每个平台 limit=10。四平台均检查 `summary`/`failures`/`missingFields`：LibTV 32（6/6/10/10），TapNow 22（2/0/10/10；小红书 `empty`，不是失败），Higgsfield 27（4/3/10/10），MiniMax Design 26（2/4/10/10），RunningHub 31（6/5/10/10）；五次 `failures=[]`、missingFields 均为空，费用字段未由接口提供（未知）。原始文件分别位于 `outputs/competitive-radar/2026-10-07/tikhub/<object>/q01/attempt-01/tikhub-search.{json,md}`。TikHub 仅作发现；本轮 B 站新 tab 返回 `ERR_CONNECTION_CLOSED`，未把摘要当作完整视频观看。

## Nomi 决策与实验回访

| finding_id | 摩擦/证据 ID | 已确认的 Nomi 现状 | 机制与反方解释 | 适用/试验/观察/不采用及理由 | TODO/已有 PR | 最小实验与成败指标 | 后续结果 |
|---|---|---|---|---|---|---|---|
| F-001 | TapNow 首页任务问句 / E-TAPNOW-APP | Nomi Agent lane 与画布现役，但本轮未跑真实任务 | 任务问句可能降低格式负担；也可能只是营销入口 | 值得试验；先做真实任务对照，不自动开发 | 未新增 TODO，待查现有 Agent/画布条目 | 同一目标在 Nomi 中从空白到可编辑首稿；首次结果时间、跨页数、工具写对率 | pending |
| F-002 | TapNow Draft/Stack / E-TAPNOW-CHANGELOG | Nomi 有画布历史/节点与时间轴，但对照链未实测 | 保留旧结果降低试错恐惧；堆叠也可能增加隐含状态 | 持续观察，先核 Nomi 当前历史/撤销体验 | 查 TODO 去重后再决定 | 生成两次、比较、撤销、导出；旧结果保留率与回退成功率 | pending |
| F-003 | Higgsfield MCP/角色化入口 / E-HIGGSFIELD | Nomi MCP 与 Agent 工具已有共享注册表，外部五个生成工具仍有例外 | 角色名可能比 capability 名更易懂；也可能造成入口过多 | 观察；不能据首页文案推断架构或优于 Nomi | 不新增 TODO | 让新用户找到并完成一次 MCP 连接；发现→连接→首个回执步数 | pending |

## 证据索引

| evidence_id | 类别 | 来源/观察时刻 | 本地相对路径 | SHA-256 | 时间码/对应结论 | 已回看/范围 |
|---|---|---|---|---|---|---|
| E-TAPNOW-APP | 实测页面 | https://app.tapnow.ai/ · 2026-10-07 | `outputs/competitive-radar/2026-10-07/web/tapnow-app/page.json` | c82d9142ed2137942b59fc6d1e9113c387f2b46a138fa2ce7313c3866b6ab5d3 | 首页入口/技能/版本 | 已人工查看；公开页面与登录态首页 |
| E-TAPNOW-CHANGELOG | 官方声明 | https://docs.tapnow.ai/en/docs/changelog · 2026-10-07 | `outputs/competitive-radar/2026-10-07/web/tapnow-changelog/page.json` | 775eab391a9624eadea9044c8fa088686d9e0bf6b987218c0aae67b98290c65a | v2.18.13 / Draft / Depth / Stack | 页面全文截取；版本声明未实测 |
| E-HIGGSFIELD | 官方声明/页面实测 | https://higgsfield.ai/zh · 2026-10-07 | `outputs/competitive-radar/2026-10-07/web/higgsfield/page.json` | c36b2dac218ea02d93547cb382b0a5145136739f5b35c29899586573bad8c405 | MCP/插件/工作室/社区入口 | 页面已人工查看；未登录 |
| E-MINIMAX | 官方声明 | https://www.minimax.io/ · 2026-10-07 | `outputs/competitive-radar/2026-10-07/web/mini-max/page.json` | 0969f2b01af0d00cd0f76b66b8047476d6016a7dcfd55a7e04020edbf952359a | Design 独立入口/商业创作定位 | 页面截取；Design 应用未验证 |
| E-RH-CN | 官方页面实测 | https://www.runninghub.cn/ · 2026-10-07 | `outputs/competitive-radar/2026-10-07/web/runninghub-cn/page.json` | d3cc39c1f79fd42064f9a443f14960b7d3b4ae4bd3dce172b5e831f6cc29712b | 中英文 banner/产品矩阵/社区 | 页面已人工查看；未登录工作台 |
| E-RH-EN | 官方页面实测 | https://www.runninghub.ai/zh-cn · 2026-10-07 | `outputs/competitive-radar/2026-10-07/web/runninghub-en/page.json` | 9a8a4496b5fcdd9d36174d8b201f5d685bd7676e993353d8c6e9821839ba3f27 | 国际站 banner/价格/模型 | 页面已人工查看；未登录工作台 |
| E-LIBTV-APP | 实测页面 | 登录态 `https://www.liblib.tv/canvas?...` · 2026-10-07 | `outputs/competitive-radar/2026-10-07/web/libtv-app/page.json` | f48bdb1fe3fb376d086cfefe143a3d3787d33b7f9647d3b2be6f9660408e2568 | TV Director/节点/网络异常 | 已人工查看；账户/项目私密信息未写报告 |
| E-LIBTV-PLUGIN | 未验证/失败 | https://www.liblib.tv/plugin · 2026-10-07 | `outputs/competitive-radar/2026-10-07/web/libtv-plugin/page.json` | be094e9b3aad6a710c04f8f04b6ad08d8328c81f5db7a7fae1b0f37ac87485e4 | ERR_CONNECTION_CLOSED | 失败页已查看，不能证明插件无变化 |
| E-LIBTV-CANVAS | 实测截图 | 登录态画布 · 2026-10-07 | `outputs/competitive-radar/2026-10-07/evidence/libtv-canvas.png` | 0cb49b5be60b09a7dec1f2b1219c6494a122198408a80e1743fb3294bd68599b | 画布节点/网络异常 | 已人工查看 |
| E-TAPNOW-VIDEO | 实测视频帧 | https://app.tapnow.ai/ · 2026-10-07 | `outputs/competitive-radar/2026-10-07/evidence/tapnow-showcase-12s.png` | a0ffe0e5de1680a4dfd9203a248d8e2974e7f77e0f4cdc4a7a5f886f0ea25905 | 00:12 / C-TAPNOW-12S | 原站视频 seek 后截图，未保存连续录屏 |
| E-HIGGSFIELD-VIDEO | 实测视频帧 | https://higgsfield.ai/zh · 2026-10-07 | `outputs/competitive-radar/2026-10-07/evidence/higgsfield-card-05s.png` | c1580dee1218196e6a435c9f27ee166c81bccd3b76bafa545ce4f1cc23dabf43 | 00:05 / C-HIGGSFIELD-05S | 原站视频 seek 后截图，未保存连续录屏 |

## 覆盖轮换与验收

- 本轮扩展深挖轮到 Higgsfield/RunningHub/MiniMax Design 的公开入口；核心 LibTV/TapNow 均有页面证据，但两条完整真实鼠标旅程均未跑通。
- 11 维矩阵：定位/页面/引导/工作流/状态/功能/Agent/生态/商业/社区/内容均有公开页或 TikHub 观察，但登录生成、取消/错误恢复、插件/CLI/MCP/Blender 首次成功仍为 partial/unverified。
- TikHub 五次唯一查询均保留 JSON/MD；TapNow 小红书为 `empty`，不是“无讨论”结论；B 站原站连接失败，未把摘要当成已观看。
- 真实录屏与 CUA：`cua_repl` 浏览器扩展请求头策略加载失败；本轮只保留 CDP 页面截图/视频关键帧，故不填写 completed_at。
- 锁与检查点：`outputs/competitive-radar/.run-lock` 已取得；本轮结束前释放。下一轮优先恢复 CUA/录屏，补 LibTV 插件/Blender、TapNow 真实生成/取消、RunningHub 工作台。
