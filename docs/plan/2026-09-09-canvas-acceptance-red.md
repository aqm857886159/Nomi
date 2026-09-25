# Canvas Acceptance 双红收尾

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已实现；三条真实走查与完整 gates exit 0；PR 交付中；2026-09-09 22:30 补充裁决已授权。基线 8a3136955736b734d21f526e5d17b510629c25d1。

## 范围与裁决

连续建卡保留同串内容：当前缩放能容纳时仅最小平移；容纳不了时对这串卡 fit，保留既有 24px 留白与画布 0.2 缩放下限；到下限后才优先露出最新卡。用户主动改变视口、删除或一次替换多张节点时结束连续串，不把项目加载当建卡。不修改节点落位、导轨布局或供应商调用。

验收入口固定内容区 1280×933，同一共享尺寸表另测 1680×1050。新卡真实几何由 _canvasHit.mjs 断言，禁止绕点。批量走查只迁移旧通知生命周期段：真实节点 queued/running → error → success，同一个节点 DOM 保留；失败汇总的独立重试动作与通知布局仍验。进度和普通成功静默，用同容器真实失败 alert 证明探针，再 expectAbsent 持续检查。

## 先查别人

- React Flow 官方 [getViewportForBounds](https://reactflow.dev/api-reference/utils/get-viewport-for-bounds) 与 [padding 更新](https://reactflow.dev/whats-new/2025-03-27)：Context7 实查支持 minZoom/maxZoom 与像素 padding；安装源码 @xyflow/system/dist/esm/index.mjs:719 使用容器宽高计算 fit。复用现有 API 与 unionCanvasFitBounds，不造第二个 fit 算法。
- tldraw [Editor.ts](https://github.com/tldraw/tldraw/blob/main/packages/editor/src/lib/editor/Editor.ts#L3859)：zoomToSelectionIfOffscreen 对已有 viewport 与选区并集计算最小滚入；zoomToBounds:3897 使用实测 viewport、inset 与 zoomSteps 下限；putContentOntoCurrentPage:10125 只在内容不与当前视口相交时转到视口中心。这支持「最小滚入」与批次适配；Nomi 的连续串/readability 是本次明确领域裁决，不声称上游有同一串定义。导轨在 flex 中占位，stage 即可用区，不能再减一遍 rail。
- Playwright 官方 [actionability](https://playwright.dev/docs/actionability) 与 [locator.click](https://playwright.dev/docs/api/class-locator#locator-click)：visible 不等于点击点能收到事件。安装源码 playwright-core/lib/coreBundle.js:16145 默认点只裁窗口，没有与祖先舞台求交，必须断言整卡在舞台内，不能用点击偏移掩盖产品问题。
- 现行通知政策 [09-09 方案](2026-09-09-notification-policy.md) 与 batchPlanPreview.ts:183：状态已有节点/任务中心承担，进度与普通成功不再 toast；失败汇总保留重试。已拍板 [逐步产出/编组](../lessons/batch-output-appears-progressively-and-grouped.md) 要求同一次产出摊在画布，连续建卡不能自动推出同串首卡。

## 最早共享边界与实现

useCreatedNodeVisibilityPan 同时接收工具条、复制及渐进新增的 nodes，且持有真实 stage 和自动视口目标。连续串只记录 ID，执行时读取最新节点尺寸，删除/换项目不使用过期闭包；zoom/offset 继续经既有 animateViewportTo。原始 revealPanDelta 仍承接最小单卡滚入，串的包围盒复用 unionCanvasFitBounds，fit 复用 React Flow。画布缩放下限从既有 fit/zoom 边界抽成共享常量。

六视角自审：CTO—复用单一视口内核；设计—仅已有画布几何变化；PM—连续建卡首卡不消失；前端—量测尺寸/删除/用户手势终止串；后端—无持久化/请求变化；真实用户—小窗口四张卡可见且普通成功不打扰。

## 验收与回滚

保留上一轮真实红日志，不重复分诊。新增几何单测先红（四卡、不同尺寸、下限），补手动视口所有权测试；修复后同片绿。group-baseline 两尺寸全旅程 + _canvasHit 整卡几何日志；batch-production 全旅程与失败重试；只更新实际受影响截图基线并逐张列出。排锁 python3 scripts/with-gates-lock.py -- pnpm run gates，exit 0 后正常 hooks commit/push，开 PR 不合并。回滚本任务提交，无用户数据迁移。证据目录 docs/fixes/canvas-acceptance-red-20260909/，原分诊 REPORT 保留历史并追加收尾收据。


## 本地验收收据

1280×933：stage=[60,56,858,932]，首卡=[84,221.59,318.64,456.24]，四张均可见；1680×1050：stage=[60,56,1258,1049]，首卡=[369.24,252.04,709.24,592.04]。默认点击、编组、composer、mention 完整走查通过；batch-production 的失败内联原因、同节点 DOM、独立失败重试和成功静默通过。旧截图路径仅为运行产物而非版本化基线，未更新任何版本化视觉基线；审阅图随本任务证据提交。
