# Nomi 迭代 TODO —— 唯一真相源

> 状态：🚧 进行中 — 这份文件**长期活着**，状态变了就改这一份。基准 `origin/main @ 18641f951`（#805 合入），最后盘点 2026-09-18（批次 3 收尾）。
> **派工、出方案、开分支之前先对照这份表**；某条看不懂或觉得写错了，回查它「来源」那一列（[sources/](sources/) 是原始资料，[designs-not-yet-built.md](designs-not-yet-built.md) 是设计落地实扫）。用法与维护纪律见 [README](README.md)。

**状态口径**：`doing` 有分支/PR 在写 · `todo` 该做没开工 · `hold` 要先聊/等别的东西 · `done` 已合 main（写 PR 号）。
**ID 不回收**：做完了把状态改成 `done`，别删行——删了下次又会有人重新发现同一件事。

---

## A. 发版主线（这版必进）

> 用户 09-14 原话：「主线是尽快推一版：合 PR + 核心 bug。」验收 = MiniMax H3 **1 分钟**短片真实闭环。

| ID | 一句话 | 状态 | 来源 | 下一步 |
|---|---|---|---|---|
| T-RL-01 | 合并列车：open PR 逐个过 CI 合进 main | doing | 09-14 拍板 | #802 已合入 main（merge SHA `71b38b8fa`，`delivery:verify-merged` 收据在 `.git/nomi-delivery/merged-main/71b38b8fa.../ci-evidence.json`）；#782 / #783 / #768 / #790 / #786 与反馈回路已在 `integration/release-20260917` 删冲突部分后重整，#754 / #799 延后 |
| T-RL-02 | Agent 做不出图/视频：动词被翻成适配器白名单里没有的名字 → 恒 `generation_surface_unavailable` | done #797 | [截图](sources/screenshots/2026-09-13-1927-layout-split-and-surface-error.jpg) · [原文 09-12](sources/2026-09-14-filehelper-transcript.md#09-12) | 已合；#777 已关。剩余矩阵夹具见 T-AG-10 |
| T-RL-03 | 视频拆解全失败：付费出口没穿 `grantId`，错误被吞 | done #804 | [原文 09-12](sources/2026-09-14-filehelper-transcript.md#09-12) | 已合入 `integration/release-20260917`：保留「付费出口一律带 grantId」主体，按用户拍板删掉「最短镜头长度按源片 fps 派生」与那条 12fps 用例（碎镜那条由 #795 的 0.1s 量化解掉，不留并行判据） |
| T-RL-04 | 设置页 7–8 个冗余区块全删 + 供应商默认放行 + 系统提示词搬进模式弹层 | done #781 | [原文 09-12/09-13](sources/2026-09-14-filehelper-transcript.md#09-12) | 已合 |
| T-RL-05 | MCP 连接真实性五 bug（只打开 tab 就静默改写本机 5 个全局配置等） | done #804 · 09-17 真实资料库真点验过四条判据 | [原文 09-13](sources/2026-09-14-filehelper-transcript.md#09-13) | 已合入 `integration/release-20260917`：保留 MCP 连接真实性修复，设置页以 #781 为准丢弃那一半。**仍需用户在真实 Nomi.app 点一次连接**验证 **批次 2 追加**：走查发现「配置目录在不在」就判已装，5 个空目录让 5 个客户端全显示可接入（W-15），已改成要求非空痕迹。 |
| T-RL-06 | 右侧 AI 栏 + 时间轴同时开 → 页面被切割、右下缺一块、面板没顶到底 | done #794 #796 | [截图 09-13 19:27](sources/screenshots/2026-09-13-1927-layout-split-and-surface-error.jpg) | 已合；停靠列 B 方案仍留下一版 |
| T-RL-07 | 「skill 能用」：选了 skill 回复里看得出被用、画幅/提示词跟着变 | done #800 | [原文 09-10/09-12](sources/2026-09-14-filehelper-transcript.md#09-12) | 已合 #800，证据 `docs/evidence/2026-09-15-skill-real-run/`；一次只能选一个 skill 仍归 T-AG-05 |
| T-RL-08 | 拆解出来的秒数一堆小数 | done #795 | [原文 09-12](sources/2026-09-14-filehelper-transcript.md#09-12) | 已合（`shotTime.ts` 0.1s 量化是唯一 owner） |
| T-RL-09 | 发版本身：0.21.0（8-27）仍是最新 release，主线积压三千多提交 | todo | 09-12 RC 切线拍板 | 列车合完打 RC；打包前置缺陷：`@anthropic-ai/sandbox-runtime` 原生二进制要 `asarUnpack` **且**显式递路径 |

## B. Agent 质量

> 用户 09-14 的验收句：「明显有问题的功能优化到可用 **+ Agent 优化到可用**」。

| ID | 一句话 | 状态 | 来源 | 下一步 |
|---|---|---|---|---|
| T-AG-01 | **Agent 缺「做事原则」**：直接让它出片时不建人物资产、不用参考图模式，怀疑 system prompt 原则没写好 | todo | [截图：Agent 自述「镜头语言规则用了、视觉锚引用没用上」](sources/screenshots/2026-09-12-0033-agent-self-report.jpg) | 这是用户猜的假设，**先验再改**：拿真实 case 跑一遍看它到底读了什么原则。已部分验证：#800 给身份层加了三句出片原则，22 句题库里「看得出技能被用」7/11 → 9/11；「不建人物资产 / 不用参考图模式」这两条仍未验 |
| T-AG-02 | 停止/复制/重试三个动作没有回执（停止实测 3–11ms 就生效，`onRetry` 从未接线） | doing #789 | [原文 09-13 19:32](sources/2026-09-14-filehelper-transcript.md#09-13) | 合 |
| T-AG-03 | 聊天框四件：一直写字框不变大 · 发送/模式按钮突然跳到左边 · 模式弹层点外面不关 · 一条回复被切成 3 段 | done | [原文 09-10 13:45](sources/2026-09-14-filehelper-transcript.md#09-10) | 四件全已修（写字框量高 / 右簇右锚 / 弹层 outside-close / 一回合一个气泡 3e7de5a86），TODO 原来那句「没有任何 lane 碰过」是陈旧描述 |
| T-AG-04 | 全自动档还弹付费卡；「工具回执说有确认卡、宿主没出卡」（让它剪辑劈两半那次） | done #808 | [截图](sources/screenshots/2026-09-12-0043-edit-split-confirm-card.jpg) | 归 v2 的「export 先确认卡」设计；两条路里删 `needs_spend_confirmation` 状态已拍板 **批次 2 根因定位，未改行为**：两条都在，机制不同。① 全自动档仍弹付费卡——`electron/productionRun/productionPendingSpend.ts:70-100` 的投影**完全不看档位**，只要 `plan.state==='draft'` 且 `cardHidden!==true` 就发卡；而按档位自动作答的 `decideByPolicyAfterDraft`（`generationTransportAdapters.ts:251`）只在 `cardShown` 之后才跑，且失败时**刻意把卡留在原处**（:245 注释）。另：`useAgentPanelAutoMode.ts:5` 的文案仍向用户承诺全自动「仍然会问…付费」，与 `spendDecidedByPolicy`（`capabilityApprovalPolicy.ts:144`）矛盾——先定哪句是真的再改。② 见 T-ED-02。`needs_spend_confirmation` 状态**早已删干净**，只剩磁盘迁移和一条守卫测试，不是这两条的成因。 **09-17 拍板（批次 3 实施，批次 2 只记）**：真话是 `spendDecidedByPolicy`——09-12 用户已拍「全自动档花钱也不问」。所以 ① `useAgentPanelAutoMode.ts:5` 那句「仍然会问…付费」是陈旧文案，删掉（zh/en）；② 修根因：`productionPendingSpend.ts:70-100` 的投影要**看档位**，全自动档直接按策略作答、不发卡；`decideByPolicyAfterDraft` 失败时把卡留在原处的行为**保留**（那是「策略答不了才问人」）。回归：全自动档 draft 不出卡、每步问档出卡。 **批次 3 已合 #808**：新增唯一 owner `capabilityCore/policySpendDecision.ts` 记「这一笔此刻由档位代答」，闸给出 `decisionFor(toolCallId)`，回执**从真实批准派生**而不是写死；`check:announced-card` 加 `hardcoded-card-claim` 规则；删掉 3 处写死的 `kind` 与 `useAgentPanelAutoMode.ts:5` 那段说反话的陈旧文案。另修全自动档真花钱腿的根因：`laneVerbTransport.draftShotToPlanShot` 把 `draft_shots` 声明的候选模型身份（`candidate.providerId` / `candidate.modelId`）直接丢掉，候选解析从 2 份实现收成 1 份 2 个调用点。真机两档（zh「只问花钱」出卡→确认→图落画布；en「全自动」零卡直接出图），真花 4 张 z-image-turbo + DeepSeek 约 8 回合，总额 < $1。 |
| T-AG-05 | 一次只能选一个 skill（skill 不随聊天发出那半已修：6b04d50db，chip 是引用、发完就摘） | hold | [原文 09-10](sources/2026-09-14-filehelper-transcript.md#09-10) | 只剩「多选 skill」未修：`useAgentPanelV4Actions` 的 `skillKey?: string` 仍是单值。与 T-AG-15 一起做 **批次 2 未做**（跨层改动，要动 IPC 契约 + 提示词组装 owner，不适合塞进体感修复批）。全链已扫清，实施只需照着改：渲染状态 `workbenchStore.ts:117` `creationActiveSkill` 单槽 → `useAgentPanelV4Actions.ts:78/125/161` `skillKey?: string` → 契约 `laneDesktopContracts.ts:24` + zod `laneDesktopInput.ts:30` → 注入 owner `agentContext.ts:93/132` `resolveRequestedSkill` / `buildSelectedSkillPrompt`（单条 `<skill>` 信封）→ chip `useAgentPanelV4Data.ts:261`（单条 push，与提示词库互斥）+ `/` 菜单 `ProjectAgentResidentShell.tsx:390/420/607`。另有轨迹投影 `laneProjection.ts:247` 与遥测 `agentChatTrace.ts:52` 两处随行。**与提示词库的互斥关系要一起定**：现在是「选了技能就不许选提示词」，多选之后这条规则怎么说，得先想清楚。 **暂缓 · 09-17 用户拍板**（不进这一版）。 |
| T-AG-06 | 废话文案：「已保存到项目」「运行命令」那串重复提示 | todo | [截图](sources/screenshots/2026-09-12-0027-canvas-saved-note.jpg) | 顺手 |
| T-AG-07 | skill 触发机制：官方怎么做 vs 我们怎么做 | hold | 09-12 派过研究，分支在远端，**结论没回来** | 先把那份结论捞回来再决定 |
| T-AG-08 | 怎么定义/评估/量化 **skill 结构**的质量（不是 skill 内容） | hold 💬 | [原文 09-14 00:12](sources/2026-09-14-filehelper-transcript.md#09-14) | 讨论题，别派工 |
| T-AG-09 | benchmark：剧本 / 资产 / 分镜 / 提示词 / 模型选择 / 模式选择 —— 专属 AI 生成视频的评价基准 | hold 💬 | [原文 09-13 19:46](sources/2026-09-14-filehelper-transcript.md#09-13) | 讨论题；它决定「Agent 优化到可用」怎么量 |
| T-AG-10 | 矩阵评测夹具：每个动词 × 每种画布状态 | todo | [原文 09-14 01:52](sources/2026-09-14-filehelper-transcript.md#09-14) | tool-face v2 合后的下一刀 |
| T-AG-11 | Agent 轨迹数据收集 + 隐私边界（今天的诊断包里**没有**转录，只有日志和模型目录） | todo | [原文 09-13 19:13–19:42](sources/2026-09-14-filehelper-transcript.md#09-13) | 先定「转录哪些字段能出门」，再谈上报；实现见 T-EC-05 |
| T-AG-12 | 快速反馈机制：出问题处就近弹「反馈给开发者」+ 信息过滤 + 让他愿意点的说法 | done #804 | [原文 09-12 #7 / 09-13 19:38](sources/2026-09-14-filehelper-transcript.md#09-13) | 已在 `integration/release-20260917` 重做并入（分支 `feat/feedback-loop-20260915` 曾被 `90a1139a5` 从列车撤出）：四个失败面同一颗钮、用户零输入（除一行可空留言）、默认关、创作内容默认不带、接收端 Worker 只收不回。projectId 由失败面在点下去那一刻给（不读「当前项目」）。与 T-AG-11 同一条链——没有轨迹时清单里写明 why **批次 2 追加**：走查发现两条 P0——出厂包没注入上报端点（W-01）、摘要是原始 i18n key 且随报文发出（W-02），均已修。Cloudflare 接收端**仍待用户本人部署**（命令见批次 2 PR 正文）。 **批次 3 核实**：Cloudflare Worker 已于 09-17 19:1x 部署（`https://nomi-feedback-intake.2373272608.workers.dev`，GET / 回 `nomi-feedback-intake`），仓库 secret `NOMI_INTAKE_ENDPOINT`/`NOMI_INTAKE_TOKEN` 均已设，`desktop-rc` 打包 job 不会因此红；批次 2 收尾报告里「仍未部署」那句读的是 17:40 的旧账本，已更正（`~/Desktop/nomi-scratch-0917/batch2/closing-report.md` 更正段）。 |
| T-AG-13 | Goal 模式 v1：一个 Run + 一条 lane，剧本进→成片出 | hold | 09-08 调研已收（PR #623），三条拍板已定 | 六条「没想到」是实施前置门；排在主线后 |
| T-AG-14 | 看片自评（Agent 最大能力缺口） | hold | 09-07 能力边界七缺口 | — |
| T-AG-15 | 提示词与 skill 整合（skill 已经把提示词装进去了） | todo | [原文 09-12 00:48](sources/2026-09-14-filehelper-transcript.md#09-12) | 先出方案 |
| T-AG-16 | 中文界面里工具失败提示仍是英文（如 "The action could not be completed. Next: …"） | hold 💬 | 2026-09-17 #802 列车收尾实测（#802 之前就存在） | 不是纯 i18n 补词条：这几句是**产品文案**（失败原因 + 下一步该干嘛），要用户先看一版中文措辞再落；落时走 R15，zh/en 两轨都要真截图 |
| T-AG-16 | 常驻 Agent 的长期身份改为窗口＋完整项目绑定，页面端口仅按动作解析；换项目、reload、窗口销毁永久撤销旧动作。09-17 实证：802 当前红灯另由文本存储准入、跨桥错误失真和节点尺寸投影触发，不能只凭错误名称归因旧端口 | doing | [09-16 上下文及09-17证据修订](sources/2026-09-16-session-identity-window-plus-project.md) · [获批实施方案](../plan/2026-09-17-pr802-root-causes.md) · Linux `resident-composer-receipt-fix` | 用户已批准 A 实际失败链＋B 项目会话全部修复合入；隔离依赖 B，因此完整会话及最终落盘守卫先验收，再合 802 |

## C. 画布与节点

| ID | 一句话 | 状态 | 来源 | 下一步 |
|---|---|---|---|---|
| T-CV-01 | 大画布卡：框选卡顿、60 张图拖组几乎动不了、右下角拖比例卡 | doing #763 | [原文 09-10/09-12](sources/2026-09-14-filehelper-transcript.md#09-12) | #787 只进了预览/海报媒体管线那半；按屏幕尺寸 LOD（S5）被撤出，见 T-CV-14。硬指标「长任务 249 → 个位数」仍不达标不算完 |
| T-CV-02 | 编组后点空白框就没了；框没拉环、拉环易丢；单击才出蓝色拉环 | todo | [原文 09-12 01:07](sources/2026-09-14-filehelper-transcript.md#09-12) | 磁吸「选中才出带子」是旧设计已拍板恢复；**「编组框丢」是另一件，要核** |
| T-CV-03 | 节点下面东西太多：只留 icon + hover 名称，运镜/更多挪右上，下面只放模型生成相关 | todo | [原文 09-10 #12](sources/2026-09-14-filehelper-transcript.md#09-10) | 与 #784 同一面；#784 样张已被退回「只收宽不改摆法」 |
| T-CV-04 | 视频节点却显示「几个图片」→ 要通用 ×1 ×2 数量控件 | todo | [原文 09-10 #11](sources/2026-09-14-filehelper-transcript.md#09-10) | 小 |
| T-CV-05 | 点节点后下方输入框来回漂移、被截断；参数挤在一起 | done | [原文 09-10 #10](sources/2026-09-14-filehelper-transcript.md#09-10) | 已修：输入框位置改成 stage/anchor/自然尺寸的纯函数（`anchoredPlacement.ts`，走查 `node-composer-placement.walk.mjs`）；参数面板摊开选项、浮层宽由内容派生（829e884cd + #784） |
| T-CV-06 | 画布里图片比例不对、上下有透明边 | done | [原文 09-12](sources/2026-09-14-filehelper-transcript.md#09-12) | 已合入 #825（b5cf48bc0）；含视频、卡片与 LOD，[验收](../plan/2026-09-20-canvas-image-aspect.md) |
| T-CV-07 | 徽标/角标看不清：分镜头左上右上徽标、技能卡黑胶囊 | todo | [截图](sources/screenshots/2026-09-12-0047-skill-card-badge.jpg) | 09-09 拍过「镜头 N 标签行在图上方」，黑胶囊是另一处 |
| T-CV-08 | 常用文本节点被收进加号；左侧工具栏 hover 加号挡住后面节点 | todo | [原文 09-10 #5 #16](sources/2026-09-14-filehelper-transcript.md#09-10) | 过设计系统 §1.5 控件层级 |
| T-CV-09 | 声音节点连不上视频节点（有些视频能参考音频，如 Seedance 2.0） | done | [原文 09-10 19:43](sources/2026-09-14-filehelper-transcript.md#09-10) | 已修（f03b949e0 + d1b1a8e82，早于 #802）：参考边分类器认音频、音频参考槽三选一门岗；「写死的共享规则」那句已陈旧——视频档案已按模型声明 `audio_ref`，剩余只是给更多模型补槽 |
| T-CV-10 | ComfyUI：音频输入用不了（缺 `LOAD_AUDIO_RE`）；节点参数确定后不能再改 | todo | [原文 09-10 19:43](sources/2026-09-14-filehelper-transcript.md#09-10) | — |
| T-CV-11 | Alt + 拖动复制节点；添加节点菜单能排序、常用前置 | todo | 群反馈（核心用户 A） | 小 |
| T-CV-12 | 「默认加入运镜很难受」：先查是不是自动加的，能删就删 | done | [原文 09-12 15:38](sources/2026-09-14-filehelper-transcript.md#09-12) | 不是自动加的：运镜控件已整个删除（c1b1c9e02 删 `NodeCameraMoveControl.tsx` -284 行），画布节点默认值里零命中 |
| T-CV-13 | Group / Frame 命名双轨：UI 叫 Frame，数据类型仍叫 `NodeGroup` | todo | [设计实扫](designs-not-yet-built.md) | 卫生项 |
| T-CV-14 | 画布「按屏幕尺寸判 LOD（S5）」重做：#787 的这半在列车里被撤出（`3a72f0ce7` 由 `fae43a80e` + `29e232a31` 撤回），main 仍是「节点数 > 80 且 zoom < 0.55」的老判据 | todo | #787 · #802 正文「进过批次又撤出去的」 | 2026-09-17 查清根因是**两条**：① 契约漏了一格——`data-status` 只长在全套 chrome 上，卡片掉档就没了（已在 `integration/release-20260917` 修：轻量档补齐身份三件套 + 测试钉住，走查的「等不到 success」自此不再是假红）；② 产品行为——那一刀规定「有结果媒体才准进轻量档」，于是卡片**生成完成那一刻外观掉档**，掉档时机是设计决策（R8 要样张拍板），这半仍未做 |
| T-CV-15 | 独立镜头号重复，首帧/视频与 Agent 指代一致性 | done | 2026-09-20 用户会话，共号并区分角色已拍板 | [方案](../plan/2026-09-20-shot-number-identity.md)：已合入 #825（b5cf48bc0）；模板/粘贴/恢复和 UI/Agent 复用共享 owner，旧日志回放已审计修复 |

## D. 设计落地（界面大改）

> 09-08 用户原话：「我很希望把我们设计好的、拍板了的**真实地做进去**。」UI 一次只跑一项。逐面实扫见 [designs-not-yet-built.md](designs-not-yet-built.md)。

| ID | 一句话 | 状态 | 来源 | 下一步 |
|---|---|---|---|---|
| T-DS-01 | **全局左侧栏**（整组零代码）：顶栏五功能簇收进常驻左栏 + 资源抽屉 + 窄屏区间 | todo | [设计](../design/2026-09-08-left-sidebar-canvas-nodes-process-feedback.md) · 用户 09-08 已拍板画布 | 最大一单；按 A-1 抽屉化去重 → A-2 全局左栏+删顶栏 → A-3 创作面文稿条分阶段 **批次 3 已合 #808 的 A-1**：创作左栏可收起（三态用户偏好 `creationResourceTreeCollapsedPreference`，默认创作展开 / 分镜收起），一对收起展开钮由 `CreationResourceTreeToggle` 独占；同 commit 删三份并行实现（`max-[1180px]:w-[200px]` 窄档让步、`DocumentListSidebar` 的外框分叉、`StoryboardWorkspace` 自带的那份内边距）。A-2（全局左栏 + 删顶栏）与 A-3 仍未开工。 |
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
| T-DS-13 | 同一分钟新建的两个项目自动名完全相同（都叫「未命名项目 09/17 05:10」），只看顶栏分不清在哪个项目 | done 批次2 | 2026-09-17 #802 列车收尾实测 · 同 [走查 W-10](../audit/2026-09-17-post-804-walkthrough.md) | 已修（`3d78d058d`）：默认名查一次现有索引，撞了才加序号——按「随输入 derive」，不是改成固定的秒级格式。缩略图与状态行**不改**：新项目的占位图和「刚刚」本来就该一样，它们没有身份可言，名字才是那一格 |
| T-DS-15 | 视频拆解可切模型：付费卡参数行 + 画布视频节点拆解参数条两处（同一组件，同一参数）；视觉/转写各一行；默认=上次选过的（复用 #682 偏好）→ 回落大脑(优先能读图)；不做逐行模型列、不进设置页 | todo | 09-17 用户拍板 | 批次 2 之后、发版前；现状 `electron/video/deconstructVideo.ts:305` 绑在 resolveTextBrainKeys 另两条一起放这里（09-17）：① 转写语言做成**用户可选**（批次 2 只修了默认随界面语言派生，`deconstructVideo.ts` 的 `transcribeLanguage()`）；② 视觉默认不该落到 Moonshot vision-preview 这种会 30s 无首字的模型——首字预算对带图调用要**实测后**定，不许拍脑袋把 30s 抬上去。（协调方原话把这两条挂在 T-DS-13 上，但那个号已被「同一分钟同名项目」占着且本批已 done，按「ID 不回收」改挂这里。） |
| T-RL-11 | 视频拆解：转写模型解析绑在文本大脑的供应商上 → 大脑是 Moonshot 就报「没有可用的转写模型」；转写语言写死 `zh` | done 批次2 | 09-17 真机失败日志 09:51Z · 用户点名 | 已修：`findExecutableModelAnyVendor('audio', 供应商偏好)` 在**所有已启用供应商**里解，报价卡那一行仍由同一个 `findExecutableModel` 解出，与 runTask 真扣费的是同一行；language 改成随界面语言派生并进 spend plan 的 parameters。回归测试 `electron/video/deconstructLegResolution.test.ts`（含反面：只在大脑那家找会抛） |
| T-MO-14 | 异步图片中转：`newapiTransport` 把 image 写死成同步 | todo | 09-17 顺带发现 | 批次 2 不修（只记）。中转站按 key 接进来之后，异步出图的那一类会走错分支 |
| T-MO-15 | **本地转写**：新增 `local-speech` 供应商（sherpa-onnx 或 whisper.cpp 二进制随 app 走），走现有 audio 档案的 transcribe 模式，与 APIMart Whisper / ElevenLabs 同一解析器，用户在 T-DS-15 那行选「本地」；零成本、不出网、离线可用；拆解 / 口播剪辑 / 字幕三条线共用 | done #808 | 09-17 用户拍板 | 批次 3 之后；先查别人（R5：sherpa-onnx vs whisper.cpp vs Apple Speech，各自 M 系速度/中英准确率/包体），再出接入方案；现状：仓库从未有过本地转写，转写只有 `apimartAudios.ts` 与 `elevenlabs.ts` 两条云端。（协调方原话给的号是 T-MO-11 / T-DS-13，两个号都已被占用且都是 done 行，按「ID 不回收」改用这两个号。） **批次 3 在做**：`feat/local-speech-provider-20260917` 已并入 `integration/batch3-20260918`——whisper.cpp sidecar 接成 transcribe 的第三个 provider，下载/校验与 Depth 共用唯一 owner `electron/downloads/verifiedAssetCache.ts`，供应链版本钉登记 + `check:supply-chain-pins` 门岗，拆解链上穿了转写线选择/进度/失败类别。**未定**：二进制自托管（现在从上游钉版下载）；**后续**：本地引擎三来源（自带 / 用户自备 / 系统内置）那条按 `local-engine-bring-your-own-brief.md` 另排。 **批次 3 已合 #808**：whisper.cpp sidecar 接成 transcribe 第三个 provider（只留 large-v3-turbo 一档，另两档实测幻听 / 输出繁体已删）；下载校验抽成唯一 owner `electron/downloads/verifiedAssetCache.ts`（同 commit 删掉 `depthVideoModelCache` 那份重复实现）；供应链版本钉登记 + `check:supply-chain-pins`；收尾又补了 VAD（片头静音会让引擎幻听复读并吞掉随后约 72 秒真人讲话）与「门岗 scope 指到不存在目录会静默空扫」两条根因。真机：mac 12.1× 实时 / Windows 11 约 1× 实时、sha256 逐字相同、中英混段 CER 6.5%。**未验**：云端同素材质量对照记 `unverified`；二进制自托管仍待拍板。 |
| T-MO-16 | **目录未标价的模型**：报价卡印「目录未标价」却放行，回执也无金额（实测 MiniMax H3 一单真扣 4.572 credits，用户只能去 APIMart 后台查） | todo | [付费走查 09-17 §6.6](../audit/2026-09-17-post-804-walkthrough.md) · 09-17 用户拍板 | **拍板：放行，不加任何拦截**（用户原话「可以放行全自动 我们也没法给他计算所有中转的」）。只剩两条要求：① 报价卡与回执上明写「Nomi 无法报价，供应商按实扣」——不印「目录未标价」这种读起来像 bug 的话；② 每步问 / 自动改两档下仍要用户明确点一次；全自动档照 09-12 拍板放行不问 |
| T-AG-17 | 付费卡在**空提示词**时照样让你确认，确认完才说「请先写点提示词」 | todo | [付费走查 09-17](../audit/2026-09-17-post-804-walkthrough.md) | 校验应在**出卡前**：能本地判定必然发不出去的请求，不该先走一遍钱的闸 |
| T-AG-18 | 冷启动落画布（创作页从未挂载）→ Agent「读一下文稿」→ `read_script` 报 `surface_port_stale`，重试三次熔断，整条会话报废；画布上 `write_script` 同根（`document_target_stale`）；外部 MCP `nomi_document_read` 同根 | doing 批次 2（`integration/batch2-20260917`） | 09-17 真机复现 `B03/B04/B05`（派工现场 `~/Desktop/nomi-scratch-0917/batch2/surface-port-stale-repro.md`）+ 24 契约普查 | **结构根因已修**：文稿端口 owner 上移到 `src/workbench/project/documentSessionPort.ts`（基线随项目、编辑器只做增强覆盖），删 `creationDocumentTools`/`isDocumentSurface`/`document_target_stale`；熔断随下一条用户消息清零；门岗 `check:capability-lifecycle`；合同 `docs/fixes/2026-09-17-document-capability-owner-project-session.root-cause.json`；教训 `docs/lessons/capability-bound-to-component-lifecycle-reports-stale.md`。合入 main 后改 done。走查里「19 工具/6 重试/2 镜空提示词」的 6 重试是本根因的下游；T-AG-01 的「做事原则」另案，本条不碰 |
| T-AG-19 | 拒绝话术只对人说、不对 Agent 说：工具错误写「请到设置里选模型」，而调用方是程序，它点不了设置只能卡住 | todo | 09-18 批次 3 收尾 | 全仓扫一遍这一族：凡是返回给 Agent 的错误都要同时给它自己能走的那条路（例如「也可以在调用里直接点名 `candidate`，可用值见 `list_models`」）。人类面与模型面是两个受众、两份文案，别共用一个字符串。教训 `docs/lessons/refusal-text-must-also-tell-the-agent-a-path.md` |
| T-AG-20 | 界面切成 English 后，模型仍然用中文回话（用户那句是英文） | todo | 09-18 批次 3 收尾 | 批次 3 fullauto lane 真机撞到，**没查根因**；先定位是系统提示词里写死了语言，还是 locale 没进请求 |
| T-AG-21 | `useAgentUsageStore` 的 token 是跨项目累计的（六条 C 里显式标了 `process` 寿命） | todo | 09-18 批次 3 收尾 | 要一句拍板：默认改成「按项目 / 会话归零」还是保持全局累计。今天的写法让用户看到的数字不对应他正在做的这个项目 |
| T-ED-06 | 拆解中断后分镜表节点**永久卡死不报错** | todo | [付费走查 09-17](../audit/2026-09-17-post-804-walkthrough.md) | 终态保证缺一条：每个节点必须落到成功/失败/可找回三者之一，没有「永远在跑」这一格 |
| T-ED-07 | `edit_timeline` 的卡说不清它要改什么：只有通用能力卡，没有逐条摘要与计划高亮带 | todo | 09-18 批次 3 收尾（F 块 lane 换锚点后暴露） | 产品问题不是 bug：按 R8 先出样张再改；`agent-timeline-ops.walk.mjs` 保持红，红在这条真需求上 |
| T-DS-16 | 英文轨节点标签同时印「Shot 1」和「镜头 1」（R15） | todo | [付费走查 09-17](../audit/2026-09-17-post-804-walkthrough.md) | 一处标签两个来源，其中一个绕过了 i18n **09-18 批次 3 收尾真机 EN 截图又撞到同族第二处**：画布节点标题行的种类角标在 English 下仍印「图片」（`closing-shots/model-box-open-en.png`，与它并排的 `Shot 1` 已经是英文）。同一行里一半翻了一半没翻，修的时候一起扫。 |
| T-DS-17 | 拆解表画面六格失败时**一个字原因都没给** | todo | [付费走查 09-17](../audit/2026-09-17-post-804-walkthrough.md) | `visionFailed` 已经带着 `failureReason`，UI 没渲染它——不是没有原因，是没往外说 |
| T-DS-18 | 分镜面多选浮条 `sticky bottom-2` **永不生效** | todo | 09-17 W-03 工人结构性发现 | 浮条住在 `[data-storyboard-rows]` 里，而那个容器是 `overflow-hidden` → sticky 没有可滚动的定位祖先，等于普通静态定位。批量选中后浮条不跟随，用户滚下去就看不见它了。与 T-DS-14 同一片区域，一起改 |
| T-DS-19 | **分镜账本 B 退役**（`storyboardDesignsByDocumentId` 只剩用户手写方案；Agent 分镜已归 Run 账本 A，分镜表读落地节点） | todo · **到期 2026-10-16** | [方案 §8.3](../plan/2026-09-18-agent-storyboard-write-path.md) · 用户 09-18 拍板「合并成一个账本」 | 条件全满足才删：① B.3 分镜页/侧栏渲染 `shot_table(production)`（先出样张）② 外部 MCP 分镜 operation 收编到 `draft_shots`（与 #754 同刀）③ 删 `projectRepository.ts` 的 `starter-*` 起手架 ④ golden-path + 四条分镜走查在单一账本上全绿。到期未满足按 R17 算红——仓库没有通用到期门岗，到期由人核（§8.4 结构性发现） |

## E. 素材与导入

| ID | 一句话 | 状态 | 来源 | 下一步 |
|---|---|---|---|---|
| T-MD-01 | 素材拖不进画布 / 拖不进 prompt 框 / `@` 无反应 / 预览界面拖不进 | done #792 | [原文 09-10 #9 · 09-12 #4](sources/2026-09-14-filehelper-transcript.md#09-12) | 已合（四个入口收成 `mediaImportPolicy.ts` 单一 owner + 门岗 `check:media-import-owner`，矩阵 36 格全合格）；只剩「预览界面拖入」那一格四份证据里都没有、未覆盖也未证伪，另记在 T-MD-06 一起看；封面坏那条仍是 T-MD-02 |
| T-MD-02 | skill 图不加载（素材库搜视频出来的封面坏那半已修） | todo | [原文 09-12](sources/2026-09-14-filehelper-transcript.md#09-12) | 视频封面已由落盘边界派生 poster 修掉（`assetPreview.ts` 抽首帧 + `AssetVideoCover` 回落）；skill 画廊侧那条仍无独立证据，`SkillMedia` 的 onError→placeholder 是降级不是根因 |
| T-MD-03 | 资产库与剪辑区的交互没了（「和我们以前的都不太一样」） | todo | [原文 09-10 #17](sources/2026-09-14-filehelper-transcript.md#09-10) | 先核实是回归还是从没有过 |
| T-MD-04 | 真实素材（4K HEVC 1.38GB）：S 档 24 图 + 24 视频，20 秒都进不了画布 | doing | [原文 09-13 05:42](sources/2026-09-14-filehelper-transcript.md#09-13) | 1.38GB 进不了画布那半已修（矩阵 AFTER：四个入口全收，1317MB 原样落盘，10s HEVC 7.2s → 0.15–0.29s）；**真素材登记仍是债**：`real-media-fixtures.json` 四类 coverage 全 `status=debt`（`real-media-debt.json`，due 2026-10-14），S 档冷开/性能那半没有任何数字 |
| T-MD-05 | 「提取深度」不问确认直接下模型 / 冒出无关图片节点 / 下载卡住 / 视频节点变黑 | todo | [原文 09-12](sources/2026-09-14-filehelper-transcript.md#09-12) | 要核 **批次 2 核过了，结论是三件不同的事**（原「要核」已完成）：①「不问确认直接下模型」属实且**是当初的设计**——`NodeDepthActionButton.tsx:24` 点了直接跑，`docs/plan/2026-09-06-depth-video-canvas-node.md:460` 记着「点了直接跑」的拍板；下的是 Depth Anything V2 Small（~50 MB，HuggingFace 钉版 + sha256 校验，`videoDepthModels.ts`），全本地、不花钱。要不要为「第一次要下 50 MB」加一次告知，是产品问题不是 bug。②「冒出无关图片节点」**不来自这条链**：`startVideoDepthDerivation.ts:72` 只建一个 video 节点。同一条浮动工具条上紧挨着的抽首帧/抽尾帧（`NodeVideoFrameToolbar.tsx:45-73`）才建图片节点，而那条工具条在 1280 下右缘被切（W-13）——极可能是**点错了旁边那颗**。并入 T-DS-14 一起修。③「视频节点变黑 / 下载卡住」本轮没有可复现的现场，需要一次带真实视频的走查。 **09-17 裁决**：① 首次下 50 MB 本地模型**不加确认**（09-08 拍板只问花钱/撤不回，这两条都不是），但要**就地告知 + 进度**（「首次使用需下载 Depth Anything V2 Small ≈50 MB」+ 下载条），不能像现在悄悄下——批次 3 实施。② 归 T-DS-14。③「视频节点变黑 / 下载卡住」本轮没有可复现现场：`depthVideoJob.ts:188-207` 只在 `phase:"downloading"` 发事件，下载阶段没有字节进度，失败走 `model-download-failed`；要定案需要一次带真实视频、断网/慢网对照的走查。 |
| T-MD-06 | 导入中节点改成进度驱动的渐显（无 GPU 兜底不再是实心蓝条） | done #804 | #790 · [设计](../design/mockups/2026-09-14-import-progress-reveal.svg) | #790 曾整个被 `bdbe9ce6c` 撤出，根因是 preload/bridge 两个巨壳贴着 800 行上限（T-QA-10）。拆壳后已在 `integration/release-20260917` 重做并入：拷贝字节驱动马赛克渐显、拷贝与预览并行、导入状态不再借用生成词表的 `queued`。「预览界面拖入」那一格（T-MD-01 剩余）仍未覆盖 **批次 2 追加**：100% 之后约 5 秒的收尾段此前显示成「100%」（W-08），已给事件加 `phase` 并显示「收尾中」。 |

## F. 设置 · 接模型 · MCP

> 群反馈里出现最多的主题就是「接模型 / 自建中转适配」。

| ID | 一句话 | 状态 | 来源 | 下一步 |
|---|---|---|---|---|
| T-MO-01 | 写完 key 没像以前一次性打开所有模型（预置模型清单已由 #788 修好） | done #804 | [原文 09-10 #4 · 09-13](sources/2026-09-14-filehelper-transcript.md#09-13) | 已在 `integration/release-20260917` 基于 main 重做并入（存 key 与发现同一步；拿不到清单按原因说人话，zh/en 两轨） |
| T-MO-02 | **接入验证一直转然后全部失败**：`store.mutate` 文件锁自旋超时 + `process()` fire-and-forget 无 catch → `certifying` 永久卡死、cancel 被拒 | done | [原文 09-12 01:26](sources/2026-09-14-filehelper-transcript.md#09-12) | 已修：`process()` 外包 catch → `terminal.settle`（b58e409bc），cancel 永不抛（`integrationSessionRunView.ts`）。**全部失败那半归 T-MO-07**：锁自旋超时机制仍在，只是不再致死（退避重试 + errors.jsonl + 看门狗） |
| T-MO-03 | 供应商切一次再切回来跳回 ApiMart；要记住上次选择；不用的会员模型一直占位；模型框同名不同商难分 | todo | 群反馈 · [原文 09-10 19:43](sources/2026-09-14-filehelper-transcript.md#09-10) | 09-06 已拍板「模型框排序去重」，没落 |
| T-MO-04 | 点进供应商的模型大页面：线条太多、既然已经接入了这页到底干嘛的 | todo | [原文 09-12 #5](sources/2026-09-14-filehelper-transcript.md#09-12) | 设计题，先想清它存在的理由再改 |
| T-MO-05 | MCP 接模型工具面收成 4 个工具（一个工具 = 一种后果） | hold #754 | 09-11 基线：入参写对 62%、回合成功 1/9 | 用户 09-17 拍板**延后**，PR 保持开着。对当前 main 落后 299 个提交、`git merge-tree` 仍有 8 个文件冲突（含 modify/delete 型），外加一条真功能红（打包冒烟：没有凭据却连上了，必须当根因修）。重做基于最新 main 重整，主体与那组真实模型入参写对率数字保留；验收仍是夹具 ≥90% |
| T-MO-06 | 不在列表里的 AI 客户端也该能连 MCP（我都没装 pi，它却显示可连） | todo | [原文 09-12 · 09-13](sources/2026-09-14-filehelper-transcript.md#09-13) | 随 #783 合入（本轮 `integration/release-20260917` 的 B 块就是它：客户端名单收成 `electron/shared/mcpClientRegistry.ts` 唯一 owner、按安装痕迹检测、pi 删除、其他客户端给通用配置片段） |
| T-MO-07 | 接入验证效率：并行 + 每模型 30s 超时 + 部分成功语义 + 只重测失败的 | todo | [原文 09-12 01:26](sources/2026-09-14-filehelper-transcript.md#09-12) | 业界共识形状（LiteLLM / TokenHub / model-check 都这样）；排在 T-MO-02 之后 |
| T-MO-08 | 用户接中转站最痛的是「手抄 20 个模型名」——pi-ai provider 的 `resolve` **原生就能自动发现**，我们没用 | todo | [pi 生态调研](sources/2026-09-14-pi-ecosystem-gaps.md) | A 类（原生就有）；先确认发现走 `resolve` 而不是第二个出站点 |
| T-MO-09 | `pi-ai` 的 `ProviderConfig`/`Model` 还没做逐字段裁决，上游加字段今天拦不住 | todo | 同上 | 补进 `docs/engineering/framework-boundaries.json` |
| T-MO-10 | 接入验证会扣积分（花钱却没过报价卡） | todo | 09-11 群反馈 | 违反「钱的闸」，要么免费自检要么先问 **批次 2 只做了根因定位，没改行为**（怎么修是产品岔路，等拍板）：付费点是 `electron/catalog/directKeyCredential.ts:49` `probeDirectKeyCredential` —— 用户点「保存验证」当场发一次真实 `POST /chat/completions`（`max_tokens:1`）；它经 `appFetch` 直接出门，**不碰 `runtime.ts`、没有 `grantId`**，所以报价卡在结构上永远不会为它出现。`revalidatePendingCredential`（`validateCandidateCredential.ts:82`）在首用前还会再跑一次同样的付费探测。受影响的只有 apimart（唯一声明 `livenessProbe` 的种子）；kie/minimax 走 `first-use`，存 key 不验。`builtinVendorSeeds.ts` 上那句「Paid only by the weekly radar」已是假话，批次 2 把注释纠正了。三条修法各自对用户的承诺不同：① 换一个真免费的自检端点（要先证明它对合法 key 不回 401）② 把这次探测接进报价卡（接入时就弹一张卡，多一步）③ 退回 `first-use`：存 key 不验，接入页显示「已保存 · 未验证」——但走查第 2.1 节刚确认现在这条路的诚实报错是**好的**，退回会把它弄丢。 **09-17 裁决（批次 3 实施）**：`probeDirectKeyCredential` **不许再发 `POST /chat/completions`**。先查 APIMart 有没有 `GET /v1/models` 或等价免费端点——**合法 key 不 401 要实测一次**（只发 GET、不生成；仓库现有证据说的正相反，`builtinVendorSeeds.ts` 的 livenessProbe 就是为此存在的，所以这一步是证伪而不是确认）；实测不成立就和 kie/minimax 一样走 `first-use`：存 key 不验。`revalidatePendingCredential` 同样处理。把「验证不花钱」写成测试：任何 credential 探测路径出现 `POST /chat/completions` 即红。 |
| T-MO-11 | 「这个模型现在能不能用」以前有好几份判断，收成一个 owner（P0-10） | done #765 | 09-12 P0 清单 | 已合：`electron/shared/modelAvailability.ts` 单一真相源 + 门岗 `pnpm run check:model-availability` + 模型框去重 `useDedupedModelSelect`；落点在 `71b38b8fa` 核对通过 |
| T-MO-12 | 接模型验收：30 句题库进 CI + 外部宿主真实闭环 + 修掉「工具结果说没有证据的话」这一族 | hold #799 | 09-15 验收方案 | 用户 09-17 拍板延后：它堆在 #754（T-MO-05）之上，单独合会把题库钉在一个还没落地的工具面上。随 T-MO-05 一起基于最新 main 重做；30 句进 CI 这件事本身不作废 |
| T-MO-17 | 设置侧栏里没有「MCP」四个字，用户要连 MCP 得先猜「自动化与权限」 | todo | 09-17 T-RL-05 真实点击验收（现场 `~/Desktop/nomi-scratch-0917/mcp-click/report.md`） | 真实点击验收的用户镜头摩擦①：六步路径 齿轮→设置→自动化与权限→管理连接→选客户端→一键接入，第三步全靠猜。改法是让侧栏那条同时印出「MCP」，不新增层级 |
| T-MO-18 | 顶部徽章「就绪」实际意思是「还没接」，语义反了 | todo | 09-17 T-RL-05 真实点击验收（现场 `~/Desktop/nomi-scratch-0917/mcp-click/report.md`） | 摩擦②：徽章跟着所选客户端在 已接入/就绪/已配置 之间跳，「就绪」这个词在别处都表示「好了」，这里却表示「尚未接入」——同一套词表要一个 owner，别让「就绪」既表成功又表未开始 |
| T-MO-19 | 「撤销接入」是底部弱对比小字链，与「一键接入」按钮不对称 | todo | 09-17 T-RL-05 真实点击验收（现场 `~/Desktop/nomi-scratch-0917/mcp-click/report.md`） | 摩擦③：接入是主按钮、撤销是最底部小号文字链，用户找不回来。一对互逆动作应当同一视觉层级（撤销可以是次级按钮，但不能是弱对比文字链） |
| T-MO-20 | **Higgsfield 内置供应商**：Soul 2 / Soul Cinema / DoP standard+turbo（Key 形如 `id:secret`、异步任务、预签名上传） | done #808 | 09-17 用户点名接入 | **批次 3 已合 #808**：契约靠实测反推（用错误值反推校验器），上传走 Higgsfield 自己的预签名 URL（不经 KIE、不经匿名图床，符合 09-17「接谁就接谁的上传」拍板），修正预签名 `x-amz-tagging` 签名问题并新增 `uploadHeadersPath` 声明位。真花 $0.850（其中 **$0.439 是误操作**：把 `POST /marketing-studio/image` 当余额探针，它只要 prompt 就真排任务，cancel 来不及）。真实小样 Soul 2 文生图 $0.004、DoP Turbo $0.407 出 1264×720 5.37s mp4。**未接**：Soul Standard（被 Soul 2 取代且贵 30 倍）、Marketing Studio Image 与 Soul ID（`input_schema` 为 null、文档 404）、74 个转售壳。**未做**：外部宿主 MCP 真接（按用户指示延后到 #754 工具面重写后验收）；`docs/research/model-radar/higgsfield.json` 基线快照未建；`style_id` / `motions` 合法值清单要向对方索要 |
| T-MO-21 | MCP 启动归属：把「不是我」当成「已损坏」，还先用本实例凭据判另一副本（auth-stale 绕过归属） | done #808 | 09-17 装正式版又开测试包的用户现场 | **批次 3 已合 #808**：唯一配置 owner `mcpConfig` 改成**归属先于认证**——先看可执行文件 / Helper 脚本 / GUI 入口 / profile，再判归属，最后才验本实例凭据；语义拆成 `launcher-broken`（自愈）与 `launcher-elsewhere`（常驻显示真实路径 + 用户主动「切到这一份」，保留 `.nomi-backup`）。删掉旧 `launcher-stale`、30 秒主进程通知、renderer toast、旧实验室 toast 状态与对应失效测试。JSON / TOML / 注册 profile 共用这条边界。**未验**：Windows 实机（本机跑不了，记 `unverified`，单测覆盖 `access(X_OK)` 的存在性语义） |
| T-MO-22 | 旗舰图像模型协议早就通、档案没种：GPT Image 2.5 Flare/Sunburst、Imagen 4 Fast/Ultra 在模型框里一个都选不到 | done #808 | 09-18 协议覆盖普查 + 群反馈「接模型」长期第一大主题 | **批次 3 已合 #808**：四个新档案 + `gemini-image-3-pro` / `grok-imagine-image-2` 原地补 apimart 行，共 +6 kie mapping、+7 apimart mapping；kie 侧 GPT Image 2.5 的跨字段约束（27:16 / 16:27 / 9:8 / 8:9 只支持 1K）落成**发请求前**的校验闸，不靠上游英文报错。顺手纠正一个隐式 bug：档案注册顺序曾让 `gpt-image-2.5` 排在 `gpt-image-2` 前面，把新用户的默认图片模型悄悄改掉（`f8dc48be4` 挪回并注释）。APIMart 7/7 真机封印实花 $0.107312。**kie 6 条 `unverified`**（见 T-MO-24） |
| T-MO-23 | 模型雷达看不出「这个缺口有没有协议 / 别家是不是已经接了」，`isCovered` 还会两头骗人 | done #808 | 09-18 档案批实扫 | **批次 3 已合 #808**：每条 added/uncovered 加 `wire`（实扫 catalog 判协议是否已知）与 `elsewhere`（别的供应商是否已覆盖同一模型）两列；修 `isCovered` 两处回归——probe 侧长度闸 8→4（veo3 够不到已接的 veo3.1，假阴）、包含关系改单向（堵住 `gpt-image-2.5` 被 `gpt-image-2` 冒领，假阳）。实测：174 个「未接入」里协议已知 174 个（100%），**这个数字今后应读作「档案待办清单」而不是「协议缺口清单」**。快照按纪律未更新，等用户看过 `latest.json` 再 `-- --update-baseline` |
| T-MO-24 | kie 侧 6 条新档案的付费验收是 402（余额不足），按 R22 记 `unverified` | todo | 09-18 批次 3 收尾 | 不许拿 mock 绿灯替代 live 证据；用例定义已保留在 `KIE_CASES`，充值后一条命令补跑：`PAID_INCLUDE_KIE=1` |
| T-MO-25 | 本机 APIMart 一条价都没填 → 付费闸的「不知价不许花」拒掉每一笔，原因只进 console，用户只看到「仍要生成」按下去必然失败 | todo | 09-18 批次 3 收尾 | 真用户会撞：报价卡上要明说「这家没有报价，先去填 / 或允许无价生成」，而不是静默拒绝。属「钱的闸」的诚实交付面（D4） |
| T-MO-26 | 跨字段约束没有家：散在档案注释、手写 `request_transform`、供应商报错三处；UI 仍把非法组合摆成可选 | todo | 09-18 批次 3 收尾 | 最早能拦住的那层是 UI 置灰（R17），那要给档案体系加「跨字段约束」这个声明位；今天只能在发请求前拦。与 `vendorParams` / `paramMap` 两套机制解决同一类问题、可合并那条一起做 |

## G. 生态与插件

> 用户 09-14 原话：「重点是我希望我们要思考这类**生态插件怎么快速补齐我们的基本能力**，而不是重复造轮子。」

| ID | 一句话 | 状态 | 来源 | 下一步 |
|---|---|---|---|---|
| T-EC-01 | **插件宿主方案拍板**：抄 Dify 反向调用（插件永远拿不到 key）+ Zed 两把锁 + Figma `networkAccess{域名, 理由}` | hold 📋 | [方案 + 11 家调研](sources/2026-09-14-plugin-host-plan.md) | **等用户点头两件**：抄这套对不对；值不值得先做「第三方代码挪出主进程」这次改造 |
| T-EC-02 | 零成本探针：`utilityProcess` 子进程 + 反向调用 + 两个真包（`pi-web-search` 等）实跑 | hold | 同上 | T-EC-01 点头后的第一步，**不是**先写产品代码 |
| T-EC-03 | **联网读素材**（唯一真能力缺口）：Agent 今天做不了「去网上找一张参考图 / 读一篇文章改成分镜」 | hold | [pi 生态调研 §2](sources/2026-09-14-pi-ecosystem-gaps.md) | 形状建议 `nomi_web_read` 只读不搜、走模型厂商自带 search、产物打 `web_fetched/untrusted`、不给 bash 开网。**碰外部契约+花钱+安全面三件，派工前先 grill** **暂缓 · 09-17 用户拍板**（不进这一版；碰外部契约+花钱+安全面三件，重启时先 grill）。 |
| T-EC-04 | 回放夜跑的输入还挂在旧格式上，R30 两个数字（工具写对率/回合成功率）没从真相源取料 | todo | [同上 §1](sources/2026-09-14-pi-ecosystem-gaps.md) | 给 `replayShadowSources.mts` 补 pi JSONL 适配器，旧三个 legacy 适配器随迁移期结束一起删 |
| T-EC-05 | 轨迹导出没有产品入口（今天只会 `shell.openPath` 打开目录） | todo | 同上 · T-AG-11 | **不另造格式**：对 pi session JSONL 做字段过滤，复用已有的 redaction |
| T-EC-06 | `check:prior-art` 只数「有几条带出处」，不看查了哪几个池子 | todo | [同上 §4](sources/2026-09-14-pi-ecosystem-gaps.md) | 改成「框架原生 / 生态 npm / 我们自己」三个子节各至少一条四段式；不新建门岗 |
| T-EC-07 | 内置技能库继续扩充：收市场验证过的 GitHub 技能/提示词 | todo | 09-07/09-08 用户点名 | 只收 MIT/CC，按 SKILL.md 标准，预览媒体走 frontmatter 自定义键 |
| T-EC-08 | 技能导入要能直接上传文件（zip / SKILL.md）——解析 09-01 已修，**入口可发现性未验** | todo | 群反馈 | 真机走一遍导入闭环 |
| T-EC-09 | 底层架构：什么时候把生态 package 纳进来 | hold 💬 | [原文 09-14 00:18](sources/2026-09-14-filehelper-transcript.md#09-14) | 与开放战略同题；T-EC-01 拍板后自然有答案 |

## H. 剪辑

| ID | 一句话 | 状态 | 来源 | 下一步 |
|---|---|---|---|---|
| T-ED-01 | 时间轴：收不回去 / 拉上来太大 / 右下缺一块 / 跟着右侧 Agent 面板左右变动遮挡左边 | doing | [截图 09-13 19:27](sources/screenshots/2026-09-13-1927-layout-split-and-surface-error.jpg) | 布局那半已由 #794 #796 合入（时间轴横贯底部、胶囊可召回）；剩「两条轨（图片轨 + 视频轨）能拖动预览」未验，要真机走一遍再判 done |
| T-ED-02 | 让 Agent「劈成两半」：它说要确认卡、卡没出现、也没劈 | done #808 | [截图](sources/screenshots/2026-09-12-0043-edit-split-confirm-card.jpg) | 与 T-AG-04 同根 **批次 2 根因定位，未改行为**：「回执说有卡、卡没出」的成因是**回执来自一张静态表**——`electron/agentLane/laneExtendedTools.ts:21` 的 `nextActionFor` 在 `edit_timeline` 成功时**无条件**返回 `user_sees_review_card`，从不查 `laneApprovalGate` 的 pending 状态、也不看档位。三道防线都看不见它：`assertAnnouncedCardRendered`（`ProjectAgentResidentShell.tsx:132`）的 `announced` 只统计 `data.primaryPending` / `spend.pending`，`check:announced-card` 的 WATCHED 名单里没有 `laneExtendedTools.ts` 与 `verbDeclaration.ts`。修法是让回执**从真实审批决定 derive**，而不是查表——同时把工具回执这一面纳入 announce 判据，否则下一个动词还会再来一次。 **09-17 裁决（批次 3 实施）**：纯 bug，照根因修——`nextActionFor` 从 `laneApprovalGate` 的真实 pending 状态 + 档位 derive，删掉静态表那一行；并把 `laneExtendedTools.ts` / `verbDeclaration.ts` 纳入 `check:announced-card` 的 WATCHED（加规则先验它会红）。 **批次 3 已合 #808**：回执改为从真实批准派生；新走查 `tests/ux/agent-timeline-receipt.walk.mjs` 绿（真人在剪辑面说「劈成两半」→ 卡 → 确认 → 落盘 → 回执），阳性对照退回修前代码当场红。**剩下的产品问题另记 T-ED-07**：`edit_timeline` 只给通用能力卡，没有逐条摘要与计划高亮带。 |
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
| T-QA-10 | `electron/preload.ts`(797) / `src/desktop/bridge.ts`(784) 贴着 800 行巨壳上限，谁加桥接都撞线 | done #804 | #790 撤出复盘（交接 §2.4） | 已在 `integration/release-20260917` 拆完：preload 797→265（组装层 + 四族桥面 + `ipcCall`），bridge 784→428（浏览器/素材/模型目录三支各自成型）。不加白名单、不抬基线；顺带堵了「按源码文本判断桥面的检查只读组装层会静默变绿」那条假绿（`check:skill-ipc-coverage` 加硬零 Guard 0 + 两处结构测试改读整面） |
| T-DS-14 | 分镜面 1280 宽下编辑器列仅 570px，29 个叶子被右缘切（W-03）；画布视频节点动作条同病（W-13） | todo | [走查 09-17](../audit/2026-09-17-post-804-walkthrough.md#51-走查时撞到的比-16-条更要紧的三件) | 批次 2 已修不动结构的部分（批量条提示、页脚换行）。剩下的要在四个方案里选一个：编辑器列 min-width + 横滚 / Agent 面板窄视口自动收 / 帧列与参考列断点收窄 / 底栏胶囊收进「⋯」。**先出对比表请用户拍板**（底栏换行那条已被 2026-09-06 拍板否掉，别再提）。**09-17 拍板：结构解 = 全局左侧栏 A-1 抽屉化提前（成文中）**；原方案 C（帧列与参考列断点收窄）降级为「抽屉打开时的兜底」，进批次 3 **批次 3**：A-1 左栏抽屉化已落地并进集成分支（`integration/batch3-20260918`），同分支还带了分镜编辑器 grid 列模板那条根因修——1280 + Agent 面板展开 + 创作内容列收起这一档，**zh 越界 0 / EN 越界 0**。剩下的是「模式+尺寸两枚胶囊那行底栏自然宽超出」——C（参考列 211→138）与 D（尺寸胶囊收进行尾 ⋯）单独都够，09-17 23:59 用户拍板走 **D + 让位下限**，由原 lane 在 `fix/storyboard-en-overflow-20260917` 追加，追加后再并进集成分支。 **批次 3 已合 #808**：A-1 左栏抽屉化 + 编辑器 grid 列模板根因 + 方案 D（尺寸这类可降级胶囊到让位下限后收进行尾 ⋯ 弹层，模型 / 模式 / 时长不可降级）全部落地——1280 + Agent 面板展开 + 创作内容列收起这一档，**越界叶子 zh 0 / EN 0**，模型胶囊 zh 122px / EN 110px。同 commit 删掉与 `spendHint` 逐字重复的 `footer.spendNote`（zh/en 词条一并删）。**本行仍留着**：画布视频节点动作条那半（W-13）没动。 |
| T-MO-13 | 打包版拒绝验证 127.0.0.1 供应商（W-14），本机/局域网 OpenAI 兼容网关接不进来 | todo | [走查 09-17](../audit/2026-09-17-post-804-walkthrough.md#23-顺带撞到打包版拒绝验证回环地址的供应商) | 批次 2 记 `unverified`：查到 `seedLabTrustedPrivateOrigins(app.isPackaged)` 早返回、packaged CSP 无 `http:` 两处分叉，但凭据验证那条路不过目的地策略，都解释不了。**先复核**：打包 + 起本机兼容端点 + 打包实例走一次真实接入 + 与开发构建交叉对照，再谈修 |
| T-QA-11 | #802 这一轮验证全部走 loopback 供应商、0 付费；**没有跑过付费供应商 smoke** | todo | 2026-09-17 #802 列车收尾 | 发 RC（T-RL-09）之前必须补一次真付费闭环：只用 APIMart（用户没有即梦账号、kie 余额为负），先抓出站报文以便被拒时仍能验契约；R22 口径：没跑就记 `unverified`，不许拿 mock 绿灯替代 |
| T-QA-12 | 所有权审计六条 C（同一份状态有几个 owner / 生命周期对不齐）→ 批次 3 第一条 lane | done #808 | [所有权与生命周期普查 09-17](../audit/2026-09-17-ownership-lifetime-census.md)（分支 `audit/ownership-lifetime-20260917` 待合） | 报告 A6/B3/C6/D0；C 档六条是「要动结构才修得掉」的那一档，批次 3 排第一条 lane。合审计分支时把报告路径核一遍 **批次 3 已合 #808**：六条 C 全部落地——T-QA-13（`ApiKeyRecord.enabled` 一个布尔背两义）、C4 错误码单 owner（6 份手抄改 spread）、C5 失败文案走 pi `after_tool` 结构化信封、C1 store 寿命释放点从声明派生、C2 身份比对收敛、C3 读路径写盘降成进程缓存。结构评审 `docs/audit/2026-09-18-ownership-axis-structural-review.md` 结论：四簇是同一件事，**不是「结构不对」是「契约少一个字段」**（C 档 6 / D 档 0）。C2 复核推翻了审计原估「project 身份 6 处只比 1 维」（实际比 3–4 维），真缺陷是 preload 7/13 维比对抄了五遍。 |
| T-QA-13 | 走查夹具的 key 注入**已经死了**，`hasApiKey` 恒 false——所有靠它的走查真实性受影响 | done #808 | 09-17 W-03 工人结构性发现 | `tests/ux/storyboard-table-exec.walk.mjs` 注入的凭据进不去：`validateCandidateCredential.ts:50` 对 `authType:'none'` 直接抛错，渲染层写 key 时强制 `enabled:false`，而 `credentialRecordCounts` 又要求 `enabled !== false` → 计数恒 0。这是**走查基础设施债**（假绿源），修它之前别拿这条链上的走查当真实证据 **批次 3 已合 #808**：`ApiKeyRecord.enabled` 的双义拆开，走查 key 注入已经活了。**但四条分镜走查仍然是死的**——复活后逐条复跑，`storyboard-table-exec` / `storyboard-table-phasec` 按钮定位器不可见、`shot-table-storyboard-projection` 文本不可见、`storyboard-strategy-resolve` 通知找不到，delta=0。剩下这半移到 T-QA-14。 |
| T-QA-14 | 四条分镜走查在 main 线上全是死的：key 注入修好后仍逐条报错、delta=0 | todo | 09-18 批次 3 收尾（T-QA-13 剩下的那半） | `storyboard-table-exec` / `storyboard-table-phasec` 按钮定位器不可见、`shot-table-storyboard-projection` 文本不可见、`storyboard-strategy-resolve` 通知找不到。死锚点会同时造假红和假绿（`docs/lessons/dead-selector-lies-both-ways.md`），修之前别拿这条链上的走查当真实证据。其中 `strategy-resolve` 那条「闸没给提示、整批可能已放行」要先判是死走查还是真缺闸 |
| T-QA-15 | 仓里 4 个付费 e2e 既不铸 spend grant 也不点确认框，必定 `SpendNotAuthorizedError` → 默认 SKIP，「闸门加了、脚本没跟上」长期没有红灯 | todo | 09-18 批次 3 收尾（档案批实扫） | `apimart-params` / `apimart-gemini-vision` / `happyhorse` / `modelscope-expand`。付费闸的共享助手收进 `_launchApp` + 补门岗断言（默认 SKIP 不算通过）。加规则前先验它会红（R17） |
| T-QA-16 | `check:boundaries` 没有「渲染层够得到的模块不许 import 主进程 API」这条判据——整类今天只靠设计实验室整页崩才抓得到 | todo | 09-18 批次 3 收尾（合并面暴露的结构性发现①） | 本批实例：Higgsfield 给渲染层可达的 `assetLocalization.ts` 加了主进程 i18n，把 Electron main 拉进渲染 bundle，vite 报 `does not provide an export named 'app'`；已拆出 electron-free 的 `desktopStrings.ts`（i18n.ts 443→41 行）救急。**连带的第二件**：`assetLocalization.ts` 本身把渲染安全的纯助手与主进程专用的上传机器混在一个模块里，拆开才是根治 |
| T-QA-17 | `check:symptom-cluster` 的模块键太粗：一份合同只要在 `scope_paths` 写了该层任意一个文件就给它记一笔，跨层修复会被顺带记账，评审变成交税 | todo | 09-15 记下 · 09-18 批次 3 收尾 量化 | 实测：`electron/providerAdapter` 七天七份合同里**只有两份重心真在这一层**（≥2/3），最后两份各只碰一个文件（7% / 5%）。改法：按该模块在 `scope_paths` 里的占比加权成簇，或按 `doors` 里真正改动的门所在模块计。证据在 `docs/audit/2026-09-18-provider-adapter-cluster-structural-review.md` §2 |
| T-QA-18 | 同一条不变量「任何非终态在有限时间内必须落到终态」在 run 层与 session 层各实现了一次，没有任何机器判据保证它们同源 | todo | 09-18 批次 3 收尾（providerAdapter 结构评审 §3） | 09-12 修在 `terminalGuarantee.ts`、09-15 又修在 `serviceLifecycle.ts`；两处的退避预算、看门狗周期、逃生口各写各的，改一处另一处不会红。停止层（一条）：凡声明了非终态集合的模块必须在同一处声明 ① 终态化保证 ② 看门狗 ③ 逃生口，缺一即红；两层各自声明时判据要能看出指向同一份定义。**加规则前先验它会红**（R17）——今天至少这两处会红 |
| T-QA-19 | agent-runtime 的 L1 T3 / G2 两条场景现在只覆盖「没问就直接做了」那一支，「出了确认卡」那一支没有场景摆批准动作 | todo | 09-18 批次 3 收尾 gates 翻红后定位 | T-ED-02 把 `userSees` 从写死改成**由真实批准结论派生**之后，这两条场景的期望文本才对上——但它们本来就没摆批准，所以覆盖的是「不问」那支。要把「出卡」那支也钉住，得在 `tests/agent-runtime/laneL1Scenarios.mts` 里真的摆一次批准，不是把话写回去。**连带的过程问题**：这两条只在 `pnpm run gates` 的全量档跑，功能 lane 只跑 focused，所以改行为的那条 lane 当时看不见自己把夹具改废了——与 T-QA-15「默认 SKIP 没有红灯」是同一族 |
| T-QA-20 | Ponytail 对批次 3 提了约 90 条 shrink/yagni，两族是真账：① 一个导入函数被改名成 8 个别名（`sameOwner` / `sameProjectSelection` / `matchesCommittedSelection` / `sameExportProjectIdentity` / `sameSelection` / `sameProjectIdentity` / `sameSurfaceAuthority` / `sameIdentity`）；② `safeFailure` 在 4 个 transport adapter 里逐字相同 | todo | 09-18 批次 3 交工前 Ponytail（findings 存 `.claude/ponytail-findings/`） | ① 正是 R14.1「同一语义几个名字」的活样本，而且本批刚立了 `check:identity-compare`——把别名族做成它的一条判据，加规则前先验它会红；② 抽一份共享 `safeFailure(error, codes)`。其余条目多是新增代码的行数建议，本轮逐条表态在 PR 正文 `## Ponytail`，不在收尾窗口改（改一行就要重跑整条分支的评审与五门） |
| T-QA-21 | 测试质量体系首批：有界核对现状、可信判定、最简一页报告 | todo | 用户 2026-09-20 要求逐步建设、通用可扩展；[唯一方案 §0/2/16](../plan/2026-09-20-nomi-test-quality-system.md) | WP0/WP1＋WP7 最简报告；先消除跳过/重试/缺证据的假绿，验真实 CLI 退出码。当前仅文档规划，未实施；完成这一切片就交 PR，不一次执行全计划 |
| T-QA-22 | 最小安全隔离＋一条真实历史问题完整回归 | todo | [方案 §0.2/7/16](../plan/2026-09-20-nomi-test-quality-system.md) | 接 T-QA-21；复用原启动器，阻断真实凭据继承与未准入出站，再走原 UI/IPC/runner/磁盘；首选 QA-05 切项目正反对照，报告与证据同批交付 |
| T-QA-23 | 付款与目标所有权按行为小批覆盖 | todo | [方案 QA-01～08 / WP3](../plan/2026-09-20-nomi-test-quality-system.md) | 接 T-QA-22；关闭/集合、unknown/恢复、后台/失效分别交 PR；复用 T-QA-15/19 相关待办与已实现首例，不重复造 case；本列逐批记录 PR 和剩余范围 |
| T-QA-24 | 保存、撤销、输入恢复、Stop 与历史分批回归 | todo | [方案 QA-09～21 / WP3](../plan/2026-09-20-nomi-test-quality-system.md) | 原 editor/runner 与真实 pi SDK；保存重开先成一批，输入与历史后续分批；映射 T-QA-02/14、T-AG-10，产品缺陷单独最小修复 |
| T-QA-25 | 完整 T7：参数条、历史、键盘、手势、加载恢复与诊断 | todo | [方案 QA-22～28 / WP4](../plan/2026-09-20-nomi-test-quality-system.md) | 正常可编辑→历史/键盘→手势/加载恢复→宿主/原生边界逐批交付，接 T-QA-05/08；所有承诺格齐备才称完整 T7，不把缺平台改名为通过 |
| T-QA-26 | 适用旧数据、媒体、模型接入与候选包矩阵 | todo | [方案 QA-29～40 / WP5](../plan/2026-09-20-nomi-test-quality-system.md) | 按当前变更/发行范围分批，保存/包必测随相应改动提前；T-QA-09/11 原生与 live 证据单列，真实费用需本计划范围的单独授权 |
| T-QA-27 | 稳定回归后的序列/变异/AI 探索试点及维护成本 | todo | [方案 WP6 / WP7 / §18.5](../plan/2026-09-20-nomi-test-quality-system.md) | 单模块先证明反例可重放与历史变异可检出再扩面；不是核心回归/报告前置。WP7 报告和成本观察从 T-QA-21 持续贯穿，不等本项开工 |

## J. 官网与发布

| ID | 一句话 | 状态 | 来源 | 下一步 |
|---|---|---|---|---|
| T-WB-01 | 官网四件：SEO / 页面设计 / 官方文档 / 功能速递介绍视频 | todo | [原文 09-14 00:14](sources/2026-09-14-filehelper-transcript.md#09-14) | 对标 MiniMax Design 的 X 运营与官网、TapNow、libtv；资料与验证任务统一走[三日竞品学习](../research/competitive/README.md)，研究不代表本项已实现 |
| T-WB-02 | logo 与真实产品不一致 | done #788 | [原文 09-13 19:12](sources/2026-09-14-filehelper-transcript.md#09-13) | 已合 |
| T-WB-03 | 产品发布会：PPT（对标 Apple）+ 逐字稿 + 图片/视频素材 + 特效 + 音乐 | hold | 09-08 用户加入，排最后 | **先写逐字稿**（逐字稿就是定位练习）；demo 段全部真机录屏，片子尽量用 Nomi 自己做 |
| T-WB-04 | 每周 RC 的发版时钟；`docs-autosync` 从来没能开 PR（仓库设置禁止 Actions 建 PR），**债已经攒出来了**：09-14 实测 `origin/main` 上 `check:docs-index` 超基线 136 篇、`check:doc-status` 超基线 101 篇 | todo | 09-07 裁决 · 09-09 实核 · 09-14 实测 | 这两个门岗在 `gates:contracts` 里是 advisory 所以没人看见；**要么用户开「Actions 可建 PR」，要么手工 cherry-pick `docs/autosync-*` 分支补齐** |

---

## K. 竞品学习与设计研究

> 用户 2026-09-19 要求“先构建 skill/规则/流程”，覆盖页面、流程、用户引导、功能交互、图标、社区、自媒体与视频。研究范围及执行入口见[流程](../research/competitive/README.md)，不自动授权功能开发。

| ID | 一句话 | 状态 | 来源 | 下一步 |
|---|---|---|---|---|
| T-CR-01 | LibTV/TapNow 核心对标 + Higgsfield/MiniMax Design/RunningHub 扩展对标，每 3 天扫描、轮换深挖、汇总分析并对照 Nomi | doing | 用户 09-19 本会话；[方案](../plan/2026-09-19-competitive-learning-workflow.md) | 分支 `docs/competitive-research-workflow-20260919` 交付规则/skill/模板/本机调度；首轮真实执行另行记录，不提前标 done |
| T-CR-02 | 表情/姿势自定义编辑的发现、精调、预览、保存复用完整旅程对标 | todo | 用户 09-19 本会话 | 先核实 Nomi 当前能力及已有任务，再按[旅程卡](../research/competitive/TEMPLATE.md)形成差距与设计验证任务 |
| T-CR-03 | 插件/CLI/MCP 与 Blender 的官网及软件内呈现、安装引导、连接验证和结果回流对标 | todo | 用户 09-19 提供 [LibTV 插件](https://www.liblib.tv/plugin) / [Blender](https://www.liblib.tv/blender?entrySource=homepage_feature&entryItemKey=blender) | 不把 Nomi 的 MCP 等同插件/CLI 成品；先用真实路径比较，Blender 是否已有 Nomi 集成待核实；关联 T-EC-01，不替代插件宿主方案 |
| T-CR-04 | Agent 设计、社区、自媒体选题/视频结构/官网转化路径的持续学习 | todo | 用户 09-19 本会话 | TikHub 发现 + 登录原站观看/鼠标录屏；输出有证据的产品/营销实验简报，关联 T-WB-01 与 Agent 待办；不直接改产品或发布 |

## 附：这份表**故意不收**的东西

- **纯一次性的排障记录**（某个 CI 为什么红、某个 worktree 怎么清）→ 归 `docs/lessons/`。
- **已经有独立方案文档在跑的大件**（Goal 模式、剪辑数据模型重写）→ 这里只留一行指针，细节别抄过来，抄了必漂。
- **用户没说过、我自己觉得该做的事** → 先去问，别先进表。表里每一条都要指得出来源。
