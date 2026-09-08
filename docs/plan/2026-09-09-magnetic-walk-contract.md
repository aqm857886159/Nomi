# 磁吸走查消费契约同步

范围：扫描 tests/ux 的 magnetic、handle-hit、29px 与 source handle 消费者，修正选中前提与全局定位。共享命中助手按节点、侧别定位，在外侧热区真实 hover 并验证 29px、加号与可见性；各走查保留自身用户任务断言。card-stack 当前版本已无报告中的全局点击，补未选中图片/视频双侧验证。

根因：可连节点均挂载把手后，DOM 存在不等于显示；选中也不再触发显示。旧走查未同步消费此合同，属于 recurring。

不动生产代码、依赖和性能结果；不跳过或放宽断言。回滚本次 scoped commit 即恢复走查。验收：critical 4/4、magnetic、gestures、S5、截图人眼查看、gates，正常 hooks commit/push，PR 转 ready 不合并。

## 走查揭示的生产 bug

card-stack 真实点击/hover 被视频 source 热区拦截（/tmp/mh-card.log、/tmp/mh-critical-after2.log）。BaseGenerationNode 的 isolate 使托盘局部 z-14 无法越过外层 z-8 source。共享节点壳让空闲 source 先绘制且 z-0，卡片本体及版本控件绘制在其上；连接中的 target 保留 z-8。覆盖图片和视频版本控件，不加 kind 特例、不强制点击。生产范围仅 GenerationCanvasReactFlowNodes.tsx 与 generationCanvasReactFlow.css，既有磁吸样张外观不变。

## 验证

四份走查同步：canvas-drag-pan-gestures、canvas-card-stack、canvas-s5-walkthrough、group-ports，共享 _canvasHit 按节点/侧别确认真实命中。S5 只数 RF edge 容器，删除将容器与 path 重复计数的旧查询，严格新增一条，不再点击兜底。

本地 critical 4/4；magnetic 3/3；单独 gestures 通过；S5 通过。人工查看 green-01-hover 与版本托盘截图，未选中外侧加号可见、托盘正常操作。未放宽/跳过走查，未安装依赖。原 Linux 失败 run：https://github.com/aqm857886159/Nomi/actions/runs/34248853729 。

## 先查别人

- 仓库已有：`tests/ux/_canvasHit.mjs:71` 的 findCanvasBlankPoint 和 `tests/ux/_canvasHit.mjs:236` 的 findNodeHitPoint 都以 elementFromPoint 确认命中归属。本次沿用该 owner，新增节点/侧别限定的外侧热区命中，不抄另一套几何助手。
- 卡片层叠已有：`src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:278` 的 isolate 与 `src/workbench/generationCanvas/nodes/NodeResultStack.tsx:342` 的局部 z-14 说明托盘不能跨越外层 source 的 z-8。修复放在共享 RF 节点壳的绘制顺序，不逐个 kind 补特例。
- 依赖已有：`node_modules/@xyflow/react/dist/style.css:247` 的原生 Handle 样式与仓库 `src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowNodes.tsx:89` 的 isConnectableStart/isConnectableEnd 继续拥有连接手势；官方契约 https://reactflow.dev/api-reference/components/handle 已在原根因合同核查。本次仅调整本地绘制层级，不新增框架 API 或替代连接内核。
- 本次没用 TikHub，因为这是已复现的本地 DOM 命中与旧走查消费契约问题，仓库真实 Electron 证据能直接证明因果；不编造自媒体来源。
- 结论：用已有 RF Handle 与 _canvasHit 共享命中方式，保留全部用户任务断言。此节是在门岗提示后补齐的既有调查记录，不声称此前文档已完整。
