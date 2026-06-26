# 技能库中枢（Skill Library Hub）

日期：2026-06-23
状态：已交付（五门全绿 + 真机走查通过）
负责：本会话

## 交付补记（与计划的差异）
- 走查发现 `skills/` 根混进 16 个未跟踪的工程技能（superpowers 的 brainstorming/systematic-debugging…，无 manifest，不进打包）+ 6 个内置里含 5 个幕后管线技能（creation-edit/skill-author/workbench.*，自动路由非浏览挑选项）。
- 用户拍板「收紧，只显面向用户的」→ `listSkillsForRenderer` 过滤改为 **用户目录 ∪ 内置 playbook（有 stages）**，口径与创作区技能下拉（ActiveSkillChip 的 isPlaybook）一致。内置现只露「品牌宣传片」。
- 真机走查（隔离 userData）逐项验过：AppBar 按钮位置/书图标、面板、来源切换、卡片、内置只读无删除键、导入→我的技能出现、删除→消失计数减、在创作区用→切创作区。
- 遗留（未做，待定）：`workbench.fixation.planner` 无 manifest 故不进库（它由专属按钮触发，影响小）；要让它可在库浏览须补一份 skill.json。

## 0. 已拍板（动手前锁定）
- **icon**：那摞书 `IconBooks`（和提示词库灯泡/素材库照片/模型插头同款 outline 单物件，stroke 1.7）。同时用在 AppBar 按钮 + 面板头部。
- **布局**：A 画廊式 —— 和 `PromptLibraryPanel` 保持设计一致（卡片网格 + 来源标签 + 搜索）。
- **创建**：只走 AI（复用「让 AI 帮我写技能」），v1 不做手填 manifest 表单、不做手动编辑。
- **入口**：AppBar 那排库按钮（提示词库/素材库/模型旁）。
- **v1 不碰**：「非 playbook 技能在创作区下拉看不到」的 runtime 路由问题（独立切片）。

## 1. 为什么做（真实摩擦）

现状：技能功能只做了一半。技能在 UI 上唯一露面处是**创作区 AI 助手面板顶部的「当前技能」徽标**下拉，而且：
- 没有「技能库」页面 —— 用户做过的技能落进 `userData/skills/` 后，**UI 上没有任何地方能列出/浏览它们**。
- 下拉只列 `isPlaybook`（manifest 带 `stages`）的技能（`ActiveSkillChip.tsx:49`），目前全库只有 `brand.promo` 一个 → 用户做的非 playbook 技能**直接隐身**。
- 导入技能文件、导出、删除：UI 全无入口（`exportWorkbenchSkill` 后端有但零 UI 调用；删除后端根本不存在）。

摩擦一句话：**「我做了技能，但看不见、管不了、也不知道它在哪。」**

## 2. 范围

### 做（v1）
一个 overlay 模态面板「技能库」（抄 `PromptLibraryPanel` 范式），能：
1. **浏览**：来源标签「我的技能 / Nomi 内置」+ 搜索；卡片显示用途、playbook 段数 / 助手标、所需模型与缺口（复用 `skillCapabilityFor`）。
2. **导入文件**：渲染层 `<input type=file>` + `FileReader` 读 `.json`/`.nomiskill` 包 → `importWorkbenchSkill(pkg)`。**不加系统对话框桥。**
3. **导出**：`exportWorkbenchSkill(dir)` 返回的 SkillPackage 对象 → `JSON.stringify` → Blob → `<a download>` 触发下载。**不加桥。**
4. **删除**（仅「我的技能」）：新增后端删除 IPC，带撤销 toast。内置只读禁删。
5. **用 AI 新建**：跳创作区，复用现有「让 AI 帮我写技能」（skill-author）流程；做完自动落库（已有逻辑 `CreationAiPanel.tsx:343`）。
6. **在创作区用**：选中技能 → 跳创作区并锁定该技能（派发事件 + 设 `creationActiveSkill`）。
7. **入口**：`NomiAppBar.tsx` 那排库按钮（提示词库/素材库/模型旁）加「技能库」，派发 `nomi-open-skill-library`；`NomiStudioApp` 加 `skillLibraryOpened` state + 监听 + 懒加载面板（三件套抄提示词库）。

### 不做（v1 明确砍）
- ❌ **手填 manifest 表单创建/编辑技能** —— 违 D1（让用户学我们格式 = 离谱）。创建只走 AI；编辑 v1 不做（要改 = 用 AI 重写或重新导入）。
- ❌ 系统文件对话框桥（用渲染层 file input + blob 下载替代）。
- ❌ 修「非 playbook 技能在创作区下拉看不到」的运行时路由问题 —— 是另一条独立链，本次只让库页面能浏览到它们，不动 runtime。

## 3. 后端要补的（小）

| 项 | 现状 | 要做 |
|---|---|---|
| 来源标志 `origin: 'builtin'\|'user'` | `SkillListItemDto` 缺（提示词库有 `origin` 可抄）| `listSkillsForRenderer`(skillIpc.ts:27) 按 root 归属给每条标；用户根 = `getUserSkillsRoot()` |
| 删除 IPC | **无任何 delete** | 新增 `nomi:skill:delete` handler + preload `skill.deleteByDir` + `skillPackage.ts` 删目录函数；**只允许删 `getUserSkillsRoot()` 下的，拒删内置** |
| 导入/导出 | 已有 `importWorkbenchSkill` / `exportWorkbenchSkill` | 复用，不动后端 |
| 创建 | 已有 skill-author 流程 | 复用，不动后端 |

## 4. 文件清单（预计）

**新建（前端）**：
- `src/workbench/skillLibrary/SkillLibraryPanel.tsx` — 面板（抄 PromptLibraryPanel 结构，≤300 行）
- `src/workbench/skillLibrary/useWorkbenchSkills.ts` — 列表 + 删除 hook
- `src/workbench/skillLibrary/SkillCard.tsx` — 单卡

**改（前端）**：
- `src/ui/app-shell/NomiAppBar.tsx` — 加「技能库」按钮 + `openSkillLibrary()`
- `src/workbench/NomiStudioApp.tsx` — `skillLibraryOpened` state / 监听 `nomi-open-skill-library` / 懒加载面板
- `src/workbench/api/skillApi.ts` — 加 `deleteWorkbenchSkill(dir)`、DTO 加 `origin`

**改（后端）**：
- `electron/skills/skillIpc.ts` — DTO 加 `origin`
- `electron/skills/skillPackage.ts` — 加 `deleteUserSkillDir(dir)`（只删 userRoot 下）
- `electron/main.ts` + `electron/preload.ts` — 注册/暴露 `nomi:skill:delete`

## 5. 验收门（P3：全绿≠完成）
- 五门全过（filesize→tokens→lint→typecheck→test→build）。
- 真机走查：打开技能库 → 切两个来源 → 导入一个包文件成功落「我的技能」→ 导出一张卡得到 json → 删除一张「我的技能」卡（内置删不掉）→ 「用 AI 新建」跳到创作区流程 → 「在创作区用」锁定技能。截图人眼判断。
- 与本样张逐项对账。

## 6. 回滚
全部新增 + 三件套接线，回滚 = 撤面板组件 + AppBar 按钮 + NomiStudioApp 接线 + 后端 delete IPC，无破坏性迁移。

## 7. 待用户拍板（动手前）
1. **创建/编辑路径**：确认「创建只走 AI、v1 不做手填表单 / 不做编辑」。（推荐：是 —— 贴 D1）
2. **入口位置**：确认放 AppBar 那排库按钮里。（推荐：是 —— 和提示词库/素材库一致）
3. **范围**：确认 v1 不碰「非 playbook 技能在创作区下拉看不到」的 runtime 问题。（推荐：是 —— 独立链，分开做）
