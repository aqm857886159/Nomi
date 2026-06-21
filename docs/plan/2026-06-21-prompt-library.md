# 提示词库 + 节点 AI 优化下沉

日期：2026-06-21
状态：已拍板，实现中
触发：借鉴 basketikun/infinite-canvas 的提示词库；用户拍板「C 爬公开库打底 + AI 优化是招牌」「优化下沉成节点通用能力」「浮层从卡片放大浮到中央」「图+视频提示词都要、媒体也搬」「优化按钮用 Nomi 标记」。

---

## 1. 要解决的真实摩擦（为什么做）

用户盯着空 prompt 框不知道写什么、也不知道怎么写才出好图/好视频。库解决前半句（靠封面图挑现成起点），节点上的 AI 优化解决后半句（顺手一句口语想法 → 把提示词改好）。两者解耦，无并行版。

## 2. 范围

**做：**
- 主进程：从公开 GitHub 仓库拉取 + 解析 + 内存缓存（1h TTL，惰性刷新，失败回退旧缓存）提示词库，IPC 暴露给渲染层。图片 + 视频两类，封面媒体（图/视频 URL）一并带出。
- 渲染层：提示词库面板（顶栏入口）= 画廊网格 + 搜索 + 分类/标签筛选 + 点卡片「从卡片放大浮到中央」的预览浮层 + 「送上画布」。
- 节点 composer：新增「优化」按钮（Nomi 标记图标），调文本大脑流式改写当前 prompt，高亮回填。

**不做（明确划界）：**
- 不下载媒体到本地磁盘（v1 直接显示远端 URL；本地缓存首帧是后续切片）。
- 不做「我的素材」收藏（参考项目有，本期砍，广度敌人）。
- 不做服务端分页（数据在内存，渲染层虚拟化 + 过滤足够）。
- 不碰对话流 agentChatV2（优化是 one-shot 文本任务，不拖记忆/tools/多步）。

## 3. 数据源（实查锁定，2026-06-21）

> 真相：图片侧有成熟结构化源；视频侧**没有**图片那样的理想富媒体仓库，最优是「结构干净的 + 媒体稳定的」双源拼。如实接，不硬凑。

**图片（3 源）：**
| 仓库 | 媒体宿主 | 解析锚点 |
|---|---|---|
| EvoLinkAI/awesome-gpt-image-2-API-and-Prompts | raw.githubusercontent（稳） | `### Case N: [title](url)` + `<img src=".../images/poster_caseN/output.jpg">` + `**Prompt:**` |
| ImgEdify/Awesome-GPT4o-Image-Prompts（570★） | cdn.imgedify.com | `### title` + `**Prompt Text:** \`...\`` + `<img src="cdn.imgedify.com/...jpeg">` |
| YouMind-OpenLab/awesome-nano-banana-pro-prompts（12.5k★） | cms-assets.youmind.com | `### No.N: title` + `<img src="cms-assets.youmind.com/...">` + `**Prompt:**` |

**视频（2 源）：**
| 仓库 | 媒体宿主 | 解析锚点 |
|---|---|---|
| zhangchenchen/awesome_sora2_prompt（223★，结构最干净） | video.twimg.com（token URL，可能失效→媒体降级处理） | `prompts/*.md`：`### title` + `**Prompt:**\n\`\`\`...\`\`\`` + `**Video Links:** [View](mp4)` |
| hr98w/awesome-sora-prompts（OpenAI 官方 mp4，最稳） | cdn.openai.com/sora/videos/*.mp4（稳） | README/分文件，prompt + 官方 mp4 |

媒体不可达兜底：视频封面 URL 失效时显示占位 + 仍可用 prompt（诚实标，不假装）。

## 4. 架构与落点（file:line 来自勘查）

### 4.1 主进程数据层（新建 `electron/promptLibrary/`）
- `promptSources.ts` — 6 个源的配置（base URL、文件列表、parser 引用）。
- `promptParsers.ts` — 每源一个纯函数 `(markdown) => LibraryPrompt[]`，正则解析（纯函数便于单测）。
- `promptLibraryStore.ts` — 聚合所有源 + 模块级 TTL 缓存（仿 `electron/events/secretsProvider.ts:8-23`，失败回退旧缓存）。拉取用 `hardenedFetchText`（`electron/hardenedFetch.ts:214`，代理自动继承），仿 `electron/catalog/catalogCommit.ts:366`。
- `promptLibraryIpc.ts` — `registerPromptLibraryIpc()`，`ipcMain.handle("nomi:prompt-library:list", ...)`（仿 `electron/memory/memoryIpc.ts`）。在 `electron/main.ts` 的 `registerIpc()`（:335 区）注册。
- preload：`electron/preload.ts` 加 `promptLibrary: { list }`（仿 :86 memory 域）。
- 类型：`src/desktop/bridge.ts` 的 `DesktopBridge` 加 `promptLibrary?`。
- 渲染层 client：`src/workbench/api/promptLibraryApi.ts`（仿 `skillApi.ts:28` `requireDesktopRuntime`）。

`LibraryPrompt` 类型：`{ id, title, prompt, mediaUrl, mediaType:'image'|'video', promptType:'image'|'video', tags[], source, sourceUrl }`。

### 4.2 渲染层库面板（新建 `src/workbench/promptLibrary/`）
仿 `AssetLibraryPanel`（事件驱动全局浮层），不污染三工作区模型：
- `PromptLibraryPanel.tsx` — Portal/fixed 外壳 + ESC/点外关闭 + 头部 + 搜索 + 标签 chip（仿 `AssetLibraryPanel.tsx`）。
- `PromptGrid.tsx` — 虚拟化网格（`@tanstack/react-virtual`，仿 `AssetLibraryPanel.tsx:106`）。
- `PromptCard.tsx` — 单卡（封面 img/video + 标题 + 标签，视频带播放标，`React.memo`）。
- `PromptPreviewOverlay.tsx` — 自研 FLIP 放大浮层：记录卡片 `getBoundingClientRect()`，`transform` 从卡片原位 `scale(.22)` 过渡到屏幕中央 + 遮罩（动画仿 `AssetLibraryPanel.tsx:313` keyframes，缓动用 Nomi `cubic-bezier(.2,.7,.3,1)`）。媒体 16:9，视频可播。底部「送上画布」+「复制」。
- `usePromptLibrary.ts` — 数据 hook + 搜索/标签过滤纯函数。
- `promptLibraryTypes.ts` — 渲染层类型。
- 接线：① `NomiAppBar.tsx:9-13` 加 `openPromptLibrary()` 派 `nomi-open-prompt-library` + :181 旁加按钮（Nomi 标记/`IconBulb`）；② `NomiStudioApp.tsx:152` 仿写事件监听；③ :576 旁挂 `<PromptLibraryPanel>`。

### 4.3 送上画布
预览浮层「送上画布」→ `useGenerationCanvasStore.getState().addNode({ kind, prompt, select:true })`（`canvasNodeActions.ts:38`，自带碰撞避让）。kind 按 `promptType`：image→`'image'`、video→`'video'`（判别/映射 `generationNodeKinds.ts:94`，都默认落 `shots` 分镜）。需在 studio 上下文（面板本就在 studio 内）。

### 4.4 节点 composer AI 优化（下沉成通用能力）
- 按钮插入点：`NodeGenerationComposer.tsx` 底栏，参数 chip（:284）与生成钮（:285）之间。图标 = Nomi 标记（仿 `src/design/identity.tsx` `NomiLogoMark` SVG）。
- 点开 → 小输入框「说一句你的想法」+ 优化钮。
- 改写调用：复用现有文本任务流 `runWorkbenchTextTaskStream`（`taskApi.ts:123`）/ 'rewrite' 模式（`textActions.ts:15`，`buildTextPrompt:90`），把「原 prompt + 用户想法」拼成改写指令，流式 `onDelta` 回填。模型走 `chooseTextModel` 默认文本大脑（与创作助手同脑，P4 通用）。
- 回填：`updateNode(node.id, { prompt })`（`canvasNodeActions.ts:88`，受控自动回灌 textarea）。高亮改动用临时态展示。
- **不新建并行改写通道**：复用文本任务管线（P1）。

## 5. 切片（每片五门绿 + commit）

- **S0 数据层**：`electron/promptLibrary/*` + preload + bridge + api。单测覆盖每个 parser（喂样例 markdown 断言解析结果）。验收：单测绿 + 真机拉取打印条数。
- **S1 库 UI**：面板 + 网格 + 卡片 + 预览浮层 + 入口接线。验收：与样张 `nomi_prompt_library_zoom_popover` 逐项对账 + 真机走查（搜索/筛选/浮层放大动画/视频封面播放）。
- **S2 送上画布**：预览「送上画布」接 addNode。验收：真机点送 → 画布出对应 kind 节点 + prompt 已灌。
- **S3 节点优化**：composer ✨ 按钮 + 流式改写 + 回填。验收：与样张 `nomi_node_composer_optimize_nomimark` 对账 + 真机优化一条出结果。

## 6. 不动项
- 不改三工作区模型（creation/generation/preview）。
- 不改对话流 agentChatV2、文本任务底层 streamTextTask。
- 不改现有 addNode/registry 语义，只调用。
- 设计 token 全用现成 `nomi-*`，不新增 hex/任意尺寸。

## 7. 回滚
每切片独立 commit。库是纯增量（新目录 + 3 处接线 + composer 1 按钮），出问题 revert 对应 commit 即可，不影响现有功能。

## 8. 验收门（push 前）
五门：`check:filesize`（新文件均 ≤800）→ `check:tokens` → `lint:ci` → `typecheck` → `test`（parser 单测）→ `build`。
体验：S1/S3 与获批样张逐项对账 + Playwright/真机截图人眼判断（P3/R13）。
