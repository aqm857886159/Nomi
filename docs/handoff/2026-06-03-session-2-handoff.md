# Nomi 会话交接（2026-06-03 · 第二段）

> 给下一个 AI：**先读 `CLAUDE.md`（已加总纲「长期价值优先」+ 规则 1–10），再读这份。**
> 本文覆盖：开局先做什么 → 当前状态 → 立即要做的 C5 → 排队项。
> 本文**取代** `docs/handoff/2026-06-03-session-handoff.md` 中已过时的部分（目录、styles.css、React Flow 决策）。

## 0. 开局三步（按顺序）
1. **读 `CLAUDE.md`**：现在顶部有「总纲：长期价值优先」+ 10 条规则按三类归位。核心：选长期对的，不选短期快的。
2. **验证 Context7 是否生效**（上个会话已修，本会话才生效）：
   - `ToolSearch "resolve-library-id"` —— 找得到 `resolve-library-id`/`get-library-docs` 就是好了，**按规则 5 用它查 Tiptap 官方**。
   - 找不到 → 在 Claude Code 跑 `/mcp` 批准 context7，或退回 WebFetch 查 `tiptap.dev`（等价）。
   - 根因已写进规则 5：项目 `.mcp.json` 服务器**需审批**（`enabledMcpjsonServers`），`mcp list` 的 Connected 只是可达性。已把 `context7` 写进 `~/.claude.json`（若被 Claude Code 退出时回写覆盖了，就 `/mcp`）。
3. **读本文** + `docs/plan/c5-text-node.md`（C5 落地方案 + 本段会话回填的 Chunk 进度 + 剩余接入图）。

## 1. 当前状态（本段会话改变的）
- **单一工作树**：`/Users/aoqimin/Desktop/Nomi/`（分支 main）。**旧的 `.claude/worktrees/impl-v0.6.0/` 已删除合并**——不再有双目录漂移。任何指向 impl-v0.6.0 的旧路径都过时。
- **`styles.css` 已不存在**：8867 行死 CSS 全清（Tier 1/2/3），合法全局样式 145 行收进 `src/styles/globals.css`（`--tc-*` token + reset + body 背景 + `#root` 网格 + `.nomi-loading-mark__logo`）。运行时已验证渲染零变化。
- **规则集**：加了总纲 + 规则 9（模块化先想）+ 规则 10（样式 Tailwind 化、CSS 只减不增）。
- **C5 P1 Chunk 1 已 commit `10042d3`**：`GenerationCanvasNode.contentJson?: TiptapDocJson` + zod schema（旧节点兼容）+ schema 测试。build + 417 测试绿。
- 本段会话 commit 链（main，最新在最上）：`6c065df`(规则总纲+Context7坑) `0463e54`(C5进度) `10042d3`(C5 Chunk1) `01eecf3`(规则10) `bde6125 617abfb 9093b01`(styles Tier3) `f8468c7`(规则9+目录合并) `10f4f41`(styles Tier1+2)。
- **未提交残留**：无（工作树干净）。`.claude/launch.json` 有个指向已删 worktree 的 `marketing` 配置（本地未跟踪、失效，可顺手修路径或忽略）。

## 2. 立即要做：C5 P1 Chunk 2 + 3（接入图已就位）
> 方案/样张已评审确认（`docs/plan/c5-text-node.md` + `docs/mockups/c5-text-node.html`）。
> 共享内核 `src/workbench/common/useNomiRichTextEditor.ts` 已就位（早于本段会话）。
> **先按规则 5 用 Context7 查 Tiptap 官方**（`editor.setEditable`、`getJSON`、`insertContentAt`、`editorProps.handleKeyDown`），再动手。

### Chunk 2（安全关键——在 1354 行 `BaseGenerationNode` 改拖拽/键盘，出错=打字误删节点）
1. **新建 `nodes/render/TextDocumentNode.tsx`**：照 `CharacterCardNode.tsx` 壳（`type Props={node}` + `React.memo`）；消费 `useNomiRichTextEditor({content: node.contentJson ?? {type:'doc',content:[]}, placeholder, onChange})`；渲染 `<EditorContent>`；外层 `<section onKeyDown/onKeyUp={e=>e.stopPropagation()}>`（仿 `WorkbenchEditor.tsx:132-133`）；`onChange→updateNode(id,{contentJson},{persist:false})`，`onBlur→commitPersistedChange()`（仿拖拽的"实时不 persist + 结束 commit"）。
2. **`BaseGenerationNode.tsx` 分发**：`isCardKind`（~line 707-711）纳入 `node.kind==='text'`（或独立 `isTextKind`），在卡片分发块（~line 1088-1101）加 `node.kind==='text' && <TextDocumentNode node={node}/>`，并让图片预览 body 对 text 隐藏。
3. **安全坑必修**：`handlePointerDown` 白名单（~line 314）`target.closest("button, input, textarea, select")` → 追加 `, [contenteditable="true"], .ProseMirror`。**全局快捷键 `GenerationCanvas.tsx:537` 已放行 `[contenteditable="true"]`，无需改**（这一半坑上个会话就堵好了）。
4. **resize 复用**：加 `TEXT_MIN_WIDTH=280 / TEXT_MIN_HEIGHT=200` + `getMinSize(kind)`，替换 `BaseGenerationNode` 里 `MIN/MAX_NODE_*`（常量 ~line 71-74、`mediaNodeSize` ~111-139、clamp 调用点、`visualSize.width`、`storedPreviewHeight`）按 kind 取 bounds。`registry.ts` text plugin `defaultSize` 高度 170→200。

### Chunk 3（文本生成 · 续写不覆盖）
- `registry.ts`：text plugin 加 `executionKind:'text'`，扩 `GenerationNodeExecutionKind = 'image'|'video'|'text'`（~line 14）。
- `runner/generationNodeExecutor.ts`（~line 27 现在直接 throw）：加 text 分支 → `generateText(node,...)`。
- **新建 `runner/textActions.ts`**：调文本模型，**读 `node.contentJson` append 一段新 paragraph 后整体 `updateNode` 写回**（数据层实现"续写不覆盖"，不依赖 editor 实例），同步 `result.text` 摘要。
- 每 Chunk 独立 commit + `pnpm build`（vite+electron tsc）+ `npx vitest run` + 本地重建目测：节点里能打字（不误拖）、能生成不覆盖、能缩放。

## 3. 排队项（长期，按总纲排）
- **C5 P2/P3**：P2 浮动格式条（`buildRichTextActions` + 自动翻向）、双击头临时放大、生成模式（续写/改写/重写）；P3（用户命脉）AI 分镜结构化 → 一键喂下游图片/视频节点。
- **🟡 React Flow 迁移决策：扣住未决**。本段会话已做完整调研 + 6 角色评审：B 全量迁移否决；工程派选 C（渐进混合，store 当唯一真值源 + 渲染层 adapter）、产品派选 A（先做用户功能）。用户定的是"等 C5 做完再说"。要继续就从 `docs/`（本段会话评审结论）接，但**别在 C5 没落地前开**。
- **发版 v0.8.3**：v0.8.2 之后一大堆没发（文件预览、C1/C2、全部清理、C5 Chunk1）。bump `package.json` → `git tag v0.8.3` → push tag 触发 `.github/workflows/desktop-release.yml`。
- **C3 3D 节点外观 / C4 时间轴重做**：大、需样张 + 评审（规则 7/8）。C4 用 Context7 查核心框架。
- **GitHub 社交预览图**：手动 repo Settings → Social preview 传 `marketing/assets/social-preview.png`。
- 小：`.claude/launch.json` 的 `marketing` 路径指向已删 worktree，修成 `/Users/aoqimin/Desktop/Nomi/marketing`。

## 4. 关键文件索引（单一树根 `/Users/aoqimin/Desktop/Nomi/`）
- 规则：`CLAUDE.md`（总纲 + 1–10）｜设计：`Design.md`、`docs/design/`、`src/design/`
- C5：`docs/plan/c5-text-node.md`、`docs/mockups/c5-text-node.html`；内核 `src/workbench/common/useNomiRichTextEditor.ts`、`richTextActions.tsx`；参考 `src/workbench/creation/WorkbenchEditor.tsx`
- 画布：`src/workbench/generationCanvas/`（`nodes/BaseGenerationNode.tsx`、`nodes/render/CharacterCardNode.tsx`(壳参考)、`nodes/registry.ts`、`nodes/NodeGenerationComposer.tsx`、`runner/generationNodeExecutor.ts`、`store/generationCanvasStore.ts`、`model/generationCanvasTypes.ts`+`generationCanvasSchema.ts`、`components/GenerationCanvas.tsx`）
- 样式：`src/styles/index.css`（入口）、`globals.css`、`vendor-overrides.css`、`animations.css`、`src/theme/nomi-tokens.css`、`tailwind.config.ts`
- 清理审计：`docs/audit/2026-06-03-dead-canvas-css.md`、`docs/plan/2026-06-03-styles-css-teardown.md`
