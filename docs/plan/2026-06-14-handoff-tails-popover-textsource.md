# 交接 · 小尾巴 + 弹层原语 + 文本片段ID（2026-06-14，给下一个 AI）

> **给接手会话**：主仓库 `/Users/aoqimin/Desktop/Nomi`、`main` 分支、单窗口顺序做下面 3 件。**开工先读「§1 动手前必读」**，别凭印象动手。
>
> **⚠️ 并发警告（必看）**：现在**至少有两个会话同时在动这棵树/这个 main**——① 用户自己在另一个窗口做「跨分类边可见性」（碰 `GenerationCanvas.tsx`、`useNodeRelationships.ts`、`BaseGenerationNode.tsx`、`canvasNodeActions.ts`、`generationNodeKinds.ts`）；② 一个评测会话在大建 evals（碰 `evals/`、eval 脚本）。
> 所以：**只 `git add` 指名文件（绝不 -A）、push 前必 `git fetch` 对账、慎用 `git rm` 暂存**（共享 index 里会被并行 commit 扫走——上轮真踩过）。本文任务顺序已按「先做和跨分类边不重叠的」排好；唯一会撞 `GenerationCanvas.tsx` 的是任务③弹层，**排最后、并要等跨分类边那个窗口收尾或显式确认后再碰它**。

---

## 1. 动手前必读（铁律，别跳）
1. **`CLAUDE.md`** — 全部工程纪律（P1–P5 / R1–R14），最高真相源。
2. **`docs/design/nomi-design-system.md`** — 任何用户可见改动**前完整读**；token-only（禁非 token 的 px/hex/圆角）。
3. **`docs/audit/2026-06-14-ultra-deep-mechanism-audit.md`** — 这些项的出处与根因。
4. **`docs/plan/2026-06-14-remaining-work-handoff.md`** — 总交接（含已做清单、单窗口工作方式）；本文是它的子集（去掉跨分类边那件，因为有人在做）。
5. memory `ultra-deep-audit-2026-06-14b` — 全部来龙去脉 + 已做清单 + 坑。

触发式：碰第三方库先 Context7（R5；画布是**自研非 React Flow**，别查 RF）；UI 改动先样张后实现（R8/P5）；多文件先写 `docs/plan`（R4）；取舍出 R3 对比表让用户拍板；报完成前真机走查（P3/R13）。

## 2. 工作方式（单窗口 main 直作）
每件一个循环：**Explore 摸现状（记真实 file:line，别信本文行号——代码会漂）→ 设计/plan（按需）→ TDD 实现 → 五门全过（`pnpm run check:filesize && pnpm run lint:ci && pnpm run typecheck && pnpm test && pnpm build`）→ commit（只 add 指名文件，中文 message，结尾挂 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`）→ `git fetch` 对账后 push → 下一件**。UI 任务额外做真机走查。每件做完回填 `docs/plan/2026-06-14-ultra-audit-remediation.md` 进度。

---

## 任务 ①（先做）一包小尾巴 —— 与跨分类边不重叠，逐条独立 commit
都是明确的代码活，一条一个 commit：

**1a. 统一 ProjectCreationSpec 单一构造点（防整类创建 bug）**
- 现象/根因：「新建项目」3 入口（新建空白 / 打开文件夹 / 点示例）各自拼装项目初始数据（id / 是否草稿 / 落地 workspaceMode / categoryId / 默认节点），约定不统一——历史 bug「新建空白被当 legacy 迁移删默认节点」「落地视图不确定」根子都在这。
- 范围：`src/workbench/NomiStudioApp.tsx`（newProject/openProject/tryExample）、`src/workbench/project/projectRepository.ts`（createLocalProject）、`electron/projects/repository.ts`（createProject/createDefaultProject）、`electron/workspace/workspaceRepository.ts`。
- 交付：把三入口收口到同一个「创建规格」构造点；加不变量测试（create 后 manifest 必含 seedKey/categoryId/workspaceMode、默认节点形态通过迁移的 already-migrated 判定）。守 P1，删各入口重复拼装。

**1b. 缩略图双份派生收口**
- 现象/根因：项目库封面缩略图，renderer（`src/workbench/project/projectNormalize.ts` 的 deriveThumbnail/extractCanvasThumbnailUrls）与 main（`electron/workspace/workspaceRepository.ts` 的 deriveThumbnailUrls）**各算一份**，第二真相源隐患。
- 注意：两份分属渲染层/主进程，跨 tsconfig 不易直接共享——可抽成一个两边都能 import 的纯模块，或至少保证逻辑等价 + 双向交叉注释单一来源。交付：收口到单一来源（或证明等价）+ 回归测试。

**1c. manual 接入连通性测试（对齐「接入即验证」）**
- 现象/根因：`electron/catalog/catalogCommit.ts` 的 `commitManualOpenAiCompatibleModels` 注释明写「No connectivity test」——填完 baseUrl+key 直接「成功」，错了要到生成时才暴露。现有 `testModelCatalogMapping` 只覆盖带 mapping 的 image/video 模型，不覆盖 manual 的 text 直连。
- 范围：`electron/catalog/catalogCommit.ts` + 新增 `electron/main.ts` IPC handler + `src/desktop/bridge.ts` 入口 + 接入面板一个「测试连接」按钮。交付：非阻断的连通性探活（如 GET {baseUrl}/models），当场提示通不通，不拦提交。

**1d. 草稿态「完全不写盘」补 renderer 端**
- 现象/根因：点「新建空白」哪怕零编辑也立刻落盘（现已加「空壳启动 GC」兜底，是「写了再回收」的等价态）。真正「未编辑不落盘」需在 `src/workbench/NomiStudioApp.tsx` newProject 端延迟创建到第一笔编辑。差异已在 `docs/plan/2026-06-14-empty-draft-project-gc.md` 声明。
- 交付：newProject 不立即 createLocalProject，改为「内存草稿 + 首次编辑才落盘」；保留 GC 作兜底。**这件改 NomiStudioApp，注意和 1a 同文件——1a、1d 放一起做或顺序做，别分头改 NomiStudioApp。**

## 任务 ②（再做）文本三真相源片段 ID —— 先写 plan，别盲改
- 现象/根因：同段源文本散成三份拷贝——创作区文档(`workbenchDocument`)、AI 拆的分镜方案(`storyboardPlan`)、落画布后的镜头节点 prompt——互不相连，改一处另两处不动，越改越对不上。根因：系统无「这是同一段文本」的概念，每次派生都是「读 trim 字符串→写进新对象」，复制即断联。入口：`src/workbench/creation/SelectionGeneratePopover.tsx`、`createNodeFromSelection.ts`、`CreationAiPanel.tsx`(runStoryboardPlanner)、`generationCanvas/agent/storyboardPlan.ts`。
- **性质：架构改造**（引入「文本片段 ID」绑定源文本与派生物，重连 创作→分镜→画布 数据流）。**先按 R4 写 `docs/plan` + R7 六角色评审 + R3 给用户拍板方向，再动代码。本任务到「plan + 拍板」为止，不要直接改实现。**

## 任务 ③（最后做，撞 GenerationCanvas）弹层翻转/clamp 共用原语（R13）
- 现象/根因：画布各弹层（`NodeGenerationComposer` / `AssetPickerPopover` / `SelectionGeneratePopover` / `OnboardingFloatingPanel` / 右键菜单）的「翻转 + 防裁切」各自手写，边缘位置偶发被裁；右键菜单 clamp 用写死常数（如 148/330）。`src/design/portal.tsx` 只导出裸 `BodyPortal`，无可复用定位原语。
- **⚠️ 撞车点**：右键菜单 clamp 在 `src/workbench/generationCanvas/components/GenerationCanvas.tsx`——跨分类边那个窗口也在改它。**做这件前先确认跨分类边已合入 main（git log 看到 / 问用户），否则等它收尾再做这件的 GenerationCanvas 部分**；其余弹层文件可先做。
- 范围：`src/design/portal.tsx`（抽 `usePopoverPlacement`：量真实 DOM rect + 视口 clamp + 向上翻转）、上述各弹层迁移到它删手写、右键菜单 clamp 改量真实菜单 rect。
- 交付：原语 + 迁移各调用点（守 P1 删并行版）+ 几何不变量写进 `tests/ux/design-fidelity.e2e.mjs` 回归断言 + 真机逐个打开每个弹层走查（不裁/不溢出/不重叠，含节点在画布边缘极端位置）。

---

## 不做（用户已拍板延后）
- Scene3D 3860 行全拆（纯技术债，卡顿已修）。
- P0-8 声明式 archetype（非文本模型自动接入，大家用最新内置模型暂不碰）。
- **跨分类边可见性**：用户正在另一个窗口做，**本会话别碰**它的文件（GenerationCanvas 边渲染 / useNodeRelationships / BaseGenerationNode）。
