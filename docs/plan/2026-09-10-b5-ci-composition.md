# B5 合并树 CI 修复

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已实现，最新 main 合并树完整 gates 通过，待交付

## 范围与依据

合并 origin/main f68cf2c7 后复现原 12 条 canvasWriteTarget 集成测试：1 红。临时只读诊断显示真正异常来自 addStoryboardDesign → applyStoryboardPlanProjection → addNode → interruptPendingCanvasWrite，不是 DC22/DC23 错误投影。保留原错误码与所有断言。既有共享写边界已有 settled waiters；复用它让外部派生投影在 durable receipt 释放后读取最新分镜与画布，同事务投影保持同步。捕获 undo journal generation，项目替换后丢弃旧投影。

## 先查别人

这是内部事务组合，不引入框架或外部格式。近邻是本仓 src/workbench/generationCanvas/nodes/shotTable/factBridge.ts:19 的等待后读取和 useNodeModelAutoSelect.ts:83 的派生更新。统一使用 canvasWriteBoundary.ts 的既有等待队列；不新增队列、不绕过锁。

- `src/workbench/generationCanvas/nodes/shotTable/factBridge.ts:19` 已先等写边界释放，再检验 generation 与读取当前 table；沿用生命周期检查，不另建任务队列。
- `src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts:83` 已把模型默认值的派生写延迟到回执结束；分镜表属于同类派生投影。
- `src/workbench/generationCanvas/events/canvasWriteBoundary.ts:56` 已拥有 settled waiters；扩展同 owner 同步执行和外部等待的统一入口，继续使用这份队列。

## 性能证据

run 34414428313，M/click-select frameGapP95Ms=59.4 > Linux 53；warmupFailures=[]，其他场景通过。C09 仅响应显式聚焦请求，不在普通 click-select 上改变倍率。按 CI production build + performance profile 本地重放，再决定是否需要生产优化。禁止修改预算/断言。

## 不动项、回滚、验收

不改 DC21–24/C53/C09 已交付行为、不改测试判据、不改错误码 owner。回滚仅本次 scoped commit。验收原失败测试、共享投影的同事务/外部等待/删除/项目替换测试；原性能 profile；完整锁内 gates；正常 hooks 推送原分支；更新 B5-LAST.md 与指定 scratchpad。

## 原因核验

main 自身 run https://github.com/aqm857886159/Nomi/actions/runs/34414378679 在同一测试上失败（target_stale → receipt_unresolved）。合并时 canvasWriteTarget.ts、proposalTxn.ts、ensureStoryboardShotTable.ts 与 origin/main 零差异；不是 B5 的 DC22/DC23 投影改名。原测试未改断言，只补回执确实 aborted 的验证。

定向 5 文件 50 项通过；追加共享边界测试后该文件 8 项通过。check:vocabularies、根因合同、症状聚类均通过。新增类测试覆盖创建/复制/最新源重读、源删除、canvas lifetime 替换、下一回执抢占与同 owner 同步执行。

## 性能输入对照

main run 34414378679：M/click-select 35.5ms，6/6 selected，stage 798×876；B5 run 34414428313：59.4ms，3/6 selected，stage 798×688，额外出现 workbench-timeline-clip__thumb 和时间轴媒体预览。两个 probe 开始时均有 6 个节点，zoom=1，结束时 B5 仍为 zoom=1，说明不是 C09 聚焦缩放在逐帧计算，而是合成点击误触了时间轴相关操作。

`tests/ux/_canvasHit.mjs:234` 已有 findNodeHitPoint，检查最顶层命中属于指定节点并排除按钮；canvas-frame.walk.mjs:177 和 canvas-three-gestures.walk.mjs:121 已复用。性能的 click-select:743 和 dragScenarios.mjs:148 仍使用未经命中校验的固定坐标。后续如原始重放确认，接回现有 helper，不改预算或降低断言。

## 性能修复实施

现有手势门岗增加 direct coordinate-only click 检查，改动输入前准确报出 benchmark:743 与 dragScenarios:148 两处，4 条门岗回归通过。使用原有 findNodeHitPoint 为每次多选点击和后续主节点拖动重新读取可命中位置；找不到直接失败，不跳过 requested 节点。原 sampleHardFailures、预算及全部结果断言不改。Linux 原始 artifact 为红证据，本地完整 profile 与推送后的 Linux CI 为验收。

真实 Chromium 的受遮挡卡片回归：使用 git HEAD 的原 runMultiNodeDrag，2 张请求卡片实际选中 0 张，原断言红；同一 DOM、同一断言调用修复后 runner，2/2 选中，遮挡按钮激活数为 0，绿。证据见 docs/fixes/b5-density-evidence/ci-perf-hit-{red,green}.txt。该浏览器夹具验证手势归属，不替代真实 Electron 性能预算。

修复后真实 Electron click-select 三轮：frameGapP95Ms=13.9/16.8/12.5，严格 macOS 33ms 原预算通过；每轮 domainSelected=flowSelected=mounted=6，stageHeight=876。人眼查看 after 截图，时间轴保持收起，未出现额外时间轴 clip。摘要与截图见 docs/fixes/b5-density-evidence/ci-perf-click-local.json、ci-perf-click-after.png。

## 最新 main 合流

首轮完整 performance profile：18/18 场景通过，warmupFailures=[]，click-select=13.3ms、6/6、stageHeight=876。随后完整 gates 的新鲜基线闸发现 main 前进到 6e68cbcf5425，正常保存工作后合并，无冲突。新 main 的 0ca1816fa 将原测试夹具收窄为纯 selection race；本分支保留它，并另加原 design creation race，不让新建分镜时的真实投影冲突消失在覆盖之外。在合并树上重新运行完整 gates 和 performance profile。

完整 gates 在 8ab54b2ecb32 上 exit 0：77 contracts 中 74 通过、0 阻断失败、3 既有 advisory；173 设计基线通过；Vitest 12073 通过/2 跳过；Agent runtime 425/425；前端和 Electron 构建通过。新合并树完整 performance profile 正在复验，最终结果随交接与 PR 更新。

第二轮完整 performance profile（已并 #619）18/18 通过，预热失败 0，click-select=15.1ms、6/6、stageHeight=876。推送前刷新发现 #685 已入 main，正常合入为 ffdf023a，无冲突；其变更为技能/提示词库与节点 composer，不改 React Flow 手势/缩放内核。再次完整 gates + click-select/multi-node-drag 定向性能复验，最终收据见 B5-LAST.md 与 PR。

最终合并树 ffdf023a3900 完整 gates exit 0：12086 Vitest 通过/2 跳过、425 Agent runtime 通过、173 设计基线通过、contracts 0 阻断失败、前端/Electron 构建通过。click-select 和 multi-node-drag 在同树 production build 上均通过，预热失败 0，原预算/原结果断言未改。最终摘要见 ci-perf-final-merged.json；日志 /tmp/b5-cifix-delivery-gates.log。
