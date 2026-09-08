2026-09-09 版本托盘回归修复：引入点 src/workbench/generationCanvas/reactFlow/generationCanvasReactFlow.css:76（节点壳新增层叠边界导致托盘视口判定异常）；修法：节点壳显式 isolation:isolate + overflow:visible，保持把手层级隔离且托盘可溢出参与边缘避让。
验证：canvas-card-stack.walk.mjs PASS；两分片/critical/magnetic 待 gates 汇总。

2026-09-09 CI 消费契约修复：更新 4 份走查（gestures / card-stack / S5 / group-ports）及共享 _canvasHit。
critical：PASS 4/4；magnetic：3/3；单独 gestures：通过；S5：通过。hover 与版本托盘截图已人工查看。
CI 原红 run：https://github.com/aqm857886159/Nomi/actions/runs/34248853729
附带真实 bug：source 热区挡住视频版本按钮/托盘；仅修 RF 节点壳绘制顺序和层级，target 热区保留高层。无强制点击、无 skip、未放宽断言。
本次证据：outputs/canvas-acceptance/critical/summary.json；/tmp/mh-{critical-green,magnetic,gestures,s5-final,gates}.log。

PR：#656 https://github.com/aqm857886159/Nomi/pull/656 （draft，未合并；HEAD已推送）。
分支：fix/canvas-magnetic-handle-hover-20260908
任务提交：733196352（契约）/ 5d3f639c1（吸附）/ 63b62abfc（走查与性能）
基线：60f9123c3；#653 等待45分钟超时，随后已整合 #653/#654。
RF 12.11.5：原生 Handle 外侧伪元素命中，固定侧边锚点；https://reactflow.dev/api-reference/components/handle
预览共用 RF toX/toY/toHandle/toNode/connectionStatus：https://reactflow.dev/api-reference/types/connection-line-component-props
红→绿：未选中hover加号0→1；单线离侧边60px→<3px且+1边；×2外侧失败→吸附且+2边；离开恢复跟随。
截图（均已Read）：docs/plan/canvas-magnetic-handle-evidence/green-{01-hover,02-single,03-batch}.png
性能FPS（M·3次+1预热）：120→120.2 / 120→120.2 / 118.9→119.5；预算全通过，长任务0。
脚本ms：107.9→117.3 / 86.0→72.1 / 142.2→138.4；合计-2.5%，平移单项+8.7%，不称每项严格不退。
验证：最终gates绿（HEAD 63b62abfc；75项合同，11992项Vitest通过/2跳过）；tokens/vocabularies/heavy-path未增。
未完成：任意远侧端口松手后固定需扩边模型/持久化，超出限定目录；已询问范围，未收到授权。
费用：生成/付费模型调用0；Ponytail经正常hook。雷达apimart新增1，apimart-llm凭据解密失败；论文技能本机未找到。
2026-09-09 第四段假设结论：假设成立。GroupFrame 原先没有 `MagneticConnectionHandle`，按下热区命中组框壳并进入 node-drag；节点卡/折叠组卡才复用共享把手组件。根因：`src/workbench/generationCanvas/components/GroupFrame.tsx:45-170` 缺少共享连接把手与 `nodrag` 命中边界。修法：GroupFrame 接入同一 `MagneticConnectionHandle`，由 `CanvasGroupProjectionLayer` 传入同一 `onStartGroupConnection`，把手容器标 `nodrag` 并阻止壳层 pointerdown 冒泡。
