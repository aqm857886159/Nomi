# Nomi 迭代 TODO —— 唯一真相源

> 状态：🚧 进行中 — 这份文件**长期活着**，状态变了就改这一份。基准 `origin/main @ 155f660ce`，最后盘点 2026-09-14。
> **派工、出方案、开分支之前先对照这份表**；某条看不懂或觉得写错了，回查它「来源」那一列（[sources/](sources/) 是原始资料，[designs-not-yet-built.md](designs-not-yet-built.md) 是设计落地实扫）。用法与维护纪律见 [README](README.md)。

**状态口径**：`doing` 有分支/PR 在写 · `todo` 该做没开工 · `hold` 要先聊/等别的东西 · `done` 已合 main（写 PR 号）。
**ID 不回收**：做完了把状态改成 `done`，别删行——删了下次又会有人重新发现同一件事。

---

## A. 发版主线（这版必进）

> 用户 09-14 原话：「主线是尽快推一版：合 PR + 核心 bug。」验收 = MiniMax H3 **1 分钟**短片真实闭环。

| ID | 一句话 | 状态 | 来源 | 下一步 |
|---|---|---|---|---|
| T-RL-01 | 合并列车：open PR 逐个过 CI 合进 main | doing | 09-14 拍板 | #785 Contracts 转绿先进（它解 `Canvas Performance (Linux)` 那条共同红），其余按序 |
| T-RL-02 | Agent 做不出图/视频：动词被翻成适配器白名单里没有的名字 → 恒 `generation_surface_unavailable` | doing | [截图](sources/screenshots/2026-09-13-1927-layout-split-and-surface-error.jpg) · [原文 09-12](sources/2026-09-14-filehelper-transcript.md#09-12) | `feat/agent-tool-face-20-verbs-v2` 开 PR，关 #777 |
| T-RL-03 | 视频拆解全失败：付费出口没穿 `grantId`，错误被吞 | doing #782 | [原文 09-12](sources/2026-09-14-filehelper-transcript.md#09-12) | 合 |
| T-RL-04 | 设置页 7–8 个冗余区块全删 + 供应商默认放行 + 系统提示词搬进模式弹层 | doing #781 | [原文 09-12/09-13](sources/2026-09-14-filehelper-transcript.md#09-12) | 合 |
| T-RL-05 | MCP 连接真实性五 bug（只打开 tab 就静默改写本机 5 个全局配置等） | doing #783 | [原文 09-13](sources/2026-09-14-filehelper-transcript.md#09-13) | 合；**用户需从真实 Nomi.app 重点一次连接** |
| T-RL-06 | 右侧 AI 栏 + 时间轴同时开 → 页面被切割、右下缺一块、面板没顶到底 | todo | [截图 09-13 19:27](sources/screenshots/2026-09-13-1927-layout-split-and-surface-error.jpg) | 09-14 拍板 **A = 修回旧设计**（时间轴横贯底部、AI 面板被顶上去），以迁移前代码为规格，不需样张；停靠列 B 留下一版 |
| T-RL-07 | 「skill 能用」：选了 skill 回复里看得出被用、画幅/提示词跟着变 | todo | [原文 09-10/09-12](sources/2026-09-14-filehelper-transcript.md#09-12) | v2 合后带 skill 真跑 20 句 |
| T-RL-08 | 拆解出来的秒数一堆小数 | todo | [原文 09-12](sources/2026-09-14-filehelper-transcript.md#09-12) | 并进拆解那条分支 |
| T-RL-09 | 发版本身：0.21.0（8-27）仍是最新 release，主线积压三千多提交 | todo | 09-12 RC 切线拍板 | 列车合完打 RC；打包前置缺陷：`@anthropic-ai/sandbox-runtime` 原生二进制要 `asarUnpack` **且**显式递路径 |

## B. Agent 质量

> 用户 09-14 的验收句：「明显有问题的功能优化到可用 **+ Agent 优化到可用**」。

| ID | 一句话 | 状态 | 来源 | 下一步 |
|---|---|---|---|---|
| T-AG-01 | **Agent 缺「做事原则」**：直接让它出片时不建人物资产、不用参考图模式，怀疑 system prompt 原则没写好 | todo | [截图：Agent 自述「镜头语言规则用了、视觉锚引用没用上」](sources/screenshots/2026-09-12-0033-agent-self-report.jpg) | 这是用户猜的假设，**先验再改**：拿真实 case 跑一遍看它到底读了什么原则 |
| T-AG-02 | 停止/复制/重试三个动作没有回执（停止实测 3–11ms 就生效，`onRetry` 从未接线） | doing #789 | [原文 09-13 19:32](sources/2026-09-14-filehelper-transcript.md#09-13) | 合 |
| T-AG-03 | 聊天框四件：一直写字框不变大 · 发送/模式按钮突然跳到左边 · 模式弹层点外面不关 · 一条回复被切成 3 段 | todo | [原文 09-10 13:45](sources/2026-09-14-filehelper-transcript.md#09-10) | 没有任何 lane 碰过；一个小 PR 的量 |
| T-AG-04 | 全自动档还弹付费卡；「工具回执说有确认卡、宿主没出卡」（让它剪辑劈两半那次） | todo | [截图](sources/screenshots/2026-09-12-0043-edit-split-confirm-card.jpg) | 归 v2 的「export 先确认卡」设计；两条路里删 `needs_spend_confirmation` 状态已拍板 |
| T-AG-05 | 一次只能选一个 skill；skill 不随聊天发出，用户以为没用上 | todo | [原文 09-10](sources/2026-09-14-filehelper-transcript.md#09-10) | 与 T-AG-15 一起做 |
| T-AG-06 | 废话文案：「已保存到项目」「运行命令」那串重复提示 | todo | [截图](sources/screenshots/2026-09-12-0027-canvas-saved-note.jpg) | 顺手 |
| T-AG-07 | skill 触发机制：官方怎么做 vs 我们怎么做 | hold | 09-12 派过研究，分支在远端，**结论没回来** | 先把那份结论捞回来再决定 |
| T-AG-08 | 怎么定义/评估/量化 **skill 结构**的质量（不是 skill 内容） | hold 💬 | [原文 09-14 00:12](sources/2026-09-14-filehelper-transcript.md#09-14) | 讨论题，别派工 |
| T-AG-09 | benchmark：剧本 / 资产 / 分镜 / 提示词 / 模型选择 / 模式选择 —— 专属 AI 生成视频的评价基准 | hold 💬 | [原文 09-13 19:46](sources/2026-09-14-filehelper-transcript.md#09-13) | 讨论题；它决定「Agent 优化到可用」怎么量 |
| T-AG-10 | 矩阵评测夹具：每个动词 × 每种画布状态 | todo | [原文 09-14 01:52](sources/2026-09-14-filehelper-transcript.md#09-14) | tool-face v2 合后的下一刀 |
| T-AG-11 | Agent 轨迹数据收集 + 隐私边界（今天的诊断包里**没有**转录，只有日志和模型目录） | todo | [原文 09-13 19:13–19:42](sources/2026-09-14-filehelper-transcript.md#09-13) | 先定「转录哪些字段能出门」，再谈上报；实现见 T-EC-05 |
| T-AG-12 | 快速反馈机制：出问题处就近弹「反馈给开发者」+ 信息过滤 + 让他愿意点的说法 | todo | [原文 09-12 #7 / 09-13 19:38](sources/2026-09-14-filehelper-transcript.md#09-13) | 与 T-AG-11 同一条链（先有轨迹才有东西可反馈） |
| T-AG-13 | Goal 模式 v1：一个 Run + 一条 lane，剧本进→成片出 | hold | 09-08 调研已收（PR #623），三条拍板已定 | 六条「没想到」是实施前置门；排在主线后 |
| T-AG-14 | 看片自评（Agent 最大能力缺口） | hold | 09-07 能力边界七缺口 | — |
| T-AG-15 | 提示词与 skill 整合（skill 已经把提示词装进去了） | todo | [原文 09-12 00:48](sources/2026-09-14-filehelper-transcript.md#09-12) | 先出方案 |
| T-AG-16 | 常驻 Agent 切到生成面再往画布放东西就 `surface_port_unavailable`：对话还在、画面口作废。根因不是「忘了 recapture」，是会话把短命画面口当成了身份证。结论：会话 = 窗口+项目，画面只在动手时现问 | todo | [09-16 上下文全文（冻点滑动 / 假对照 / 换项目口径）](sources/2026-09-16-session-identity-window-plus-project.md) · Linux `resident-composer-receipt-fix` · 合同 `docs/fixes/2026-09-15-lane-canvas-write-live-port.root-cause.json` | **先读来源全文再派工**，不要只抄「窗口+项目」。#802 合入后立刻开独立 PR；#802 只许 execute 现问口，不许改会话身份 |

## C. 画布与节点

| ID | 一句话 | 状态 | 来源 | 下一步 |
|---|---|---|---|---|
| T-CV-01 | 大画布卡：框选卡顿、60 张图拖组几乎动不了、右下角拖比例卡 | doing #787 #763 | [原文 09-10/09-12](sources/2026-09-14-filehelper-transcript.md#09-12) | 合；硬指标「长任务 249 → 个位数」不达标不算完 |
| T-CV-02 | 编组后点空白框就没了；框没拉环、拉环易丢；单击才出蓝色拉环 | todo | [原文 09-12 01:07](sources/2026-09-14-filehelper-transcript.md#09-12) | 磁吸「选中才出带子」是旧设计已拍板恢复；**「编组框丢」是另一件，要核** |
| T-CV-03 | 节点下面东西太多：只留 icon + hover 名称，运镜/更多挪右上，下面只放模型生成相关 | todo | [原文 09-10 #12](sources/2026-09-14-filehelper-transcript.md#09-10) | 与 #784 同一面；#784 样张已被退回「只收宽不改摆法」 |
| T-CV-04 | 视频节点却显示「几个图片」→ 要通用 ×1 ×2 数量控件 | todo | [原文 09-10 #11](sources/2026-09-14-filehelper-transcript.md#09-10) | 小 |
| T-CV-05 | 点节点后下方输入框来回漂移、被截断；参数挤在一起 | todo | [原文 09-10 #10](sources/2026-09-14-filehelper-transcript.md#09-10) | 要核（可能已随参数条 v1 改掉） |
| T-CV-06 | 画布里图片比例不对、上下有透明边 | todo | [原文 09-12](sources/2026-09-14-filehelper-transcript.md#09-12) | 要核 |
| T-CV-07 | 徽标/角标看不清：分镜头左上右上徽标、技能卡黑胶囊 | todo | [截图](sources/screenshots/2026-09-12-0047-skill-card-badge.jpg) | 09-09 拍过「镜头 N 标签行在图上方」，黑胶囊是另一处 |
| T-CV-08 | 常用文本节点被收进加号；左侧工具栏 hover 加号挡住后面节点 | todo | [原文 09-10 #5 #16](sources/2026-09-14-filehelper-transcript.md#09-10) | 过设计系统 §1.5 控件层级 |
| T-CV-09 | 声音节点连不上视频节点（有些视频能参考音频，如 Seedance 2.0） | todo | [原文 09-10 19:43](sources/2026-09-14-filehelper-transcript.md#09-10) | 根因已定位：一条共享规则写死（`anchorPolicy.ts` + `referenceEdgeCapability.ts`）；音频模型也该多接几个 |
| T-CV-10 | ComfyUI：音频输入用不了（缺 `LOAD_AUDIO_RE`）；节点参数确定后不能再改 | todo | [原文 09-10 19:43](sources/2026-09-14-filehelper-transcript.md#09-10) | — |
| T-CV-11 | Alt + 拖动复制节点；添加节点菜单能排序、常用前置 | todo | 群反馈（核心用户 A） | 小 |
| T-CV-12 | 「默认加入运镜很难受」：先查是不是自动加的，能删就删 | todo | [原文 09-12 15:38](sources/2026-09-14-filehelper-transcript.md#09-12) | **没人查过**；不是自动加的话要设计反馈验证用户到底用不用 |
| T-CV-13 | Group / Frame 命名双轨：UI 叫 Frame，数据类型仍叫 `NodeGroup` | todo | [设计实扫](designs-not-yet-built.md) | 卫生项 |

## D. 设计落地（界面大改）

> 09-08 用户原话：「我很希望把我们设计好的、拍板了的**真实地做进去**。」UI 一次只跑一项。逐面实扫见 [designs-not-yet-built.md](designs-not-yet-built.md)。

| ID | 一句话 | 状态 | 来源 | 下一步 |
|---|---|---|---|---|
| T-DS-01 | **全局左侧栏**（整组零代码）：顶栏五功能簇收进常驻左栏 + 资源抽屉 + 窄屏区间 | todo | [设计](../design/2026-09-08-left-sidebar-canvas-nodes-process-feedback.md) · 用户 09-08 已拍板画布 | 最大一单；按 A-1 抽屉化去重 → A-2 全局左栏+删顶栏 → A-3 创作面文稿条分阶段 |
| T-DS-02 | Agent v4 两条分隔线：A3 阶段分隔线、A6 压缩分隔线带轮数 | todo | [偏差清单](../design/2026-09-06-agent-panel-design-lab-deviations.md) | 小；其余 A 类已落 |
| T-DS-03 | v4 偏差 B3–B6（两个「几镜」打架 / 折叠尾 / 价格行 / 计划失败卡）判不了 | todo | 同上 | 跑 `design-lab.html?screen=agent-panel` 逐格比对 |
| T-DS-04 | 借结构（把一条跑量片变成我的分镜）：只有设计，零代码 | todo | [设计](../design/2026-09-08-borrow-structure-design.md) | — |
| T-DS-05 | **分镜面一串交互 bug**（09-12 一次撞出十几条）：8 镜卡不能取消只能确认 / 收起无效 / 对话框不能滑 / 执行计划删不掉 / 「生成中」文字看不清 / 点 01 是选中点左侧 icon 是跳过 / 换画幅全换 / MiniMax H3 不能选画幅 / 首帧模式两个小框 / 统一模型把图和视频堆一起 / 移到场·交给 Agent·锁定 可删 / 时长太宽 / 参考槽截断 / 「仍要生成」无反应 / 关键帧不是视频 / 「添加参考」浮层整体离谱 | todo | [截图](sources/screenshots/2026-09-12-0006-storyboard-plan.jpg) · [原文 09-12](sources/2026-09-14-filehelper-transcript.md#09-12) | 分镜 v6 设计**已经落了**，这些是交互 bug 不是设计缺口；按面拆两三个 PR |
| T-DS-06 | **拆解联动表**（新面）：上视频下表格，表格跟播放自动滚动，停一边另一边停 | todo | [原文 09-13 21:15](sources/2026-09-14-filehelper-transcript.md#09-13)（4 张参考图本机没有原图） | 下一版；和 `reelbench/video-shots` skill 对照后先出样张 |
| T-DS-07 | 导演台：进来不知道怎么用（WASD）；「热闹十字街道」输出很差 | todo | [截图](sources/screenshots/2026-09-12-0205-director-stage.jpg) | 教学 / 空状态引导 |
| T-DS-08 | 技能库：15 个技能还没封面；列表式排版空间浪费 | todo | [原文 09-12 01:08](sources/2026-09-14-filehelper-transcript.md#09-12) | 封面规则与锚图已定，按已批规则补齐 |
| T-DS-09 | 项目卡「可在另一台电脑继续」徽标换行挤在卡片下沿 | todo | [截图](sources/screenshots/2026-09-12-0045-project-library-badge.jpg) | 小 |
| T-DS-10 | 创作三栏各不相同不搭配；Nomi 栏空间浪费；时间轴无法向下缩、右上功能栏遮挡 | todo | [原文 09-10 02:09 / 13:45](sources/2026-09-14-filehelper-transcript.md#09-10) | 三栏统一那条要等 T-DS-01 |
| T-DS-11 | 剪辑面 T2（转场选择器 / 右键菜单 / 字幕样式）落没落**不知道** | todo | [设计实扫](designs-not-yet-built.md) | 先核实再排 |
| T-DS-12 | 两份设计文档的状态抬头已过期（`2026-09-09-agent-process-state…` 写着「未实施」、v6 合同写着「未接真数据」） | todo | 同上 | 改抬头，一分钟的事 |

## E. 素材与导入

| ID | 一句话 | 状态 | 来源 | 下一步 |
|---|---|---|---|---|
| T-MD-01 | 素材拖不进画布 / 拖不进 prompt 框 / `@` 无反应 / 预览界面拖不进 | doing | [原文 09-10 #9 · 09-12 #4](sources/2026-09-14-filehelper-transcript.md#09-12) | 入口矩阵 + 单一 owner 在写 |
| T-MD-02 | 素材库搜视频出来的封面坏；skill 图不加载 | todo | [原文 09-12](sources/2026-09-14-filehelper-transcript.md#09-12) | 与 T-MD-01 可能同根（媒体预览管线） |
| T-MD-03 | 资产库与剪辑区的交互没了（「和我们以前的都不太一样」） | todo | [原文 09-10 #17](sources/2026-09-14-filehelper-transcript.md#09-10) | 先核实是回归还是从没有过 |
| T-MD-04 | 真实素材（4K HEVC 1.38GB）：S 档 24 图 + 24 视频，20 秒都进不了画布 | doing | [原文 09-13 05:42](sources/2026-09-14-filehelper-transcript.md#09-13) | 旧夹具用色块且绕过导入，从没撞到；门岗 `check:real-media-fixture` 已进 #780 |
| T-MD-05 | 「提取深度」不问确认直接下模型 / 冒出无关图片节点 / 下载卡住 / 视频节点变黑 | todo | [原文 09-12](sources/2026-09-14-filehelper-transcript.md#09-12) | 要核 |

## F. 设置 · 接模型 · MCP

> 群反馈里出现最多的主题就是「接模型 / 自建中转适配」。

| ID | 一句话 | 状态 | 来源 | 下一步 |
|---|---|---|---|---|
| T-MO-01 | 写完 key 没像以前一次性打开所有模型；「已有预置地址模型」没有列表，AI 侧也选不到 | doing #788 #786 | [原文 09-10 #4 · 09-13](sources/2026-09-14-filehelper-transcript.md#09-13) | 合 |
| T-MO-02 | **接入验证一直转然后全部失败**：`store.mutate` 文件锁自旋超时 + `process()` fire-and-forget 无 catch → `certifying` 永久卡死、cancel 被拒 | todo | [原文 09-12 01:26](sources/2026-09-14-filehelper-transcript.md#09-12) | **清单里最久没人接的 P0**（远端从没这条分支）；先核实免费自检是否走同一条路 |
| T-MO-03 | 供应商切一次再切回来跳回 ApiMart；要记住上次选择；不用的会员模型一直占位；模型框同名不同商难分 | todo | 群反馈 · [原文 09-10 19:43](sources/2026-09-14-filehelper-transcript.md#09-10) | 09-06 已拍板「模型框排序去重」，没落 |
| T-MO-04 | 点进供应商的模型大页面：线条太多、既然已经接入了这页到底干嘛的 | todo | [原文 09-12 #5](sources/2026-09-14-filehelper-transcript.md#09-12) | 设计题，先想清它存在的理由再改 |
| T-MO-05 | MCP 接模型工具面收成 4 个工具（一个工具 = 一种后果） | doing #754 | 09-11 基线：入参写对 62%、回合成功 1/9 | 用 `pr754-clean` 开新 PR 取代 #754；验收 = 夹具 ≥90% |
| T-MO-06 | 不在列表里的 AI 客户端也该能连 MCP（我都没装 pi，它却显示可连） | todo | [原文 09-12 · 09-13](sources/2026-09-14-filehelper-transcript.md#09-13) | 部分归 #783 |
| T-MO-07 | 接入验证效率：并行 + 每模型 30s 超时 + 部分成功语义 + 只重测失败的 | todo | [原文 09-12 01:26](sources/2026-09-14-filehelper-transcript.md#09-12) | 业界共识形状（LiteLLM / TokenHub / model-check 都这样）；排在 T-MO-02 之后 |
| T-MO-08 | 用户接中转站最痛的是「手抄 20 个模型名」——pi-ai provider 的 `resolve` **原生就能自动发现**，我们没用 | todo | [pi 生态调研](sources/2026-09-14-pi-ecosystem-gaps.md) | A 类（原生就有）；先确认发现走 `resolve` 而不是第二个出站点 |
| T-MO-09 | `pi-ai` 的 `ProviderConfig`/`Model` 还没做逐字段裁决，上游加字段今天拦不住 | todo | 同上 | 补进 `docs/engineering/framework-boundaries.json` |
| T-MO-10 | 接入验证会扣积分（花钱却没过报价卡） | todo | 09-11 群反馈 | 违反「钱的闸」，要么免费自检要么先问 |

## G. 生态与插件

> 用户 09-14 原话：「重点是我希望我们要思考这类**生态插件怎么快速补齐我们的基本能力**，而不是重复造轮子。」

| ID | 一句话 | 状态 | 来源 | 下一步 |
|---|---|---|---|---|
| T-EC-01 | **插件宿主方案拍板**：抄 Dify 反向调用（插件永远拿不到 key）+ Zed 两把锁 + Figma `networkAccess{域名, 理由}` | hold 📋 | [方案 + 11 家调研](sources/2026-09-14-plugin-host-plan.md) | **等用户点头两件**：抄这套对不对；值不值得先做「第三方代码挪出主进程」这次改造 |
| T-EC-02 | 零成本探针：`utilityProcess` 子进程 + 反向调用 + 两个真包（`pi-web-search` 等）实跑 | hold | 同上 | T-EC-01 点头后的第一步，**不是**先写产品代码 |
| T-EC-03 | **联网读素材**（唯一真能力缺口）：Agent 今天做不了「去网上找一张参考图 / 读一篇文章改成分镜」 | todo | [pi 生态调研 §2](sources/2026-09-14-pi-ecosystem-gaps.md) | 形状建议 `nomi_web_read` 只读不搜、走模型厂商自带 search、产物打 `web_fetched/untrusted`、不给 bash 开网。**碰外部契约+花钱+安全面三件，派工前先 grill** |
| T-EC-04 | 回放夜跑的输入还挂在旧格式上，R30 两个数字（工具写对率/回合成功率）没从真相源取料 | todo | [同上 §1](sources/2026-09-14-pi-ecosystem-gaps.md) | 给 `replayShadowSources.mts` 补 pi JSONL 适配器，旧三个 legacy 适配器随迁移期结束一起删 |
| T-EC-05 | 轨迹导出没有产品入口（今天只会 `shell.openPath` 打开目录） | todo | 同上 · T-AG-11 | **不另造格式**：对 pi session JSONL 做字段过滤，复用已有的 redaction |
| T-EC-06 | `check:prior-art` 只数「有几条带出处」，不看查了哪几个池子 | todo | [同上 §4](sources/2026-09-14-pi-ecosystem-gaps.md) | 改成「框架原生 / 生态 npm / 我们自己」三个子节各至少一条四段式；不新建门岗 |
| T-EC-07 | 内置技能库继续扩充：收市场验证过的 GitHub 技能/提示词 | todo | 09-07/09-08 用户点名 | 只收 MIT/CC，按 SKILL.md 标准，预览媒体走 frontmatter 自定义键 |
| T-EC-08 | 技能导入要能直接上传文件（zip / SKILL.md）——解析 09-01 已修，**入口可发现性未验** | todo | 群反馈 | 真机走一遍导入闭环 |
| T-EC-09 | 底层架构：什么时候把生态 package 纳进来 | hold 💬 | [原文 09-14 00:18](sources/2026-09-14-filehelper-transcript.md#09-14) | 与开放战略同题；T-EC-01 拍板后自然有答案 |

## H. 剪辑

| ID | 一句话 | 状态 | 来源 | 下一步 |
|---|---|---|---|---|
| T-ED-01 | 时间轴：收不回去 / 拉上来太大 / 右下缺一块 / 跟着右侧 Agent 面板左右变动遮挡左边 | todo | [截图 09-13 19:27](sources/screenshots/2026-09-13-1927-layout-split-and-surface-error.jpg) | 用户说核心只要**两条轨（图片轨 + 视频轨）能拖动预览**就够；与 T-RL-06 同一面，一起修 |
| T-ED-02 | 让 Agent「劈成两半」：它说要确认卡、卡没出现、也没劈 | todo | [截图](sources/screenshots/2026-09-12-0043-edit-split-confirm-card.jpg) | 与 T-AG-04 同根 |
| T-ED-03 | 剪辑数据模型重写（动态轨道 + 稳定 id/别名 + 关键帧形状；一次性原子切换不留两套） | hold | 09-11 已拍板方向 | **用户说不着急**；第一刀纵向切片 = 口播 + B-roll + 闪避 |
| T-ED-04 | MotionClone：给定视频生成可编辑的 motion 进时间轴 | hold | [原文 09-13 22:04](sources/2026-09-14-filehelper-transcript.md#09-13) | 与「深度视频 = 剥掉外观的动作参考」同族 |
| T-ED-05 | 竞品研究方案包（剪辑综合提升 + 竞品调研）只在桌面，**仓库里没有** | todo | [原文 09-11 02:03](sources/2026-09-14-filehelper-transcript.md#09-11) | 并进主线计划或明确不做 |

## I. 测试系统与门岗

| ID | 一句话 | 状态 | 来源 | 下一步 |
|---|---|---|---|---|
| T-QA-01 | R13「四件真实」（真实应用 / 真实页面输入 / 真实工具轨迹 / **真实素材**）的**执行面**：还没有一条走查真的跑用户那 1.38GB 素材 | doing | [原文 09-13](sources/2026-09-14-filehelper-transcript.md#09-13) · 规则进了 #780 | 规则已成，缺人跑 |
| T-QA-02 | Agent 的 Playwright 真实 case：等待输出 + 各种矩阵状态 | todo | [原文 09-14 01:52](sources/2026-09-14-filehelper-transcript.md#09-14) | 与 T-AG-10 同一件的执行面 |
| T-QA-03 | 另一个 AI 给的 6 条测试规则与我们的 R13 冲突（它禁 computer use / Playwright MCP） | done | [原文 09-13 22:02](sources/2026-09-14-filehelper-transcript.md#09-13) | 已裁决：**保留 R13 真机走查**，吸收它的「先让脚本稳定复现再改码」与「用 getByRole/getByTestId」 |
| T-QA-04 | 门岗按风险分档（本地 contracts + 改动相关测试，全量交 CI） | done | [原文 09-12 00:45](sources/2026-09-14-filehelper-transcript.md#09-12) | 已在 `scripts/validation-policy.mjs` + CLAUDE.md |
| T-QA-05 | 体感回归机制：叠 / 裁 / 拦 / 出视口 / 对比度断言库 + 旅程夜跑 | todo | 09-09 用户要求 | 「这类问题不能再发生」；发现即断言 |
| T-QA-06 | agent-runtime 两条 flake（laneFixture ENOTEMPTY / G3b③ 挂 runner）治根 | todo | 09-08 多位工人独立撞到 | — |
| T-QA-07 | Ponytail 评审欠账：Codex 额度耗尽期间全走 `DEFER` 留痕 | todo | 09-14 环境 | 额度回来后 `check:ponytail-review` 一直红到补审 |
| T-QA-08 | 走查自动录屏：Playwright 起 Electron 时开 `recordVideo`，每个窗口出 webm；截图采样漏掉的过程态（导入渐显空等、停止→回执的间隙）靠视频看，同时留下演示素材 | todo | 用户 09-15 00:2x 口述（Windows 测试机接通时） | 改 `tests/ux/_launchApp.mjs` 一处；动手前按 R5 查 Playwright 当前文档确认 `electron.launch({ recordVideo })` 形状；视频不进 git，放 evidence/scratchpad，PR 贴关键帧 |
| T-QA-09 | Windows 测试机接入走查：192.168.31.216 已可 SSH（用户 23732），在 D: 建 worktree 跑 R13；SSH 会话 0 截不到桌面，Nomi 窗口截图/录屏走 Playwright，整桌面要计划任务塞进登录会话 | doing | 09-15 00:2x 接通；记忆 `windows-test-machine-ssh` | 先清 C: 上二十几个旧 Nomi-* 目录腾空间（C: 剩 8GB），再建 D:\Nomi-walkthrough |

## J. 官网与发布

| ID | 一句话 | 状态 | 来源 | 下一步 |
|---|---|---|---|---|
| T-WB-01 | 官网四件：SEO / 页面设计 / 官方文档 / 功能速递介绍视频 | todo | [原文 09-14 00:14](sources/2026-09-14-filehelper-transcript.md#09-14) | 对标 MiniMax Design 的 X 运营与官网、TapNow、libtv |
| T-WB-02 | logo 与真实产品不一致 | doing #788 | [原文 09-13 19:12](sources/2026-09-14-filehelper-transcript.md#09-13) | 合 |
| T-WB-03 | 产品发布会：PPT（对标 Apple）+ 逐字稿 + 图片/视频素材 + 特效 + 音乐 | hold | 09-08 用户加入，排最后 | **先写逐字稿**（逐字稿就是定位练习）；demo 段全部真机录屏，片子尽量用 Nomi 自己做 |
| T-WB-04 | 每周 RC 的发版时钟；`docs-autosync` 从来没能开 PR（仓库设置禁止 Actions 建 PR），**债已经攒出来了**：09-14 实测 `origin/main` 上 `check:docs-index` 超基线 136 篇、`check:doc-status` 超基线 101 篇 | todo | 09-07 裁决 · 09-09 实核 · 09-14 实测 | 这两个门岗在 `gates:contracts` 里是 advisory 所以没人看见；**要么用户开「Actions 可建 PR」，要么手工 cherry-pick `docs/autosync-*` 分支补齐** |

---

## 附：这份表**故意不收**的东西

- **纯一次性的排障记录**（某个 CI 为什么红、某个 worktree 怎么清）→ 归 `docs/lessons/`。
- **已经有独立方案文档在跑的大件**（Goal 模式、剪辑数据模型重写）→ 这里只留一行指针，细节别抄过来，抄了必漂。
- **用户没说过、我自己觉得该做的事** → 先去问，别先进表。表里每一条都要指得出来源。
