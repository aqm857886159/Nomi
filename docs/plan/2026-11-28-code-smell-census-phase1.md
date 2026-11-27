# Nomi 坏代码普查第一段（只读报告）：五维实查与高代价收口路线图（Q-smell）

> 状态：📋 方案待拍板
> 关联看板：`#1586`（`Q-smell` 第一段只读普查）
> 实查基线：`origin/main` @ `cd33b197d`（全仓跟踪文件 20,829 个，其中 `src/` + `electron/` + `worker/` 生产源文件 3,025 个；近 30 天匹配 `fix` 提交 941 个）
> 统一规矩：我们是一个小的桌面应用。只做创作者常走的路，以及这条路上的钱和数据安全；边角记一行，不写代码。每个 PR 写一节「明确不做」。

---

## ★0 先查别人

- https://codescene.com/product/code-health · Adam Tornhill《Your Code as a Crime Scene》确立了技术债热点的工业界标准公式 `Hotspot = Change Frequency × Code Complexity`：单纯行数大但长期无人修改的文件维护边际成本很低，真正吞噬工程吞吐并反复制造回归的是「近期高频修补 × 超大单函数/多职责耦合」的交叉区域 · **改了**本文的坏代码代价排序公式与巨石处置决定——不按纯行数把 1,399 行的 `integrationSession.ts`（30d 仅 1 次 fix）排在首位，而是按「近期 bug 密度 × 规模 × 创作者主路径与钱/数据安全权重 ÷ 收口风险」排序，将低频历史巨石列为第 20 名「暂不动主体、仅锁紧基线余量」，把算力集中在 `StoryboardPlanEditor.tsx`（30d 9 fix）、`laneHost.mts`（30d 7 fix）等高热主路径热点。
- https://knip.dev/overview/getting-started · Knip 基于入口图可达性（entry-graph reachability）统一检测孤儿文件、死导出、桶文件（barrel）冗余重导出与未用依赖，同时指出将测试文件或全量脚本无差别放入 `entry` 会掩盖「生产零调用、仅测试自嗨」的孤岛模块，而漏标动态 Worker / CLI 子进程入口会产生误报 · **改了**「① 没人调用」的实查方法——在跑完 `knip`（检出 1,672 个未用导出）后，用 AST 与全仓 `git grep` 做二次证伪：一方面排除了 `electron/capabilityCore/host.ts`（关窗 CLI 子进程入口）、2 个 Web Worker 及 `vite.config.ts` `resolve.dedupe` 所需的 `scheduler` / `use-sync-external-store` 等 9 处假阳性；另一方面挖出被测试入口掩盖的 **18 个「生产零导入、仅单测/评测调用」孤岛生产文件（1,445 行）**。
- https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md · Dependency Cruiser 通过分层禁止规则与循环依赖基线棘轮（ratchet）治理架构腐蚀，核心经验是跨层穿刺往往聚集在少数缺少中立归属的高扇入 DTO/契约文件上，先抽离中立契约层比逐个业务调用方打补丁收益高一个数量级 · **确认了**「④ 模块不清」的首批收口切口——实查 `scripts/boundaries-baseline.json` 中 49 条 `src-no-import-electron` 违规，前 4 个目标契约文件就占了 29 条（59.2%），且 `electron/shared/contracts/agentChatContracts.ts` 已建好却零导入，据此定下「纯契约迁入 `electron/shared/contracts/` 一刀削减 >60% 跨层穿刺」的低风险方案。
- https://floating-ui.com/docs/react · Floating UI 与 Radix Primitives 将锚点定位、视口碰撞翻转、Escape 栈、焦点陷阱与外部点击关闭收敛为统一无头原语，避免业务组件手写 `getBoundingClientRect() + createPortal` 或用错误 ARIA 角色（如把富交互面板标成 `role="menu"`）引发定位漂移和键盘失灵 · **确认了**「② 该用通用组件没用」的收口准则——仓库 `src/design/` 已备齐 `AnchoredPopover`、`DesignModal`、`WorkbenchMenu`，但业务层仍残留 7 处手写 `getBoundingClientRect` 浮层与 3 处误挂 `role="menu"` 的富面板（多次出现在 30d 高频 fix 文件中），后续收口直接对位替换进现有原语，不再手写局部定位逻辑。

---

## 短版设计卡

- **★1 目标与验收口径**：
  - **用户可见结果**：产出一份全量实查、数据可复核、严守在途隔离的坏代码普查第一段报告，把全仓「① 没人调用 / ② 该用通用组件或现成库没用 / ③ 反复写 / ④ 模块不清 / ⑤ 太大」五类坏代码按真实维护与出错代价排定优先级，并拆出立即可派工的「机械删除清单」与「需用户拍板的瘦身候选」。
  - **量化指标与量具**：
    1. 五类坏代码全覆盖且每项绑定仓库真实量具（`knip`、`scripts/self-written-review.mjs`、`eslint-suppressions.json`、`scripts/vocabularies-baseline.json`、`docs/engineering/concept-owners/`、`scripts/boundaries-baseline.json`、`scripts/check-boundary-owners.mjs`、`scripts/file-size-baseline.json`、`git log --since='30 days ago' --grep='fix'`）；
    2. Top 20 高代价清单与立即可机械删除清单对 6 个在途大 PR（`#1712`、`#1713`、`#1692`、`#1702`、`#1703`、`#1665`，全量分页核对共 670 个独立文件）的推荐立即改动文件冲突数为 **0**；
    3. 文档与门岗校验：`scripts/prior-art-lib.mjs`（`evaluatePlan`）、`scripts/check-doc-status.mjs`、`scripts/check-docs-index.node-test.mjs`、`scripts/check-pr-judgement.mjs`（`push` / `merge` 双阶段）全部 `0` 错误通过。
  - **★1b 外部依赖生命周期**：不适用（第一段为纯只读普查文档，不新增或升级任何外部依赖）。
  - **★1c 老数据怎么过**：不适用（不改动任何运行时代码、IPC 协议或本地项目持久化格式；报告中涉及历史迁移层 `laneLegacy*` 的退役已单列交用户拍板兼容窗口）。
- **★2 最小方案与备选对比**：
  - **方案 A（放弃）**：仅按文件行数或单一 lint 规则静态罗列大文件。缺陷：无法区分「稳定的生成表/协议定义」与「高频修补的创作者主路径泥球」，容易诱导高风险低收益的大拆大改。
  - **方案 B（放弃）**：在普查分支顺手删改死代码和组件。缺陷：违背 `#1586` 第一段只读交付要求，放大评审面并极易与 6 个在途 PR（670 个文件）撞车。
  - **方案 C（采用）**：用现有门岗基线 + TypeScript AST + Prettier 格式化代码行口径 + 近 30d/14d `fix` 提交热度 + 全仓 `git grep` 假阳性证伪，输出「五维全景量化 → Top 20 高代价非在途排序表 → 机械删除池 vs 待用户拍板池 → 分批路线图」只读报告。
- **★3 一致与复用**：
  - **与前序清理衔接（P5 核对以前做过什么）**：2026-11-24 前序 `Q-smell` 批次（`#1639`、`#1640`、`#1641`、`#1643`、`#1644`、`#1646`、`#1647`）已清理 652 个 `.ts` 死导出、4 处生产克隆 + 19 处走查克隆、15 条 `src -> electron` 边界边及 11 条过期文件体积上限；同时看板 `#1586` 已单独立项 `Q-atomic-scripts`（脚本/测试 `.tmp + rename` 重复写盘收口）与 `Q-provenance-portal`（`ProvenancePanel.tsx` 等 5 处手写 `fixed` 遮罩弹层迁 `DesignModal`，正等待 `#1703`）。本报告聚焦上述批次**尚未覆盖的存量与回潮根因**，绝不重复立项。
  - **量具口径一致**：行数同时给出「原始物理行（`raw`）」与仓库 `check:filesize` 门岗权威口径「Prettier 格式化去空行/纯注释代码行（`fmt`）」，消除统计口径漂移。
- **★4 边界、失败态与回滚**：
  - **在途隔离边界**：通过 GitHub API 全量分页拉取 `#1712`（22 文件）、`#1713`（158 文件）、`#1692`（20 文件）、`#1702`（223 文件）、`#1703`（172 文件）、`#1665`（104 文件）共 **670 个独立在途文件**，在途热点仅记入背景说明与「明确不做」，不进入本轮推荐立即动手列表。
  - **防误删护栏**：凡涉及动态进程入口（`host.ts`）、Web Worker（`*.worker.ts`）、Vite 开发注入（`startupDiagnostics.ts`）、pnpm 严格去重锚点（`scheduler` / `use-sync-external-store`）及 `scripts/boundary-owners-ledger.json` 挂钩根因合同的文件（如 `agentFailureDiagnostics.ts`、`experienceRepository.ts`），均已逐一核实并标注处置前置条件。
  - **P1 权限边界**：严格执行「机械删除走 PR，删功能和规则交用户」。
  - **回滚**：本 PR 仅新增 1 份计划文档，零运行时影响，如需撤回直接 `git revert` 即可。
- **★9 验收清单与反例**：
  - [x] 正向：覆盖 ①~⑤ 全部五个维度，且每项均有精确路径、行数、调用/重复/fix 实查证据。
  - [x] 正向：Top 20 清单包含排名、类别、精确文件路径+行数、实查证据、推荐动作（直接删 / 换现成库或组件 / 合并成单源 / 暂不动）、预估净删行数与风险六列齐全。
  - [x] 正向：明确拆分「立即可机械删除的零引用清单」与「需用户拍板的功能/规则瘦身候选」。
  - [x] 反例检查 1（防撞车）：检查推荐立即动手的源码文件是否命中 `#1712` / `#1713` / `#1692` / `#1702` / `#1703` / `#1665` 任一在途文件 → 实核为 **0 命中**（共享配置如 `package.json`、`scripts/file-size-baseline.json` 已显式标注在途关联 PR）。
  - [x] 反例检查 2（防假阳性误删）：检查 `knip` 报出的 `@vitejs/plugin-react`、`onnxruntime-common`、`scheduler`、`use-sync-external-store` 与 `host.ts` 是否被误列入机械删除清单 → 已全部证伪并排除在删除清单外。
  - [x] 反例检查 3（防路径泄露与范围越界）：仓库 diff 仅含 `docs/plan/2026-11-28-code-smell-census-phase1.md` 1 个文件，且文档与 PR 正文均零本机绝对路径。

---

## 明确不做

1. **本 PR 不改任何生产代码、测试代码、脚本或门岗配置**：第一段仅交付全仓量化实查报告与分批收口路线图，不在本分支顺手删一行代码或改一处导入。
2. **不触碰、不派工抢改 6 个在途 PR 正在修改的 670 个文件**：以下高热文件虽在全仓扫描中命中高分，但因正处于在途 PR 施工面内，**第一批收口明确绕开，待对应 PR 合入后再复核余量**：
   - `#1702`（S-D，223 文件）：`src/workbench/generationCanvas/runner/generationRunController.ts`（719L fmt，30d 13 fix）、`src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx`（997L fmt，30d 7 fix）、`electron/catalog/seedBuiltins.ts`（933L fmt）、`electron/catalog/types.ts`（7 条跨层边）、`SpendConfirmDialog.tsx`（30d 8 fix）；
   - `#1703`（S-E，172 文件）：`electron/runtime.ts`（638L fmt，30d 15 fix）、`src/workbench/generationCanvas/nodes/InlineParameterBar.tsx`（787L fmt，30d 12 fix / 14d 10 fix）、`src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx`（695L fmt，30d 5 fix）、`WhiteboardLeaferCanvas.tsx`（796L fmt）、`WhiteboardDrawingTool.tsx`（882L fmt）、`archetypeMeta.ts`（707L fmt，30d 6 fix）、`src/i18n/locales/generationCommon.ts`（30d 21 fix）；
   - `#1712`（PR0-recovery，22 文件）：`electron/capabilityCore/appIntegrationCanvasShot.ts`（795L fmt，30d 11 fix）、`electron/productionRun/productionGenerationSubmission.ts`（734L fmt，30d 9 fix）、`electron/productionRun/submissionIntent.ts`（301L，30d 7 fix，11 处同步 IO）；
   - `#1713`（F-S-1，158 文件）：`src/workbench/timeline/TimelinePanel.tsx`（791L fmt）、`src/workbench/workbenchStore.ts`（744L fmt，`Ca=104`，30d 5 fix）、`electron/events/eventLogRepository.ts`（20 处同步 IO）、`electron/assets/assetPreview.ts`（13 处同步 IO）；
   - `#1665`（T-6a，104 文件）与 `#1692`（C-0，20 文件）：`src/ui/onboarding/OnboardingDrawer.tsx`（845L fmt）、`electron/catalog/catalogStore.ts`（817L fmt，`Ca=61`）、`src/workbench/generationCanvas/nodes/NodeParameterControls.tsx`（811L fmt）。
3. **不重复立项看板已有专项卡**：脚本/测试侧 `.tmp + rename` 重复写盘归属既有 `Q-atomic-scripts`；`ProvenancePanel.tsx` 等 5 处手写 `fixed` 遮罩弹层归属既有 `Q-provenance-portal`（待 `#1703`）。
4. **不为低频边角造抽象框架、不主动大拆低变更巨石**：遵循「我们是一个小的桌面应用。只做创作者常走的路，以及这条路上的钱和数据安全；边角记一行，不写代码」，对 30 天零/低变更的历史巨石（如 `integrationSession.ts`、`operationLedger.ts`、`timelineKernel.ts`、`devlab` 实验台）只锁紧体积上限防膨胀，不做投机性重写；对外围冷门脚本与非主路径细节只删死代码、不补新包装。

---

## 一、全仓五维坏代码量化全景（基线 `cd33b197d`）

| 维度 | 核心量具与基线文件 | 全仓实查关键指标（非在途净值） | 核心病灶一句话定性 |
| :--- | :--- | :--- | :--- |
| **① 没人调用** | `knip@6.45.1` + TS AST + 全仓 `git grep` | **1,503 个**非在途未用导出（697 个生产文件：963 值 + 540 类型；全仓含在途共 1,672 个）；**6 个**零生产导入文件；**18 个**仅单测/评测调用的孤岛生产模块（**1,445L**）；**17 个**真零调用脚本（**1,678L**）；**1 个**死依赖 `@radix-ui/react-switch` | `knip` 未入 `gates` 且把测试列为入口，导致桶文件重导出（`tablerIcons.ts` 181 个）与迁移遗留壳持续回潮 |
| **② 该用通用组件/现成库没用** | `self-written-review.mjs` + `eslint-suppressions.json` + `src/design/` 结构测试 | `self-written.json` 70 项中 **10 项告警**（5 项 `under-review` 含 1 项已逾期、3 项 `to-replace`、2 项复审逾期）；`eslint-suppressions.json` 压制 **1,058 处**（含 **367 处**热路径同步 `fs`、**30 处**同步 IPC `sendSync`、**7 处**手写 Map 驱逐、**6 处**主线程 `Atomics.wait`）；**7 处**手写 `getBoundingClientRect` 浮层 + **3 处**误用 `role="menu"` 富面板 + 分段器三轨并存 | 基础设施层自写包装与同步阻塞未清退；UI 层部分高频节点绕过 `AnchoredPopover` / `NomiSegmented` 手写定位与状态 |
| **③ 反复写** | `scripts/vocabularies-baseline.json` + `concept-owners/` + 模式扫描 | 跨层词表冻结 **46 条 `debt`**（约 15 组状态枚举在多处各写一份，如 7 态终态集重复 4 处、`TaskStatus` 重复 4 处）；**4 个 `pending` 核心概念**（`canvas.zoom` 等）多处各算一份 + **5 个**冻结第二写口 + **234/434（53.9%）**概念缺 `parity_test`；**6 处**手写拆解 `"Error invoking remote method"`、**22 处**手写 `process.kill(pid, 0)` 探活 | 跨 IPC 缺中立 `electron/shared/contracts/` 单源常量与结构化错误码，迫使主进程与渲染层各自复制字符串分支 |
| **④ 模块不清** | `scripts/boundaries-baseline.json` + `check-boundary-owners.mjs` + AST 耦合度 | **49 条** `src -> electron` 跨层穿刺（前 4 个目标文件占 **29 条 = 59.2%**）；**4 组**静态循环依赖（2 组在 `runtime.ts` 任务主干、2 组在 ComfyUI 设置页）；**15+ 个**三职责混居模块（JSX + 直调 IPC + DOM 测量/`localStorage`）；`bridge.ts` 扇入 **`Ca=159`**、`NomiStudioApp.tsx` 扇出 **`Ce=65`**；边界账本 **10 条 `unverified` + 85 条 `unreadable_symbols`** | 共享契约滞留 `electron/` 实现目录造成大面积穿刺；顶层壳与画布节点同时承担视图、IO 编排与 DOM 测量 |
| **⑤ 太大** | `scripts/file-size-baseline.json` + Prettier 代码行量具 + AST 顶层跨度 | **33 个**超限基线文件（25 个仍 >800L fmt；**16 个非在途基线文件有 190 行未锁余量**）；**47 个** 650–799L fmt 黄牌文件（**37 个非在途生产文件**，最高 `approvalReceipt.ts` **799/800L**）；**29 个** `<500L` 中小文件内藏 `>300L` 巨型单函数 | 800 行红线下方的 700–799L 黄牌区聚集了大量近期高频 fix 主路径文件，单函数闭包长达 450–997 行 |

---

### 1.1 没人调用（① Dead Code：导出、文件、孤岛模块、脚本、依赖）

1. **未引用生产导出（非在途 697 个文件 / 1,503 个导出）**：
   - 2026-11-24 前序 PR（`#1639`/`#1641`）虽已清掉一批 `.ts` 死导出，但因 `knip` 未接入 CI 棘轮，当前非在途生产文件仍存 **963 个未用值导出 + 540 个未用类型导出**。
   - **Top 10 非在途死导出聚集文件**：
     - `src/vendor/tablerIcons.ts`（295L）：**181 个**未用重导出（180 个零调用图标组件 + 1 个类型，如 `IconArmchair`、`IconBike`、`IconFridge`、`IconWashMachine` 等整批家具/交通图标无人使用）；
     - `src/design/index.ts`（77L）：**41 个**未通过桶入口引用的重导出（7 值 + 34 类型），且 `src/design/README.md` 已明文记账 **3 个生产零调用设计原语**：`DesignBadge`（`src/design/status.tsx`）、`NomiAILabel`（`src/design/identity.tsx`）、`NomiIdentityIcon`（`src/design/NomiIdentityIcon.tsx`）；
     - `electron/shared/modelArchetypes/index.ts`（44L）：**19 个**未用桶重导出（9 值 + 10 类型）；
     - `src/api/desktopClient.ts`（294L）：**16 个**未用导出（12 个旧 ModelCatalog IPC 包装函数 + 4 个类型）；
     - `electron/shared/contracts/modelAccessCapabilities.ts`（288L）：**12 个**（11 值 + 1 类型）；
     - `src/ui/browser/dialog/NomiBrowserDialogModel.tsx`（465L）：**12 个**内部常量/辅助函数多余 `export`；
     - `src/workbench/export/exportTypes.ts`（112L）：**12 个**未用导出类型；
     - `src/workbench/onboarding/handbookContent.ts`（218L）：**10 个**（6 值 + 4 类型）；
     - `electron/catalog/stagedVendorIdentity.ts`（241L）：**9 个**（8 值 + 1 类型）；
     - `electron/capabilityCore/mcpConfig.ts`（715L）：**9 个**（6 值 + 3 类型）。
2. **零生产导入文件（6 个真死文件 vs 5 个动态入口误报）**：
   - **确认零生产调用的 6 个非在途文件**：
     - `src/config/modelSource.ts`（15L）：全仓 `git grep` **0 命中**，彻底孤立；
     - `src/ui/switch.tsx`（31L）：全仓代码 **0 导入**（仓库已统一使用 `src/design/forms.tsx` 中的 Mantine `DesignSwitch`），且它是 `package.json` 中 `@radix-ui/react-switch` 的**唯一代码消费者**；
     - `electron/shared/contracts/agentChatContracts.ts`（15L）：本为跨层解耦创建的中立重导出壳，但全仓 **0 导入**（`src/api/desktopClient.ts:7` 仍跨层直引 `electron/harness/agentChatContracts.ts`）；
     - `src/workbench/creation/storyboard/StoryboardNudge.tsx`（61L）：全仓代码 **0 导入**，`tests/ux/creation-flow-fixes.walk.mjs:8` 注释已确认「拆分镜浮现卡在 Agent 宿主迁移时就没人挂了，没有现役对应物」；
     - `src/workbench/ai/agentFailureDiagnostics.ts`（32L）：v3→v4 面板迁移后 **0 代码导入**，但 `scripts/boundary-owners-ledger.json:170` 仍挂有旧根因合同锚点（删前需同步办理账本退役）；
     - `src/workbench/ai/v4/vendor/aiElementsContract.ts`（24L）：**0 代码导入**，仅在注释与 `scripts/vocabularies-baseline.json:1805` 挂有词表记录。
   - **实查证伪的工具假阳性（严禁误删，应补入 `knip.json` `entry`）**：
     - `electron/capabilityCore/host.ts`（144L）：Nomi 关窗态 CLI spawn `electron host.js` 的无窗口独立进程入口；
     - `src/lib/removeBackground.worker.ts`（104L）与 `src/workbench/generationCanvas/videoDepth/videoDepth.worker.ts`（211L）：通过 `new URL(..., import.meta.url)` 加载的 Web Worker 入口；
     - `src/utils/startupDiagnostics.ts`（53L）：由 `scripts/dev-electron.mjs:346` 在开发态 HTML 注入加载；
     - `electron/agentLane/laneNativeLoader.cts`（55L）：编译为 `.cjs` 供 NodeNext 私岛加载原生模块的桥接器。
3. **仅被自身单测或离线评测调用的「孤岛生产模块」（18 个非在途文件，共 1,445 行）**：
   - 因 `knip.json` 将 `**/*.test.{ts,tsx,mjs}` 与 `evals/**` 列为 `entry`，以下位于生产目录的模块虽在生产运行图中 **零调用（`prodHits = 0`）**，却长期留在生产树内：`src/workbench/generationCanvas/nodes/director/model/plan/directorPlanner.ts`（220L，仅 `evals/director/s1Adapter.ts` 引用）、`electron/events/agentChatTrace.ts`（160L）、`electron/capabilityCore/shotLanguage.ts`（136L）、`electron/experience/experienceRepository.ts`（123L，挂 `boundary-owners-ledger.json`）、`electron/catalog/imageEditProbe.ts`（77L）、`electron/parity/parityDrive.ts`（69L）、`electron/productionRun/shotProviderHandover.ts`（68L）、`src/workbench/creation/scriptDraftSnapshot.ts`（68L）、`electron/settings/portableConfig.ts`（65L）、`src/workbench/creation/creationIntentRouting.ts`（60L）、`electron/assets/projectAssetLease.ts`（51L）、`src/ui/onboarding/comfyCandidateUiFlow.ts`（37L）、`electron/capabilityCore/generationSingleShot.ts`（35L）、`electron/trustedSyncIpc.ts`（24L）、`electron/parity/knownSplits.ts`（23L）、`src/desktop/bridgeSurfaceSources.ts`（21L）、`src/workbench/export/exportCopy.ts`（19L）、`electron/ai/agentWorkModePolicy.ts`（15L）。此外，`electron/capabilityCore/agentPanelSpendConfirmTestUtils.ts`（507L raw / 656L fmt）等约 15 个 `*TestUtils.ts` 直接混放在生产目录而非 `testSupport/`。
4. **孤儿脚本与依赖实核**：
   - **17 个真零调用脚本（共 1,678 行）**：全仓 `git grep`（含 `package.json`、`.github/workflows/`、`scripts/`、`.claude/`、`.agents/`、`eslint-suppressions.json`）确认无外部调用方，清单详见 §3.1。
   - **依赖核验**：`@radix-ui/react-switch`（随 `src/ui/switch.tsx` 删除可彻底移除）；而 `knip` 报出的 `@vitejs/plugin-react`（`vite.config.ts:187` 动态 `import()`）、`onnxruntime-common`（`src/types/onnxruntime-web.d.ts:13` 类型声明重导出 + `package-budget.json` 登记）、`scheduler` 与 `use-sync-external-store`（`vite.config.ts:199` `resolve.dedupe` 在 pnpm 严格隔离下保障 React 19 / R3F 单例）均为构建必需项，**不可删除**。另 `hono` 在 `knip.json` 被 `ignoreDependencies` 屏蔽，实查仅被 15 个测试文件与 `scripts/lab-onboard.ts` 用作本地 mock server，生产代码零运行时导入。

---

### 1.2 该用通用组件/现成库没用（② 违反 P0 / 阻塞豁免 / 设计系统绕过）

1. **`docs/engineering/self-written.json` 自写登记审计（70 项中 10 项触发待决告警）**：
   - **已逾期 `under-review`（1 项）**：`ipc-invoke-failure-text`（`electron/ipcInvokeFailure.ts`、`ipcResult.ts`、`projectSaveFailure.ts`，复审日 `2026-11-23` 已过期，跨 IPC 仍靠正则拆解 Electron 报错字符串）。
   - **临期 `under-review`（4 项，`2026-11-30` 到期）**：`network-stack`（`electron/proxy*.ts`、`hardenedFetch.ts` 等 10 个文件）、`durable-json`（`electron/jsonFile.ts`、`durability.ts`、`sharingRetry.ts`——尽管 `package.json` 已安装 `atomically@2.1.1`，仍保留多层自写同步写盘重试）、`logging-and-crash`（`electron/logging/` + `crashLog.ts`）、`gate-family`（100+ 个自写 `scripts/check-*.mjs` 门岗，已续期 1 次；对照 `docs/audit/2026-10-01-gate-ledger.md` 统计，60% 为纸面红灯、93 个门岗历史上零真红灯）。
   - **明确标记 `to-replace`（3 项）**：`lane-legacy-migration`（7 个 `electron/agentLane/laneLegacy*` 旧会话迁移文件，约 990 行）、`mcp-protocol`（自写 JSON-RPC 桥与旧 stdio 壳）、`generate-outcome-receipt`（`generateOutcomeReceipt.ts`）。
   - **复审逾期 `justified`（2 项）**：`lane-coding-tools`（`2026-10-31` 逾期）、`lane-provider-watchdog`（`2026-11-15` 逾期）。
2. **`eslint-suppressions.json` 压制的通用反模式（共 1,058 处压制）**：
   - **主进程热路径同步文件 IO（`hot-path-sync-fs`：367 处）**：非在途重灾区为 `electron/productionRun/productionRunLock.ts`（14 处，30d 4 fix）、`electron/export/exportJobStore.ts`（14 处）、`electron/assets/projectAssetStore.ts`（13 处，30d 3 fix）、`electron/productionRun/productionRunRepository.ts`（13 处，30d 2 fix）、`electron/workspace/workspaceRegistry.ts`（12 处）、`electron/export/ffmpegRunner.ts`（12 处）、`electron/workspace/workspaceManifest.ts`（11 处）、`electron/workspace/workspaceManifestTransaction.ts`（11 处）、`electron/assets/uploadContentStore.ts`（11 处）、`electron/export/exportTempInput.ts`（11 处）。
   - **渲染层同步 IPC 阻塞（`renderer-sync-ipc`：30 处）**：`electron/preload/modelOnboardingBridge.ts`（112L）**单文件占 21 处 `ipcRenderer.sendSync`**（占全仓 70%），直接卡顿渲染主线程。
   - **手写缓存驱逐与同步死等**：`generic-map-eviction` **7 处**（`apimartGenerationProvider.ts` 独占 5 处手写 Map 容量淘汰）；`main-sync-wait` **6 处**主线程 `Atomics.wait` 硬阻塞睡眠（`hostConfigWrite.ts`、`operationLedger.ts`、`promotionJournal.ts`、`jsonFile.ts`、`providerAdapter/store.ts`、`workspaceRegistry.ts`）；另有 `@typescript-eslint/no-unused-vars` **441 处**历史压制。
3. **绕过 `src/design/` 原语的真实 UI 热点**：
   - **手写 `getBoundingClientRect() + createPortal` 锚点浮层（7 处，绕过 `AnchoredPopover`）**：如 `src/design/AnchoredPopover.tsx:57-60` 明文记账，非在途 5 处为 `ClipNode.tsx`、`PanoramaViewer.tsx`、`SelectionPromptSaveController.tsx`、`ScreenshotCropOverlay.tsx`、`AssetTile.tsx`（另 `InlineParameterBar.tsx`、`NodeGenerationComposer.tsx` 在 `#1703` 在途）。
   - **富交互面板误挂 `role="menu"`（3 处）**：`ProjectAgentResidentShell.tsx`、`WorkflowNodeMenu.tsx`（及 `#1703` 在途 `NodeGenerationComposer.tsx`）内含输入框/分组控制却挂 `role="menu"`；另 `ShotTableNode.tsx` 为 `menu.structure.test.ts` 唯一冻结旧坐标菜单。
   - **分段器、徽章、搜索框多轨并存**：分段器同时存在自写 `NomiSegmented`（5 处调用）、Mantine `DesignSegmentedControl` 以及 **5 处散落手写 `role="tablist"`**（`ProjectLibraryPage.tsx`、`AssetLibraryToolbar.tsx`、`WorkflowLibraryContent.tsx`、`PreviewSourcePanel.tsx`、`UserPromptComposer.tsx`）；徽章除 `StatusBadge` 与零调用的 `DesignBadge` 外，画布节点另有 **4 个手写状态徽章组件**（`NodeQueuedBadge.tsx`、`NodeDeconstructionBadge.tsx`、`TechnicalReviewBadge.tsx`、`ShotMountBadges.tsx`）；另有 **3 处手写紧凑搜索框**绕过 `DesignSearchInput`、**7 处原生 `<input type="checkbox">` / 2 处原生 `<select>`** 绕过表单原语。

---

### 1.3 反复写（③ 多处副本 / 未收口概念 / 重复纯工具）

1. **跨层字面量词表多副本（`scripts/vocabularies-baseline.json`：46 条 `debt`）**：
   - `TERMINAL_RUN_STAGES`（7 个终态成员）在 `existingConnection.ts`、`liveHarness.ts`、`providerAdapter/store.ts`、`adapterVerificationViewModel.ts` **4 处各写一份**；
   - `TaskStatus`（`queued | running | succeeded | failed`）在 `codexCli.ts`、`runtime.ts`、`responseParsing.ts`、`localTaskJobs.ts` **4 处重复定义**；
   - 其余重复簇包括 `ExportJobStatus` 活跃集、`AdapterModeState`、`CustomCall` 状态与转录结果、`GenerationReconcileOutcome`、`BrowserPromptScreenshotSelectionResult`、`FoldableModelCard` 状态子集（3 处）等，均因缺少 `electron/shared/contracts/` 下的 `as const` 真相源导致跨进程手抄。
2. **多处各算一份的核心业务概念（`docs/engineering/concept-owners/`）**：
   - **4 个 `pending` 概念尚未完成单源收口**：
     - `canvas.zoom`（19 个消费者）：5 个画布节点组件（`NodeFloatingToolbar`、`NodeGeneratingOverlay`、`NodeImportingOverlay`、`NodeLabelRow`、`NodeGenerationComposer`）仍直读持久化 `workbenchStore.categoryViewports[*].zoom` 而非实时 `useCanvasLiveZoom`，伴随 6 个 `pending_write_doors`；
     - `generation.declared-default-model`（11 个消费者）：主进程虽已有 `createGenerationDefaultModelResolver`，但渲染层 `defaultNodeModelSelection.resolveDefaultModelOption` 与 `availableModels.pickSavedDefaultModel` 仍在各自读取设置按 `(vendorKey, modelKey)` 重复匹配；
     - `generation.mode-params`（5 个消费者）与 `generation.model-switch-params`（6 个消费者）：发送端与面板端仍存过渡桥接表。
   - 此外全仓尚存 **5 个冻结第二写口（`second_write_ports`）**、**31 个未登记写口（`unregistered_boundaries`）**，且 **234/434（53.9%）个概念无 `parity_test`**。
3. **跨模块重复实现的纯工具逻辑**：
   - **IPC 报错前缀剥离 6 处散写**：除 `electron/ipcInvokeFailure.ts` 外，`browserCaptureSource.ts`、`generationFailureDetect.ts`、`rendererLog.ts`、`browserAssetPopoverUtils.ts`、`storyboardFailureCopy.ts` 等 **6 个生产文件**各自手写 `"Error invoking remote method"` 字符串匹配，直接放大了 `classifyError.ts`（30d **11 次 fix**）与 `narrate.ts`（30d **7 次 fix**）的维护脆弱性；
   - **进程探活 `process.kill(pid, 0)` 22 处手写**：**11 个主进程生产文件 + 11 个脚本/测试文件**各自重复编写 `ESRCH`/`EPERM` 异常分支；
   - **样板重复**：**43 个生产文件**内部重复 `err instanceof Error ? err.message : String(err)` ≥2 次；**80 个生产文件**内联拼装 `createHash('sha256')`。

---

### 1.4 模块不清（④ 跨层穿刺 / 静态循环 / 职责缠绕 / 耦合咽喉）

1. **渲染层穿刺主进程目录（`scripts/boundaries-baseline.json`：49 条 `src-no-import-electron`）**：
   - 49 条违规边仅指向 17 个主进程文件，其中 **Top 4 目标文件占 29 条（59.2%）**：
     - `electron/productionRun/productionRunTypes.ts`：**13 条**（非在途）；
     - `electron/catalog/types.ts`：**7 条**（`#1702` 在途，待其合入后迁移）；
     - `electron/settings/automationPolicyContract.ts`：**5 条**（非在途）；
     - `electron/catalog/parameterReferenceContract.ts`：**4 条**（非在途）；
     - 另 `electron/workspace/workspaceFileIndex.ts`（3 条）、`electron/export/exportJobManager.ts`（2 条）、`electron/harness/agentChatContracts.ts`（1 条，而 `electron/shared/contracts/agentChatContracts.ts` 已存在却无人导入！），以及 `.dependency-cruiser.mjs:82` 注释记账的 **3 处 `src/devlab -> electron/catalog/*` 运行时值导入**。
2. **4 组静态循环依赖（`no-new-static-circular`）**：
   - `electron/runtime.ts <-> electron/tasks/taskResultQuery.ts`（`taskResultQuery.ts` 30d **8 次 fix**，`runtime.ts` 30d **15 次 fix**）；
   - `electron/runtime.ts <-> electron/textTaskRunner.ts`；
   - `ComfyuiWorkflowSettingsPage.tsx -> WorkflowSidebar.tsx -> AddComfyuiInstanceButton.tsx -> ComfyuiLocalCard.tsx -> ComfyuiWorkflowSettingsPage.tsx`；
   - `ComfyuiLocalCard.tsx -> ComfyuiWorkflowSettingsPage.tsx -> useWorkflowCatalog.ts -> ComfyuiLocalCard.tsx`。
3. **三职责缠绕模块与超高耦合枢纽**：
   - **渲染层混合组件（JSX + 直接 IPC + DOM 测量/`localStorage`/Store 直写）**：`ClipNode.tsx`（708L raw / 847L fmt，`Ce=35`，30d 3 fix）、`AssetLibraryPanel.tsx`（754L raw / 837L fmt，`Ce=37`）、`NomiBrowserDialog.tsx`（688L）、`ConnectAssistantCard.tsx`（557L）、`NomiBrowserDialogModel.tsx`（465L）、`BrowserAssetOverlayApp.tsx`（423L）、`NodeVersionCardsHost.tsx`（264L，30d 4 fix）；
   - **主进程混合模块（`ipcMain`/模块级可变单例 + 同步 `fs` + 网络 `fetch`）**：`electron/browser/media/browserViewMedia.ts`（665L）、`electron/update/autoUpdater.ts`（397L）、`electron/video/extractVideoFrame.ts`（293L）、`electron/vendor/vendorBaseFallback.ts`（257L）；
   - **超高耦合咽喉**：`src/desktop/bridge.ts`（437L，**`Ca=159, Ce=24`**，30d **9 次 fix**）、`electron/capabilityCore/appIntegration.ts`（544L，**`Ce=45`**，30d **10 次 fix**）、`src/workbench/NomiStudioApp.tsx`（771L，**`Ce=65`**，30d **6 次 fix**）、`src/workbench/ai/ProjectAgentResidentShell.tsx`（646L，**`Ce=52`**，30d **7 次 fix**）；
   - **边界账本缺口**：`check-boundary-owners.mjs` 扫描 2,202 条声明，存在 **10 条 `unverified` + 85 条 `unreadable_symbols`**。

---

### 1.5 太大（⑤ 超限基线巨石 / 650–799L 黄牌悬崖 / 巨型单函数）

1. **`scripts/file-size-baseline.json` 33 个超限基线文件**：
   - 25 个文件仍超过 800 格式化代码行红线，最高前五为：`integrationSession.ts`（**1,399L fmt**，单类 `IntegrationSessionService` **889L**）、`productionRunDriverOps.ts`（**1,119L fmt**，单函数 `createDriverOps` **997L**）、`operationLedger.ts`（**1,087L fmt**）、`timelineKernel.ts`（**1,046L fmt**）、`GenerationCanvasReactFlow.tsx`（**997L fmt**，`#1702` 在途）。
   - **8 个基线文件实际已跌破 800L 红线却仍留在豁免表内**（其中非在途 5 个可直接退表或大幅压线：`ProjectAgentResidentShell.tsx` **720L / max 762**、`electron/main.ts` **675L / max 682**、`StoryboardShotTable.tsx` **734L / max 742**、`projectAssetStore.ts` **793L / max 794**、`mcpGenerationMultiShot.ts` **793L / max 794**）。全表 **16 个非在途基线文件合计有 190 行未锁紧余量（`slack`）**。
2. **650–799 格式化行「黄牌区」（47 个文件，其中非在途生产文件 37 个）**：
   - 紧贴 800 行爆表线的非在途文件：`electron/capabilityCore/approvalReceipt.ts`（**799L fmt**，仅差 1 行红灯！单函数 `createApprovalReceiptAuthority` 555L）、`src/workbench/creation/storyboard/exec/storyboardRowActions.ts`（**790L fmt**，30d **7 次 fix**）、`src/ui/onboarding/CapabilityModeEditor.tsx`（**780L fmt**）、`electron/catalog/comfyuiWorkflowImport.ts`（**776L fmt**）、`src/workbench/NomiStudioApp.tsx`（**770L fmt**，30d **6 次 fix**，单组件 632L）、`electron/productionRun/productionRunReducer.ts`（**769L fmt**）、`src/workbench/generationCanvas/store/canvasGraphActions.ts`（**768L fmt**）、`electron/workspace/workspaceManifest.ts`（**765L fmt**）、`src/workbench/generationCanvas/agent/applyCanvasToolCall.ts`（**758L fmt**，单函数 542L，30d 4 fix）、`electron/capabilityCore/generationTransportAdapters.ts`（**754L fmt**，单函数 397L，30d 5 fix）、`src/workbench/library/ProjectLibraryPage.tsx`（**753L fmt**，30d 4 fix）、`src/workbench/capability/capabilityApplyHandler.ts`（**750L fmt**，单函数 483L，30d 5 fix）、`src/workbench/ai/v4/AgentPanelV4Composer.tsx`（**698L fmt**，30d **8 次 fix / 14d 6 次 fix**）。
3. **中小文件内嵌巨型单函数（29 个 `<500L` 文件含 `>300L` 单顶层声明）**：
   - 非在途代表：`NomiBrowserAssetPopover.tsx`（468L 中单组件 **423L**）、`ModelCapabilityEditor.tsx`（427L 中单组件 **389L**）、`ModelPickerScreen.tsx`（436L 中单组件 **385L**）、`ComfyuiLocalCard.tsx`（426L 中单组件 **355L**，且卷入 2 条循环依赖）、`DocumentListSidebar.tsx`（449L 中单组件 **353L**）、`NodeErrorReport.tsx`（389L 中单组件 **311L**，30d 6 fix）、`laneApprovalGate.ts`（458L 中单函数 **313L**）、`submissionOutbox.ts`（448L 中单函数 **313L**）。

---

## 二、高代价坏代码 Top 20 清单（非在途 · 按维护与出错代价排序）

**排序口径**：`代价分 = F(近期 fix 密度: 1 + fix30d + 0.5×fix14d) × S(规模与 >500L 单函数复杂度惩罚) × P(创作者主路径 + 钱/数据安全权重: 1.0~3.0) ÷ R(收口回归风险: 1.0~3.0)`。所有触及 6 个在途 PR（670 文件）的目标已严格排除（见「明确不做」§2）。

| 排名 | 类别（①~⑤） | 精确文件路径 + 行数（原始 / 格式化） | 实查证据（几处重复 / 几次 fix / 谁在调） | 推荐动作（直接删 / 换现成库或组件 / 合并成单源 / 暂不动） | 预估净删行数与风险 |
| :---: | :---: | :--- | :--- | :--- | :--- |
| **1** | **⑤ + ④** | `src/workbench/creation/storyboard/StoryboardPlanEditor.tsx`（651L raw / **846L fmt**；单组件 `StoryboardPlanEditor` **708L**） | 30d **9 次 fix**（14d 4 次）；超限基线 `max: 856`（余 10L）；`Ce=35` 高扇出，708 行单组件混管分镜状态订阅、行编辑、锚点联动与批量工具栏 | **合并成单源 + 拆模块**：先机械锁紧基线 −10L；拆离表头批量编排与行视图，分镜派生收归单一 selector | 净删 **80~120L**（退超限基线）；**中风险**（创作者分镜核心主路径） |
| **2** | **⑤ + ④** | `electron/agentLane/laneHost.mts`（761L raw / **885L fmt**；单函数 `openLane` **776L**） | 30d **7 次 fix**（14d 4 次）；超限基线 `max: 897`（余 12L）；`Ce=33`，776 行单闭包混装流式事件翻译、工具审批挂起、中断收尾与账本落盘 | **合并成单源事件映射 + 拆闭包**：先锁基线 −12L；将流式 part 翻译与审批/中断状态收尾拆为独立纯函数模块 | 净删 **90~140L**；**中高风险**（涉长跑稳定性与花钱工具审批） |
| **3** | **④ + ② + ⑤** | `src/workbench/ai/ProjectAgentResidentShell.tsx`（646L raw / **720L fmt**；单组件 **639L**） | 30d **7 次 fix**（14d **5 次**）；`Ce=52` 扇出；已在 800L 以下却仍挂基线 `max: 762`（余 42L）；`AnchoredPopover.tsx:31` 点名其非菜单富面板误挂 `role="menu"` | **换现成组件 + 直接移出超限基线**：立即从 `file-size-baseline.json` 删除该条目（720L < 800L），浮层改用 `AnchoredPopover` 并拆出尺寸/快捷键 hook | 净删 **60~90L**（消除 42L 基线膨胀空间）；**中低风险** |
| **4** | **⑤ + ③** | `src/workbench/creation/storyboard/exec/storyboardRowActions.ts`（642L raw / **790L fmt**；`runStoryboardBatch` **196L**） | 30d **7 次 fix**；距 800L 红线仅差 **10 行**；`Ca=3, Ce=33`，单行与批量生成参数拼装重复，且关联 `generation.declared-default-model` 渲染层重复匹配 | **合并成单源**：统一单行/批量提交管道，默认模型改读主进程 `createGenerationDefaultModelResolver`，退回 <650L 安全区 | 净删 **90~130L**；**中风险**（涉分镜一键生成扣费入口） |
| **5** | **④ + ⑤** | `electron/capabilityCore/appIntegration.ts`（544L raw / **610L fmt**；`startCapabilityCore` **454L**） | 30d **10 次 fix**（14d 3 次，非在途主进程最高频大文件）；`Ce=45` 扇出；454 行启动闭包把 RPC、批调度唤醒、MCP 广告与锁清理绑在同一作用域 | **合并成单源装配端口（拆模块）**：按「RPC/MCP 服务」「ProductionRun 调度钩子」「退出与锁清理」三块拆解闭包隐式耦合 | 净删 **50~80L**；**中风险** |
| **6** | **④（跨层穿刺簇）+ ①** | `electron/productionRun/productionRunTypes.ts`（13 边）+ `electron/settings/automationPolicyContract.ts`（5 边）+ `electron/catalog/parameterReferenceContract.ts`（4 边）+ `electron/shared/contracts/agentChatContracts.ts`（15L 零调用空壳） | 4 个非在途文件合计制造 **23/49（46.9%）**条 `src -> electron` 跨层违规（连同 `#1702` 后可迁的 `catalog/types.ts` 7 边共 **61.2%**）；`shared/contracts/agentChatContracts.ts` 建好却 0 导入 | **合并成单源中立契约**：将纯 DTO/常量迁入 `electron/shared/contracts/`（接通 `agentChatContracts.ts`），同步从 `boundaries-baseline.json` 删掉 23 条跨层边 | 净删 **40~70L**（削减近半跨层债）；**低风险（纯契约搬迁，极高 ROI）** |
| **7** | **③ + ②** | `src/workbench/observability/classifyError.ts`（74L）+ `narrate.ts`（195L）+ `electron/ipcInvokeFailure.ts` 等 **6 处 `"Error invoking remote method"` 手写拆解** | `classifyError.ts` 30d **11 次 fix**（`Ca=10`）、`narrate.ts` 30d **7 次 fix**（`Ca=13`）；`self-written.json` 中 `ipc-invoke-failure-text` 已于 **11-23 逾期**，渲染层 6 个文件各自正则剥离 Electron IPC 报错前缀 | **合并成单源结构化错误契约**：预加载/IPC 边界统一输出结构化错误码与元数据，删掉渲染层 6 处字符串拆解副本，结清逾期自写项 | 净删 **90~130L**；**中低风险** |
| **8** | **⑤ + ④** | `src/workbench/ai/v4/AgentPanelV4Composer.tsx`（624L raw / **698L fmt**）+ `useAgentPanelV4Data.ts`（347L） | 两者 30d 各 **8 次 fix**（14d 各 **6 次 fix**，合计 **30d 16 fix / 14d 12 fix**，全仓最热非在途 UI 簇）；`AgentPanelV4Composer.tsx` 已入 698L 黄牌区，混装输入框、`V4SkillPopover`（73L）与 `ComposerChip`（69L） | **换现成组件 + 拆模块**：拆出 `V4SkillPopover`（统一走 `AnchoredPopover`）与 `ComposerChip`，`useAgentPanelV4Data` 收口为单一派生 selector | 净删 **70~110L**；**中低风险** |
| **9** | **⑤ + ②** | `electron/productionRun/productionRunService.ts`（755L raw / **934L fmt**；单函数 **855L**）+ `productionRunRepository.ts`（750L / **828L fmt**）+ `productionRunLock.ts`（308L） | 30d 合计 **10 次 fix**（4 + 2 + 4）；直接掌管多镜头扣费与运行账本数据安全；压制 **27 处 `hot-path-sync-fs`**，`productionRunService.ts` 基线余 **31L** 未锁 | **锁紧基线 + 换现成异步持久化原语**：立即锁紧基线 −35L（31+4）；将 855 行 `createProductionRunService` 按命令/查询拆解，锁与仓储逐步清退同步 `fs`（与 `#1712` 合入后衔接） | 净删 **100~160L**；**中高风险**（钱与数据安全核心） |
| **10** | **④ + ② + ①** | `src/desktop/bridge.ts`（437L，`Ca=159`）+ `src/api/desktopClient.ts`（294L，**16 个死导出**）+ `electron/preload/modelOnboardingBridge.ts`（112L，**21 处 `sendSync`**） | `bridge.ts` 30d **9 次 fix**、**159 个渲染层文件**扇入；`desktopClient.ts` 含 16 个零引用包装；`modelOnboardingBridge.ts` 独占全仓 **70%（21/30）同步 IPC 阻塞豁免** | **直接删死导出 + 异步化预加载桥**：机械删除 `desktopClient.ts` 16 个死导出；将 `modelOnboardingBridge.ts` 21 处 `sendSync` 改为异步 `invoke`/快照注入，化解渲染卡顿 | 净删 **120~180L**（清零 21 条同步 IPC 豁免）；**中风险** |
| **11** | **⑤（红线悬崖）** | `electron/capabilityCore/approvalReceipt.ts`（792L raw / **799L fmt**；`createApprovalReceiptAuthority` **555L**） | 格式化代码行达 **799/800**（再增 2 行即触发 `check:filesize` 红灯阻断交付！）；近 14d **2 次 fix**；`Ca=18`，花钱人工审批收据权威实现 | **拆模块（解除爆表险情）**：将收据签名/摘要纯校验函数与挑战态生命周期管理从 555 行闭包拆为两份模块 | 净删 **40~60L**（主文件降至 <550L）；**中低风险** |
| **12** | **④ + ③** | `electron/tasks/taskResultQuery.ts`（404L，30d **8 次 fix**）+ `electron/textTaskRunner.ts` + 4 处重复 `TaskStatus` 词表 | 与 `electron/runtime.ts` 构成 `boundaries-baseline.json` **2 组主进程静态循环依赖**；`TaskStatus` 四态在 `codexCli` / `runtime` / `responseParsing` / `localTaskJobs` 重复 4 处 | **合并成单源契约 + 端口解环**：先在 `electron/shared/contracts/` 抽出 `TASK_STATUSES` 单源（消 4 条词表债），待 `#1703` 合入后用函数注入切断与 `runtime.ts` 的双向导入 | 净删 **50~80L**（消 2 条循环 + 4 条词表债）；**中低风险** |
| **13** | **⑤ + ②** | `electron/capabilityCore/apimartGenerationProvider.ts`（716L raw / **809L fmt**；`createCatalogGenerationProvider` **431L**） | 30d **6 次 fix**；超限基线 `max: 824`（余 15L）；单文件压制 **5 处 `generic-map-eviction` 手写 Map 容量淘汰** | **换现成有界缓存 + 退超限基线**：将 5 处手写 Map 驱逐换为统一有界缓存工具，拆出 `projectionRequest`（104L）使主文件跌破 800L 移出基线 | 净删 **70~110L**（消 5 处 lint 压制 + 退基线）；**中低风险** |
| **14** | **⑤ + ④** | `src/workbench/NomiStudioApp.tsx`（771L raw / **770L fmt**；单组件 `NomiStudioApp` **632L**） | 30d **6 次 fix**；**`Ce=65` 全渲染层第一高扇出**；770L 黄牌高位，单壳组件混管路由参数、项目会话生命周期、全局快捷键与弹层挂载 | **拆模块**：将启动项目路由解析、全局快捷键与全局弹层宿主拆为独立 hook/host，主壳只留工作台布局编排 | 净删 **60~90L**；**中风险** |
| **15** | **⑤ + ③** | `src/workbench/capability/capabilityApplyHandler.ts`（**750L fmt**，5 fix）+ `electron/capabilityCore/generationTransportAdapters.ts`（**754L fmt**，5 fix）+ `src/workbench/generationCanvas/agent/applyCanvasToolCall.ts`（**758L fmt**，4 fix） | Agent→画布能力执行三联黄牌文件合计 **2,262L fmt、30d 14 次 fix**；三个顶层单函数分别达 **483L / 397L / 542L**，重复手写工具参数解析与 `safeFailure` 包装 | **合并成单源分发器**：按能力动词表拆分领域 handler，共享参数解析与错误回执构造器，三文件全部退回 <600L | 净删 **150~220L**；**中风险** |
| **16** | **① 没人调用** | `src/vendor/tablerIcons.ts`（295L，**181 个死导出**）+ `src/design/index.ts`（**41 个**）+ `electron/shared/modelArchetypes/index.ts`（**19 个**）等非在途死导出与 **17 个零调用脚本（1,678L）** | 非在途生产代码积压 **1,503 个未用导出**；仅 `tablerIcons.ts` 就重导出了 180 个全仓零引用的家具/交通图标；17 个脚本全仓 0 引用 | **直接删（纯机械清理 PR）**：删掉 180 个未用图标重导出、桶冗余导出与 17 个孤儿脚本；补齐 `knip.json` Worker/`host.ts` 入口后加导出上限棘轮 | 净删 **2,000~2,200L**（含孤儿脚本）；**极低风险** |
| **17** | **④ + ② + ⑤** | `src/workbench/generationCanvas/nodes/ClipNode.tsx`（708L raw / **847L fmt**；单组件 `ClipNode` **791L**） | 30d **3 次 fix**；超限基线顶格 `847/847`（0 余量）；`Ce=35`；同时命中「JSX + 直接 IPC + DOM 测量」三职责缠绕，且绕过 `AnchoredPopover` 手写 `getBoundingClientRect + createPortal` | **换现成组件 + 拆模块**：浮层迁入 `AnchoredPopover`，媒体导出 IPC 与时间轴裁剪子视图拆离，主组件降至 <680L 退基线 | 净删 **80~120L**；**中风险** |
| **18** | **③ 反复写** | `scripts/vocabularies-baseline.json`（剩余 **42 条**非 `TaskStatus` 词表 `debt`）+ `docs/engineering/concept-owners/` **4 个 `pending` 概念** | `TERMINAL_RUN_STAGES` 7 态集合重复 **4 处**（关联 `promotionMeta.ts` 30d **10 次 fix**）、`FoldableModelCard` 状态重复 **3 处**、`canvas.zoom` 5 个节点组件直读旧视口缩放 | **合并成单源**：在 `electron/shared/contracts/` 建 `TERMINAL_RUN_STAGES` 等 `as const` 单源并下调 `debtCap`；5 个节点组件改读 `useCanvasLiveZoom` 关停 `canvas.zoom` `pending` | 净删 **140~200L**；**低至中风险** |
| **19** | **② 自写待换** | `electron/agentLane/laneLegacy*.{ts,mts}`（7 个文件约 **990L**，`to-replace`）+ `electron/jsonFile.ts` / `durability.ts` / `sharingRetry.ts`（`durable-json`） | `self-written.json` 明标 `lane-legacy-migration` 为 `to-replace`；`durable-json` 11-30 到期，虽已装 `atomically@2.1.1` 仍保留自写同步重试与 `Atomics.wait` | **直接删（待用户确认兼容窗口后退役 `laneLegacy*`）/ 换现成库（`atomically`）**：清退旧迁移兼容层，JSON 落盘统一收归 `atomically` 并消除主线程 `Atomics.wait` | 净删 **800~1,050L**；**需用户拍板老会话兼容窗口后低风险执行** |
| **20** | **⑤（低频巨石）** | `electron/integrationCertification/integrationSession.ts`（**1,399L fmt**，单类 889L）+ `productionRunDriverOps.ts`（**1,119L fmt**，单函数 **997L**）+ `mcpToolResults.ts`（**995L fmt**）+ `dispatcher.ts`（**977L fmt**） | 全仓最大的 4 块非在途巨石（合计 **4,490L fmt**），但近 30d fix 仅 **1 / 2 / 1 / 0 次**，不在创作者高频故障面上 | **暂不动主体结构，仅机械锁紧基线余量**：按 CodeScene 热点原则与 `#1586` 规矩，不作无业务驱动的大拆；立即收紧 19L 基线余量（−7 / −11 / 0 / −1），后续仅在需求触及时按子命令顺手切小 | 净删 **0L 代码（锁死 19L 膨胀上限）**；**零风险** |

---

## 三、分流收口清单：立即可机械删除 vs 需用户拍板候选

严格遵循 `AGENTS.md` 核心原则 **P1**：「机械删除走 PR，删功能和规则交用户」。

### 3.1 立即可机械删除的零引用清单（零功能变更，可直接拆小型 PR 落地）

以下项目均经 AST + 全仓 `git grep` + 在途 670 文件交叉核验，确认**无运行时消费者、无动态入口引用、不涉及产品功能或工程规则裁撤**：

1. **A 组 · 零引用生产死文件与冗余依赖（预估净删 ~65 行 + 移除 1 个 npm 包）**：
   - `src/config/modelSource.ts`（15L，全仓 0 引用，非在途）；
   - `src/ui/switch.tsx`（31L，全仓 0 导入，非在途）+ 同步移除 `vite.config.ts:262` 中的 `'@radix-ui/react-switch'` 预构建项与 `package.json` 中的 `"@radix-ui/react-switch"` 依赖（注：`package.json` 与 `#1665`/`#1692` 共享，合入时做单行 rebase 即可）；
   - `electron/shared/contracts/agentChatContracts.ts`（15L）：或在机械清理中删除空壳，或在批 2 跨层契约收口中让 `src/api/desktopClient.ts:7` 改引它并删掉 `boundaries-baseline.json` 对应违规边（推荐后者，一举两得）。
2. **B 组 · 17 个真零调用孤儿脚本及配套孤立自测（合计 1,678 行脚本 + 2 个自测文件，全部非在途）**：
   - `scripts/goal-red-on-base.mjs`（269L，连同 `scripts/goal-red-on-base.test.mjs`）；
   - `scripts/lab-install-from-trial.ts`（234L）；
   - `scripts/probe-lane-deferred-tools.mts`（229L）；
   - `scripts/lab-add-text-model.ts`（127L）；
   - `scripts/probe-pipeline-e2e.ts`（123L）；
   - `scripts/relay-live-mode-matrix.mjs`（121L）；
   - `scripts/lib/feedback/render-reconcile-html.mjs`（85L）；
   - `scripts/director-calibration-align.mjs`（82L）；
   - `scripts/codex-ledger-stats.mjs`（74L，连同 `scripts/codex-ledger-stats.node-test.mjs`）；
   - `scripts/relay-model-fetch-walkthrough.mjs`（62L）；
   - `scripts/render-deconstruction-shots.mjs`（57L）；
   - `scripts/render-marketing-posters.mjs`（49L）；
   - `scripts/director-assets/render_ual_contact_sheet.py`（44L）；
   - `scripts/check-director-asset-catalog.mjs`（40L）及其唯一零生产消费者的被检索引 `src/workbench/generationCanvas/nodes/director/model/assetCatalog/index.ts`（49L）；
   - `scripts/director-assets/check_ual_standing.py`（40L）；
   - `scripts/render-marketing-social-previews.mjs`（28L）；
   - `scripts/director-assets/compose_ual_contact_sheets.py`（14L）。
3. **C 组 · 高密度死导出与桶冗余重导出机械清理（预估净删 ~380–500 行，全部非在途）**：
   - `src/vendor/tablerIcons.ts`（295L）：删掉 **180 个**全仓零引用的 Tabler 图标重导出与 1 个未用类型；
   - `src/api/desktopClient.ts`（294L）：删掉 **16 个**无人调用的旧 ModelCatalog 包装函数与类型；
   - `electron/shared/modelArchetypes/index.ts`（44L，19 个未用重导出）、`src/design/index.ts`（77L，仅清理桶层无人通过 `@/design` 导入的 41 个重导出符号，保留底层原语文件不动）、`electron/shared/contracts/modelAccessCapabilities.ts`（12 个）、`src/ui/browser/dialog/NomiBrowserDialogModel.tsx`（12 个内部符号去掉多余 `export`）、`src/workbench/export/exportTypes.ts`（12 个未用类型）、`src/workbench/onboarding/handbookContent.ts`（10 个）、`electron/catalog/stagedVendorIdentity.ts`（9 个）、`electron/productionRun/productionRunGateIdentity.ts`（7 个）。
4. **D 组 · `scripts/file-size-baseline.json` 16 个非在途文件体积余量锁紧与达标退表（消除 190 行膨胀配额）**：
   - **直接移出超限基线（已 <800L fmt，共 5 个非在途文件）**：`ProjectAgentResidentShell.tsx`（720L / 原上限 762）、`electron/main.ts`（675L / 原上限 682）、`StoryboardShotTable.tsx`（734L / 原上限 742）、`projectAssetStore.ts`（793L / 原上限 794）、`mcpGenerationMultiShot.ts`（793L / 原上限 794）；
   - **下调 `max` 贴合实测值（共 11 个非在途文件，锁死 131 行余量）**：`assetLocalization.ts`（850→815，−35）、`productionRunService.ts`（965→934，−31）、`apimartGenerationProvider.ts`（824→809，−15）、`laneHost.mts`（897→885，−12）、`productionRunDriverOps.ts`（1130→1119，−11）、`StoryboardPlanEditor.tsx`（856→846，−10）、`integrationSession.ts`（1406→1399，−7）、`mcpGenerationTools.ts`（860→856，−4）、`productionRunRepository.ts`（832→828，−4）、`dispatcher.ts`（978→977，−1）、`AssetLibraryPanel.tsx`（838→837，−1）（注：`scripts/file-size-baseline.json` 在 `#1702` 有修改，建议在 `#1702` 合入后单开 1 个 5 分钟棘轮锁紧 PR）。

---

### 3.2 需用户拍板的功能 / 规则 / 架构瘦身候选（严守 P1：未经拍板不动代码）

以下每项均涉及产品功能去留、老用户兼容窗口、设计系统公开原语裁撤或工程门岗/规则删减，统一整理选项与推荐判断供协调会话汇总请示用户：

| 编号 | 候选议题 | 实查现状与维护代价 | 推荐决策与备选代价 |
| :---: | :--- | :--- | :--- |
| **U-1** | **自写门岗群（`gate-family`）瘦身裁撤**（`self-written.json` 11-30 到期） | `package.json` `gates:contracts` 串联 **100+ 个自写 `check:*` 脚本**；`docs/audit/2026-10-01-gate-ledger.md` 实证 **60% 红灯为文档格式/自报字段纸面红灯，93 个门岗自诞生起零真红灯**，每次推送与改名都在付维护税 | **推荐**：按门岗账本批量退役「零真红灯且已被 TypeScript / ESLint / dependency-cruiser 覆盖」的字符串扫描门岗，收口为少量通用 AST/架构规则。代价：需按 P1 逐批核准退役名单。 |
| **U-2** | **旧版会话迁移层 `lane-legacy-migration` 退役窗口**（7 个 `laneLegacy*` 文件，~990L） | `self-written.json` 已标 `to-replace`，用于极早期旧格式 Agent 会话升级到当前 Lane 存储 | **推荐**：确认存量活跃用户已完成跨版本迁移（或给出明确截止版本号）后，整包删除 7 个 `laneLegacy*` 文件；对极老未迁移目录给出一行清晰只读提示（★1c）。 |
| **U-3** | **生产零调用但存留旧组件/孤岛模块的功能去留**（`StoryboardNudge.tsx` + 18 个仅单测调用模块，共 ~1,506L） | `StoryboardNudge.tsx`（61L）自宿主迁移后已脱钩；另有 `directorPlanner.ts`（220L，仅 `evals/` 调）、`agentChatTrace.ts`（160L）、`shotLanguage.ts`（136L）、`experienceRepository.ts`（123L）、`scriptDraftSnapshot.ts`（68L）、`creationIntentRouting.ts`（60L）等 18 个生产模块在运行态零调用 | **推荐**：① 已明确废弃的旧功能残留（`StoryboardNudge`、`creationIntentRouting`、`scriptDraftSnapshot`、`agentChatTrace`、`experienceRepository` 等，连同 `boundary-owners-ledger.json` 对应旧合同退役）整套删除；② 仅供离线评测用的 `directorPlanner.ts` 迁入 `evals/director/`，测试辅助 `*TestUtils.ts` 迁入 `testSupport/`，让生产目录只留真正在跑的代码。 |
| **U-4** | **设计系统零调用原语与分段器双轨收口**（`src/design/`） | `DesignBadge`、`NomiAILabel`、`NomiIdentityIcon` 3 个原语生产零调用；分段器同时存在自写 `NomiSegmented`、Mantine `DesignSegmentedControl` 与 5 处手写 `role="tablist"` | **推荐**：删掉 3 个零调用原语；分段器拍板保留唯一标准件（推荐保留贴合密度 token 的 `NomiSegmented` 或统一收归 `DesignSegmentedControl` 二选一），并将 5 处手写 `tablist` 收口过去。 |
| **U-5** | **到期 `self-written.json` 基础设施项处置**（`network-stack` / `durable-json` / `logging-and-crash` / `ipc-invoke-failure-text`） | 4 项 `under-review` 均在 2026-11-23 ~ 11-30 到期；其中 `ipc-invoke-failure-text` 已逾期，`durable-json` 与已安装的 `atomically` 重叠 | **推荐**：① `ipc-invoke-failure-text` 与 `durable-json` **不续期，执行替换**（改结构化 IPC 错误码 + 收归 `atomically` 异步写）；② `network-stack`（含桌面系统代理/凭证域安全护栏）保留与安全直接挂钩的最小边界并转为精确 `justified`，砍掉多余包装；③ `logging-and-crash` 评估切 `electron-log` 或精简自写面。 |

---

## 四、分批收口路线图（按 ROI 与在途依赖排期）

| 批次 | 范围（均遵循小步独立 PR、同 commit 删旧） | 前置条件 | 预估净收益 |
| :---: | :--- | :--- | :--- |
| **批 1：零风险机械净身** | 执行 §3.1 A/B/C 组：删 `modelSource.ts`、`switch.tsx`（含 `@radix-ui/react-switch`）、17 个孤儿脚本（1,678L）、`tablerIcons.ts` 180 个未用图标与 `desktopClient.ts` 等高密度死导出；补齐 `knip.json` 动态入口（`host.ts` + 2 个 Worker + `startupDiagnostics.ts`） | 无在途阻塞（`package.json` 避开或跟在 `#1665`/`#1692` 后合入） | **净删 ~2,100+ 行**，清退 1 个外部包，建立准确死代码基线 |
| **批 2：跨层契约与错误单源收口** | 执行 Top #6、#7、#12（前半）、#18（词表）：将 `productionRunTypes`、`automationPolicyContract`、`parameterReferenceContract` 迁入 `electron/shared/contracts/` 并接通 `agentChatContracts.ts`；建立 `TASK_STATUSES`、`TERMINAL_RUN_STAGES` 单源词表；统一 IPC 结构化错误码取代 6 处 `"Error invoking remote method"` 手写拆解 | 无在途阻塞（`catalog/types.ts` 7 条边待 `#1702` 合入后追加） | **消除 >50% 跨层穿刺边**、压降 `vocabularies` `debtCap`、根治 `classifyError`/`narrate` 18 次 fix 病根 |
| **批 3：花钱安全防爆线与预加载去同步化** | 执行 Top #11、#10（后半）、#13 + §3.1 D 组：拆分 `approvalReceipt.ts`（799/800L 解除红线险情）；将 `modelOnboardingBridge.ts` 21 处 `sendSync` 异步化；`apimartGenerationProvider.ts` 换有界缓存退基线；锁紧 `file-size-baseline.json` 16 个文件 190L 余量并清退 5 个已达标文件 | D 组待 `#1702` 合入后锁 `file-size-baseline.json` | 解除花钱审批文件爆表风险、**清零 70% 渲染同步 IPC 阻塞**、超限基线从 33 减至 ≤27 |
| **批 4：创作者高频主路径热区减重** | 执行 Top #1、#2、#3、#4、#5、#8、#9、#15、#17：聚焦分镜编辑器与行动作（`StoryboardPlanEditor`、`storyboardRowActions`）、Agent 驻留壳与输入框（`ProjectAgentResidentShell`、`AgentPanelV4Composer`、`laneHost`）、能力核装配与画布节点（`appIntegration`、`ClipNode`），将手写浮层统一迁入 `AnchoredPopover` | `#1702`、`#1703`、`#1712` 合入后同步纳入 `InlineParameterBar` 与 `generationRunController` | 主路径高频 fix 文件全部压回 <650L 安全区，消除手写浮层定位与多源状态漂移 |
| **批 5：用户拍板项集中兑现** | 执行 §3.2 经用户拍板核准的 `U-1`~`U-5`（门岗瘦身、`laneLegacy*` 退役、生产孤岛模块清理/归位、设计系统冗余原语裁撤、`durable-json` 切 `atomically`） | **用户拍板（P1）** | **预估再净删 2,500~4,000+ 行**代码与规则税 |
