# Nomi 会话交接（2026-06-03）

> 给下一个 AI：先读 `CLAUDE.md`（规则 1–8 + 工作目录铁律），再读这份。本文是当前状态 + 待办 + 最高优先级新决策。

## 0. 工作目录铁律（最重要）
- 唯一该动的工作树：`/Users/aoqimin/Desktop/Nomi/.claude/worktrees/impl-v0.6.0/`（分支 main）
- 父目录 `/Users/aoqimin/Desktop/Nomi/` 是另一个 detached worktree，**别在那改/commit**（应用从那启动）。
- 每条 Bash 命令自锚定：`git -C <上面路径>` 或 `cd <上面路径> &&`。绝不发裸 git/pnpm。
- 验证门：`pnpm build`（vite + electron tsc）+ `npx vitest run`。改完 UI 要 `pnpm exec electron-builder --mac dir --arm64` 重建并 `cp -R release/mac-arm64/Nomi.app /Applications/` 让用户目测。

## 1. 关键工程约定（CLAUDE.md 已含，强调）
- **规则1 加新必删旧**：不留并行版本/死代码（用户极在意）。
- **规则5 碰框架/库先用 Context7 查官方文档再写**。**Context7 MCP 已配进 `.mcp.json`，本会话没生效，下个会话生效**——下个会话务必用它查 Tiptap / React Flow 等官方实现。
- **规则6 做方案前先读顶尖开源真实代码**，不重复造轮子。
- **规则7 项目方案过 6 角色子 agent 评审**（用户常只要"设计师 + 真实用户"2 角，用 `Agent` 工具 general-purpose 角色扮演）。
- **规则8 用户可见的设计改动，先出"可视样张"（HTML mockup，最低成本让用户看到样子）→ 设计师+用户 agent 评审 → 用户确认 → 才实现**。复杂交互分多轮。
- 设计系统：`Design.md` + `docs/design/nomi-design-system.md` + `src/design/`，token-only、光模式、密度优先。
- 发版：bump `package.json` version → `git tag vX.Y.Z` → push tag 触发 `.github/workflows/desktop-release.yml`（出 mac+win）。本地 dmg `pnpm dist`（输出在 `release/`）。

## 2. 本会话已完成并 push（main，最新到 commit e96facc）
- **手填加模型表单**：BaseURL/Key/模型主路径 + 预设(OpenAI/Claude/Gemini/Kimi/智谱/DeepSeek/自定义中转站) + 自动拉模型(`/models`) + Anthropic 原生 + 自定义请求头 + 适配式入口(无文本模型→文本为主；有→图片/视频为主) + 视觉打磨。
- **文件预览**：文件树双击/空格 → 右侧面板预览 txt/md/pdf/图/视频（`FilePreviewPanel` + `useFilePreviewStore` + `NomiMarkdown`）。
- **C1 生成失败提示**：`NodeErrorReport`（人话原因+建议+原始+重试，Portal 浮层），删旧 ErrorBadge/error-peek，`classifyGenerationError` 单一分类器。样张 `docs/mockups/c1-generation-error.html`。
- **C2/C2b 3D 入口 + 右键统一**：左侧工具栏加 3D 场景；左+右共用 `PRIMARY_NODE_KINDS`(text/image/video/panorama/scene3d)。
- **删 skills/legacy/**（含 Python 文件）；Context7 接入；GitHub About/SEO/社交预览图(待手动上传)；markdown 渲染合并为 `NomiMarkdown`。
- **PR #5「3D 导演台」已合并**。
- **已发版 v0.8.2**（GitHub Release 成功）。**注意：v0.8.2 之后的东西(文件预览/C1/C2/C2b/markdown合并/C5基础)还没进 release**——下个会话要发 **v0.8.3** 才能让用户拿到。

## 3. 进行中：C5 文本节点 → 文档编辑器（P1 做了一半）
计划：`docs/plan/c5-text-node.md`（含两份评审结论）。样张：`docs/mockups/c5-text-node.html`（用户已确认方向）。
**已完成（commit e96facc）**：抽出共享 Tiptap 内核 `src/workbench/common/useNomiRichTextEditor.ts` + `richTextActions.tsx`，重构 `WorkbenchEditor` 复用之（rule1，不留两套 Tiptap）。build 绿。
**P1 剩余（下个会话做，先用 Context7 查 Tiptap 官方）**：
1. 节点模型加 `contentJson?`（Tiptap JSON）字段 → 改 `generationCanvasTypes.ts` + store + 持久化 + `generationCanvasSchema.test.ts`（旧节点无此字段要兼容）。注意：文本结果现存 `node.result.text`(字符串)，没有富文本字段。
2. 新建 `nodes/render/TextDocumentNode.tsx`（消费 hook + EditorContent），在 `BaseGenerationNode` 按 `renderKind` 分发 text（像 character-card 那样），**脱离图片预览 body**。
3. **必修安全坑**（评审挖出）：`BaseGenerationNode.handlePointerDown` 白名单(~line 314)只放行 button/input/textarea/select，**要加 `[contenteditable]/.ProseMirror`**，否则节点里没法选字打字（拖拽吞光标）。节点内 Tiptap 要 `onKeyDown/onKeyUp stopPropagation`，否则打字触发画布快捷键(Backspace 删节点=致命)。
4. 底部模型框：复用 `NodeGenerationComposer`，给 text 加生成分支（文本模型 + 文本 placeholder），**默认续写不覆盖已写**。
5. 缩放：**复用现成 resize-zone**（画布是自研，不是 React Flow，别引 NodeResizer），text 节点 min ~280×200 单独 clamp。
**P2**：浮动格式条(`TextFormatBar`，用 buildRichTextActions，贴顶自动翻向)；双击节点头临时放大原地沉浸编辑(不跳页)；生成模式 续写/改写/重写。
**P3（用户命脉）**：AI 出的分镜结构化 → 一键把每个镜头喂给下游图片/视频节点。

## 4. 🔴 最高优先级新决策（用户刚提，待下个会话先办）
**自研画布 vs 迁移 React Flow（xyflow）**。
- 现状：画布是**自研**的——`canvasZoom` 在 store，pan/drag/resize 靠 `BaseGenerationNode` 的 pointer+rAF，8 向 `RESIZE_DIRECTIONS`、`MIN/MAX` 常量、group、storyboard 等都是手写。**React Flow 不是依赖**。
- 用户原话："放着官方那些最好的东西不用呢？" —— 倾向用官方成熟方案。
- 这是**大架构决策**，必须按规则 5/6/3 走：
  1. 用 **Context7 查 React Flow(xyflow) 官方**能力（节点/边/NodeResizer/minimap/受控 viewport/自定义节点/性能）。
  2. 读 React Flow 真实用法 + 评估**迁移成本**（现有自研画布有哪些 bespoke 能力要重做：group 框、8 向 resize、storyboard 连边排序、节点类型注册、拖拽到画布、缩放条…）。
  3. 出**对比表**（继续自研 / 迁移 React Flow / 渐进混合）：用户看到什么、代价、风险、回滚。
  4. 让用户拍板，**别直接开干**。
- 关联：这影响 C5（节点缩放）、C3（3D 节点）、C4（时间轴另说）。若决定迁移，C5 P1 的缩放实现要等架构定。

## 5. 排队中（按之前定的顺序）
- **C3 3D 导演台节点外观**：从外面看不出里面是 3D 场景、不该套生成节点设计。需 HTML 样张 + 评审。
- **C4 时间轴 图片轨/媒体轨 交互重做**：大、复杂、持续多轮——Context7 查核心框架 + 技术选型 + 功能梳理 + 多轮评审。用户明确说不能一次出发就干。
- **A 官方实现合规审计**：全项目扫"手搓没走官方 API"的地方（React Flow viewport 那类），用 Context7 核对，出 `docs/audit/` 清单再改。（与 #4 的 React Flow 决策强相关。）
- **v0.8.3 发版**：把 v0.8.2 之后的都发出去。
- **GitHub 社交预览图**：手动在 repo Settings → Social preview 上传 `marketing/assets/social-preview.png`（无 API）。
- **spawn 的清理任务**：CreationAiPanel 旧内联 markdown 已并入 NomiMarkdown（本会话已做，若 chip 还在可忽略）。

## 6. 关键文件索引
- 规则：`CLAUDE.md` ｜ 设计系统：`Design.md`、`docs/design/nomi-design-system.md`、`src/design/`
- 计划/样张：`docs/plan/`（onboarding-*、file-preview、onboarding-form-*、c5-text-node）、`docs/mockups/`（c1、c5）
- 画布：`src/workbench/generationCanvas/`（`components/GenerationCanvas.tsx` 主画布、`components/CanvasToolbar.tsx` 左工具栏+右键、`nodes/BaseGenerationNode.tsx` 节点壳1350行、`nodes/registry.ts` 节点注册、`store/generationCanvasStore.ts`、`model/generationCanvasTypes.ts`、`runner/generationRunController.ts`）
- 富文本：`src/workbench/common/useNomiRichTextEditor.ts`、`richTextActions.tsx`、`NomiMarkdown.tsx`；创作区 `src/workbench/creation/WorkbenchEditor.tsx`
- 文件预览：`src/workbench/explorer/FilePreviewPanel.tsx`、`useFilePreviewStore.ts`、`FileTreeNode.tsx`
- 加模型：`src/ui/onboarding/OnboardingWizard.tsx`、`providerPresets.ts`；后端 `electron/runtime.ts`、`electron/main.ts`、`electron/ai/buildAiSdkModel.ts`
