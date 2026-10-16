# 密参考边画布：删除重复 DOM 工作

负责人：`/root/dense_canvas_repro`。这是现有适配层的纯修复，没有新界面、生成步骤或依赖补丁。

| 设计卡 | 决定与证据 |
| --- | --- |
| ★1 真实任务与指标 | 创作者在分镜与参考边较多的画布中平移、缩放、选中连接。仓库真实 AI 镜头抽帧的300图片/3000参考边稳定复现长任务；原用户项目未取得。无 profiler 5次before：pan p95 28.5ms/10长任务；wheel50.5ms/14长任务。预算33ms/0长任务，残余红灯必须保留。 |
| ★1b 连带界面 | 不改文案、参考边、节点布局、生成参数或付费门。 |
| ★2 谁说了算 | React Flow拥有固定viewport/edges/nodes容器。Nomi仅在host mount赋3个兼容class。每条可编辑边的自有accessible hit path是唯一交互入口；只读边保留框架原hit layer。 |
| ★3 一致与复用 | 保留stock @xyflow/react12.11.5。直接删除永久subtree MutationObserver及编辑态重复透明hit path。实验性的框架几何/可见投影cache没有过预算，不进入交付。 |
| ★4 全状态 | 空画布、外部落节点、生成结果回写和刷新都保留3个alias；卡片/边DOM变化不重扫host。可编辑边保留原30px命中、Enter/Space键盘及ARIA。只读边仍保留框架30px层。 |
| ★7 性能 | 在既有canvas-scale-bench增加I300DENSE规模；pan/wheel场景登记预算33ms。只在采样结束后记录mountedEdges，沿用原CDP heap/load指标，不在每帧增加探针。最终5runs原始数据与before一起交。 |
| ★9 验收回滚 | 真实Electron最小红灯：2次childList变化触发6次全host alias扫描；同一编辑边有2条透明hit。绿灯scan0、总hit1、accessible1，并实走Enter选边→点击×断边→CmdZ恢复。native BaseEdge SSR覆盖只读/编辑两态。外部stdio整条链检查四阶段alias，并有双语控件实际命中。回滚两处源码与对应回归，不涉及数据。 |

数门：`door-map useGenerationCanvasReactFlowHostEffects`仅发现`GenerationCanvasReactFlow.tsx:284`；`door-map GenerationFlowEdgeView`仅发现现有edgeTypes注册。继续一跳核查：`GenerationCanvasReactFlowViewport`无条件渲染ReactFlow，三容器在父useEffect前已提交且随host同寿；正常/编组聚合参考边均使用同一edge view。

直接机制及红绿证据：

- `outputs/canvas-container-alias-lifecycle/before/report.json`：alias扫描6次，初始和最终alias均存在。
- `outputs/canvas-container-alias-lifecycle/duplicate-hit-red/report.json`：framework1 + accessible1 = 2条hit。
- `outputs/canvas-container-alias-lifecycle/single-hit-stock-green/report.json`：scan0、framework0、accessible1。
- `tests/ux/canvas-container-alias-lifecycle.walk.mjs`：真实Electron/真实媒体；无需供应商key或用户项目。

实验边界：原始profile先定位到框架几何订阅，随后通过实际bundle三入口失效矩阵探索缓存；其pan脚本时间明显降低，但wheel和长任务预算没有闭环。单独与联合overscan实验也没有足够收益，最终全部撤出并恢复stock三个入口，package/lock未变。框架缓存候选及profile只保留为本地调查附件，不能当最终预算绿灯。累计事件探针明确本次pan/wheel没有hover控件不断换宿主（pan mount0/leave1；wheel enter/leave/mount/remove全0）；早先“峰值1因此排除churn”的推理已撤回。

限制：300/3000是参考边压力场景，使用4张真实抽帧重复URL以隔离DOM/边成本，不代表300张独立高分辨率图片解码能力。原用户项目、Windows和发布包未验证。最终预算仍红时，只能报告已实现的两处冗余删除和实测改善，不能把整个大画布问题标成已解决。

最终正式登记命令（真实媒体目录通过 `NOMI_CANVAS_PERF_REAL_ASSET_DIR` 注入，image-only声明保留）：

```sh
pnpm run perf:scenarios -- --id canvas-dense-edges-pan --update-baseline --noisy --out tests/perf/results/canvas-dense-edges-pan-registry-20261017.json
pnpm run perf:scenarios -- --id canvas-dense-edges-wheel-zoom --update-baseline --noisy --out tests/perf/results/canvas-dense-edges-wheel-zoom-registry-20261017.json
```

登记器两项exit0、verdict `ok`：frameGapP95五样本中位/跨样本p95为pan14/14.1ms、wheel19/25.1ms，预算33。pan每样本长任务0；wheel首样7（最长76ms），其余0。登记器仅判主指标中位，工程目标仍包含0长任务，不能用这批较好结果抹掉原始final5的pan16.6ms/7长任务、wheel27.5ms/4长任务及首样36.1ms。宿主load before3.9–8.6、原始after3.1–3.7、registry4.3–4.6，有冷暖/竞争差异。

登记器 `baseline.commit=49fa5d949` 是测量时HEAD，测的是该基线加未提交的本PR工作区（两处性能删除、root composer修复并存）；不是已提交候选或真实PR HEAD收据。正式CI/合并收据应验后续实际commit。

`onlyRenderVisibleElements=false` 官方API消融也未采用：300节点/3000边同时挂载，wheel最长长任务235ms、一次触碰300节点，heap151.7MB；原候选只挂180/2430、对应heap中位126.9MB。诊断原始数据保留本地`.tmp`，最终Viewport源码和stock三个依赖入口均已恢复。
