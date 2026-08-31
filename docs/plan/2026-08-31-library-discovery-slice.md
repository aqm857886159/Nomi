# Nomi 资源库发现优化方案与交付

日期：2026-08-31
> 状态：🚧 进行中（本分支落地项目库、提示词库、技能库、素材库的发现体验；工作流复制由 PR #239 负责，Agent 接入由 PR #223 负责）

## 1. 先说结论

Nomi 不做一个把所有东西混在一起的“超级资源库”，也不新增“概览”页。每类资源继续有自己的家，但四个家遵守同一条找东西规则：先搜，再按已有确定性分类缩小范围，点到资源后在当前语境完成动作。

这解决的不是“资源不够”，而是用户已经做过一套东西之后，下一次找不到它：

- 回到上次项目：搜名字，直接打开；
- 复用验证过的提示词：搜关键词，看封面/正文，送到画布；
- 复用技能：搜名字或声明的模型模态，先看是否可用，再在创作区启用；
- 找上一项目的素材：切到“全部项目”，按文件名找，看到真实比例的缩略图后居中预览；当前项目素材才可拖到画布，跨项目物化复制另开合同。

成功标准是“十秒内找到并开始用”，不是让用户读一套新的资源格式。

## 2. 用户旅程与用户可见变化

### 2.1 主旅程

1. 用户从左侧现有入口进入目标库（项目库、提示词库、技能库、素材库各自只有一个家）。
2. 搜索框始终表达真实字段：项目/提示词/技能搜可读名称；素材 V1 只搜文件名。
3. 分类只使用已有事实：项目来源、提示词图片/视频、技能流程包/助手、素材图片/视频/音频。
4. 卡片承担“认出”而不是“解释”：素材以媒体为主，提示词以封面为主，技能显示能力缺口。
5. 详情或预览在中间打开，不挤压画布右侧；主动作沿用现有写入/撤销/拖拽边界。

### 2.2 具体界面变化

| 场景 | 用户看到什么 | 不做什么 |
|---|---|---|
| 项目库 | 最近使用的项目优先；来源筛选和搜索在同一条发现栏 | 不新增概览页、项目说明表单 |
| 提示词库 | 我的/Nomi 精选、图片/视频筛选和搜索保持同一节奏；送到画布后可撤销 | 不把 AI 改写、收藏、编辑器塞进库卡片 |
| 技能库 | 我的/Nomi 内置、流程包/助手分类；卡片保留文本/图像/视频能力状态 | 不把缺模型伪装成可用，不接 Agent 工具 |
| 素材库 | 全部项目/项目素材、单一媒体类型菜单、素材名搜索；紧凑卡片显示一行文件名和真实比例 | 不在卡片堆描述/标签/导入按钮，不搜技术路径 |
| 素材详情 | 图片/视频在居中预览中显示标题，能辨认来源项目时只在详情显示 | 不新增 preload API，不改变 `AssetOrigin` 传输合同 |
| 工作流库 | 跨项目复制完整工作流（节点、连线、分组、参数、素材来源）由 PR #239 提供 | 本分支不复制 #239 的实现或另起一套工作流库 |

## 3. 信息架构与边界

### 3.1 “各自有家，共用找东西规则”

`src/workbench/library/libraryDiscovery.ts` 是 renderer 侧的纯发现层：多词匹配、稳定的最近使用排序、同窗口更新通知。它不保存资源正文、不拥有任何写入权限。

`src/workbench/library/libraryAdapters.ts` 只把已有领域字段映射成搜索文档：

- project：`name`，以及已有来源线索（native/folder）；
- prompt：`title`、正文、已有 `tags`、来源；
- skill：`label`、描述、`name`、已声明 `neededProviders` 和 playbook/assistant 类型；
- asset：只把 `name` 作为可见搜索字段，类型由现有 `accept`/分类菜单处理。

这层不创建第二份 store，也不把四类资源混成统一数组。

### 3.2 所有权边界

- Agent、Project Agent Host、Canvas Read/Write、能力准入：PR #223 唯一 owner。本分支不读取其内部接口、不复制旁路、不猜最终合同。
- 工作流快照/跨项目复制：PR #239 唯一 owner。本分支只提供发现入口兼容性说明，不 cherry-pick 或重写其代码。
- 画布写入：提示词仍调用 `useGenerationCanvasStore.addNode` 并配套撤销 toast；素材只有当前项目/当前画布结果可拖拽并继续传 `AssetOrigin`，其他项目只读预览；技能仍只切换创作区当前技能。
- Electron 安全：不放宽 CSP、不增加 preload API、不允许任意 URL JavaScript/本地任意脚本/插件市场。
- 提交纪律：R25 要求 commit/push 前由版本化 hook 自动调用只读、限时的 `/ponytail-review`（Codex 为 `@ponytail-review`）；适配器只审准确 staged/outgoing diff，失败即阻止操作，不接入 Nomi Agent 能力链。

## 4. 数据合同

### 4.1 最近使用索引

索引键为 `nomi:library-discovery:v1`，只保存 `{ kind, id, lastUsedAt }`，不保存 prompt 正文、素材路径或技能包。读取时丢弃未知 kind、空 id、非有限时间戳；localStorage 不可用时发现功能仍可用，只失去排序增强。

`markLibraryUsed` 只在真实主动作成功后调用（打开项目、送提示词到画布、启用技能、当前项目素材成功加入或预览）。素材选择和拖拽开始不记账，避免多选/拖拽过程中卡片重排；取消、失败和跨项目只读尝试不写入最近使用。同窗口通过轻量事件触发重排，不依赖刷新或重新打开面板。

### 4.2 素材展示元数据

尺寸只从已有节点/DTO metadata 读取，必须是有限正数且有界；缺失时回落现有安全比例。显示用的 `sourceProjectName` 只作为瞬时 renderer 展示字段，不进入 `AssetOrigin`、拖拽 payload 或持久化；拖拽 payload 只携带现有 `AssetOrigin`，当前画布落节点的 metadata 仍按既有 `workspaceRelativePath`/`referencedNodeId` 合同物化。跨项目素材本 PR 只提供发现和居中预览，不允许直接写入当前画布/时间轴；物化复制另开安全写入合同。

### 4.3 迁移与兼容

旧项目、旧提示词、旧技能包和旧素材不改格式；发现层只读适配。未知字段继续由领域解析器处理，搜索字段缺失不丢数据。资源消失或来源不可用时，原有空态/错误态继续显示，不能静默删除用户数据。

## 5. 代码落点（实现对应关系）

| 层 | 文件 | 责任 |
|---|---|---|
| 共享发现 | `src/workbench/library/libraryDiscovery.ts` | query 归一化、全词匹配、排序、轻量索引、更新订阅 |
| 领域适配 | `src/workbench/library/libraryAdapters.ts` | 项目/技能字段映射与来源/类型筛选 |
| 共用布局 | `src/workbench/library/LibraryDiscoveryToolbar.tsx` | token-only 的发现栏排版，宽屏横排、窄侧栏纵排 |
| 项目库 | `src/workbench/library/ProjectLibraryPage.tsx` | 最近排序、来源筛选、项目打开记录 |
| 提示词库 | `src/workbench/api/promptLibraryApi.ts`、`src/workbench/promptLibrary/PromptLibraryPanel.tsx` | 标签/正文搜索、最近排序、送画布记录 |
| 技能库 | `src/workbench/skillLibrary/SkillLibraryPanel.tsx`、`SkillCard.tsx` | 类型筛选、能力状态、启用记录 |
| 素材库 | `src/workbench/assets/assetTypes.ts`、`useAllProjectAssets.ts`、`AssetLibraryPanel.tsx`、`AssetLibraryPanelParts.tsx`、`AssetPreviewDialog.tsx` | 名称搜索、真实比例/文件名、居中详情、来源只读展示、加载/部分结果提示 |
| 素材写入边界 | `src/workbench/generationCanvas/components/canvasStageDrop.ts`、`GenerationCanvasReactFlow.tsx`、`src/workbench/timeline/addAssetToTimeline.ts`、`TimelineTrack.tsx`、`TimelineSecondaryAddRow.tsx` | 只接受当前项目/当前画布来源的素材拖放，拒绝跨项目 URL 直写 |

## 6. 设计系统执行规范

- 复用 `DesignSearchInput`、`NomiSegmented`、`NomiSelect`、`DesignEmptyState`；新布局只写组件 className，不新增全局 CSS。
- 控件顺序遵守“筛选在左、搜索占剩余空间、低频动作在右”；窄侧栏自动换行，避免按钮挤在左侧。
- 素材卡片内容优先：媒体 > 一行文件名 > 类型徽章；不把技术路径、描述和操作堆到卡面。
- 详情用 body portal 居中，Esc/遮罩/关闭按钮保持现有行为；画布不被常驻右栏挤窄。
- 所有新增可见文字同时补 `zh-CN`/`en`，不在组件中写硬编码文案。

## 7. 验收与风险分层

### 7.1 单元/合同

- discovery：大小写、空白、多词、非法索引、同窗口排序通知；
- adapter/API：项目来源、技能类型/能力字段、提示词标签；
- asset：名称-only 搜索、尺寸边界、来源字段不进入 `AssetOrigin`/拖拽 payload；
- 既有画布写入、删除、撤销、持久化测试必须保持通过。

### 7.2 真实用户任务

至少复跑四条低成本任务并保存截图：

1. 搜项目名 → 打开项目；
2. 搜提示词 → 居中预览 → 送到画布 → 撤销；
3. 搜技能 → 看能力缺口 → 在创作区启用；
4. 切全部项目 → 按素材名找 → 居中预览；切项目素材 → 拖入当前画布/时间轴，写入携带既有来源线索。

现有 `asset-surface-convergence.walk.mjs` 和 `prompt-picker.walk.mjs` 继续作为回归入口；若环境 fixture 失败，记录根因，不降低断言、不扩大超时、不跳过测试。本次只在 React Flow 的 drop 边界传入已有 `activeProjectId`，没有改渲染/拖拽热路径；但该文件路径会按仓库策略触发 canvas performance 分类，因此保留 CI 结果并与既有 Linux 基线对账，不修改阈值来制造通过。

### 7.3 Ponytail 规则与 hook 验收

- `scripts/install-git-hooks.cjs` 保留原有 `commit-msg` 与 pre-commit 敏感数据扫描，并安装 `pre-commit`/`pre-push` 的 Ponytail runner；pre-commit 先扫敏感数据，再审 staged diff。
- linked worktree 若启用 Git `extensions.worktreeConfig`，安装器把 hooks 放到该 worktree 的 Git 目录并写入 worktree-local `core.hooksPath`；没有隔离能力时跳过安装，避免新分支改写共享 hooks 阻塞其他分支。
- `scripts/ponytail-review-hook.mjs` 解析 staged/outgoing diff，启动一次 `--ask-for-approval never --ignore-rules --sandbox read-only` 的只读、临时、限时 Codex skill 调用；Codex 缺失、超时、异常或无合法结果均 fail closed（原生洁净报告接受唯一一行 `Lean already. Ship.`，或该洁净结论加 `net: -0 lines possible.` 与最终 `PONYTAIL_REVIEW: PASS` 的明确适配器包络；原生 findings 可用 `net: -N lines possible.` 收尾；适配器 findings 使用唯一 `net` + 最终 marker 形式）。新建远端 ref 没有旧 SHA 时，以远端 HEAD 的 merge-base 作为基线，无法解析就拒绝整仓 diff。报告只写权限为 0600 的系统临时文件，读取上限 256 KB，评审结束立即删除；终端只显示状态、diff hash 和字节数摘要，不回显报告/进程输出，清理失败同样阻断 Git 操作。
- `scripts/ponytail-review-hook.node-test.mjs` 覆盖临时仓库安装、精确 diff 范围、multi-ref push、结果分类、Codex 失败/超时、fake runner 和 linked-worktree 隔离；`pnpm run check:ponytail-review` 接入 contracts。
- Ponytail v4.9.0 的 `/ponytail-review` 是宿主 Agent skill、没有独立 PATH 二进制，因此适配器调用 `codex exec` 的 `@ponytail-review` 等价触发；`--no-verify`、网页/API 和未安装 hook 仍需 CI/分支保护补强，不能声称本地 hook 绝对不可绕过。

### 7.4 已知限制

- 工作流复制的完整快照和缺失插件占位依赖 PR #239；
- Agent 搜索/调用/确认/审计依赖 PR #223，暂不接入；
- 全部项目素材当前是“可发现、可预览”；只有当前项目素材可拖拽写入，跨项目物化复制和来源反向索引另开合同；扫描失败会明确显示部分结果提示，不静默当成完整列表；
- 全部项目扫描目前按挂载实例串行读取，尚无共享缓存；大型项目首次打开会显示 loading/partial 状态，缓存合同另行设计；
- 资源正文仍由各自 store/API 管理，发现索引不是离线数据库。

## 8. 回滚与交付

回滚只移除发现 helper、共用 toolbar、对应 UI 绑定和测试；不触碰领域数据、IPC、React Flow、工作流插件或 Agent 代码。验证通过后一次性提交本分支并创建独立 PR；不推送 `main`，不合并 PR。PR #239 合并顺序若先于本分支，需在合并前按其最新 main 做一次无猜测的冲突整理，尤其关注 `libraries.ts`、`docs/plan/INDEX.md` 和 `docs/DELIVERY-LEDGER.md`。

## 9. 评审记录

- 设计审查：素材卡片减字、保留真实比例、详情居中；搜索占位必须与实际字段一致。
- 用户审查：用户不需要学习“超级库”或新格式，只要从已有入口快速找到并使用；跨项目复用必须保留来源。
- 工程审查：不增 preload/CSP 权限，不把最近使用索引变成第二份资源真相，不改变 Agent/#223 和工作流/#239 所有权。
- Ponytail 审查：Git hook 只启动一个只读、临时、限时的 Codex 评审适配器，输入绑定 staged/outgoing diff；不启动写权限 Agent、不执行测试/commit/push，也不另设收据旁路。
- Ponytail delete-list 处置：人工审查并删除无消费者的 evidence hash、`countLibraryItemsBy`、一调用包装器和当前分支的 speculative workflow 桶；技能来源筛选保留单一 owner。保留媒体类型守卫、有限的旧 sidecar 比例兼容、大小上限和 linked-worktree 隔离，因为它们分别是数据安全、真实比例显示、模型输入边界与并行工作树安全的必要边界。自动 hook 仅记录状态/摘要，逐条清单需在需要时另行运行 `@ponytail-review`。

> 完成标记：实现、focused tests、真实旅程截图、五门 gates、commit/push/PR 与 CI 状态全部核对后，才把本文件状态改为 ✅。
