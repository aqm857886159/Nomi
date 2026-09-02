# 技能导入真机走查报告 · 2026-09-03

走查者：QA agent（隔离 profile，dev build origin/main da415627）  
被测分支：docs/skill-import-walkthrough-20260903（off origin/main da415627）  
走查目的：验证 PR #279（rework/skills-import-195）"合入了"≠"用户真能导入"

---

## 一句话结论

**用户目前无法导入技能（不能）。** UI 入口存在、按钮可见、文件格式解析层完整，但主进程 IPC 处理器全部缺失——文件选完后静默失败，无任何错误提示。这是 P0 回归。

证据：
```
IPC_RESULT: Error invoking remote method 'nomi:skill:import': Error: No handler registered for 'nomi:skill:import'
SKILLS_AFTER_MD_UI: []
SKILLS_AFTER_ZIP_UI: []
```
截图见 `02-after-md-import.png` / `03-after-zip-import.png`（导入前后界面完全相同，无 toast，技能列表空空如也）。

---

## 一、可达通路清单

### GUI 通路（2 条，均需先进项目）

| # | 路径 | 点击次数 | 入口 file:line |
|---|---|---|---|
| G1 | 工作台 → 侧栏 技能库 icon (IconBooks) → 面板内「导入文件」按钮 | 2 次 | `ProjectExplorerSidebar.tsx:167-170` → `SkillLibraryPanel.tsx:importButton` |
| G2 | 工作台 → 创作区 → 工具按钮 (IconTool) → 下拉「技能管理」→ 侧栏打开 | 3 次 | `ProjectAgentResidentShell.tsx:732` → `nomi-focus-skill-library` event |

注：技能库**不在项目库页**，必须进入某个项目的工作台才可见（已由走查实测确认）。从项目库到技能导入最短路径 = 4 次点击（选项目 → 继续创作 → 技能库 → 导入文件）。

### CLI 通路（1 条）

| # | 命令 | 实测结果 |
|---|---|---|
| C1 | `npx skills experimental_install`（从 skills-lock.json 还原） | 未测（非本次走查范围）；仅恢复 `.claude/skills/`，非用户导入技能库 |

---

## 二、逐步走查记录

### Step 1：可发现性

- 从项目库页出发：「技能库」按钮**不在**项目库页，用户若不进项目就永远找不到。
- 进入项目工作台后：侧栏左侧 rail 有 IconBooks 图标，aria-label="技能库"，**可见、可点击**。
- 截图：`01-skill-library.png` — 面板打开后有「我的技能」/「Nomi 内置」tab 切换，「导入文件」按钮清晰可见。

**可发现性判断**：找得到（2 次点击），但需先进项目。P2 级体验问题：项目库没有入口，首次用户会懵。

### Step 2：文件格式解析层检查（渲染层，已 OK）

- `input[type="file"]` 的 `accept` 属性：`.md,.markdown,.zip,.json,.nomiskill` ✓（覆盖了 SKILL.md / zip / 信封三种格式）
- `parseSkillImport.ts` 实现完整，能处理裸 .md / zip（含 GitHub 套层文件夹）/ .nomiskill.json 三路径。
- **这层是 OK 的。**

### Step 3：IPC 层——致命断点

IPC 调用链：
```
渲染层 importWorkbenchSkill(payload)
  → preload.ts: ipcRenderer.invoke("nomi:skill:import", payload)
  → 主进程: [无 ipcMain.handle("nomi:skill:import", ...)]
  → 报错: "No handler registered for 'nomi:skill:import'"
```

实测结果（直接调 IPC）：
```json
{ "ok": false, "error": "Error invoking remote method 'nomi:skill:import': Error: No handler registered for 'nomi:skill:import'" }
```

通过 UI 文件选择（setInputFiles 触发）：同样静默失败，no toast，技能目录未创建。

### Step 4：export / delete 也失效

```json
"exportError": "reply was never sent"
"deleteError": "reply was never sent"
```

`nomi:skill:export` 和 `nomi:skill:delete` 在 preload 中声明为 `invokeSync`，但 main 进程也没有对应的 `registerSyncIpc` 注册。

### Step 5：错误路径诚实性

用户操作（选文件 → UI 无反应）：**静默失败，无 toast，无提示**。这是最差的错误处理模式——用户不知道是格式问题、还是根本没发生。

### Step 6：导入后真能用吗

因为 Step 3 导入本身失败，无法走到此步。已知代码路径：若导入成功，技能应落到 `settingsDir/skills/<dirName>/`，然后 `nomi:skill:list` 刷新后在面板显示（IPC list 本身工作正常）。

---

## 三、问题清单

### P0（功能性断点，现在就阻断用户）

| ID | 描述 | 证据 file:line |
|---|---|---|
| P0-1 | `nomi:skill:import` IPC handler 未在主进程注册 | `electron/skills/skillIpc.ts`：`registerSkillIpc` 只注册 `nomi:skill:list` + `nomi:skill:list-secure`；preload.ts:599 `ipcRenderer.invoke("nomi:skill:import")` 永远得到 "No handler" |
| P0-2 | `nomi:skill:export` handler 同样缺失 | `invokeSync("nomi:skill:export")` → "reply was never sent" |
| P0-3 | `nomi:skill:delete` handler 同样缺失 | `invokeSync("nomi:skill:delete")` → "reply was never sent" |
| P0-4 | 导入失败全程静默——无 toast、无日志、无任何用户反馈 | 截图 `02-after-md-import.png` = `01-skill-library.png`（一模一样） |

### P1（严重但次于 P0）

| ID | 描述 |
|---|---|
| P1-1 | `nomi:skill:import` 在 preload 里写成 `ipcRenderer.invoke`（async），但安装版 app.asar 里是 `invokeSync`（sync）——两套协议不一致，修主进程时必须同时对齐 preload |

### P2（体验问题，功能通了再修）

| ID | 描述 |
|---|---|
| P2-1 | 技能库入口不在项目库页，用户必须先进项目才找得到；首次用户路径长（4 次点击） |
| P2-2 | 技能库「我的技能」tab 默认为空时的 empty state 文案缺导入引导（只有「用 AI 新建」磁贴，无「或拖入文件」提示） |

---

## 四、已正常工作的部分（截图亲验）

- `nomi:skill:list` IPC → 返回 3 条内置 playbook，结构完整（brand-promo / drama-short / release-media-pack） ✓
- 侧栏技能库 tab 可见 ✓，aria-label="技能库" ✓
- 面板「导入文件」按钮可见 ✓，file input accept 含 .md/.zip ✓
- `parseSkillImport.ts` 渲染层解析逻辑存在且完整 ✓
- `importSkillPackageToUserDir` 主进程落地函数存在（`electron/skills/skillPackage.ts:273`）✓
- 安装版 Nomi.app（v0.21.0）app.asar 内有完整 `registerSyncIpc("nomi:skill:import", ...)` ✓（说明该功能曾经存在于某个更旧的构建）

---

## 五、修法建议

每条一句话：

1. **P0-1/P0-2/P0-3**（最高优先）：在 `electron/skills/skillIpc.ts` 的 `registerSkillIpc` 函数里补注册三个 handler——`registerSyncIpc("nomi:skill:import", importSkillPackageToUserDir)`、`registerSyncIpc("nomi:skill:export", (dirName) => exportSkillPackageByName(dirName, Date.now()))`、`registerSyncIpc("nomi:skill:delete", deleteUserSkill)`；同时把 preload.ts:599 的 `ipcRenderer.invoke` 改回 `invokeSync` 与其他两条对齐。

2. **P0-4**（同步修）：在 `handleImportFile` catch 路径（`SkillLibraryPanel.tsx`）补上 `showInfoToast(t('libraries.skill.importFailed', ...))` 兜底——当 `res.ok === false` 时已有，但 IPC throw 的 Error 没被 catch（`importWorkbenchSkill` 没有 try/catch 包裹，IPC 异常直接上浮到 React event handler 被吞掉）。

3. **P1-1**：修完 P0 后，把 `importPackage` 的 preload 统一为 `invokeSync` 与 export/delete 保持同一协议，消除混用隐患。

4. **P2-1**（下一轮）：在项目库页或设置页补技能库入口（或至少在 "Nomi 内置" tab 里加「管理我的技能 →」跳转）。

---

## 六、截图亲验清单（眼见链）

| 截图 | 路径 | 已用 Read 亲眼看过 |
|---|---|---|
| `01-skill-library.png` | `/var/…/nomi-skill-diag2-8vAOwd/01-skill-library.png` | ✓ 面板结构、按钮可见 |
| `02-after-md-import.png` | 同目录 | ✓ 导入前后完全一致，无变化 |
| `03-after-zip-import.png` | 同目录 | ✓ 同上，确认静默失败 |
| 安装版 splash | `/var/…/nomi-skill-import-installed-Ii35h7/01-initial.png` | ✓ v0.21.0 onboarding |
| 已安装 app 项目库 | `/var/…/nomi-skill-full-6mdCP0/01-after-skip.png` | ✓ 项目库页面无技能库入口 |

---

## 七、根因总结（一句话）

PR #279 交付了渲染层解析逻辑（`parseSkillImport.ts`）和主进程落地函数（`skillPackage.ts`），但**忘了把三个 write IPC handler 注册进 `registerSkillIpc`**——渲染层调 IPC 永远得到 "No handler registered"，用户选完文件后什么都不发生。
