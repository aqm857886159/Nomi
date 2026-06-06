# Plan：通用「素材引用」系统（不是 Seedance 专用模板）

> **定位（用户 2026-06-06 拍板）**：这套逻辑**通用**——产品里任何「挑/加/引用一个素材」都用它，别给某个模型/功能写专用版（规则 1 并行版 + 违反通用第一）。生成参考只是它的第一个消费方。
> 样张：`docs/design/mockups/2026-06-06-reference-at-v4.html`（4 态，已渲染）。方向已过设计师 + 真实用户 agent + 用户认可。
> 规则：Rule 4 执行文档；UI 走 Rule 8 样张 + Rule 7 评审（已做）；架构对偶于「档案声明能力 / 供应商负责传输」。

## 0. 通用系统 = 3 原语 + 2 规律（住共享模块，非生成节点）

- **AssetTile**：正方形、形态自明（图缩略图 / 视频缩略图+播放三角+暗蒙 / 音频整块波形）。一个素材的小表示，到处用。
- **AssetPicker**：统一添加入口——画布 / 项目素材（搜索+最近+浏览全部）/ 上传 / 拖入 / 连线。任何「+」点开都是它。
- **AssetMention**：内联 `@` 引用——句中缩略图 chip，**按调用方解析绑定**（Seedance→character1，时间轴→clip，…）。
- 规律：**快速取（弹层：搜+最近）vs 全量浏览（面板）**；**形态自明 > 文字解释**。
- **一处真相源「素材池」**（画布产出 + 上传 + 项目文件），picker/面板/@ 都读它。
- **档案只声明「要几个什么槽」，通用系统负责怎么填**。加新模型/功能 = 声明槽，UI 零重写。

## 1. 目标（用户拍板）

把现状「角色参考 / 参考视频 / 参考音频 三组带标签 + caption + 暴露 character1」改成：
1. **参考图，不叫角色**：统一一排**正方形 tile**；图/视频/音频靠**形态自明**（缩略图 / 缩略图+播放三角+暗蒙层 / 整块波形），不靠右下角小角标。
2. **@ 内联引用**：描述里**点 tile（主路径）或打 @（快捷键）** → 该图缩略图进句子（≈1 字高、基线齐、无数字）；发模型前才把它转成 `character1..N`——**用户永不可见 character1**。
3. **最少文字**：删所有 caption/「顺序对应…」说明；空态只「+ 加参考图（可选）」+「描述你想生成的画面…」。

## 2. 三来源统一添加（研究结论）

现状（Explore 摸底，见 §4 证据）：三来源**互不打通**——目录树拖拽只新建独立 asset 卡、数组槽 meta-only 不连线、上传直写 meta、**节点级 onDrop 没有**。

**方案 = 一个统一入口 + 两条画布原生捷径，全汇到同一条「加参考」管道**（顶尖工具共识：Krea/即梦统一素材抽屉、Figma place image、ComfyUI LoadImage upload+文件夹、Notion Upload/Embed 分栏）：

- **「+」→ 统一选择器**（样张态④）：
  - **画布**：横排画布图卡缩略图，点选即加。
  - **项目素材**：项目文件夹的图/视频/音频，**以缩略图呈现**（比裸文件树优雅），点选即加。
  - **⬆ 上传本地文件**：系统文件框。
  - 选择器接拖入（文件树/桌面拖文件）。
- **连线**：从卡片输出点拉到节点 → 加为参考 tile。**数组保持 meta-only、不持久画 9 条线**（连线是一次"投入"手势，tile 才是持久表示）——既能连又不糊画布，化解 M6。
- **拖到节点上**：目录树/桌面文件拖到节点 → 直接加（**需补节点级 onDrop**）。

## 3. 实现要点 / 改动面（按层）

**共享原语（新模块 `src/workbench/assets/`，与生成节点解耦——这是通用第一的落点）**
- `AssetTile.tsx`：形态自明的素材块（image/video/audio），到处复用。
- `AssetPicker.tsx`：统一选择器（画布卡 + 项目素材[搜索+最近+浏览全部] + 上传 + 拖入），一个入口三来源 + 规模化。
- `AssetMention`：描述框内联 `@` 引用 chip + 解析钩子（调用方决定绑定）。textarea 装不下内联图——**先按 Rule 5/6 查 Tiptap**（已在用）能否直接干，不手搓。
- `assetPool`：一处真相源（画布产出 + 上传 + 项目文件 `useWorkspaceFiles`），picker/面板/@ 都读它。

**生成节点（素材系统的第一个消费方，只声明 + 接线，不写交互）**
- `ReferenceSlots` → 改用 AssetTile + AssetPicker；档案 slots 只声明「几个什么槽」。
- 发送前投影：句中 AssetMention 按顺序 → `character1..N`（renderer 侧，接 `archetypeMeta.buildArchetypeInputParams`）。
- 首尾帧 / 源视频 / 时间轴加片段：后续都切到同一套原语（消灭各自的 bespoke 加素材代码）。

**数据 / 来源接入**
- 项目素材来源：复用 `useWorkspaceFiles` / `workspaceFileIndex`，放开 FileTreeNode 只 image 可拖（视频/音频也要）。
- 节点级 onDrop：BaseGenerationNode 补 drop handler，认 `WORKSPACE_FILE_DRAG_MIME` + OS `Files` → 加到当前 tile row（而非新建画布卡）。
- 连线→参考：`connectToNode` 命中「目标节点有参考槽」时，加到 meta 数组（不强建持久 edge）；沿用 generationReferenceResolver 聚合。

**不动 / 谨慎**
- character1 的模型契约不变（只是从用户眼前藏起来，发送前才出现）。
- 单帧槽（首/尾帧）的 edge+meta 双写沿用；数组槽 meta-only 沿用（M6）。

## 4. 现状证据（Explore 摸底）
- 目录树：`WorkspaceFileExplorerPanel` / `FileTreeNode`（仅 image 可拖，MIME `application/x-nomi-workspace-file`，`nomi-local://` URL）；拖到画布只走 `GenerationCanvas.handleStageDrop` → 新建 asset 节点。
- 连线：自定义两段点击（`store.startConnection`/`connectToNode`），非 React Flow；edge mode 实际只用 reference/first_frame/last_frame（style/character/composition_ref 死代码兜底）。
- 上传：`importWorkbenchLocalAssetFile` → 复制进项目文件夹 + 写 meta（vendor URL）；无素材库 UI。
- 节点级 onDrop：**无**。
- C3「+ 添加」：图片槽接了 上传 + 选画布图节点；视频/音频只上传；目录树/连线均未接。

## 5. 验收门
- Rule 8：样张 v4 已出 + 设计师/用户 agent 过审 + 用户认方向。落地后**真渲染样张并排对账**（Rule 8 AFTER）。
- Rule 13：零额度走查（加图三来源各走一遍 + @ 引用 + 发送前 character 投影快照）。
- CI 五门；character 投影 + 三来源加入的单测。
