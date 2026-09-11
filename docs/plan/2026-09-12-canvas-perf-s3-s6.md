# Canvas performance S3/S6

## 先查别人
调查报告 §4 记录了 React Flow 官方建议：把高频派生数据移出 nodes 数组并按 id 订阅，避免每个节点扫描整表。React Flow 官方性能文档（https://reactflow.dev/learn/advanced-use/performance）同样要求稳定、窄订阅；本实现据此删除节点组件的整表选择器。

## 范围
补充全选拖动、组框拖动、缩放滑杆门岗；滑杆取消连续动画；节点状态改为按节点订阅。

## 不动项
不改组框手搓拖动内核、LOD、边渲染和按钮步进动画。

## 回滚
revert 本分支对应 commit 即可恢复。

## 验收门
I150 长任务 ≤3、I300 ≤5，FPS/p95 达报告 §6；滑杆长任务为 0；门岗三场景红→绿；真机 150 节点拖动截图留档。

## 修前/修后
修前数字来自调查报告 §2.1；修后由 `tests/perf/canvas-scale-bench.mjs` 同 harness 重测后填入 PR。
