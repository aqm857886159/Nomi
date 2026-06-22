# 提示词库 ·「我的库」+ 精选快照兜底 — 落地文档

> 2026-06-22。用户拍板：① 现有提示词库只能挑别人的（5 个外部 GitHub 合集），缺「存自己的、跨项目复用」；要补一个**用户级「我的库」**。② 现有空态（GitHub raw 拉不到时「没拉到提示词」）要靠**打包一份精选快照当兜底**消除。
>
> **拍板记录**：组织方式 = **来源切换**（我的库 / Nomi 精选 分开，非单一画廊混置顶）；捕获入口 = **只做面板「+ 新建」手写**（画布节点「存进我的库」这条本版不做，结构留口将来可加）。

---

## 0. 一句话

把提示词库从「只读·只能借别人的」扩成「**精选（外部）+ 我的（用户级、可写、跨项目）**」双来源；并打包一份精选快照，让外部源拉不到时也不空。

## 1. 技术讲解

### 1.1 我的库 = Nomi 第一个「用户级（跨项目）」存储
现状所有记忆都 **per-project 隔离**（防串台）。「我的库」要能跨项目复用，必须落在**用户级**：单文件 `prompt-library-user.json` 存 `getSettingsRoot()`（userData，非项目目录）。**拷贝语义**——送上画布是复制 prompt 文本进节点，不是全局共享真相源（避免一处改处处变）。对齐 `docs/plan/2026-06-21-user-level-memory-direction.md` §3.2「基础库」。

### 1.2 数据形态（单一真相源扩字段）
`LibraryPrompt` 加 `origin: "public" | "user"`（缺省 public）。用户条目：`id=user-<uuid>`、`origin=user`、`source="我的"`、`mediaUrl=""`（无成品封面 → 文字卡）、`mediaType=promptType`、`updatedAt`。`promptType` 由新建时选图/视频决定，不 hardcode。

### 1.3 精选快照兜底（task 1）
- `scripts/snapshot-prompt-library.ts`（tsx 跑）：复用 `promptSources` + `promptParsers`，拉全 5 源、解析、每源 cap 16（≈80 条，只当地板不是全量），写 `electron/promptLibrary/promptLibrarySeed.json`。可重复再生。
- `electron/tsconfig.json` 补 `resolveJsonModule`（base 没开），主进程 import 快照。
- `promptLibraryStore.ts`：把「全失败/无缓存 → 空」的地板从 `[]` 换成 `PROMPT_LIBRARY_SEED`。在线拉成功照常覆盖。空态从此基本不出现（除非筛选无命中）。

### 1.4 分层（沿用现有范式，不另起）
| 层 | 文件 | 职责 |
|---|---|---|
| 持久化 | `electron/promptLibrary/userPromptStore.ts`（新） | 用户库 CRUD（原子写/水合，仿 store） |
| IPC | `promptLibraryIpc.ts` | +user-list/add/update/delete |
| 桥 | `electron/preload.ts` + `src/desktop/bridge.ts` | +userList/userAdd/userUpdate/userDelete |
| 渲染 API | `src/workbench/api/promptLibraryApi.ts` | +origin 字段 + 用户库 4 个函数 |
| 状态 | `src/workbench/promptLibrary/useUserPrompts.ts`（新） | 用户库加载 + CRUD 态 |
| UI | `PromptLibraryPanel.tsx` + `UserPromptCard.tsx`（新）+ `UserPromptComposer.tsx`（新） | 来源切换 / 文字卡 / 新建·编辑表单 |

## 2. 通俗讲解
现在这个库像「别人贴在墙上的好作业」，你只能照抄。加「我的库」= 给你自己一个抽屉，把验证过好用的提示词手写存进去，**换任何项目都能拉出来**。精选快照 = 哪怕断网/墙了，墙上也预先贴了一批，不再开门一片空。

## 3. 用户看到的 UI 变化
- 顶部多一个「**我的库 / Nomi 精选**」开关（默认 Nomi 精选，保持现有第一印象）。
- 切到「我的库」：第一格是「**+ 新建**」虚线卡 → 点开内联表单（标题 + 提示词 + 图/视频）→ 存入即出卡。
- 我的卡片 = 文字卡（显示提示词摘要），带「我的」徽章 + 悬停「编辑/删除」。点卡可预览/送上画布（和精选一致）。
- 我的库空时：「还没有自己的提示词，点 + 新建攒第一条」。

## 4. 不动项
- 画布节点「存进我的库」捕获入口（本版不做，结构留口）。
- AI 优化仍在节点 composer（不进库）。
- 外部 5 源、1h 缓存、send-to-canvas 建节点逻辑不变。
- per-project 记忆隔离不变（我的库是新增的用户级层，不动既有层）。

## 5. 回滚
新增文件可整体删除；改动点（types `origin`、store 地板、tsconfig、panel 来源切换）均加法式，revert 对应 commit 即回到现状。

## 6. 验收门
- 五门全过（filesize 不计 JSON / typecheck 需 resolveJsonModule / lint / test / build）。
- 单测：userPromptStore CRUD（add→list→update→delete 幂等 + 落盘水合）。
- 真机走查（R13）：开库 → 切我的库 → 新建图/视频各一 → 编辑 → 删除 → 送上画布建对应节点 → 重开 App 仍在（跨会话持久）；断源时精选不空（快照兜底）。
