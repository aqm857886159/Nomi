# 交接：多项目标签页 阶段一 UI + 接线（下一个 AI 冷启动读这份）

> 写给接手的 AI。先读本文件，再读 `docs/plan/2026-06-19-multi-window.md`（完整方案）。
> 最高真相源永远是 `CLAUDE.md`（工程纪律）；本文件只是当前任务的上下文。

## 0. 你的任务（本轮范围）
实现「浏览器式项目标签页」**阶段一**：标签条 UI + 接进 `NomiStudioApp`，让用户能多项目标签切换。
**不含**分屏（阶段二，是 store 隔离大重构，见 §6，本轮别碰）。

## 1. 已落地的基座（别重做，直接用）
- `src/workbench/tabs/projectTabsStore.ts`（已 push，commit 53586f0）+ 8 单测全过。
- API：`useProjectTabsStore` →
  - state：`tabs: ProjectTab[]`（`{id,name}`）、`activeId: string|null`
  - `openTab(tab)`：**同项目锁已实现**——同 id 不新建只聚焦（改了名会同步名）
  - `closeTab(id) → newActiveId`：关活动标签→激活相邻（优先右）；空了→`null`（回项目库）
  - `setActive(id)` / `renameTab(id,name)`
  - 持久化 localStorage 已实现（重开 app 恢复标签）
- 纯函数 `applyOpenTab/applyCloseTab/applyRenameTab` 可单测（已测）。

## 2. 要做的（阶段一剩余）
1. **标签条 UI 组件**（`src/workbench/tabs/ProjectTabBar.tsx`）：浏览器式——每标签 `图标+项目名+×`，右侧 `＋`。渲染自 `useProjectTabsStore`。**先读 `docs/design/nomi-design-system.md` 用 token**（禁非 token 的 px 字号/圆角/hex）。
2. **挂进 app shell**：`src/workbench/NomiStudioApp.tsx`（584 行）。标签条放 workbench 视图顶部（`NomiAppBar` 之上或整合一行）。
3. **接线**（核心）：
   - 切标签 → `setActive(id)` + 调 `hydrateProject(id)`（NomiStudioApp 内已有，约 line 192）
   - `＋` → 回项目库选项目（`setView('library')`）；选中→ `openTab(project)` + hydrate
   - 关标签 → `const next = closeTab(id)`；`next===null` → 回库；否则 `hydrateProject(next)`
   - 从项目库「继续创作」打开项目时 → 也要 `openTab({id,name})`（让它进标签）
   - **同项目锁**：openTab 已 dedup；确认"重复打开同项目"是聚焦已有标签、不新建（真机验）
4. **后台生成不停**（核心爱点的来源）：生成在**主进程**跑，切标签不影响——**无需改后端**。

## 3. NomiStudioApp 现状（已摸，省你时间）
- `view: 'library' | workbench`（useState）；`activeProject: LocalProjectSummary | null`
- `hydrateProject(projectId, {replaceUrl?})` —— 加载项目（已有）
- projectId 从 URL search param 读（line 86）；路由 `#/studio?projectId=X`（HashRouter）
- `setDesktopActiveProjectId(activeProject?.id)`（line 182）——切项目时同步

## 4. 验收门（必做，别跳）
- **五门**：`pnpm run gates`（filesize→tokens→lint→typecheck→test→build）。
  ⚠️ filesize 当前因**并行会话**的画布文件（GenerationCanvas.tsx/BaseGenerationNode.tsx 超 800 行）可能红——**那不是你的**，只 `git add` 自己的文件即可；push 前 `git fetch` + rebase（并行会话在抢 main）。
- **R13 真机走查**（关键）：用 `tests/ux/ui-driver.mjs`（后台 `run_in_background:true`）+ `tests/ux/ui.mjs <snap|shot|click|eval>`。
  ⚠️ **先彻底清场**：`pkill -9 -f electron; pkill -9 -f Nomi.app; pkill -9 -f ui-driver`，否则 Electron 僵尸导致页面闪退（踩过）。
  走查清单：① 开俩项目→切标签项目不串改 ② A 后台生成时切到 B，A 生成不停 ③ 关标签不崩、激活相邻对 ④ 重复打开同项目→聚焦不新建 ⑤ 重开 app 标签恢复。**截图人眼判断**。
- **R8**：标签条是用户可见 UI → token-only；基础标签条可照浏览器惯例直接做，但 token 要对（字号 text-body-sm/micro、圆角 rounded-nomi、色 var(--nomi-*)）。
- 报完成前别说"做好了"，除非真机走查过（P3）。

## 5. 真实资源（已配进 app，可用于验证）
- 魔搭 key `ms-...` / 火山 Ark key `ark-...` 已 encrypted 存进 catalog（生成验证可直接用）。
- 真机生成验证回路：`window.nomiDesktop.tasks.run({vendor,request})` → `tasks.result(...)` 轮询；asset 落 `~/Documents/Nomi Projects/<项目>/assets/generated/`。

## 6. 阶段二（分屏，本轮别做，但要知道边界）
分屏 = 两项目同屏并排 + 拖宽度。需要：
- store 工厂化：`createWorkbenchStore()` + React context（`useWorkbenchStore` 改读 context；105 处 hook 几乎零改）。
- **121 处非 React 全局访问**（`useWorkbenchStore.getState/setState/subscribe`，散在 agent 工具/生成控制器/IPC 桥）**逐处重接线成 pane-aware**——接错 = agent/生成写到错项目 = **跨项目串改 = 唯一不能碰的线**。必须 TDD + 跨项目串改回归断言。**独立一轮专注做**。

## 7. 本 session 已交付（别重做）
- 版本号 + 检查更新 + 一键更新（electron-updater + 顶栏 Nomi 标志开「关于」浮层）✅push
- 时间轴预览音频修复（去 `<video muted>`）✅push
- 魔搭 7 图像模型（Z-Image Turbo/Z-Image/Qwen-Image/FLUX.2 Klein/FLUX.1 Krea/majicFlus + Qwen-Image 改图）+ 火山 Seedream 全 family（5.0真验/4.5/4.0）——**全逐个真机出图验证** ✅push
- 分镜镜卡模型参数渐进展开（ShotParamControls，常用 inline + 抽屉，archetype 派生）✅push 真机验过（commit d4f7cd7）
- 标签页基座（本文件 §1）✅push（commit 53586f0）

## 8. #4 其余（方向聊清，未动手）
- **#4-b Soullens**：Nomi 拆镜头已覆盖「剧本→人物/场景/道具/分镜」；真正差异只在"一键批量生成全套定妆卡图"的爽感。待定是否做这个批量加速（不是新链路）。
- **#4-c 技能库**：**别抄 Nody 的技能清单**（飞书文档登录墙看不到）。做「**技能通用接入框架**」——像模型接入那样：技能 = 声明式档案（输入选区/节点 → 操作+参数 → 输出落画布），通用系统渲染参数 UI（复用分镜参数那套）+ 执行；加技能 = 加档案、不写新 UI（P4）。Nomi 已有「切图/裁剪」是第一个实例。待出方案文档。

## 9. 纪律速记（CLAUDE.md 是完整真相源）
P1 加新必删旧无并行版 · P2 修根因 · P3 全绿≠完成(真机走查) · P4 通用第一 · P5 想清楚再动。
R5 碰三方库先 Context7（zustand/Electron/Mantine/React Flow）· R8 UI 先 token+样张 · R9 单文件≤800 · R11 验证过自己 commit+push、只 add 自己文件、push 前 fetch（并行会话抢 main）。
