# UX-simple PR-UX3 · 预览与时间轴

Phase 1 #6、#16 前半和 #21，协调批复 [#issuecomment-7126279479](https://github.com/aqm857886159/Nomi/issues/1586#issuecomment-7126279479)。既有预览、时间轴与顶栏的小修。验收依照批复里的文案、状态和实际截图。

## ★0 先查别人

- iMovie 从第一段素材确定项目格式，确认在首次入轨时匹配。[Apple](https://support.apple.com/en-gb/102276)
- Premiere 允许在第一段进入序列时匹配设置，确认以入轨为时点并保留用户已选画幅。[Adobe](https://helpx.adobe.com/ph_fil/premiere-pro/how-to/create-edit-sequence.html)
- Electron 可在文件管理器中选中已保存的文件，确认沿用现有 reveal IPC 和项目相对路径。[Electron](https://www.electronjs.org/docs/latest/api/shell/#shellshowiteminfolderfullpath)
- 出口：添加任何有正时长的片段即可启用导出。空态提示给出点击和拖入两条路径，沿用 Premiere 中将素材加到时间轴的起点。[Adobe](https://helpx.adobe.com/premiere/desktop/edit-projects/change-clip-sequence/create-a-sequence.html)

## ★1 用户旅程

打开预览 → 看空态指引 → 点竖屏镜头或拖素材入轨 → 看画面占满竖屏舞台 → 悬停导出查规格 → 导出 → 从回执打开文件夹。第二条任务先在属性选择 16:9，再添加方形或竖版素材并重开项目。量具为 `tests/ux/ui.mjs` 的 DOM、截图和落盘数据及 FFprobe。竖屏首次入轨从 16:9 变为 9:16，手动指定任务保持 16:9。空导出点击从能误触变为无法触发，有时长的轨道和忙态走查仍可完成真 MP4。

### ★1b 连带界面

舞台、Inspector、顶栏规格和导出读取同一项目画幅。预览导出的成功 Toast 提供文件管理器动作。复用现有的进度、失败和导出按钮。图片、视频、文字、配乐、字幕沿用各自轨道用途。

### ★1c 老用户

旧项目没有持久化画幅，打开按原 16:9 解释。已有画面的时间轴加载时保持原画幅。空画面项目在实际写入首段画面时匹配。新记录写项目画幅与显式选择来源，两者缺省和不识别时用旧默认。退回上一版能读同版本项目；旧版存盘会省略新增字段。

## ★2 归属与入口

项目拥有画幅，Inspector 写入用户意图；素材入轨事务负责首次匹配。媒体用浏览器解码得到内在尺寸。顶栏用现有时长与导出事件桥说明能否导出。完成回执由实际导出调用签发并保存原项目与文件身份。概念扫描复核 `previewAspectRatio`、`addTimelineClipAtFrame`、`commitTimeline`、`showInFolder` 和现有通知策略。

`node scripts/door-map.mjs --write=addTimelineClipAtFrame,setTimeline,setPreviewAspectRatio,commitTimeline --read=previewAspectRatio,computeTimelineDuration,showInFolder` 的相关入口见下方门表。沿包装查到素材库点选/拖放汇入 `addTimelineClipAtFrame`，镜头点选/拖放和拼片汇入 `commitTimeline`。Agent 内核可移动、裁剪、删除、分割、编辑文字和转场，从空轴无法用这些操作创建媒体。hydrate 的 `setTimeline` 是加载旧内容。

## ★3 一致与复用

保留 Preview Narrow Panels 板的收起交互，以及 NomiEntryTopbar 板的导出按钮与窄窗让位。原方向是继续使用现有按钮、通知与浏览器媒体组件，把规则前移到入轨提交；逐屏状态会遗漏采纳与素材库，删掉导出或手选会让用户失去现有能力。沿用原方向。改典型缺陷复用原来的控制和容器，设计批准来源为 Phase 1 审计和协调批复。

## ★4 全状态

空轴按钮禁用并悬停给原因。有时长时短按钮提示画幅与分辨率。忙态沿用阶段和百分比。成功且有保存路径时可打开文件夹，失败继续在原项目归属下提示。当前没有可取消的导出按钮。媒体尺寸未知时保持当前画幅，素材可继续入轨。最长英文 Clips 要完整容纳于 32px 轨条。配乐、字幕和文字均可单独撑起导出时长。

## 5 打断

等待媒体时切换项目由已有边界核验。关闭或重启从项目盘恢复选择。一次已开始的导出归属原项目，在离开预览时完成回执仍可揭示文件。断网时本地可读媒体照常导出。连点由现有导出忙态门阻止重入。全程本地处理。

## 6 外部数据与失败

媒体宽高取 HTML 图像/视频元数据，读取失败时保留当前画幅，沿用素材的时长与失败处理。Reveal 用 Electron 主进程已有 IPC，只传已保存文件的项目相对路径。

## ★7 性能

`timeline-scrub` 在 96 节点、24 视频片段时测帧间隔。33ms 预算，登记基线中位 18.3ms、p95 25.1ms。顶栏订阅布尔导出条件，播放头变化无需重绘顶栏。出图与导出完成时用实际窗口测结果，素材读取只在准备入轨时进行。

## 8 真实条件

macOS 隔离桌面，真实本地 9:16 媒体及本地 FFmpeg 导出，在中英亮暗及 1100×690 记录。原 S1 使用供应商生成的视频，这次走同一镜头入轨和 FFmpeg 路径，素材来自本地。Windows 与远程付费供应商不在本次执行范围。

## ★9 验收与回滚

- 红先绿后：图片/视频首段，9:16、1:1、非标比例，显式选择 16:9，第二段比例不同，纯音频和文字先入轨，旧项目恢复，新格式重开项目。
- 阳性与反例：有时长按钮可用，忙态不能重复请求，空轴真实 DOM 禁用，悬停仅一个 App tooltip，打开文件动作向原项目和相对路径发 IPC，成功前无打开系统文件管理器动作。
- 中英空态、收起片库和轨道名由双语测试及真截屏核对。截图核对无裁字和无画面内黑边，FFprobe 确认成片 9:16。
- 自验走现有驱动与定向测试，独立验收交协调线。回滚该提交可恢复原逻辑。

## 数门输出

```json
[
  {
    "kind": "read",
    "path": "src/workbench/capability/capabilityApplyHandler.ts",
    "symbol": "previewAspectRatio"
  },
  {
    "kind": "read",
    "path": "src/workbench/export/renderManifest.ts",
    "symbol": "computeTimelineDuration"
  },
  {
    "kind": "read",
    "path": "src/workbench/export/timelineWebmExport.ts",
    "symbol": "computeTimelineDuration"
  },
  {
    "kind": "read",
    "path": "src/workbench/generation/TimelineStrip.tsx",
    "symbol": "computeTimelineDuration"
  },
  {
    "kind": "read",
    "path": "src/workbench/generationCanvas/nodes/ClipNode.tsx",
    "symbol": "showInFolder"
  },
  {
    "kind": "read",
    "path": "src/workbench/preview/inspector/PreviewInspector.tsx",
    "symbol": "previewAspectRatio"
  },
  {
    "kind": "read",
    "path": "src/workbench/preview/inspector/PreviewInspector.tsx",
    "symbol": "computeTimelineDuration"
  },
  {
    "kind": "read",
    "path": "src/workbench/preview/PreviewWorkspace.tsx",
    "symbol": "previewAspectRatio"
  },
  {
    "kind": "read",
    "path": "src/workbench/preview/PreviewWorkspace.tsx",
    "symbol": "computeTimelineDuration"
  },
  {
    "kind": "read",
    "path": "src/workbench/preview/TimelinePreview.tsx",
    "symbol": "computeTimelineDuration"
  },
  {
    "kind": "read",
    "path": "src/workbench/preview/TimelinePreview.tsx",
    "symbol": "showInFolder"
  },
  {
    "kind": "read",
    "path": "src/workbench/taskCenter/exportJobTaskAction.ts",
    "symbol": "showInFolder"
  },
  {
    "kind": "read",
    "path": "src/workbench/timeline/agent/exportToolCall.ts",
    "symbol": "previewAspectRatio"
  },
  {
    "kind": "read",
    "path": "src/workbench/timeline/TimelinePanel.tsx",
    "symbol": "computeTimelineDuration"
  },
  {
    "kind": "read",
    "path": "src/workbench/WorkbenchShell.tsx",
    "symbol": "computeTimelineDuration"
  },
  {
    "kind": "read",
    "path": "src/workbench/workbenchStore.ts",
    "symbol": "previewAspectRatio"
  },
  {
    "kind": "write",
    "path": "src/devlab/designLab/processFeedback/processFeedbackLabKit.tsx",
    "symbol": "setTimeline"
  },
  {
    "kind": "write",
    "path": "src/workbench/adoption/adoptionApply.ts",
    "symbol": "commitTimeline"
  },
  {
    "kind": "write",
    "path": "src/workbench/preview/inspector/PreviewInspector.tsx",
    "symbol": "setPreviewAspectRatio"
  },
  {
    "kind": "write",
    "path": "src/workbench/project/workbenchProjectSession.ts",
    "symbol": "setTimeline"
  },
  {
    "kind": "write",
    "path": "src/workbench/timeline/addAssetToTimeline.ts",
    "symbol": "addTimelineClipAtFrame"
  },
  {
    "kind": "write",
    "path": "src/workbench/timeline/agent/timelineCapabilityTarget.ts",
    "symbol": "commitTimeline"
  }
]
```

修后数门清单在 [根因合同](../fixes/2026-11-24-preview-ux3.root-cause.json)。为区分旧 UI 表现和现有写入调用者，上表保留开工前原始结果。

## 系统改进

最早可拦的一步是入轨设计与导出走查。入轨协议只写轴，没有把尺寸和项目画幅选择送入提交；导出走查仅构造有媒体的轴，且把原生 title 当唯一说明。将计算放到两个事务共用的决定函数，把资格交时长主人，把成功回执交给结果签发者。当前镜头点击与旧的一键采纳写口用同一参数和规则。空轴拦截的阳性对照是只有标题仍能导出。复查日期 2026-12-24，用首段与顶栏测试重测，要求失败形状和阳性对照均能区分。
