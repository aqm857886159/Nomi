# C5 · 文本节点 → 文档编辑器

> 裁决：已在现行 TextDocumentNode 与共享富文本内核中交付；证据：`src/workbench/generationCanvas/nodes/render/TextDocumentNode.tsx:1-21`、`src/workbench/common/useNomiRichTextEditor.ts:35-42`。

> 用户已确认样张方向（`docs/mockups/c5-text-node.html` v2）。本文是经设计师 + 真实用户评审后的落地方案。复杂交互，分多轮。

## 关键事实（评审挖出，纠正既有认知）
- **画布不是 React Flow**，是自研画布：`canvasZoom` 在 store，拖拽/缩放靠 `BaseGenerationNode` 的 pointer + rAF（8 向 `RESIZE_DIRECTIONS`、`MIN/MAX` 常量）。→ **不能引 React Flow NodeResizer**（规则 1），复用现成 resize-zone。
- `BaseGenerationNode.handlePointerDown` 白名单（~line 314）只放行 button/input/textarea/select，**`contenteditable` 不在内** → 不修就没法在节点里选字/打字（拖拽吞光标）。**P1 必修。**
- 创作区 `WorkbenchEditor` 已是正确接入的 Tiptap（StarterKit+Placeholder + markdown 工具 + keydown stopPropagation 挡全局快捷键 + lastEditorJsonRef 防回灌）——**复用的真相源**。

## 模块化拆分（不堆进 BaseGenerationNode）
- `hooks/useNomiRichTextEditor.ts` — 共享内核：extensions、markdown 工具、命令链、读选区。**唯一真相源**，创作区 + 文本节点同用。
- `creation/richTextActions.ts` — `buildRichTextActions(editor)` 纯函数（B/I/H/列表…），创作区渲染成横条、节点渲染成浮动 pill。
- `nodes/render/TextDocumentNode.tsx` — 文本节点 body（消费 hook + EditorContent），走 `renderKind` 分发（像 character-card 那样）。
- `nodes/render/TextFormatBar.tsx` — 浮动格式条（编辑/选中出现，自动上下翻避免飞出屏幕）。
- **同 commit 重构 `WorkbenchEditor` 消费 hook，删掉它本地的 useEditor/toolbar 内联定义**（规则 1，不留两套 Tiptap）。
- 底部模型框：复用 `NodeGenerationComposer`，给它加 `text` 执行分支（文本模型 + 文本 placeholder），不另写第二套底部框。
- 缩放：复用现成 resize-zone；文本节点 min 280×200 单独 clamp，不动全局常量。

## 评审采纳的体感要点
- **拖动 vs 编辑**（用户最怕）：点正文 = 编辑；只有抓节点头那条「Text」栏才能拖。白名单加 `[contenteditable]/.ProseMirror`；header 保持 grab，body 不抢 pointer。
- **键盘**：节点内 Tiptap keydown/keyup stopPropagation，否则打字触发画布删除等快捷键（Backspace 删节点 = 致命）。
- **格式条飞出屏幕**：贴顶时自动翻到下方。
- **生成不覆盖**：区分 续写 / 改写(选中) / 重写——默认续写(appendToEnd)，不一点生成就清空已写。
- **临时放大**：双击节点头 → 原地铺满沉浸编辑，再点缩回原位（不跳页、位置不变）。

## 分阶段（每阶段可验、可回滚）
- **P1 核心可用**：抽 `useNomiRichTextEditor` + 重构 WorkbenchEditor 复用；`TextDocumentNode` 内联可编辑 body（脱离图片预览）；持久化 `node.contentJson`；白名单+键盘修复（能在节点里安全编辑）；composer text 生成分支（默认续写不覆盖）；复用 resize。→ 文本节点变成"能写、能生成、能缩放"的文档卡片。
- **P2 体验**：浮动格式条（buildRichTextActions + 自动翻向）；双击头临时放大；生成模式 续写/改写/重写。
- **P3（远期，用户命脉）**：AI 出的分镜结构化 → 一键把每个镜头喂给下游 图片/视频 节点（文本→分镜→下游串联）。

## 设计系统 token
节点壳 `bg-nomi-paper border-nomi-line rounded-nomi shadow-nomi-md`；编辑态 `nomi-accent` 1.5px + shadow 提一级；格式条 `bg-nomi-paper border-nomi-line shadow-nomi-lg`，active `bg-nomi-accent-soft text-nomi-accent`，按钮复用 `WorkbenchIconButton`；生成按钮沿用现有 ink→accent。全部 token，无裸值。

## Context7 / 规则 5
Tiptap 是框架——下个会话 Context7 生效后，实现前查 Tiptap 官方（editable 切换、BubbleMenu/floating toolbar、防回灌）核对。本会话先以 `WorkbenchEditor` 真实代码为准。

## 回滚 / 验收
- 分阶段 commit，互不依赖。
- 每阶段 `pnpm build` 绿 + `vitest` 不回归 + 本地重建目测：能在节点里打字（不误拖）、能生成不覆盖、能缩放。

## 执行结果（回填）
- **P1 Chunk 1（数据地基）✅ commit `10042d3`**：`GenerationCanvasNode` 加 `contentJson?: TiptapDocJson`
  + zod schema `passthrough().optional()`（旧节点兼容）+ schema 测试。build + 417 测试绿。
  共享内核 `useNomiRichTextEditor` + WorkbenchEditor 重构早在 `e96facc` 完成。
- **P1 Chunk 2（安全关键）✅ commit `3846fe5`（+ select-text 修复）**：
  - 新建 `nodes/render/TextDocumentNode.tsx`：消费 `useNomiRichTextEditor` 内核 + `EditorContent`；
    顶部「Text」栏作拖拽手柄（非 contenteditable，pointerdown 冒泡触发拖动），正文 section
    stopPropagation keydown/keyup；实时 `updateNode(persist:false)` + 失焦 `commitPersistedChange`；
    空态 Tailwind 占位提示（不动创作区、不加 CSS）。**select-text/touch-auto 覆盖外层 `article`
    的 select-none/touch-none，否则正文无法选字（已修）。**
  - `BaseGenerationNode`：renderKind 分发加 `isTextKind` 分支、preview div 对 text 隐藏；
    `handlePointerDown` 白名单加 `[contenteditable="true"], .ProseMirror`；
    `getNodeSizeBounds(kind)` 自由缩放按 kind 取 bounds（text 280×200~680×800），
    storedPreviewHeight/previewHeight/visualSize 同步。注：全局快捷键 `GenerationCanvas.tsx:537`
    已放行 `[contenteditable]`，未改。registry text `defaultSize` 高度 170→200。
- **P1 Chunk 3（生成 · 续写不覆盖）✅ commit `5416163`**：
  - registry：text 加 `executionKind:'text'`；`GenerationNodeExecutionKind` 扩 `'text'`。
  - `canRunGenerationNode`：text 放行。
  - `catalogTaskActions`：`resolveTaskKind` text→`'chat'`（复用 runtime 既有
    `wantedKind=text` → `/v1/chat/completions` 分支，不另起通道）；`normalizeCatalogTaskResult`
    加 text 支——从 `raw` 取文本（兼容 OpenAI/Anthropic 形状），返回 `type:'text'`。
  - 新建 `runner/textActions.ts`：跑 chat 任务拿文本后，读节点**最新** `contentJson` append 段落
    整体写回（数据层"续写不覆盖"，不依赖 editor 实例，复用 `markdownToTiptapContent`）。
    文本结果无 url → composer 恒「生成 →」、每次续写。`generationNodeExecutor` 加 text 分支。
  - 模型选择走通用 `catalogKind` 路径（text 节点列文本模型），未改 `NodeParameterControls`。
  - 新增 `catalogTaskActions.test.ts`（6 例）锁定文本抽取 + 图片路径不回归。
- **验证**：build(vite+electron tsc) 绿 + 422 测试绿（含新 6 例）。**未做应用内目测**——
  本改动只在运行中的 Electron 生成画布里可见（需 desktop bridge + 加载项目），浏览器 preview
  无法忠实复现，按项目既有口径留用户重建后在 app 内目测：节点里能打字/选字（不误拖）、
  抓 Text 栏能拖、能缩放（min 280×200）、选文本模型后能生成且续写不覆盖。
- **P1 待做（下个会话）**：用户重建后目测确认；若 OK 则收尾 P1，转 P2（浮动格式条 / 双击放大 / 生成模式）。
- **P2 · 浮动格式条 ✅**（用户反馈「上面没格式工具」后补；只做这一项，双击放大/生成模式仍排队）：
  - 用 Tiptap **官方 `BubbleMenu`**（`@tiptap/react/menus`，Floating UI 自动定位/翻向/portal
    escape overflow——不手搓定位，规则 5/6）。**无需新增依赖**：`@tiptap/extension-bubble-menu`
    + `@floating-ui/dom` 已是 `@tiptap/react` 的传递依赖，经 `@tiptap/react/menus` 再导出即可用。
  - `TextDocumentNode` 渲染 BubbleMenu，复用 `buildRichTextActions(editor)`（与创作区同一套动作，
    一份定义两个壳）；按钮 `onMouseDown preventDefault` 保选区；active 态用 `nomi-accent-soft`。
  - **设计偏差（已告知用户）**：样张 `c5-text-node.html` 画的是「节点上方静态条」，实现用官方
    BubbleMenu = 「选中文字时浮在选区上方」。换法理由：静态节点顶条要么 portal+Floating UI（=重造
    BubbleMenu），要么手搓 rect/翻向（=刚在错误卡清掉的债）。官方件更稳、零新依赖。若坚持节点顶条可回切。
  - 验证：build(vite+electron tsc) 绿 + 446 测试绿。应用内目测（需重建）：选中文本→选区上方浮出
    H1/H2/B/I/列表/引用/撤销重做，点击生效且不丢选区。
- **P2 · 生成模式 续写/改写/重写 ✅**（用户「做完push」后补）：
  - composer 加文本专属模式选择条（续写/改写/重写）+ 模式相关 placeholder（写 `meta.textGenMode`）。
  - `textActions.generateText` 改成模式感知：拼 prompt 时带上**文档上下文**（`docToPlainText(contentJson)`
    数据层拍平，不依赖 editor，离屏也安全）；落地分三路——
    - **续写** append 到 contentJson 末尾（数据层）；
    - **重写** 用生成内容替换整篇 contentJson（数据层）；
    - **改写** 改当前选区——数据层拿不到 ProseMirror 位置，只打 `meta.textPendingSelectionApply` 标记，
      `TextDocumentNode` 的 effect 用 `tools.replaceSelection` 落地（幂等：ref seed 挂载时 result.id，
      防项目加载重放；clear 标记 persist:false）。选区文本经 `onSelectionChange` 存 `meta.textGenSelection`
      供拼 prompt；无选区时改写自动退回续写。
  - 画布 >50 节点会虚拟化（离屏卸载），故续写/重写走数据层（最稳）、仅改写依赖编辑器（生成时该节点必在屏）。
  - 新增 `textActions.test.ts`（5 例，注入 stub runTask）锁定模式路由。build 绿 + 452 测试绿。
- **P2 · 双击放大：不做（已废）**——确认样张 v2 第 ③ 条明确「没有展开，节点自己可拖拽缩放」，
  缩放已在 Chunk 2 落地，再加 enlarge 既违样张又与 resize 重复（规则 1/8）。若日后要可再议。
