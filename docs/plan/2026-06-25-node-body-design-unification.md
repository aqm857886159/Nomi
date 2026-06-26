# 生成画布节点 body 设计统一 + 下沉共享组件

> 2026-06-25 · 用户「其他节点都找出来设计优化一遍」→ 审计出 10 处不一致 + 6 处重复 → 拍板「全做 + 下沉共享组件」。承接画板统一外壳。

## 背景
所有节点已走共享外壳 BaseGenerationNode，但中间各 body（CardCommon 占位 / CharacterCard / SceneCard / PropCard / AudioStrip / WhiteboardCardBody / PanoramaViewer / Scene3DEditor）各写各的，漂移出标题四套规格、空态启动器圆⇄方、底纹三套、音频空态无文案等。审计详见对话（10 项不一致按严重度排序）。

## 统一规格（锁死，新节点照此）

| 维度 | 统一值 |
|---|---|
| **标题** | `text-body-sm font-semibold text-nomi-ink-80`（场景卡在暗图上用 text-nomi-paper，仅颜色随上下文）。左上角；可选「镜头 N」徽标在标题上方 |
| **空态启动器圆底**（点击进入：画板/3D） | `size-12 rounded-full bg-nomi-ink text-nomi-paper`（统一画板款，3D 弃方角描边） |
| **空态底纹** | 全部 `STRIPED_BG_CLASS`（单一常量；外壳内联值改 import；音频/3D 空态补上） |
| **空态文案** | 每个空态都有「主文案 + 副提示」；音频空态补「上传或连接音频」 |
| **body 信息区 padding** | `p-2.5`（音频补垂直 padding） |
| **强调色 accent** | body 层统一 `nomi-accent`（外壳交互 resize/timeline 把手保留 workbench-accent，文档化边界） |

## 阶段

### Phase 1 — 下沉共享组件（单一真相源）
- `render/STRIPED_BG_CLASS`：已在 CardCommon，外壳 BaseGenerationNode 内联值改 `import { STRIPED_BG_CLASS }`（逐字符相同，零视觉变化）。
- 新 `render/NodeBodyHeader.tsx`：`<NodeBodyHeader title shotIndex? />` —— 左上标题行（含镜头徽标）。CardCommon 的 PendingGenerationPlaceholder 标题段 + WhiteboardCardBody 标题段改用它。
- 新 `render/EmptyStateLauncher.tsx`：`<EmptyStateLauncher icon label hint onActivate? />` —— size-12 圆形实心墨图标 + 主文案 + 副提示。画板启动器 + 3D 空态 + 音频空态共用。

### Phase 2 — 各 body 套用统一规格
- `EditableNodeTitle.tsx`：字号字重对齐 `text-body-sm font-semibold`（角色/道具/场景卡跟上；位置不动）。
- `AudioStripNode.tsx`：标题走 NodeBodyHeader 左上 + 加粗；空态补 STRIPED_BG_CLASS 底纹 + 「上传或连接音频」文案；补垂直 padding；上传圆底 size 对齐。
- `Scene3DEditor.tsx`：空态启动器改 EmptyStateLauncher（圆形实心墨，弃方角描边）。
- `WhiteboardCardBody.tsx`：标题段 + 启动器改用共享组件。
- `CardCommon.tsx`：PendingGenerationPlaceholder 标题段用 NodeBodyHeader；PlaceholderCenter/UploadFallback 文案与 padding 对齐。
- `PanoramaViewer.tsx` + BaseGenerationNode panorama 上传：两处文案统一（「上传全景图或连接图片节点」单源），底纹对齐。

## 不动项
- 共享外壳 BaseGenerationNode 的 header（状态徽标/provenance）、把手、composer 策略不改。
- 图片卡（角色/场景/道具）的标题**位置**（图上/图下浮条）保留——仅字号字重对齐。
- 不改任何节点的功能/交互，纯视觉一致性。

## 回滚 / 验收
- 单一 feature，纯样式 + 组件抽取，无数据/schema 改动；revert 即回。
- 五门全过（注意 check:tokens 棘轮 + check:filesize：新组件别撑破，BaseGenerationNode 只减不增）。
- R13：重新逐个截图所有节点类型（image/audio/whiteboard/panorama/scene3d/text/video + 尽量 character/scene），人眼对账标题/启动器/空态三处已统一；和本 plan 规格逐项对账。
