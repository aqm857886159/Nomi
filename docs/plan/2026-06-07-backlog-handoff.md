# 剩余 backlog 交接（2026-06-07，给新会话冷启动用）

> 上个会话太长、上下文过满，转新会话继续。**新会话先读本文件 + CLAUDE.md**，再按「剩余清单」往下做。
> 决策都已和用户拍板，照做即可；遇真正岔路才停下问。

---

## 0. 状态快照

- 分支 `main`，工作树干净。`package.json` = **0.9.4**。
- **本地 `/Applications/Nomi.app` = 0.9.4，但是旧的**：它在 commit `34082ec`（bump）之后立刻打包，**没含后面 3 个提交的修复**（见下「已完成」末 3 条，含一个 P0）。所以最后一步重打包必做。
- 未跟踪：`docs/design/mockups/2026-06-07-asset-library.html`（素材库样张，已拍板）、两份 `docs/audit/2026-06-07-ux-walkthrough*.md`（早先走查记录）。

## 1. 本会话已完成（已提交推送）

| commit | 内容 |
|---|---|
| `5643935` | R-F 助手停靠宽度可拖拽 + 文件树只在生成区 |
| `582ae98` | 模型设置面板重设计（折叠摘要卡 方案 A）+ 真实推广链接 |
| `226ac4d` | 下载按钮移工具条末尾 + 供应商真实 brand logo（apimart黑M/kie蓝A，打包进 src/assets/vendor-logos）|
| `1e0657e` | 创作编辑器 placeholder 真显示（补缺失 ::before CSS）+ 助手建议去小说味 |
| `9b91fa8` | README 精简 190→125 行 + 换正确截图 |
| `34082ec` | bump 0.9.3→0.9.4（**本地 app 停在这**）|
| `2bb0125` | **P0**：自动选模型避开不会工具调用的模型 + 「只说不做」告警 |
| `f69e7c0` | 一批设计修复：助手空隙(删冲突旧CSS)/去接入图标/模型名显具体/左栏图标/预览控制条不折行不截断 |
| `e69bebc` | 项目卡名称去重 + 创作助手默认折叠可展开 |

外加 apimart 一个 key 全通接入（更早提交，已真测：填 key→12 模型点亮→真出图）。

## 2. 剩余清单（按此顺序做；决策已拍板）

> 建议顺序：先把要进 app 的功能都做完（#A #B），再统一验证/固化/打包（#C #D #E），避免重复打包。

### #A 素材库面板（真实库）— 样张已拍板
- 样张：`docs/design/mockups/2026-06-07-asset-library.html`（右侧抽屉：头部 上传/✕ + 分段筛选 全部/图片/视频/音频 + 搜索 + 网格 + 空态）。
- **复用现成件**（不要从零造）：`src/workbench/assets/useAssetPool.ts`（画布节点+项目文件去重合流，单一真相源）、`AssetTile.tsx` 的 `AssetThumb`、`assetTypes.ts` 的 `filterAssets(assets,{query,accept})` + `AssetKind`。
- 挂载仿 `src/ui/onboarding/OnboardingFloatingPanel.tsx`（Mantine `Portal` 固定面板 + Escape/点外关闭），挂进 `src/workbench/NomiStudioApp.tsx`（参照 `OnboardingFloatingPanel` 那套：lazy + state + CustomEvent `nomi-open-asset-library`）。
- AppBar：`src/ui/app-shell/NomiAppBar.tsx` 的「素材库」按钮（约 192 行）**从 `assetInputRef.click()` 改为 dispatch 开面板事件**；上传移进面板（复用 `importImageFilesToGenerationCanvas`，见 NomiAppBar `handleAssetFilesSelected`）。
- projectId：从 URL param 取（NomiStudioApp 第 53 行 `new URLSearchParams(search).get("projectId")`）。
- v1 范围建议：浏览+筛选+搜索+上传（够"真实库"）。拖到画布/删除（pool 合并源，删哪个源要想清）可作 v1.1，别硬塞。

### #B 项目/文件夹来源徽标 — 已拍板「先查再做」，已查清=可行
- **结论**：靠项目目录位置判，**存量项目也能判**、无需 schema 迁移。原生项目目录在默认 `NOMI_PROJECTS_DIR` 内；用「打开已有文件夹」的项目目录 = 外部 rootPath（`openWorkspaceFlow.ts` 把 rootPath 传给 `bridge.workspace.openFolder`，后端该项目 dir 即外部路径）。
- 实现：后端 `electron/runtime.ts` listProjects 给每个项目派生 `source:'native'|'folder'`（比较 `projectDirById` 与默认根）；前端 `ProjectLibraryPage.tsx` 项目卡加视觉徽标（文件夹角标/不同色）区分。token-only。

### #C 把修复+踩的坑落成 `tests/ux/design-fidelity.e2e.mjs` 断言
- 用现成文件（**别造新测试框架**，CLAUDE.md R13 已规定）。加断言锁本会话修的回归点：
  - 生成助手 aside `display:flex`（非 grid）、工具条折叠条行高 ~26px（非 146）；
  - 预览控制条 导出MP4/安全框 单行（高 28、不折行）、画幅/显示 select 值不截断（无 …）；
  - 助手模型选择器显具体模型名（非"自动选模型"）；左栏缩起按钮含 svg 图标（非文字"类/文"）；
  - 项目卡无封面时缩略图无项目名（名称只在下方一次）；创作助手默认折叠（pill 在、面板未挂载）。

### #D 冷启动 J3 + 导出 J5 真测
- J3：隔离启动模拟全新安装——`electron.launch({args:[".","--user-data-dir=/tmp/nomi-cold"], env:{...,NOMI_PROJECTS_DIR:"/tmp/nomi-cold-projects"}})`，走「30秒体验」验 CS1/CS2（首页无模型接入入口 + 全新安装零文本模型预置 → 第一步死）。这是已知 **P0 断路**，验完大概率要修（首页加接入入口 + 预置一个文本模型 archetype）。
- J5：改节点 prompt→重新生成→导出 MP4 真跑（需额度 + ffmpeg）。

### #E 重打包并更新本地 app（最后做，含以上全部）
- bump `package.json` 0.9.4→**0.9.5**；`pnpm run build` → `pnpm run dist:mac:dir`（arm64，输出 `release/mac-arm64/Nomi.app`）。
- 安装：`osascript -e 'quit app "Nomi"'` → `rm -rf /Applications/Nomi.app` → `cp -R release/mac-arm64/Nomi.app /Applications/` → `xattr -cr /Applications/Nomi.app`（清隔离，未签名必做）→ `open -a Nomi` 验证启动。
- 本机是 arm64。

## 3. 踩过的坑（务必沿用，否则重复踩）

- **R13 驱动用现成的**：后台 `node tests/ux/ui-driver.mjs`（run_in_background），命令 `node tests/ux/ui.mjs <snap|shot|click|fill|eval|wait|quit>`。**不要造新测试脚本**。
- **驱动 fill 不同步 React 受控组件**：给输入框写值要用原生 setter + input 事件：
  `eval "(function(){var t=document.querySelector(SEL);var s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;s.call(t,VAL);t.dispatchEvent(new Event('input',{bubbles:true}))})()"`，再点发送键。
- **单实例**：跑驱动前先退已装 app（`pkill -f "/Applications/Nomi.app"`）——无单实例锁，两实例抢同一 userData 会写坏 catalog/project JSON。
- **stale chunk**：改完渲染层、driver 仍显示旧 UI/旧 CSS（computed 与源码对不上）时，先 `rm -rf ~/Library/Application\ Support/nomi/{Cache,Code\ Cache,GPUCache}` 再重启驱动。
- **截图太大读不了**：driver 截图 2880px，先 `sips -Z 1200 in.png --out /tmp/x.png` 再 Read。
- **生成 Agent 工具调用**：默认「自动选模型」别选到 vision/preview 模型（不发 tool_use，只回文字）——已在 `chooseTextModel`(runtime.ts) + AssistantModelPicker 降权修复。生成真测用 kie 的图片模型（kie 有 key）。Playwright 抓不到 vendor HTTP（在主进程），看节点视觉状态变化判断。
- **代理**：apimart/外部 vendor 需代理；Electron 主进程已支持，driver 跑生成 OK。Node 脚本直连要 `NODE_USE_ENV_PROXY=1`。

## 4. 关键文件指针

- 设计系统（动 UI 必读）：`docs/design/nomi-design-system.md`（token-only，§6 图标只用 Tabler）。
- 模型接入：`electron/catalog/`（apimart*/kie* mapping + seedBuiltins）、`src/config/knownVendors.ts`、`src/ui/onboarding/{OnboardingDrawer,VendorOnboardCard,FoldableModelCard}.tsx`。
- 素材：`src/workbench/assets/{useAssetPool,AssetTile,assetTypes,AssetPicker}.ts(x)`。
- 助手：`src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx`（生成）、`src/workbench/creation/CreationAiPanel.tsx`（创作）。
- 记忆：`~/.claude/.../memory/model-onboarding-and-e2e-loop.md`（真实生成 E2E + 自动选模型 P0 + 教训）、`r13-walkthrough-gotchas.md`。

## 5. 给新会话的一句话

> 读完本文件 + CLAUDE.md，按 §2 顺序做 #A→#E；每改完跑五门（filesize/lint/typecheck/test/build）+ R13 真机走查，验证通过即提交推送（R11）。决策已拍板，照做。
