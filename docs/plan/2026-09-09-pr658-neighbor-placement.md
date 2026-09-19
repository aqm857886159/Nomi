# PR 658 邻近节点避让与标签裁决

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：实施中。用户 2026-09-09 已明确裁决，延伸现有放置规则，不涉及框架或产品方向变更。

原因：参数卡仅避让视口和底部 dock；最低高度兜底允许盖住邻居。多节点点击被 selected 子树拦截，属于 recurring。

范围：composer 放置层统一计算屏幕空间，邻居媒体 rect / toolbar / dock 作为障碍。完整卡优先下、上、右、左；全部容不下则在可用矩形内收缩并滚动。观察节点增删、位置、尺寸及视口变化。状态条媒体左上仅过程/异常态；镜头号媒体左下常驻；动作条节点外上方。无新包、无数据迁移、不改内核与 agent lane。

验收：旧产品先跑矩形相交断言证红；纯几何同类用例；真实生成四种选中/完成组合截图；card-stack outside viewport 独立追因；full 1/2、2/2、critical 4/4、gates；正常 hooks commit/push 更新 #658。

回滚：撤销本次 scoped commit；不回滚调查证据或他人依赖改动。

## 同类扫描

图片、视频均从 NodeGenerationComposer 消费同一 useComposerViewportPlacement；BaseGenerationNode 为统一 article[data-node-id] 边界。TimelineMiniPreview、CanvasBatchGenerateDock 为既有固定障碍。卡宽反向 scale 保持屏幕大小，障碍也必须取屏幕 rect，不混用 canvas 单位。

## 验证进展

旧版真实矩形断言红：group-character 和 group-scene 被参数卡覆盖，见 neighbor-placement/red-card-intersection.log。共享放置层改后同断言通过。

侧放参数卡后，真实「落时间轴再重新生成」遇到本节点连线把手热区拦截。把手宽于媒体边界，故同一放置层也测量其 DOM 热区，代码未触碰 reactFlow 内核。见 red-side-handle.log；加热区后真实流程已通过。

取消旧的 composer 自动平移和强制最小高度；完整卡四方向择优，受限时卡片自身滚动。旧 pan/min-height 单测随旧路径删除，用新矩形类回归替换，不保留第二套放置规则。

版本托盘曾观察到悬停目标移动；媒体 pointer-events 修改未修好，已撤销，不作修复交付。构建后的 card-stack 全链通过；未修改托盘或测试点击方式、超时。

用户裁决已落地并更新 process-feedback 屏 19 张既有视觉基线；其它实验室屏不更新。

四周完全占满边界另补红测 `red-dense.log`：不再隐藏参数卡，最后取选中节点自身的空闲矩形缩卡并滚动。任何非选中节点仍是硬障碍。

真实卡片回归另验证：在有邻居的选中节点上，参数卡可滚到完整的「重新生成」按钮。没有改变原有版本按钮的点击方式或超时。

## 先查别人

本节补齐已有调查的来源索引。用户明确裁决为现有避让规则延伸、不需外部调研；没有新增框架或另造内核。

- 现有共享放置 owner：`src/workbench/generationCanvas/nodes/useComposerViewportPlacement.ts:34`；原调查已确认它只避让视口和 dock，本轮在此补入邻居矩形。
- 真实触发入口：`tests/ux/canvas-batch-production.walk.mjs:410`；重试后点击已成功的邻近节点，故不是生成中尺寸抖动。
- 同类入口与版本托盘：`tests/ux/canvas-card-stack.walk.mjs:170`；同一参数卡的矩形断言与原版本切换全链验收。
- 结论：沿用现有 composer；无需新增依赖、替换 React Flow 或另建浮层体系。依据 `src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx:535` 的真实宿主。

## 门禁发现的错误分类边界

上一段 catalog-unavailable 修复用中文子串兼容旧数据，触发 i18n 棘轮。新错误改用已有 `electron/shared/nomiErrorCodes.ts:14` 的 NOMI_ERR 码通道。两种历史完整落盘模板仅在同一解码边界升级到 model-config，固定旧格式不随当前翻译变化；删除 classifyError 的宽泛子串猜测。生产图片/视频入口、翻译后消息和旧数据模板分别测试，不放宽门禁。
