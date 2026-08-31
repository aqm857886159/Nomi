# HyperFrames 画布节点集成方案研究

日期：2026-08-26  
状态：研究稿，未进入实现  
范围：Nomi 生成画布中的「图片/文本 → 提示词 → 动效/字幕 → 可预览卡片 → 可复用素材」体验

## 0. 结论先行

可以把 HyperFrames 接入 Nomi 画布，但不应把它当成一个新的 AI 模型节点，也不应让用户离开 Nomi 去编辑 HyperFrames 项目。

推荐的产品抽象是：

> **动效合成节点（motion composition node）**：接受画布中的文本、图片、Logo、视频或数据作为输入；由 Agent 根据提示词建立/修改 HyperFrames composition；在节点卡片内预览；需要进入时间轴时，把当前 composition 渲染为一个带完整血缘的本地素材。

最终关系应是：

```text
[图片 / 文本 / 视频 / Logo]
              ↓ 连线或当前选中上下文
        [动效合成节点]
              ↓ 可编辑预览
     [HyperFrames composition]
              ↓ 渲染版本
        [素材 asset / result]
              ↓ 采纳
          [时间轴 clip]
```

“变成素材”是**渲染出一个版本**，不是删除动效节点、只留下一个黑盒 MP4。源节点必须保留，素材必须能回溯到源节点并支持重新渲染。

## 1. 当前代码与能力证据

### 1.1 Nomi 现有画布已经有可复用的节点生命周期

- 节点注册和生成能力集中在 `src/workbench/generationCanvas/nodes/registry.ts:14-44`，当前 `GenerationNodeExecutionKind` 包含 image/video/text/audio/model3d，但没有本地 composition/workflow 执行类型。
- 节点模型已经支持 `prompt`、`references`、`result`、`history`、`runs`、`progress`、`meta` 和 provenance：`src/workbench/generationCanvas/model/generationCanvasTypes.ts:69-179`。
- 结果已经有 `url`、`thumbnailUrl`、`durationSeconds`、`assetId`、`assetRefId`、`taskKind` 和 `provenance`，足以承载「节点预览 + 渲染素材 + 来源记录」的第一版，但 schema 需要为 composition 元数据补字段：`src/workbench/generationCanvas/model/generationCanvasSchema.ts:41-105`。
- 生成执行器当前按 execution kind 分派至 image/video/text/audio/model3d：`src/workbench/generationCanvas/runner/generationNodeExecutor.ts:28-68`。HyperFrames 更适合走独立的本地 renderer/workflow 分支，而不是伪装成某个供应商的 video 模型。
- 现有节点结果可以通过 `buildClipFromGenerationNode` 进入时间轴，已有本地 URL 优先、时长、结果版本和 sourceNodeId 处理：`src/workbench/generationCanvas/model/buildClipFromGenerationNode.ts:79-112`。
- 现有「采纳到时间轴」已经走统一 adoption bridge：`src/workbench/generationCanvas/agent/sendGenerationNodeToTimeline.ts:1-72`。动效节点不应另建一条直接写时间轴的旁路。

### 1.2 HyperFrames 的本质适合“节点化”

本地安装的 HyperFrames CLI（当前探测到 `0.7.101`）定义的是 HTML composition 渲染框架，而不是单一模型：

- composition 由 HTML DOM、`data-*` 时间属性和可 seek 的 runtime 组成；
- 支持主 composition 与 sub-composition；
- 支持通过 variables 注入内容；
- 支持 `hyperframes-player` 做轻量嵌入式预览；
- 支持 `snapshot`、`check`、`render`；
- 支持透明 WebM（`render --format webm`）；
- registry 中已有可复用 blocks/components。

本地 registry manifest 已观察到适合作为第一批节点模板的能力：

- 动效：`shimmer-sweep`、`motion-blur`、`grain-overlay`、`parallax-zoom`、`vfx-liquid-background`；
- 字幕：`caption-pill-karaoke`、`caption-neon-accent`、`caption-weight-shift`、`caption-highlight`、`caption-kinetic-slam`；
- 包装和片段：`logo-outro`、`yt-lower-third`、`news-ticker`、`lt-mask-reveal`；
- 转场：`transitions-dissolve`、`transitions-light`、`transitions-scale` 等。

这些能力说明第一版不必先做“自由动画编辑器”，可以先做少量参数化的动效/字幕模板，由提示词负责选择和改写参数。

## 2. 目标用户体验

### 2.1 从图片节点开始

用户选中一个图片节点，卡片底部出现一条上下文操作栏：

```text
这个画面可以：
[生成视频] [做动效] [加字幕] [做转场]
```

用户点击“做动效”后，画布不会跳转到外部编辑器，而是在当前节点下方创建一个动效节点，并自动连边：

```text
产品图  ─────>  产品入场动效
```

动效节点初始状态不是一张配置表，而是一个小的可视卡片：

```text
┌─────────────────────────┐
│ 产品入场动效             │
│ [动态预览]               │
│ 3.0s · 透明背景 · 9:16   │
│ “做一个高级感扫光入场”   │
│ [预览] [渲染为素材]       │
└─────────────────────────┘
```

用户可以直接在卡片下方输入：

> 扫光慢一点，Logo 从液体里浮出来，最后停留 0.5 秒。

Agent 修改 composition 变量或模板选择，并把变化直接反映到卡片预览。聊天中只需要显示简短的变更说明和 `[应用] [撤销]`，不把 HTML、GSAP 或模型参数暴露给普通用户。

### 2.2 从文本节点开始做字幕

用户选中一段文本节点，点击“做字幕动效”。Nomi 自动把文本作为 content input，把当前画布比例和作品风格作为 composition variables：

```text
文本节点 ─────> 字幕动效节点
                 ├── 字幕内容：来自文本节点
                 ├── 风格：来自作品 / 品牌规范
                 ├── 节奏：默认按句或词级时序
                 └── 输出：透明视频素材
```

用户说：

> 做成口播字幕，重点词放大，跟着语音逐词出现。

第一版可以先支持「句级」或已有 transcript 的「词级」输入，不要在第一步自建完整字幕编辑器。HyperFrames registry 已有多种 caption component，可先把它们包装成模板能力。

### 2.3 从结果到素材

用户点击“渲染为素材”后，节点状态进入：

```text
准备渲染 → 渲染中 62% → 已生成素材
```

完成后卡片显示：

```text
[播放]
素材 v1 · 3.0s · WebM Alpha
[加入时间轴] [下载] [继续编辑]
```

“加入时间轴”走现有 adoption bridge，并把 `sourceNodeId` 指向动效节点。

用户之后修改了源图片或提示词，节点显示：

```text
源已变化 · 时间轴中有 2 个旧版本引用
[重新渲染并更新] [保留旧版本]
```

## 3. 推荐的数据抽象

不建议一开始把 HyperFrames composition 的全部 HTML 写进 `GenerationCanvasNode`。建议在 `meta` 中先放一个明确的、可版本化的 motion payload；等验证通过后再提升为严格 schema。

```ts
type MotionCompositionMeta = {
  engine: 'hyperframes'
  templateId: string
  projectId?: string
  compositionId: string
  width: number
  height: number
  fps: number
  durationSeconds: number
  transparent: boolean
  variables: Record<string, string | number | boolean>
  sourceNodeIds: string[]
  renderFormat: 'mp4' | 'webm'
  renderStatus: 'draft' | 'rendering' | 'ready' | 'stale' | 'error'
  renderedAssetId?: string
  renderedResultId?: string
  sourceHash?: string
}
```

节点的最终结果仍复用 `GenerationNodeResult`：

```ts
{
  type: 'video',
  url: 'nomi-local://...',
  thumbnailUrl: 'nomi-local://...',
  durationSeconds: 3,
  taskKind: 'workflow',
  assetId: '...',
  provenance: {
    provider: 'hyperframes',
    modelKey: 'template:shimmer-sweep',
    params: { ... }
  }
}
```

这里的 `taskKind: 'workflow'` 比把 HyperFrames 塞进 `model: video` 更诚实；但真正实现前仍需决定是否给 node registry 增加独立的 `executionKind: 'composition'` / `renderer: 'hyperframes'` 契约。

## 4. 技术接缝与建议分层

### Renderer 层

新增一个 Nomi-owned HyperFrames adapter，负责：

1. 将 node inputs 和 motion variables 生成一个受控的 HyperFrames project/composition；
2. 在本地 renderer 或 Electron worker 中启动 `check` / `snapshot` / `render`；
3. 将输出复制到 Nomi 本地资产存储；
4. 返回 `GenerationNodeResult` 和 provenance；
5. 处理取消、失败、恢复和 stale。

不要让 renderer 直接执行用户提供的任意 HTML/JS。第一版只允许内置模板和经过静态检查的 composition，避免把画布节点变成任意代码执行入口。

### Preview 层

节点卡片优先使用嵌入式 player 或 Nomi 自己的 preview surface；不要每次预览都触发完整 MP4 渲染。

预览和最终渲染必须明确区分：

```text
预览：低成本、可快速 seek、可以是 draft
渲染：可进入时间轴、持久化、产生 assetId
```

### Asset 层

渲染结果要像现有生成资产一样进入本地资产存储，而不是留在 HyperFrames 项目目录里。素材必须带 source node、composition version、render format、duration、alpha 信息。

### Timeline 层

复用 `buildClipFromGenerationNode` 和 adoption bridge；对透明 WebM、带字幕的 overlay、普通 MP4 分别声明 track type/alpha 能力，不能只根据 `result.type === 'video'` 猜轨道。

## 5. 第一版 MVP

### 只做三类节点行为

1. **图片 → 产品动效**：Logo reveal、shimmer sweep、parallax zoom。
2. **文本 / transcript → 字幕动效**：caption highlight、kinetic slam、karaoke pill。
3. **动效节点 → 透明素材 → 时间轴叠加层**。

### 第一版必须跑通的闭环

```text
选中图片
→ 输入一句提示词
→ 创建动效节点
→ 卡片内看到动态预览
→ 修改一次参数并预览
→ 渲染为本地素材
→ 一键加入时间轴
→ 从时间轴回到源节点继续编辑
```

### 第一版明确不做

- 任意 HTML/JS 动画代码输入；
- 完整 HyperFrames Studio 嵌入；
- 无限嵌套 composition；
- 复杂多轨字幕编辑器；
- 任意模板市场；
- 让每个 registry item 都直接暴露成一个节点；
- 通过外部网页或远程 CDN 直接播放最终素材。

## 6. 主要风险

| 风险 | 机制后果 | 用户感受 | 处理建议 |
|---|---|---|---|
| 只渲染成 MP4 | 源结构丢失，修改要重做 | “AI 做完就不能改了” | 节点与素材双层保留 |
| 每个模板一个新节点类型 | 菜单和数据模型爆炸 | “我不知道该选哪个” | 一个 motion 节点 + 模板/Agent 选择 |
| 预览也走完整渲染 | 延迟和成本过高 | “输入一句话要等很久” | player/draft preview 与 final render 分离 |
| 允许任意 HTML | 安全、可复现、版本不可控 | 偶发空白或渲染不一致 | 内置模板、sandbox、check gate |
| 时间轴只认普通 video | Alpha/字幕层行为错误 | “透明动效带黑底” | 输出契约显式声明 alpha/track type |
| 源输入变化没有 stale | 时间轴继续使用旧素材 | “我改了但成片没变” | sourceHash + stale 提示 + 重新渲染 |

## 7. 实现前的验证门

在写代码前，需要先做一个真实样张，而不是先扩展 node registry：

1. 用一个本地 HyperFrames composition 做 `shimmer-sweep` 或 `caption-highlight`；
2. 验证它能在 Electron/本地页面中嵌入预览；
3. 验证 `snapshot` 能得到稳定缩略图；
4. 验证 `render --format webm` 的透明背景能被 Nomi 时间轴正确播放；
5. 验证渲染产物能经过现有 asset localization/adoption 流程；
6. 验证修改源图片后，节点能被标记为 stale，而不是静默继续使用旧结果；
7. 用真实任务走通“图片 → 动效 → 素材 → 时间轴”，再决定是否扩展到字幕和批量模板。

## 8. 最终产品判断

这项集成的价值不在于“让 Nomi 多一个 HyperFrames 按钮”，而在于：

> 用户在画布里选中任何一个内容对象，就可以用自然语言把它变成一种动态表达；动态表达可以继续留在画布里被编辑，也可以在需要时变成时间轴可用的素材。

因此 HyperFrames 的最佳位置是 Nomi 的**动效执行层**，不是独立页面，也不是另一个模型市场。第一阶段应以少数高质量动效模板验证“节点 → 预览 → 渲染 → 素材 → 时间轴”的完整体验。
