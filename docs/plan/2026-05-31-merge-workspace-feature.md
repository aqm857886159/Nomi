# 把 workspace 文件管理功能合并进发布线 main

> 裁决：已在 main 的 Workspace/Project Explorer 链路中交付；证据：`electron/workspace/workspaceIpc.ts:97-120`、`docs/qa/workspace-folder-projects-qa.md:17-45`。

> 状态：实施中
> 触发：用户在另一个 AI 会话里、于父目录游离 HEAD（bf8a420）上做了一整套 workspace 文件管理功能（7 commits / ~4300 行），但从未合进 main。本地 app 由 main 构建，故看不到该功能。

## 1. 现状
- `main`（28f20ac, v0.8.0）：onboarding 抽参、请求管线、画布图片编辑、素材库修复。**无 workspace**。
- workspace 线（bf8a420，父目录游离 HEAD，无分支）：`5d6f2f7..bf8a420` 共 7 commit。
  - 4e8e37c workspace foundation
  - 91b60f3 workspace registry
  - f6261c3 route projects through workspaces
  - fe96364 workspace folder picker
  - 4c434a9 store generated outputs in workspace folders
  - 658e607 show workspace file tree in generation area
  - bf8a420 finalize workspace folder project migration
- 合并基：`5d6f2f7`（两线共同祖先）。
- 父目录另有**未提交暂存垃圾**：skills 目录重组 + package.json 版本 0.4.0→0.1.3（降版本）。**丢弃，不带过来**。

## 2. 方案
- 在 main 上 `git cherry-pick 5d6f2f7..bf8a420`（仅搬 7 个 commit，天然不含父目录的未提交暂存垃圾）。
- 预期冲突文件（两线都改过）：`electron/runtime.ts`、`electron/main.ts`、`electron/preload.ts`、`src/desktop/bridge.ts`、`src/workbench/library/ProjectLibraryPage.tsx`、`src/workbench/NomiStudioApp.tsx`、`src/workbench/WorkbenchShell.tsx`。
- 冲突解决原则：**两边功能都保留**——main 的删 cost / 请求管线 / 素材库修复 + workspace 的文件树 / IPC / 路由。不能用一边覆盖另一边。

## 3. 不动什么
- 不动父目录任何文件（只读 git 对象）。
- 不带父目录的 skills 重组、版本降级暂存改动。
- main 已有的 v0.8.0 功能全部保留。

## 4. 回滚
- 全程在分支 `feat/workspace-merge` 上操作，main 不动；失败 `git checkout main` 即恢复。
- 记录 main 起点 28f20ac，可随时回到。

## 5. 验收门
1. cherry-pick 全部应用，无残留冲突标记。
2. `pnpm exec tsc -p electron/tsconfig.json` 0 错；renderer `pnpm build` 通过。
3. `pnpm test` 全绿（含 workspace 新增测试）。
4. grep 无冲突标记 `<<<<<<<`。
5. 重新打包后 app 里能看到文件管理（生成区文件树 / 工作区）。

## 6. 为什么会发生（根因，供告知另一 AI）
见 §8。

## 7. 结果
- `git cherry-pick 5d6f2f7..bf8a420` 把 7 个 commit 全部搬到分支 `feat/workspace-merge`（基于 main 28f20ac）。
- 解决的冲突：
  - `runtime.ts`：4 处冲突 + 1 处误合并的旧 cost 块。原则=任务执行/cost/onboarding 用 main（新），项目走文件夹路由用 workspace。删掉 workspace 夹带的 `logCostEntry`/`costEntry`/`readProjectCostSummary`（main 已删 cost 子系统）。
  - `electron/main.ts`：import 冲突 → 两边都留（onboarding + workspace IPC）。
  - `ProjectLibraryPage.tsx`：两处冲突 → 同时保留 main 的搜索过滤（`filteredProjects`）+ workspace 的「打开文件夹」卡片与 `onOpenFolder` prop。
  - `WorkbenchShell.tsx`：恢复被 main cost 清理删掉的 `projectId` prop（这次是给文件树用，不是给已删的 cost 徽章）；NomiStudioApp 重新透传 `projectId`。
- 删除：`electron/cost/costLog.test.ts`（cherry-pick 夹带的孤儿测试，引用已删的 costLog.ts）。
- 修复：`WorkbenchShell` 的 `<main>` 漏了 `flex` class（合并时误取 HEAD 版），补回 → 文件树侧栏与内容并排。
- 验收：electron tsc 0 错、`build:renderer` 通过、`pnpm test` 46 files / 397+1 todo 全绿（含全部 workspace 新测试）、grep 无冲突标记、无 cost 残留。

### 7.1 目测验证时发现并修复的潜在 bug（非合并回归，是 workspace 功能自带缺陷）
- 现象：启动打包后的 app，点已有项目 → URL 进 `#/studio` 但视图弹回项目库，控制台刷 `本地项目记录损坏：payload 缺少必要字段`。
- 根因：workspace 文件夹迁移会写 **version:2** manifest（`.nomi/project.json`，payload 嵌套 + `lastKnownRootPath`），但 renderer 的 `workbenchProjectRecordSchema` 只认 `version: z.literal(1)`。V2 记录解析失败 → 落到 `normalizeLegacyRecord`（读顶层 `workbenchDocument` 等，V2 里这些在 payload 内 → undefined）→ `normalizePayload` 抛错。
- 这是 workspace 分支自身遗漏：electron 侧产出 V2，renderer 侧从没教会读 V2（folder-picker commit 只给 `createLocalProject` 加了 `rootPath` 选项，没碰 normalizeRecord）。今天迁移生成的 V2 manifest 才触发。
- 修复：`projectRecordSchema.ts` 的版本 schema 改为 `z.union([z.literal(1), z.literal(2)]).transform(()=>1)`——V1/V2 payload 同形，统一规整到内存里的 version:1 表示；加 `projectRepository.workspace.test.ts` 读 V2 记录回归测试。
- 目测结果（CDP 截图 `/tmp/nomi-studio.png`）：项目正常进 STUDIO，左侧文件树并排渲染（assets / generated / imported / cache / exports / project.json + 真实文件），`flex` 布局生效，日志 0 payload 错误。文件管理功能确认可见可用。

## 8. 根因复盘（告知另一 AI）

**核心原因：workspace 功能是在 detached HEAD（游离头指针）上开发的，从未合并/变基到 main。**

发生链条：
1. 另一 AI 在父目录 `/Users/aoqimin/Desktop/Nomi` 里 `git checkout origin/main`（检出的是**远程追踪 ref**，不是本地分支）→ 进入 detached HEAD 状态。
2. 在 detached HEAD 上直接 commit 了 7 次，**没有先 `git switch -c <分支名>`**。这些 commit 不属于任何分支，只能通过 reflog/HEAD 找到。
3. 从未 push → 没有远程备份、没有 PR、对 main 完全不可见。
4. 构建 / 运行 / 打包全部以 `main` 为基准，所以游离上的工作永远进不了 app。
5. 父目录还堆了无关的未提交改动（skills 目录重组、package.json 版本从 0.4.0 降到 0.1.3），进一步污染状态。
6. 两条线从共同祖先 5d6f2f7 各跑各的好几天 → runtime.ts 单文件 320 行分叉，合并时被迫手解大量冲突。

**给另一 AI 的预防规则：**
- **提交前必建命名分支**：`git switch -c feat/xxx`，**绝不在 detached HEAD 上 commit**。`git status` 第一行若是 "HEAD detached at ..." 立即停手建分支。
- **在会发布的那条线上开发**：和打包同源（这里 = `main`），或频繁 `git rebase main` 跟上最新，别让分叉拖到几百行。
- **及时 push + 开 PR**：让工作可见、可回滚、可 review。
- **一个功能 = 一个分支 = 尽快合并**，不要长期平行两套未reconcile 的历史。
- **别在 worktree 父目录里乱改**：父目录是另一个游离 worktree，改动既不在 main 也容易被忽略。
