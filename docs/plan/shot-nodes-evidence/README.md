# C73/C74/C75 验收证据

状态：真机/定向验证完成；完整 gates 与 PR 身份记录在根目录 shot-nodes-LAST.md。

全部 Electron 使用 launchNomiApp 隔离 settings/userData/projects；用户 gate-r2 只读复盘，没有读取真实资料库。供应商是本地 loopback，付费 0。图片未经重绘或合成。

## 实际生成闭环

`node tests/ux/shot-nodes-lifecycle.e2e.mjs` 从真实项目库新建项目、添加两镜提示词、点击批量生成。并发 1 使第二镜实际排队；供应商返回后经真实 asset store 落盘；禁用第二镜供应商形成真实错误；恢复配置后点击原节点「仍要重试」完成。见 lifecycle-receipt.json。完成与失败有原地状态；成功没有新增 toast。部分失败的批次摘要仍提供真实批量重试动作（不是成功 toast）。

## 媒体与状态边界

`node tests/ux/shot-nodes-media.e2e.mjs` 的完整 StoryboardShotRow 宿主四态是 renderer 契约：真实队列 store、真实共享时钟、真实重试回调，成功由 nomi-local 协议解码隔离 MP4，videoWidth=640/videoHeight=360/readyState=4/error=null。没有把 fixture 状态说成新付费模型生成。

## 对比度与布局

`node tests/ux/shot-nodes-badges.e2e.mjs` 验当前完整 BaseGenerationNode，后图按真实媒体 ready 等待；前图在原源码以同一完整宿主拍摄（生成中媒体等待态）。单独量测真实徽标 token，背景遍历以黑白通道上下界计算保守下界，门槛4.5。Electron light/dark 实际结果见 after-badges-contrast-*.json；_feel.browser 还覆盖名称与 +N、透明/半透明红控制、OKLCH。

`node tests/ux/shot-nodes-layout.e2e.mjs` 验选中/未选中四态及超长标题/错误；layout-geometry.json 证明工具栏→状态→标签→媒体不互盖，错误不横溢。旧页面其它 feel 发现未被当成零缺陷。

## 原现场 C74 复盘

gate-r2/attempt-1UrYyt/station-ledger.json 的04站已生成8段真实视频，06站导出、07站重启；其隔离项目 .nomi/project.json 的8节点均success、type=video、nomi-local://asset/...mp4且无thumbnailUrl。旧 resultDisplayUrl回退MP4，Frame固定NomiImage解码失败；现按媒体类型调用既有DeferredNodeVideo，真实坏媒体仍报错且只提供媒体重载，不触发付费生成。未以延时掩盖路径/协议问题。

## 截图全名

- [after-badges-dark.png](after-badges-dark.png)
- [after-badges-light.png](after-badges-light.png)
- [after-complete-dark.png](after-complete-dark.png)
- [after-complete-light.png](after-complete-light.png)
- [after-failed-dark.png](after-failed-dark.png)
- [after-failed-light.png](after-failed-light.png)
- [after-generating-dark.png](after-generating-dark.png)
- [after-generating-light.png](after-generating-light.png)
- [after-queued-dark.png](after-queued-dark.png)
- [after-queued-light.png](after-queued-light.png)
- [after-retry-complete-dark.png](after-retry-complete-dark.png)
- [after-retry-complete-light.png](after-retry-complete-light.png)
- [after-storyboard-error-dark.png](after-storyboard-error-dark.png)
- [after-storyboard-error-light.png](after-storyboard-error-light.png)
- [after-storyboard-queued-dark.png](after-storyboard-queued-dark.png)
- [after-storyboard-queued-light.png](after-storyboard-queued-light.png)
- [after-storyboard-running-dark.png](after-storyboard-running-dark.png)
- [after-storyboard-running-light.png](after-storyboard-running-light.png)
- [after-storyboard-video-dark.png](after-storyboard-video-dark.png)
- [after-storyboard-video-light.png](after-storyboard-video-light.png)
- [before-badges-dark.png](before-badges-dark.png)
- [before-badges-light.png](before-badges-light.png)
- [layout-selected-error.png](layout-selected-error.png)
- [layout-selected-queued.png](layout-selected-queued.png)
- [layout-selected-running.png](layout-selected-running.png)
- [layout-selected-success.png](layout-selected-success.png)
- [layout-unselected-error.png](layout-unselected-error.png)
- [layout-unselected-queued.png](layout-unselected-queued.png)
- [layout-unselected-running.png](layout-unselected-running.png)
- [layout-unselected-success.png](layout-unselected-success.png)

## 受影响视觉基线全名

仅更新实际使用此次镜头节点/反馈原子的图。process-feedback 宿主原上沿裁掉新增状态行，给实验室取景留足顶部空间；生产几何不因此改变，原有断言保持。

- `tests/ux/design-lab/__baselines__/canvas-frame/canvas-frame-shot-label-outside.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-audio-failed.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-audio-finalizing.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-audio-generating.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-audio-queued.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-audio-submitting.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-fx-done-clean.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-fx-final-reveal.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-fx-generating.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-fx-organic.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-fx-preview-reveal.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-fx-reduced.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-image-failed.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-image-finalizing.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-image-generating.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-image-queued.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-image-submitting.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-late.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-preview-dark.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-preview.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-video-failed.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-video-finalizing.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-video-generating.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-video-queued.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-video-submitting.png`
- `tests/ux/design-lab/__baselines__/process-feedback/pf-zoom-60.png`
- `tests/ux/design-lab/__baselines__/storyboard/sb-row-06-generating.png`

完整指定 gates 于最新基线 `6afb88ae8` 上 exit 0；全部阻断性门岗、11938 Vitest tests、425 agent runtime tests、构建通过。定向视觉45/45、徽标12/12、真实Electron闭环与媒体解码均通过。
