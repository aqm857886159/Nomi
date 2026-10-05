# PR1014 卡18 · baseline reapproval 机械证据（2026-10-05）

本目录只保存逐格截图、左右对比图和走查原始日志。左侧取 `tests/ux/design-lab/__baselines__/` 中已存在的基线，右侧取 `origin/main`（`180224684`）在本机真实 Design Lab 走查重新截出的现行图。未运行 `design-lab:update`，未写 `__baselines__/`、`calibration.json`，未改产品代码或断言。

总计：31 格（process-feedback 14、storyboard 8、settings 4、depth-action 2、director-3dbox 2、canvas-frame 1）。每行链接到带标题和提交号的左右对比图；“可见变化”只报机械像素差异，不把差异归因成设计结论。

## 原始走查日志

- [process-feedback](logs/process-feedback.log)
- [storyboard](logs/storyboard.log)
- [settings](logs/settings.log)
- [depth-action](logs/depth-action.log)
- [director-3dbox](logs/director-3dbox.log)
- [canvas-frame](logs/canvas-frame.log)

## 结果按屏分组

### process-feedback（14）

| 状态 id | 缩略图 | 左基线提交 | 右现行提交 | 尺寸（左→右） | 可见变化（机械 diff） | 左右对比 |
|---|---|---:|---:|---|---|---|
| `pf-image-queued` | <img src="thumbs/process-feedback/pf-image-queued.png" width="320" alt="pf-image-queued 缩略图"> | `da6b4c57f` | `180224684` | 800×632 → 800×632 | 机械 diff 约 13.52% 像素变化；未作语义归因。 | [对比图](comparisons/process-feedback/pf-image-queued.png) |
| `pf-image-submitting` | <img src="thumbs/process-feedback/pf-image-submitting.png" width="320" alt="pf-image-submitting 缩略图"> | `da6b4c57f` | `180224684` | 800×632 → 800×632 | 机械 diff 约 13.52% 像素变化；未作语义归因。 | [对比图](comparisons/process-feedback/pf-image-submitting.png) |
| `pf-image-generating` | <img src="thumbs/process-feedback/pf-image-generating.png" width="320" alt="pf-image-generating 缩略图"> | `da6b4c57f` | `180224684` | 800×632 → 800×632 | 机械 diff 约 13.58% 像素变化；未作语义归因。 | [对比图](comparisons/process-feedback/pf-image-generating.png) |
| `pf-image-finalizing` | <img src="thumbs/process-feedback/pf-image-finalizing.png" width="320" alt="pf-image-finalizing 缩略图"> | `da6b4c57f` | `180224684` | 800×632 → 800×632 | 机械 diff 约 13.52% 像素变化；未作语义归因。 | [对比图](comparisons/process-feedback/pf-image-finalizing.png) |
| `pf-image-failed` | <img src="thumbs/process-feedback/pf-image-failed.png" width="320" alt="pf-image-failed 缩略图"> | `ce5cfb336` | `180224684` | 800×632 → 800×632 | 机械 diff 约 0.01% 像素变化；未作语义归因。 | [对比图](comparisons/process-feedback/pf-image-failed.png) |
| `pf-video-queued` | <img src="thumbs/process-feedback/pf-video-queued.png" width="320" alt="pf-video-queued 缩略图"> | `da6b4c57f` | `180224684` | 800×632 → 800×632 | 机械 diff 约 13.52% 像素变化；未作语义归因。 | [对比图](comparisons/process-feedback/pf-video-queued.png) |
| `pf-video-submitting` | <img src="thumbs/process-feedback/pf-video-submitting.png" width="320" alt="pf-video-submitting 缩略图"> | `ab027e3f1` | `180224684` | 800×632 → 800×632 | 机械 diff 约 13.53% 像素变化；未作语义归因。 | [对比图](comparisons/process-feedback/pf-video-submitting.png) |
| `pf-video-generating` | <img src="thumbs/process-feedback/pf-video-generating.png" width="320" alt="pf-video-generating 缩略图"> | `a7381748c` | `180224684` | 800×632 → 800×632 | 机械 diff 约 13.58% 像素变化；未作语义归因。 | [对比图](comparisons/process-feedback/pf-video-generating.png) |
| `pf-video-finalizing` | <img src="thumbs/process-feedback/pf-video-finalizing.png" width="320" alt="pf-video-finalizing 缩略图"> | `da6b4c57f` | `180224684` | 800×632 → 800×632 | 机械 diff 约 13.52% 像素变化；未作语义归因。 | [对比图](comparisons/process-feedback/pf-video-finalizing.png) |
| `pf-video-failed` | <img src="thumbs/process-feedback/pf-video-failed.png" width="320" alt="pf-video-failed 缩略图"> | `ce5cfb336` | `180224684` | 800×632 → 800×632 | 机械 diff 约 0.01% 像素变化；未作语义归因。 | [对比图](comparisons/process-feedback/pf-video-failed.png) |
| `pf-preview` | <img src="thumbs/process-feedback/pf-preview.png" width="320" alt="pf-preview 缩略图"> | `a7381748c` | `180224684` | 800×632 → 800×632 | 机械 diff 约 0.50% 像素变化；未作语义归因。 | [对比图](comparisons/process-feedback/pf-preview.png) |
| `pf-preview-dark` | <img src="thumbs/process-feedback/pf-preview-dark.png" width="320" alt="pf-preview-dark 缩略图"> | `da6b4c57f` | `180224684` | 800×632 → 800×632 | 机械 diff 约 1.82% 像素变化；未作语义归因。 | [对比图](comparisons/process-feedback/pf-preview-dark.png) |
| `pf-late` | <img src="thumbs/process-feedback/pf-late.png" width="320" alt="pf-late 缩略图"> | `da6b4c57f` | `180224684` | 800×632 → 800×632 | 机械 diff 约 13.64% 像素变化；未作语义归因。 | [对比图](comparisons/process-feedback/pf-late.png) |
| `pf-zoom-60` | <img src="thumbs/process-feedback/pf-zoom-60.png" width="320" alt="pf-zoom-60 缩略图"> | `ab027e3f1` | `180224684` | 800×632 → 800×632 | 机械 diff 约 4.52% 像素变化；未作语义归因。 | [对比图](comparisons/process-feedback/pf-zoom-60.png) |

原始日志：[logs/process-feedback.log](logs/process-feedback.log)

### storyboard（8）

| 状态 id | 缩略图 | 左基线提交 | 右现行提交 | 尺寸（左→右） | 可见变化（机械 diff） | 左右对比 |
|---|---|---:|---:|---|---|---|
| `sb-row-01-draft-inherited-aspect` | <img src="thumbs/storyboard/sb-row-01-draft-inherited-aspect.png" width="320" alt="sb-row-01-draft-inherited-aspect 缩略图"> | `ab027e3f1` | `180224684` | 900×161 → 900×161 | 机械 diff 约 0.04% 像素变化；未作语义归因。 | [对比图](comparisons/storyboard/sb-row-01-draft-inherited-aspect.png) |
| `sb-row-02-aspect-override-16-9` | <img src="thumbs/storyboard/sb-row-02-aspect-override-16-9.png" width="320" alt="sb-row-02-aspect-override-16-9 缩略图"> | `af61d73c9` | `180224684` | 900×133 → 900×133 | 机械 diff 约 0.05% 像素变化；未作语义归因。 | [对比图](comparisons/storyboard/sb-row-02-aspect-override-16-9.png) |
| `sb-row-03-aspect-override-1-1` | <img src="thumbs/storyboard/sb-row-03-aspect-override-1-1.png" width="320" alt="sb-row-03-aspect-override-1-1 缩略图"> | `af61d73c9` | `180224684` | 900×134 → 900×134 | 机械 diff 约 0.05% 像素变化；未作语义归因。 | [对比图](comparisons/storyboard/sb-row-03-aspect-override-1-1.png) |
| `sb-row-05-missing-required` | <img src="thumbs/storyboard/sb-row-05-missing-required.png" width="320" alt="sb-row-05-missing-required 缩略图"> | `ab027e3f1` | `180224684` | 900×161 → 900×161 | 机械 diff 约 0.05% 像素变化；未作语义归因。 | [对比图](comparisons/storyboard/sb-row-05-missing-required.png) |
| `sb-row-06-generating` | <img src="thumbs/storyboard/sb-row-06-generating.png" width="320" alt="sb-row-06-generating 缩略图"> | `486d87ee7` | `180224684` | 900×205 → 900×205 | 机械 diff 约 0.06% 像素变化；未作语义归因。 | [对比图](comparisons/storyboard/sb-row-06-generating.png) |
| `sb-row-07-failed` | <img src="thumbs/storyboard/sb-row-07-failed.png" width="320" alt="sb-row-07-failed 缩略图"> | `ab027e3f1` | `180224684` | 900×189 → 900×189 | 机械 diff 约 0.08% 像素变化；未作语义归因。 | [对比图](comparisons/storyboard/sb-row-07-failed.png) |
| `sb-row-08-done` | <img src="thumbs/storyboard/sb-row-08-done.png" width="320" alt="sb-row-08-done 缩略图"> | `ab027e3f1` | `180224684` | 900×208 → 900×208 | 机械 diff 约 0.08% 像素变化；未作语义归因。 | [对比图](comparisons/storyboard/sb-row-08-done.png) |
| `sb-row-19-composer-demoted` | <img src="thumbs/storyboard/sb-row-19-composer-demoted.png" width="320" alt="sb-row-19-composer-demoted 缩略图"> | `af61d73c9` | `180224684` | 804×161 → 804×161 | 机械 diff 约 0.04% 像素变化；未作语义归因。 | [对比图](comparisons/storyboard/sb-row-19-composer-demoted.png) |

原始日志：[logs/storyboard.log](logs/storyboard.log)

### settings（4）

| 状态 id | 缩略图 | 左基线提交 | 右现行提交 | 尺寸（左→右） | 可见变化（机械 diff） | 左右对比 |
|---|---|---:|---:|---|---|---|
| `privacy-01-idle` | <img src="thumbs/settings/privacy-01-idle.png" width="320" alt="privacy-01-idle 缩略图"> | `18c571d14` | `180224684` | 516×480 → 516×480 | 机械 diff 约 10.53% 像素变化；未作语义归因。 | [对比图](comparisons/settings/privacy-01-idle.png) |
| `privacy-02-exporting` | <img src="thumbs/settings/privacy-02-exporting.png" width="320" alt="privacy-02-exporting 缩略图"> | `18c571d14` | `180224684` | 516×480 → 516×480 | 机械 diff 约 10.23% 像素变化；未作语义归因。 | [对比图](comparisons/settings/privacy-02-exporting.png) |
| `privacy-03-saved` | <img src="thumbs/settings/privacy-03-saved.png" width="320" alt="privacy-03-saved 缩略图"> | `18c571d14` | `180224684` | 516×480 → 516×480 | 机械 diff 约 10.68% 像素变化；未作语义归因。 | [对比图](comparisons/settings/privacy-03-saved.png) |
| `privacy-04-failed` | <img src="thumbs/settings/privacy-04-failed.png" width="320" alt="privacy-04-failed 缩略图"> | `18c571d14` | `180224684` | 516×480 → 516×480 | 机械 diff 约 10.73% 像素变化；未作语义归因。 | [对比图](comparisons/settings/privacy-04-failed.png) |

原始日志：[logs/settings.log](logs/settings.log)

### depth-action（2）

| 状态 id | 缩略图 | 左基线提交 | 右现行提交 | 尺寸（左→右） | 可见变化（机械 diff） | 左右对比 |
|---|---|---:|---:|---|---|---|
| `depth-action-01-toolbar` | <img src="thumbs/depth-action/depth-action-01-toolbar.png" width="320" alt="depth-action-01-toolbar 缩略图"> | `9490c0a99` | `180224684` | 800×460 → 800×460 | 机械 diff 约 0.98% 像素变化；未作语义归因。 | [对比图](comparisons/depth-action/depth-action-01-toolbar.png) |
| `depth-action-04-done` | <img src="thumbs/depth-action/depth-action-04-done.png" width="320" alt="depth-action-04-done 缩略图"> | `ab027e3f1` | `180224684` | 800×460 → 800×460 | 机械 diff 约 0.04% 像素变化；未作语义归因。 | [对比图](comparisons/depth-action/depth-action-04-done.png) |

原始日志：[logs/depth-action.log](logs/depth-action.log)

### director-3dbox（2）

| 状态 id | 缩略图 | 左基线提交 | 右现行提交 | 尺寸（左→右） | 可见变化（机械 diff） | 左右对比 |
|---|---|---:|---:|---|---|---|
| `d3-empty-director-zh` | <img src="thumbs/director-3dbox/d3-empty-director-zh.png" width="320" alt="d3-empty-director-zh 缩略图"> | `fbba3cfdc` | `180224684` | 1280×933 → 1280×933 | 机械 diff 约 0.02% 像素变化；未作语义归因。 | [对比图](comparisons/director-3dbox/d3-empty-director-zh.png) |
| `d3-courtyard-director-zh` | <img src="thumbs/director-3dbox/d3-courtyard-director-zh.png" width="320" alt="d3-courtyard-director-zh 缩略图"> | `fbba3cfdc` | `180224684` | 1280×933 → 1280×933 | 机械 diff 约 5.37% 像素变化；未作语义归因。 | [对比图](comparisons/director-3dbox/d3-courtyard-director-zh.png) |

原始日志：[logs/director-3dbox.log](logs/director-3dbox.log)

### canvas-frame（1）

| 状态 id | 缩略图 | 左基线提交 | 右现行提交 | 尺寸（左→右） | 可见变化（机械 diff） | 左右对比 |
|---|---|---:|---:|---|---|---|
| `canvas-frame-shot-label-outside` | <img src="thumbs/canvas-frame/canvas-frame-shot-label-outside.png" width="320" alt="canvas-frame-shot-label-outside 缩略图"> | `337472b01` | `180224684` | 800×560 → 800×560 | 机械 diff 约 0.02% 像素变化；未作语义归因。 | [对比图](comparisons/canvas-frame/canvas-frame-shot-label-outside.png) |

原始日志：[logs/canvas-frame.log](logs/canvas-frame.log)

## 逐格状态清单（卡面计数对应）

- **process-feedback（14）**：`pf-image-queued`、`pf-image-submitting`、`pf-image-generating`、`pf-image-finalizing`、`pf-image-failed`、`pf-video-queued`、`pf-video-submitting`、`pf-video-generating`、`pf-video-finalizing`、`pf-video-failed`、`pf-preview`、`pf-preview-dark`、`pf-late`、`pf-zoom-60`
- **storyboard（8）**：`sb-row-01-draft-inherited-aspect`、`sb-row-02-aspect-override-16-9`、`sb-row-03-aspect-override-1-1`、`sb-row-05-missing-required`、`sb-row-06-generating`、`sb-row-07-failed`、`sb-row-08-done`、`sb-row-19-composer-demoted`
- **settings（4）**：`privacy-01-idle`、`privacy-02-exporting`、`privacy-03-saved`、`privacy-04-failed`
- **depth-action（2）**：`depth-action-01-toolbar`、`depth-action-04-done`
- **director-3dbox（2）**：`d3-empty-director-zh`、`d3-courtyard-director-zh`
- **canvas-frame（1）**：`canvas-frame-shot-label-outside`

## 阻塞与边界

本轮 31/31 状态均生成 PNG，走查进程退出码为 0。director-3dbox 原始日志含 Vite 字体请求越过 allow list 的警告；两格仍输出 1280×933 PNG，日志中保留原文。未出现无法截图的状态，因此没有把任何未截图状态标为通过。

取证原件：
- 右侧现行原图：[`raw/current/`](raw/current/)
- 左侧基线副本：[`raw/baseline/`](raw/baseline/)
- 逐格记录（提交、尺寸、diff）：[`records.json`](records.json)
- 现行树说明：[`source.txt`](source.txt)

