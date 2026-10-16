# 密画布 DOM 修复与性能收据

实施/测量线：`/root/dense_canvas_repro`。本报告不代替另一条线的独立验收；协调线将对实际整合后的候选独立重跑 lifecycle。用户原项目未取得，以下是隔离 profile 中的真实 Electron 复现。

最终生产改动只有两处：删除固定三容器 alias 的永久 subtree observer；编辑态取消 BaseEdge 自带的重复透明 hit path，保留原 accessible hit（只读态保留框架原30px层）。stock React Flow、可见元素裁剪、全部参考边、节点数据均保留。尝试过的库缓存/overscan和全量渲染消融没有足够收益，已全部撤出，package/lock未修改。

| 类回归 | 红灯 | 最终绿灯 |
| --- | --- | --- |
| 真实 DOM 子树增删 | 6次全host alias扫描 | 扫描0；三alias存在 |
| 同一编辑连接的透明hit owner | framework1 + accessible1 = 2 | framework0 + accessible1 = 1 |
| Enter选择→点击×断边→CmdZ恢复 | 新增保留行为回归 | 全流程实际操作成功，alias仍在、扫描0 |
| native BaseEdge、全部注册edge view | 新增保留行为回归 | 6个unit测试绿；编辑态单accessible，readonly单framework |

最小红绿：[alias红](../evidence/2026-10-17-dense-canvas-rendering-ownership/alias-scan-red.json)、[重复hit红](../evidence/2026-10-17-dense-canvas-rendering-ownership/duplicate-hit-red.json)、[最终真实交互绿](../evidence/2026-10-17-dense-canvas-rendering-ownership/ownership-green.json)。外部stdio落卡/生成/结果尺寸变化/刷新四阶段alias由协调线的WorkBuddy链覆盖。类别切换仅核查同host的无条件ReactFlow结构，未独立操作该UI，不记为真实旅程已验。

300图片/3000参考边使用4张仓库真实AI抽帧重复URL以隔离边/DOM成本，不是300张不同高分辨率图片解码实验。窗口1600×1000、zoom0.2、约180个node挂载；最终记录2430条edge挂载。以下两批最终数字都保留，不能择优报告。

| 无profiler5runs | pan样本p95中位 / 长任务中位 | wheel样本p95中位 / 长任务中位 |
| --- | --- | --- |
| before | 28.5ms / 10 | 50.5ms / 14 |
| 最终工作区原始批 | 16.6ms / 7 | 27.5ms / 4 |

原始before load3.9–8.6、after3.1–3.7；wheel最终首样36.1ms仍超33ms目标。存在明显宿主竞争/冷暖差异，不能把全部降幅归因于两处删除。

| 正式登记器（各5runs） | 主指标中位 / 跨样本p95 | 长任务中位 / 跨样本p95 | verdict / exit |
| --- | --- | --- | --- |
| canvas-dense-edges-pan | 14 / 14.1ms | 0 / 0 | ok / 0 |
| canvas-dense-edges-wheel-zoom | 19 / 25.1ms | 0 / 5.6 | ok / 0 |

正式登记器load4.3–4.6；wheel首样7个长任务（最长76ms），其余四样0。当前登记器只用主指标**中位**判33ms预算，但工程0长任务目标没有在所有已观察样本中达成。[逐样本原始输出](../evidence/2026-10-17-dense-canvas-rendering-ownership/registry-samples.json)保留非零首样。

原始收据：[before5](../../tests/perf/results/canvas-scale-dense-3000-edges-before-5-20261017.json)、[final5](../../tests/perf/results/canvas-scale-dense-3000-edges-final-5-20261017.json)、[pan登记器](../../tests/perf/results/canvas-dense-edges-pan-registry-20261017.json)、[wheel登记器](../../tests/perf/results/canvas-dense-edges-wheel-zoom-registry-20261017.json)。baseline已由真实命令更新并标noisy。`commit=49fa5d949`是测量时base HEAD加未提交工作区（含root composer修复），不代表固定PR提交；CI必须验实际PR HEAD。

未验证：用户原项目、Windows、发布包和独立高分辨率解码规模。已实现两处可证明的重复工作删除和类回归，不能称整个大画布问题已彻底解决。
