# 执行计划：Pi Agent 的素材获取三通道 + 本地文本模型通用端点

> Rule 4 执行计划。承接 PR #223（`project-agent-host` 线，Pi Agent 落地 Nomi 项目）**下一阶段**的两个能力：
> **A. 素材/参考获取**（三通道分工）与 **B. 本地文本模型接入**（通用端点，非 LocalAI 专项）。
> 方向已由用户拍板（2026-08-31），本文只把「怎么落」写清；**实施等 #223 phase1 收口**，本轮不写码、不开 PR。
>
> **背景来源（承接，不重复调研）**：
> - 素材/浏览器/pi 生态调研：`docs/research/2026-08-29-browser-assets-pi-ecosystem-research.md`（随 #226 合并入库）。
> - Connector 合同与提示词系统：`docs/plan/2026-08-29-creative-capability-catalog-and-prompt-system.md`（随 #226 合并入库）。
> - 运行时 owner 边界：`docs/superpowers/plans/2026-08-24-unified-agent-master-plan.md`、`docs/specs/2026-08-22-runtime-ownership-adr.md`。
>
> **验证时点**：本文所有代码坐标以 `origin/main` = `b71d3c88` 为准，2026-08-31 实查核实；标「随 #226 入库」的合同/文档为**前置依赖**，尚未在 main（见「依赖与顺序」）。

---

## 0. 一页看懂（当前基线 + 本轮做什么）

**已落地（`origin/main`，本文直接站在其上）**：
- Pi 适配层已在 `electron/harness/runtime/pi/`（`session.mts` / `run.mts` / `tools.mts` / `model.mts` / `attachments.mts` 等，注意是 `.mts`），#223 把 Pi Agent 接进 Nomi 项目宿主。
- 内置浏览器已通：`electron/browser/core/browserViews.ts:251` 起用 `WebContentsView`（`contextIsolation`+`sandbox`）；截图入库管道已闭环——`electron/browser/media/browserMediaVisualCapture.ts`（视频抽帧/截屏兜底）+ `electron/browser/media/browserPromptScreenshotSelection.ts`（框选入库）。
- 本地文本模型的**原语已存在**：`electron/ai/buildAiSdkModel.ts` 的 `createOpenAICompatible({ baseURL, apiKey? })` 已支持 `authType: "none"`（`buildAiSdkModel.ts:110/149`）；自定义供应商 UI 在 `src/ui/onboarding/CustomVendorCard.tsx` + `src/ui/onboarding/VendorBaseUrlField.tsx`。
- 本地图像/视频已归 ComfyUI：`electron/catalog/comfyuiLocal.ts`（探测/连接）+ 预设卡 `src/ui/onboarding/ComfyuiLocalCard.tsx`。

**本轮做什么（一句话）**：给 Pi Agent 补上「拿素材」和「用本地文本模型」两件能力——
**A** 用三条**职能不重叠**的通道解决素材获取（机器拿结构化 / 人挑内置浏览器 / agent 查资料），
**B** 把已有的 OpenAI-兼容原语包成一张「本地模型」预设卡（探测→一键连→能力预检），让本地 Ollama / LM Studio / LocalAI 可发现、可用。
**两件都是「装配已有原语 + 补可发现性/合同」，不新造运行时、不写供应商专有代码。**

**用户已拍板的方向（本文不再重开）**：A 的三通道分工、"agent 不模拟点击爬素材站"、B 做通用端点而非 LocalAI 专项。

---

## 1. 背景与用户摩擦（为什么做——D1/D6）

**A. 素材获取——现在 Pi Agent「巧妇难为无米之炊」。** Agent 能规划、能生成，但一到「找一张参考图 / 一段空镜 / 一个音效」就断档：要么让用户手动去外部网站下载再拖进来（多读多操作，D1 砍的对象），要么 agent 只能凭空描述。三种「拿素材」的**真实场景本就不同**，硬塞进一条通道会互相打架：
- 「给我一张海边日落的空镜」→ 机器应当**直接拿到带许可的结构化素材**，不该让用户去翻网站。
- 「我想自己挑一张更有感觉的」→ 人应当在**熟悉的浏览器里挑**，agent 只负责搜好、打开。
- 「查一下这个转场怎么做 / 这个导演的分镜风格」→ agent 要的是**资料**，不是入库素材。

**B. 本地文本模型——能力在、但等于没有。** `buildAiSdkModel.ts` 早就能连任意 OpenAI-兼容端点（含免鉴权），可普通用户根本不知道「自定义供应商」能填 `http://localhost:11434/v1`——这是**可发现性缺口**，不是能力缺口（对标记忆：`vendor-manage-is-a-discoverability-problem.md`——功能在、只是没入口）。跑本地模型的人（Ollama / LM Studio 桌面主流、LocalAI 自托管）想让 Agent 用自己的模型省额度/保隐私，却卡在「不知道怎么连、连了不知道行不行」。

**共同的底层逻辑**：这两件都不是「造新能力」，是**把已有原语接到用户摸得着的地方**，并诚实告诉用户边界（拿不到的素材标出来、跑不动 agent 的模型明说）。

---

## 2. 范围（本轮做什么）

### A. 素材/参考获取——三通道分工

> 核心判断：**一个「拿素材」需求，按「谁来拿、拿来干嘛」分三条职能不重叠的通道**；P1 不留并行版——同一职能只有一个家。

**通道 1 · 机器拿素材 = Connector 轨（结构化 API）**
- 数据源：Pexels / Pixabay / Freesound（免费 key、结构化响应、**自带许可信息**）；参考视频走 **Pexels Videos**。
- 实现：**复用 #226 的 `ConnectorDefinition` + `AssetSourceEvidence` 合同**（不新造素材抽象）——connector 声明「搜什么、返回什么、许可怎么记」，通用系统负责调用与入库，`AssetSourceEvidence` 记录来源/许可作为凭证。
- Unsplash **延后**：其条款要求 hotlink（不得转存/代理），与我们「入库=本地留存」冲突，本轮不接。

**通道 2 · 人挑素材 = 内置浏览器轨**
- 复用**已存在**的浏览器（`browserViews.ts:251` `WebContentsView`）+ 已通的截图入库管道（`browserMediaVisualCapture.ts` / `browserPromptScreenshotSelection.ts`）。
- Agent 职责**收窄到「搜好、打开」**——把用户意图变成搜索、把浏览器开到对的页；**人**在页面里圈选/截图入库。
- **明确不做 agent 模拟点击的浏览器自动化**（理由见 §3 不动项 / §6 风险）。

**通道 3 · agent 查资料 = web 搜索/抓取工具**
- 复用 pi 生态 **`pi-web-access`**（npm，钉版本；4 个工具 `web_search` / `fetch_content` / `get_search_content` / `source_check`；免 key 走 Exa 起步、HTTP-only）。
- 落地方式：**钉版本 + 源码审计后，作为内置能力 vendor 进 #223 的 pi 适配层**（`electron/harness/runtime/pi/`）——**不开放任意第三方 extension 安装**（遵 #226 安全判定「不原样交出系统权限」）。
- 产出**只当参考/调研**，**不入素材库**（与通道 1 的产物泾渭分明）。
- **前置检查项（阻断性）**：落地前必须核实 `pi-web-access` 的 license 允许 vendoring（见 §5 依赖 / §6 风险）。

### B. 本地文本模型——通用端点预设卡

> 核心判断：**做可发现性，不做 LocalAI 专项**；三家都是 OpenAI-兼容，走同一张卡，零供应商专有代码（P4 通用第一）。

- 仿 `ComfyuiLocalCard.tsx` 出一张**「本地模型」预设卡**（`src/ui/onboarding/`），能力：
  - **探测常见端口**：Ollama `11434` / LM Studio `1234` / LocalAI `8080`；
  - **一键连**：命中即用已有 `createOpenAICompatible({ baseURL, authType: "none" })` 建档；
  - **拉 `/v1/models`** 列出可用模型 + **连通测试**。
- **配「能力预检」**：一个 **function-calling 探针**——本地模型若跑不动 agent loop（不支持工具调用），**当场明说**「此模型可对话、但带不动 Agent 编排」（D4 诚实交付），不让用户事后踩坑。
- 三家定位（写进卡片说明，帮用户判断）：Ollama / LM Studio = 桌面主流；LocalAI = 自托管、偏多模态。

---

## 3. 不动项（P1 不碰 / 边界红线）

明确**不动**，避免顺手扩面破坏已定边界：

1. **#223 运行时 port 抽象**：Pi 适配层的 session/run/tools 契约与运行时 port 语义**不改**；本轮只往适配层**加内置工具**（通道 3），不改运行时 owner。
2. **skills 纯知识包边界**：skills 仍是**纯知识包**，不因「查资料/拿素材」把可执行能力塞进 skills；能力住适配层与 connector，不住 skills。
3. **#239 画布插件层**：画布节点/插件层**不碰**；素材入库后如何在画布消费是既有管线，本轮不改。
4. **本地图像/视频不另开腿**：本地图像/视频**已归 ComfyUI**（`comfyuiLocal.ts`）——**不因 LocalAI 支持多模态就为本地图像/视频再开一条通道**（P1 无并行版）。B 只做**文本模型**端点。
5. **agent 操纵浏览器爬素材站入库**：**明确不做**（脆、违 ToS、无许可证据）——它与通道 1 同职能，留着就是并行版。
6. **不开放任意第三方 pi extension 安装**：通道 3 只 vendor **审计过的** `pi-web-access`，不给「装任意 extension」的口子。
7. **既有 Connector 合同不改语义**：通道 1 **复用** #226 的 `ConnectorDefinition` / `AssetSourceEvidence`，只**新增 connector 定义**，不改合同形状。

---

## 4. 分期交付（每期一个可体验闭环）

> 原则：每期收一个**用户能真跑通的闭环**（R16），独立过五门（R11）+ 用户可见的过样张/走查（R8/R13）。A 的通道 1/3 与 B **相互独立可并行**；通道 2 依赖通道 1 的 UI 骨架故稍后。

### P0 · 本地文本模型预设卡（B，风险最低、最独立，建议起点）
- **可体验闭环**：用户开着 Ollama（或 LM Studio）→ 打开接入页 → 「本地模型」卡自动探到 `11434` → 一键连 → 拉到模型列表 → 能力预检显示「支持 Agent / 仅对话」→ 建档后 Agent 能用本地模型跑一段。
- **落点**：新预设卡（仿 `ComfyuiLocalCard.tsx`）+ function-calling 探针；建档复用 `createOpenAICompatible` + `authType none`。
- **为何先做**：零外部合同依赖（不等 #226）、零供应商专有码、纯装配已有原语，风险最低。

### P1 · Connector 轨拿结构化素材（A 通道 1）
- **依赖**：#226 的 `ConnectorDefinition` / `AssetSourceEvidence` 已入 main。
- **可体验闭环**：Agent 收到「海边日落空镜」→ 走 Pexels/Pixabay connector → 结构化拿图/视频 + 许可证据 → 入库 → 画布可用；音效走 Freesound；参考视频走 Pexels Videos。
- **落点**：新增三个 connector 定义（Pexels 含 Videos / Pixabay / Freesound）+ key 配置入口；许可写进 `AssetSourceEvidence`。

### P2 · agent 查资料工具（A 通道 3）
- **前置（阻断）**：`pi-web-access` license 允许 vendoring 已核实（见 §5）。
- **可体验闭环**：Agent 遇到「这个转场/分镜怎么做」→ 用 `web_search` / `fetch_content` 拿到资料 → 用于规划/提示词，**产物不入素材库**。
- **落点**：钉版本 + 源码审计 → vendor 进 `electron/harness/runtime/pi/` 作内置工具；`source_check` 做来源可信度提示。

### P3 · 人挑素材（A 通道 2）
- **依赖**：P1 的素材入口 UI 骨架（复用其许可/入库路径）。
- **可体验闭环**：Agent 把「想自己挑一张」变成搜索 → 内置浏览器开到结果页 → **人**圈选/截图入库（复用现有 `browserPromptScreenshotSelection` 管道）。
- **落点**：Agent 侧「搜好打开」的意图→浏览器桥；**不新增自动化点击**。

> 顺序可按 #226/#223 的实际到位时间调整；P0 与 P2 不依赖 #226，P1/P3 依赖 #226。

---

## 5. 依赖与顺序

**硬前置（阻断相应期）**：
1. **#226 合同先入 main**（`ConnectorDefinition` / `AssetSourceEvidence` + 承接的两份背景文档）→ 阻断 **P1 / P3**。#226 即将随合并列车入 main；未入之前 P1/P3 不开工。
2. **#223 phase1 收口**（Pi 适配层稳定）→ 阻断**全部**开工时点：本轮所有期都建立在 #223 的适配层上，phase1 未收口不动手。
3. **`pi-web-access` license 允许 vendoring**（阻断 **P2**）：落地前实查其 license（npm 包 + 仓库 LICENSE），确认允许 vendor 进闭源桌面分发；不允许则 P2 改走「独立进程/网络隔离」或换等价 HTTP-only 方案，**不得先斩后奏 vendor**。

**并行关系**：
- **P0（B）** 与 **A 的任一期相互独立**，可最先并行推进（不等 #226）。
- **P2（通道 3）** 只依赖 #223 + license 核实，不依赖 #226，可与 P1 并行。
- **P1 → P3**：P3 复用 P1 的素材入口/许可/入库骨架，P1 先。

**建议起点**：**P0**（最独立、风险最低）+ 并行准备 **P2 的 license 核实**；#226 一入 main 立刻起 **P1**。

---

## 6. 验收门（每期 + 总）

**每期通用门**：
- **五门全过（R11）**：`check:filesize` → `check:tokens` → `check:i18n` → `check:heavy-path` → `lint:ci` → `typecheck` → `test` → `build`。
- **用户可见改动**（P0 的预设卡、P1/P3 的素材入口）：先出 mockup + 用户拍板（R8），实现后与样张逐项对账；Playwright 真体感走查（R13，截图人眼判断）。
- **可见文字国际化（R15）**：预设卡/能力预检/许可提示等全部走 i18n。

**每期专项验收（R16 真实用户任务闭环——功能交付才算完成）**：
- **P0**：建「用本地模型让 Agent 跑一段真实创作任务」端到端测试；跑不动工具调用的模型必须**在 UI 明确降级提示**（诚实交付，非静默失败）。
- **P1**：建「Agent 自主取到带许可的参考素材并入库」闭环；`AssetSourceEvidence` 里许可字段非空、来源可追。
- **P2**：建「Agent 查资料辅助规划」闭环；断言**产物不进素材库**（避免与通道 1 混线）。
- **P3**：建「人在内置浏览器挑素材入库」闭环（走查法）；断言**无 agent 自动点击**路径被触发。

**总验收**：三通道**职能不重叠**可从 UI/代码双向证明（一职能一个家，无并行版）；本地端点走通用原语、无供应商专有分支。

---

## 7. 风险与开放问题

| # | 风险 / 开放问题 | 影响 | 应对 |
|---|---|---|---|
| R1 | **`pi-web-access` license 是否允许 vendoring** | 阻断 P2；vendor 了不合规=法律/合规风险 | **落地前实查**（§5 硬前置）；不允许则改独立进程/网络隔离或换等价 HTTP-only 方案 |
| R2 | **素材站 rate limit**（Pexels/Pixabay/Freesound 免费 key 有配额） | Agent 高频取素材触限、任务中断 | connector 层做退避/缓存；触限时**明说**并降级（不静默卡住）；key 为用户自备资源 |
| R3 | **本地模型质量参差**（小模型带不动 agent loop / 输出不稳） | 用户以为「连上=能用 Agent」，实际跑不动 | function-calling **能力预检** + UI 明确「仅对话 / 支持 Agent」（D4）；不承诺质量，只承诺诚实 |
| R4 | **参考视频版权边界**（Pexels Videos 许可范围、商用/二创限制） | 用户误用于商用触权 | 许可写进 `AssetSourceEvidence` 并在 UI 可见；只接**明确免费许可**的源，Unsplash 类 hotlink 源延后 |
| R5 | **#226 合同若在合并中形变** | P1/P3 依赖其 `ConnectorDefinition`/`AssetSourceEvidence` 形状 | #226 入 main 后**以 main 实况为准复核**合同坐标再开 P1；不基于 PR 草案写死字段 |
| R6 | **通道边界随时间被侵蚀**（有人图省事让 agent 爬站入库） | 破坏「一职能一个家」，退回并行版 | §3 红线明文；P2/P3 验收断言「无自动点击爬站路径」作结构保证 |

**开放问题（需在对应期开工前定/或用户拍板）**：
- 通道 1 的三个 connector key：走**用户自备**（接入页填）还是 Nomi 侧代管额度?（倾向用户自备——免费 key、避免我们扛配额；产品级取舍，留待拍板。）
- 通道 3 的 `source_check` 结果如何呈现给用户（可信度标注的 UI 形态）——P2 出样张时定。

---

## 8. 执行记录（回填）

> 待 #223 phase1 收口 + #226 入 main 后按期开工，逐期回填 commit / 验收结果 / 走查证据。本文当前为**方向已拍板、待实施**状态。
