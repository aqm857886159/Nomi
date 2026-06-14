# 剩余工作交接 · 单窗口顺序执行（2026-06-14）

> **给接手会话**：你在主仓库 `/Users/aoqimin/Desktop/Nomi`、`main` 分支、**单窗口顺序**完成下面的任务（用户明确：不开 worktree/分支）。**开工前先读「§1 动手前必读」**，别凭印象动手。

---

## 0. 一句话背景
Nomi = 本地优先 AI 视频创作工作台（Electron + React18 + Zustand + Vercel AI SDK）。刚做完一轮极底层机制审计：**8 类 P0 + 绝大多数 P1/P2/P3 已修复并入 main**。本文是剩余工作的交接——按顺序一件件做，每件 **TDD + 五门全过 + commit + push** 再下一件。

## 1. 动手前必读（铁律，别跳）
按顺序读：
1. **`CLAUDE.md`** — 全部工程纪律（P1–P5 / R1–R14）。最高真相源，与任何 skill 冲突以它为准。
2. **`docs/design/nomi-design-system.md`** — 任何用户可见改动**前完整读**（§2 token 全表 / §3 通用组件 / 规范）。**token-only**：禁非 token 的 px/hex/圆角（如 `h-[34px]`/`text-[12.5px]` 违规）。
3. **`docs/audit/2026-06-14-ultra-deep-mechanism-audit.md`** — 审计全貌，剩余项的出处与根因。
4. **`docs/plan/2026-06-14-ultra-audit-remediation.md`** — 修复计划 + 进度回填。
5. memory `ultra-deep-audit-2026-06-14b` — 这轮全部来龙去脉 + 已做清单 + 踩过的坑。

触发式纪律：
- 碰第三方库（AI SDK / Mantine / Electron / Tiptap / Vite…）→ 先 Context7 查官方文档（R5）。**注意：Nomi 画布是自研的，不是 React Flow，别查 RF**。
- 用户可见改动 → 先出 HTML mockup → 用户拍板 → 实现后逐项对账（R8/P5）。
- 多文件/多步 → 先写 `docs/plan`（范围/不动项/回滚/验收门）（R4）。
- 涉及取舍/产品方向 → 给 R3 对比表让用户拍板，别单方面开干；样张自相矛盾就停下上报。
- 报「做完」前 → 真机体感走查（Playwright 截图人眼判断），全绿 ≠ 完成（P3/R13）。

## 2. 已做完的（别重做）
本轮已修复并入 main（详见 memory `ultra-deep-audit-2026-06-14b`）：
- **8 类 P0**：EventLog 解析器回归、删项目真删盘、多步 abort 补偿(I3)、storyboardPlan 持久化、导出引擎统一(P0-5)、空壳 GC 草稿态、clientId 切项目重置、A14 助手身份统一。
- **多簇 P1/P2/P3**：runtime（结构化错误三出口/extraHeaders/taskCache/catalog 写保护/精确键路由/import 事务化/findTaskMapping 不套错/SOCKS 诊断/fingerprint provenance）、scene3d（meta 竞态/inert/useFrame 脏判断/整树 diff）、时间轴导出（before-quit 杀 ffmpeg/导出可取消/fps derive/排片幂等/删节点对账 clip/asset 键含 url/折行统一）、画布（单一 getNodeSize/wheel 双轴/usageCount 结构化/手动连边校验）、创作（删死代码/chatOnly 硬约束/附件守卫）、harness（redact query/seq 高水位/续聊 tool 摘要）。
- 存量数据清理（库 88→2）、journeys e2e 修复、巨壳瘦身（runtime/Scene3D/TimelinePreview）。
- 五门基线状态：单测约 1340 绿；filesize 白名单 3 巨壳（Scene3DFullscreen 3827 / runtime.ts 745 / BaseGenerationNode 935）。

## 3. 工作方式（单窗口，main 直作）
每个任务一个循环：
1. **调研**：Explore agent 摸现状，记**真实 file:line**（别用本文里的行号当真，代码会漂——以你查到的为准）。
2. **设计/plan**（按需）：UI 任务出样张 + R3/R7；多文件任务写 `docs/plan`。
3. **实现**：TDD（先红后绿），分层清楚，单文件 ≤800 行。
4. **五门**：`pnpm run check:filesize && pnpm run lint:ci && pnpm run typecheck && pnpm test && pnpm build` 全过。
5. **commit**：只 `git add` 指名文件（**绝不 -A**），中文 message（做了什么+为什么+验证），结尾挂 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
6. **push**：`git fetch` 对账后再 push。
7. UI 任务额外：实现后**真机走查**（`node tests/ux/ui-driver.mjs` + 截图人眼判断）。
8. 下一个任务。

**协作安全**：若发现另有会话在改同一棵树（git status 冒出你没动的文件 / main 远端在动）→ 只 add 指名文件、push 前 fetch、**慎用 `git rm` 暂存**（共享 index 里会被并行 commit 扫走——上轮踩过这个坑）。

---

## 4. 任务清单（按此顺序做）

### 任务 1 🥇 跨分类边可见性（R8 样张 → 拍板 → 实现）
**问题**：画布节点按分类分到不同子画布视图（镜头→shots / 角色定妆→cast / 场景→scene）。角色定妆卡被某镜头引用时，那条参考边**两端跨分类**——渲染把边过滤成「两端都在当前视图才画」，所以这种边**在任何视图都看不见，但生成时照常生效**（"看不见但生效"）。做多镜头角色一致性（定妆链路）时是真实盲区。
**现状代码（Explore 核实真实行号）**：
- 边过滤：`src/workbench/generationCanvas/components/GenerationCanvas.tsx`（按"两端都在可见节点"过滤）
- 生成期用全量边：`src/workbench/generationCanvas/runner/generationReferenceResolver.ts` / `generationRunController.ts`
- 已有结构化引用统计：`hooks/useNodeRelationships.ts` 的 `useNodeUsageCount`（已改为按 edges 统计，"徽标"方案可直接复用）
- 分类归属：`model/generationNodeKinds.ts`；节点卡片：`nodes/BaseGenerationNode.tsx`；改分类不动边的入口：`store/canvasNodeActions.ts` 的 `reassignNodeCategory`
**交付（R8 流程，别跳）**：
1. 出 **2–3 个 HTML mockup**（放 `docs/design/reviews/<日期>-cross-category-edge-*.html`，token-only）：① 节点徽标 MVP（卡上"被 N 个镜头引用 / 引用了 X"，复用 useNodeUsageCount，近纯代码）② 跨分类引用面板/抽屉 ③ 跨视图指示（点节点高亮其在别分类的引用对端）。
2. 设计师 agent + 真实用户 agent 各审一遍（R7 子集），回填。
3. R3 对比表（方案/用户看到什么/代价）→ 用户拍板。**拍板前不写实现。**
4. 拍板后实现 + 真机走查 + 逐项对账。
**顺带拍板**：把「选区 vs 全文显式化」（拆镜头到底用选中段还是全文，现在隐式短路、用户看不见）做成一个小指示方案，放进同一轮样张一起给用户拍板（省一件事）。

### 任务 2 弹层翻转/clamp 共用原语（R13）
**问题**：画布各弹层（NodeGenerationComposer / AssetPickerPopover / SelectionGeneratePopover / OnboardingFloatingPanel / 右键菜单）的翻转+防裁切各自手写，边缘位置偶发被裁；右键菜单 clamp 还用写死的 148/330 常数。
**根治方向（守 P1，删并行版）**：在 `src/design/portal.tsx` 一带抽一个共用原语（如 `usePopoverPlacement`：量真实 DOM rect + 视口 clamp + 向上翻转），把上述各处手写逻辑迁过去删掉。
**交付**：原语 + 迁移各调用点 + 把几何不变量写成 `tests/ux/design-fidelity.e2e.mjs` 回归断言（不被裁/不溢出/不重叠）+ 真机逐个打开每个弹层走查。

### 任务 3 一包小尾巴（代码为主，批量清）
逐条做，每条独立 commit：
1. **统一 `ProjectCreationSpec` 单一构造点**：newProject/openProject/tryExample 三入口对 seedKey/categoryId/workspaceMode/默认节点的约定收口到一处 + 不变量测试（create 后 manifest 必含这些）。涉及 `NomiStudioApp.tsx` + `project/projectRepository.ts` + `workspace/workspaceRepository.ts`。
2. **缩略图双份派生收口**：`project/projectNormalize.ts`（renderer）与 `workspace/workspaceRepository.ts`（main）各一份 deriveThumbnail —— 抽共享或保证逻辑等价 + 交叉注释单一来源。
3. **manual 接入连通性测试**：`catalog/catalogCommit.ts` 存了即"成功"无连通校验 → 补一个非阻断「测试连接」（需 main.ts IPC + bridge.ts 入口），对齐"接入即验证"纪律。
4. **草稿态"完全不写盘"补 renderer 端**：现在空白项目是"写盘 + 启动 GC"的等价态；真正"未编辑不落盘"需在 `NomiStudioApp.tsx` newProject 端延迟创建（见 `docs/plan/2026-06-14-empty-draft-project-gc.md` 声明的差异）。

### 任务 4 文本三真相源（片段 ID）—— 先写 plan，别盲改
**问题**：同段源文本散在文档(`workbenchDocument`)/分镜方案(`storyboardPlan`)/节点 prompt 三处，改一处另两处不同步。派生动作都是"读 trim 后字符串 → 写进新对象"，无回溯。
**性质**：架构改造（引入"文本片段 ID"绑定源文本与派生物，重连 创作→分镜→画布 数据流）。**先按 R4 写 `docs/plan` + R7 六角色评审 + R3 给用户拍板方向，再动代码**。不要直接改。

### 延后（用户已拍板，不做）
- **Scene3D 3860 行全拆** —— 纯技术债，卡顿已修，维护性问题，往后延。
- **P0-8 声明式 archetype（非文本模型自动接入）** —— 大家用最新内置模型，暂不接非内置图/视频模型就碰不到，往后延。

---

## 5. 顺序与节奏建议
任务 1（最高价值，需用户拍板样张）→ 任务 2（自包含）→ 任务 3（零散批量）→ 任务 4（先 plan 等拍板）。每完成一件回填 `docs/plan/2026-06-14-ultra-audit-remediation.md` 的进度。报「全部完成」前按 P3 做一遍真机走查。
