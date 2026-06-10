# 修三个生成画布 bug（图片比例 / 视频误判图片 / GPT-image 空参数框）

> 状态：实施中
> 触发：用户截图反馈三个 bug。

## 1. 三个 bug 的根因

| # | 现象 | 根因 | 文件 |
|---|---|---|---|
| 1 | 生成图显示成卡片框比例（被裁切），不是图自己的比例 | 结果 `<img>` 用 `object-cover`（裁切填满容器）；video 已用 `object-contain` | `src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:1046` |
| 2 | onboarding 一个视频模型 → 被识别成 image 模型 | onboarding 没有任何 kind 识别；`main.ts` 硬编码 `targetKind ?? "image"`（注释写 "fallback until set_model_kind tool lands"）。向导已有"识别类型"步骤 + `detectedKind` 等着 agent 声明，但工具从没实现 | `electron/main.ts:398`、`electron/ai/onboarding/*` |
| 3 | GPT-image 工具条中间有个空参数框 | GPT-image catalog 有 `callBackUrl` 参数（type=text、options=[]、default=""），落到 `<input>` 空文本框分支 | `src/workbench/generationCanvas/nodes/NodeParameterControls.tsx`（`buildDynamicControls`） |

## 2. 方案（bug #2 用户已拍板：Agent 工具 set_model_kind）

- **bug #1**：`object-cover` → `object-contain`（一行）。保证显示图自己的原始比例。
- **bug #3**：在 `buildDynamicControls` 的 paramControls 里过滤掉"会渲染成空输入框"的控件 —— type 为 text/number、无 options、无 defaultValue、无 placeholder。`callBackUrl` 命中被删；有默认值/占位符/选项的合法控件保留。
- **bug #2**：新增 onboarding 工具 `set_model_kind({ kind, evidence })`，agent 读完文档后声明 image/video/audio，patch `draft.targetKind`。系统提示词加一步要求调用。删除 `main.ts` 里"fallback until set_model_kind tool lands"的注释含义（默认值保留为初始 seed，但 agent 必须覆盖）。

## 3. 不动什么

- 不动 catalog schema、mapping 存储格式。
- 不动 runtime 的 taskKind 映射逻辑（image→text_to_image 等已正确，只是喂进去的 kind 之前恒为 image）。
- 不动 reference 缩略图的 `object-cover`（那是缩略图，裁切是对的）。
- 不动 video `<video>` 的 `object-contain`（已正确）。

## 4. 回滚策略

- 单 commit；若回归 `git revert`。
- bug #1/#3 纯前端、零风险；bug #2 改 onboarding 工具集 + 提示词，已有向导 UI 接住 detectedKind。

## 5. 验收门

1. `pnpm exec tsc -p electron/tsconfig.json` 0 错；前端 tsc 不新增错误。
2. `pnpm test` 全绿。
3. bug #1：生成一张非卡片比例的图，显示完整不裁切。
4. bug #3：GPT-image 节点工具条不再有空框。
5. bug #2：onboard 一个视频模型，catalog 里 kind=video（向导"识别类型"显示"已识别为：视频"）。

## 6. 结果（实施后回填）

实施完成。

- **bug #1**：`BaseGenerationNode.tsx:1046` `object-cover` → `object-contain`。
- **bug #3**：`NodeParameterControls.tsx` 新增 `isEmptyInputControl`，在 `buildDynamicControls` 过滤 type=text/number 且无 options/default/placeholder 的空框控件（kie `callBackUrl` 命中）。
- **bug #2**：
  - `tools.ts` 新增 `set_model_kind({ kind, evidence })` 工具，patch `draft.targetKind`。
  - `systemPrompt.ts` Step 4 加入 set_model_kind（THREE→FOUR calls，步骤 c→d，budget +1），Target 改为 "kind hint"。
  - `main.ts` 注释更新（默认 image 仅为初始 seed，agent 覆盖）。
  - `OnboardingWizard.tsx`：`set_model_kind → 'kind'` milestone，从其结果设 detectedKind（删掉旧的"工具未实现"占位）。

验收门：
1. `tsc -p electron/tsconfig.json` ✅ 0 错；前端我改的 3 个文件 0 新错（renderRegistry/ProjectLibraryPage 是既有 pre-existing 错误，未碰）。
2. `pnpm test` ✅ 35 files / 339 tests + 1 todo 全绿。
3. bug #1/#3 待用户在 app 内目视确认。
4. bug #2 待用户重新 onboard 一个视频模型确认 kind=video。

> ⚠️ 已存在 catalog 里的 `gemini-omni-video`（kind=image，但参数是 video）是修复前 onboard 的脏数据，create mapping 也按 text_to_image 建的。需用户**重新 onboard 一次**才能正确归为 video（光改 kind 字段不够，taskKind 映射也得重建）。

## 7. 通用化加强（用户复盘：要自适应、不能 per-model）

用户指出这些本质是自适应/通用问题。对账后：#1 图片比例、#3 空参数过滤、#4 image-url→顶部参考图 都已是 model-agnostic（写在 `buildDynamicControls`/`buildImageUrlSlots`，对所有模型生效，无任何硬编码 model 名）。两处补强：

- **#2 底部参数区自适应（用户选：面板随参数数量变宽）**：
  - `NodeParameterControls.tsx` 导出 `useNodeParameterControlCount(node)` —— 复用 `buildModelControls` 算出底部行控件数（模型选择器 + 动态控件），纯 catalog-meta 驱动。
  - `BaseGenerationNode.tsx` `floatingComposerLayout` 增加 `controlCount` 参数：`panelWidth = clamp(max(aspectWidth, controlCount*92+96), 320, 720)`。参数越多面板越宽，封顶 720 不跑出画布。
- **#4 加固（用户选：加固）**：新增共享判定 `looksLikeImageUrlControl` —— `type==='image-url'` 或 free-text 且 key 名像图片 URL（imageurl/inputurls/referenceimage/firstframe…）。`buildImageUrlSlots`（顶部）和 `buildDynamicControls`（底部）共用它，保证一个参数只落一处，且不再完全依赖 onboarding 把类型标对。

验收：electron tsc 0 错、前端我改文件 0 新错、`pnpm test` 339 全绿、已重建重启。待用户目视确认参数多的模型面板变宽、被错标成 text 的图片参数也跑到顶部。

## 8. 复盘修正：图片外框 + 参数框常驻（用户截图反馈第二轮）

用户反馈第 7 节的 `object-cover→object-contain` 没真正解决：图片外面仍有一层框（棋盘格底纹），且没按图片自身比例自适应；参数框一直常驻。

**根因（git blame 定位）**：v0.6.1 commit `457eaf5` 把 shots 节点的 composer 从「选中浮出」改成「flex 内嵌常驻」（所谓 Mura 设计）。一个改动同时造成两个症状：

- composer 作为 flex child 占走节点垂直空间 → 图像区 `flex-1` 比图片本身比例矮 → `object-contain` 上下留黑（letterbox）→ 棋盘格底纹露出来变成「外框」。
- 参数框（composer）对 shots 分类常驻可见，不再是点选才出。

**修复（回退到 v0.6.1 之前的浮层行为，对所有节点类型一致）**：

- `BaseGenerationNode.tsx` 物理删除 `isInlineComposer` 及其所有分支（规则 1）：
  - article 容器恒 `block` + `gridTemplateRows: previewHeight`（删 flex-column 分支）。
  - 删 `data-inline-composer` 属性。
  - preview div 恒 `h-full`（删 `flex-1` 分支）。
  - composer 恒「`selected && !readOnly && !panorama` 才渲染」的 absolute 浮层（删 inline relative 分支）。
- preview 棋盘格底纹改为只在 `!hasResult` 时出现 —— 生成后节点尺寸已贴合图片比例，不再露底纹，图片外不再有框。

效果：未选中只看图、点中才弹 composer（含变宽逻辑仍生效）；图片按自身比例铺满整个节点框，无外框；棋盘格只在未生成态做占位提示。

验收：前端 tsc 我改文件 0 新错、`pnpm test` 339 全绿、待重建重启后用户目视确认。
