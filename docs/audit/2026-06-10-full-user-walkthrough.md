# 全链路用户走查 + 自动化 UI 测试工具调研（2026-06-10）

> 触发：用户要求「调研最新 computer-use 式的全量点击/逐页验证工具，并给项目做一次特别完整的用户测试」。
> 方式：Playwright `_electron` 常驻驱动（`tests/ux/ui-driver.mjs` + `ui.mjs`），AI（本 agent）作为「computer-use 智能体」按 J1–J5 真实创作目标逐步 snap→判断→click/fill→再 snap。
> 版本：0.9.6，本次走查前已 `pnpm build` 全新构建（防 stale-chunk 伪 bug）。

---

## 一、自动化 UI 测试工具调研（2026 现状）

### 工具分层
| 层级 | 代表 | 谁来「写」测试 | 对 Electron 适配 |
|---|---|---|---|
| AI-native 自主探索 | Magnitude / Skyvern / Autonoma | LLM agent 读意图自动起草+执行+自愈 | 以 Web 为主 |
| AI-assisted 脚本 | **Midscene.js** / Stagehand / Shortest / ZeroStep | 你搭脚手架，自然语言写步骤，LLM 运行时编译成动作 | **Midscene 已支持 Desktop/CDP** |
| 跨端商用 | Autify Aximo / Test.ai / mabl | 自然语言 + 视觉识别自主跑 | 覆盖桌面 |
| 开源探索器 | Explorbot | agent 自主爬 Web | Web |

### 对 Nomi（Electron）的结论
- **Midscene.js** 是「最方便的外部自主工具」最强候选：MIT、视觉驱动、有 playground/可视回放报告，且对 Electron 有真实路径——`--cdp` 连 Electron 远程调试端口，或 desktop skill 视觉控制；甚至有 Claude Code skill：`npx skills add web-infra-dev/midscene-skills`。
- **但本项目不必换工具**：Nomi 已有的 Playwright `_electron` 驱动（`ui-driver.mjs`/`ui.mjs`）就是 Electron 场景的正确工具（DOM 感知、免费、零额度），而「computer-use 点击智能体」这一层 = AI 本身。外部视觉工具需要 vision-model 的 API key/额度（属于「需用户独有资源」的决策），故本次未自动接入。
- **建议**：常规走查继续用现有驱动；若将来想要「无人值守批量爬遍每个按钮」，再评估接 Midscene 作为专门的自主探索器（需用户拍板额度）。

来源：[QA.tech](https://qa.tech/blog/the-13-best-ai-testing-tools-in-2026)、[Midscene 官网](https://midscenejs.com/)、[Midscene GitHub](https://github.com/web-infra-dev/midscene)、[Midscene skills](https://midscenejs.com/skills)、[testriq 桌面测试](https://www.testriq.com/blog/post/top-10-ai-powered-desktop-application-testing-tools-in-2026-boost-efficiency-and-catch-bugs)。

---

## 二、走查结果（J1–J5 全部走通）

| 旅程 | 结果 | 关键观察 |
|---|---|---|
| **J1 产品宣传主链路** | ✅ 走通 | 示例卡 → 创作文案 → AI agent 自动拆 6 镜头（待确认）→ 确认节点 → 确认连边 → 画布连成流 → 每节点可选模型（Seedream/Nano Banana/GPT Image 2/Qwen/Imagen/Z-Image）配比例/清晰度 |
| **J2 漫剧定妆链路** | ✅ 走通 | 创作脚本 → 左侧「分类」面板有 角色/场景/道具/声音 分类 → 新建角色 → 角色卡含「上传角色图 + 文生图/改图 + 提示词 + 模型」槽位 |
| **J3 新用户 30 秒上手** | ✅ 走通（有摩擦） | 点示例卡 → agent 自动建 6 节点 → 确认 → 连边。见下方问题 |
| **J4 参考图驱动** | ✅ 走通 | 素材库「+ 上传」→ 上传 `test-upload.png` → 缩略图入库；角色/改图节点可挂参考图 |
| **J5 修改旧节点并导出** | ✅ 走通 | 打开示例项目 → 节点可改 prompt（contenteditable）→ 节点上「生成素材」按钮 = 重新生成 → 导出 = 预览页「导出 MP4」（空轨道时禁用 + tooltip 说明） |

走查截图存于 `tests/ux/shots/00-home … 19-assistant-model-dropdown`。

---

## 三、问题分级

### P1 — 必修
**1. AI 助手对话跨项目泄漏（前端会话未按项目隔离）**
- 现象：打开「产品 demo」让 agent 生成 LumenFlow 6 镜头后，返回项目库再打开「天台上的告白」漫剧项目——标题栏已切到漫剧，但右侧 AI 助手仍显示上一个项目的 LumenFlow 对话记录。
- 根因（已定位）：
  - 前端 transcript `creationAiMessages` 是**全局 Zustand 切片，未按 projectId 键控** — [src/workbench/workbenchStore.ts:71](src/workbench/workbenchStore.ts:71)、[:193](src/workbench/workbenchStore.ts:193)
  - 切项目路径 `hydrateProject` 从不调用 `resetCreationAiConversation()` — [src/workbench/NomiStudioApp.tsx:150](src/workbench/NomiStudioApp.tsx:150)
  - 后端历史是按 `sessionKey`（`nomi:workbench:<projectId>`）正确隔离的（[electron/ai/agentChatV2.ts:387](electron/ai/agentChatV2.ts:387)、[src/workbench/ai/workbenchAgentRunner.ts:24](src/workbench/ai/workbenchAgentRunner.ts:24)）——所以是**前后端两份真相源、前端这份没隔离**。
- 修法（P2 修根因）：首选把 `creationAiMessages` 按 projectId 数据化键控（切项目即数据驱动切换，无副作用）；最小修法是在 `hydrateProject` 内对换出项目 `clearWorkbenchAgentSession()` + `resetCreationAiConversation()`。

### P2 — 体验摩擦
**2. J3 待生成节点匿名**：画布上 6 个 `待生成` 卡只显示斜纹占位，卡面无镜头序号/标题/提示词预览/缩略图。新用户看到 6 个一模一样的格子，必须逐个点开才知道是什么——弱化了 J3「能说出这些格子是什么」。（点开后会内联展开 prompt + 参数，信息是有的，只是收起态藏了。）

**3. J3 自动布局溢出视口**：agent 把 6 节点排成一行（画布 x 到 ~2090，视口 ~1440），加上原有节点在下方，「适应视图」后整体偏散乱。

**4. 示例行为不一致**：产品 demo 示例打开即自动触发 agent 建节点；漫剧示例打开只落在创作文本编辑器、不自动触发。两个示例对「打开后会发生什么」给用户不同预期。

**5. 两段式确认偏啰嗦**：agent 先「确认节点(6)」再「确认连边」，对标榜「30 秒体验」的冷启动略繁琐。

### P3 — 细节
**6. 非 token 字号**：导出按钮 className 硬编码 `text-[11.5px]`（`workbench-preview-player__export-button`），违反 R8 token-only（应走 `text-[11px]`/`text-[13px]` token）。建议跑 `tests/ux/design-fidelity.e2e.mjs` 顺带收口。

---

## 四、做得好的地方（正向）
- 模型接入面板「通用第一」落地到位：渠道（APIMart 已连通 / KIE.AI 待接入）声明槽，按 图片/视频 分组列模型，key 已保存态清晰。
- 节点模型选择器即点即换（实测 Seedream 4.5 → Nano Banana 生效）。
- 导出按钮空轨道时**禁用 + tooltip「时间轴为空，先添加素材」**——禁用态给了原因，优秀。
- 素材库/创作 AI 空态文案到位、引导清楚。
- 助手模型下拉向上翻转、完整可见、无遮挡（R13 交互态几何 OK）。
- 定妆体系（角色/场景/道具/声音 分类 + 角色卡含参考图+提示词槽）结构完整。

---

## 五、问题分级：局部小修 vs 地基（落地顺序）

> 原则：**局部小修先做（慢慢推进），地基问题单独立项慢慢来**。注意 R8——用户可见改动落地前要先出 mockup + 拍板，下面标注了哪些需要。

### A. 局部小修（先做，范围明确）
| # | 问题 | 性质 | 是否需拍板/样张 |
|---|---|---|---|
| L1 | P3-6 非 token 字号 `text-[11.5px]`/`text-[10.5px]`（7+ 处：ProjectLibraryPage、TimelinePreview 导出按钮、ProvenancePanel、NodeErrorReport） | 纯 R8 token 合规，视觉差 ≤0.5px | 建议出对照样张确认目标 token（11px？）后批量替换 + design-fidelity 断言收口 |
| L2 | P2-3 J3 6 节点自动布局单行溢出视口 | 布局算法（bug 向，非新设计） | 改网格/分行即可，影响小 |
| L3 | P2-2 待生成卡匿名（无镜头序号/提示词预览/缩略图） | UI 信息密度 | **需样张**（复用「计划清单卡显示模型/比例/清晰度」卡面，R8） |
| L4 | P2-4 示例打开行为不一致（产品 demo 自动拆镜 / 漫剧落创作不自动） | 产品取舍 | **需拍板**（统一到哪个方向，R3） |

### B. 地基问题（单独立项，慢慢来）
| # | 问题 | 为什么是地基 |
|---|---|---|
| F1 | **P1 AI 助手对话跨项目泄漏** | 表象是 bug，根因是**前端会话状态全局、未按 projectId 键控** + **前后端两份真相源**（前端 `creationAiMessages` Zustand 全局 / 后端 sessionKey 已隔离）。最小修法（hydrate 时 reset）是修症状；根因修法是前端 transcript 按 projectId 数据化键控、与后端历史收敛到单一真相源。属 agent 地基（见 `docs/plan/agent-foundation.md`），随地基一起做。 |

落地建议顺序：L2（纯 bug）→ L1（合规，先出对照样张）→ L3/L4（出样张/拍板后做）→ F1 随地基立项。
