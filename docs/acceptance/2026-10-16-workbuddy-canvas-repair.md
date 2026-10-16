# 独立验收：密集竖图画布的生成控件可达性

验收线：`/root/dense_canvas_repro`；实现线：`/root`。基线 `49fa5d9494c537932f2fa90e6bb551eedb12b12a` 加当前未提交 composer selection reveal 实现，macOS arm64。

## 红灯与根因边界

- 原始现役基线（实现前）的真实 Electron 探针：60 节点、300 参考边、每节点 3840 字提示词，模型浮框屏幕 x=-28.6，部分模型控件被画布左边裁切；长提示词本身在 199px 滚动口内滚，scrollHeight=2254，没有复现文字越界。同类协议红证见 `docs/evidence/2026-10-16-workbuddy-canvas-repair/workbuddy-red.json`。
- 已安装 Nomi 0.23.0 的独立回归红灯：相同真实竖图夹具，模型控件 rect x=-135,width109，中心落在视口外，elementFromPoint=null。`outputs/dense-canvas-generation-controls/independent-red-installed/zh-CN/report.json`。这是同类可达性失败，不冒充用户原项目重现。
- 字体/卡片“大片缺失”的初始 PNG 是取证伪影：macOS 原生遮挡只保留 damaged tiles；完整重绘后恢复所有卡片和文字。未把这些无效 PNG 记成产品 bug。

## 独立回归结果

`node tests/ux/dense-canvas-generation-controls.walk.mjs zh-CN independent-final`：16 项通过。
`node tests/ux/dense-canvas-generation-controls.walk.mjs en independent-green`：16 项通过（之后测试只增加 runtime 取证字段，无行为改动）。

夹具：60 张真实 AI 镜头派生的 360×640 竖图、300 参考边、3840 字提示词、三版结果。重复使用同一真实图片，所以不代表大量不同高分辨率照片的解码压力。所有项目、设置、userData 均隔离，无生成调用/无费用/不触碰真实用户项目。

检查：左边缘和底边缘选中后模型/生成按钮真实命中；整卡在可用舞台内；长提示词内部滚动到底；重复点击不漂视口；版本宫格开合与 composer 互斥、还原后可达；用户平移不被抢回；从未选中邻卡起拖不触发 reveal；两个拖动态都正常释放；无 renderer errors。

底缘 geometry：stage=(60,40)..(1272,889)，composer=(68,417)..(628,817)，prompt clientHeight=199/scrollHeight=2254。底栏留出 72px 现有画布控件空间。

已亲眼核对中文左缘与英文底缘两张截图：
- `docs/evidence/2026-10-16-workbuddy-canvas-repair/dense-zh-green.png`
- `docs/evidence/2026-10-16-workbuddy-canvas-repair/dense-en-green.png`

## 性能现状与未验证项

改动前、同机真实 AI 镜头抽帧、现有规模量具（未启 profiler），每项 1 次：

| 节点/边 | 操作 | FPS | p95 ms | max ms | 长任务 |
| --- | --- | --- | --- | --- | --- |
| 60/30 | 拖 1 卡 | 120.0 | 10.3 | 14.5 | 0 |
| 60/30 | 平移 | 120.0 | 9.4 | 10.1 | 0 |
| 60/30 | 滚轮缩放 | 119.9 | 10.7 | 14.5 | 0 |
| 300/150 | 拖 1 卡 | 120.2 | 10.9 | 14.3 | 0 |
| 300/150 | 平移 | 119.7 | 10.5 | 18.5 | 0 |
| 300/150 | 滚轮缩放 | 106.3 | 13.9 | 179.0 | 0 |

原始 `tests/perf/results/canvas-scale-dense-canvas-red-20261016.json`；缩放存在一次179ms尖峰，单样本不能确认持续卡顿，也不能说用户所报卡顿已修。未验证 Windows、用户原项目、独立高分辨率素材。

额外 300节点/3000边 profiler 样本不能作为预算判据；新实例期间构建曾更新且 wheel 启动失败。预算以之后无profiler5轮与登记器收据为准，不以失败样本或原型单测替代。

## 协议到生成闭环（实现线记录）

签名 WorkBuddy stdio client → `nomi_session_open` → `nomi_canvas_edit(create_canvas_nodes)` → GUI确认落3个image节点 → 选中下缘第3镜 → 模型/参数/生成DOM真实命中 → 点生成 → provider POST恰好1次 → 结果落同一节点、节点变高后全部按钮仍命中 → renderer reload仍存在。落卡与选中阶段POST=0。`workbuddy-chain-green.json`保存对应节点身份、请求与持久结果。采用声明式免key本地gateway和内置image codec，网络guard封公网；没有改动生产确认或运行归属。单用户单镜的点击本身就是现役确认，不额外弹一次确认。

这是 WorkBuddy 身份与协议传输回放，不是 WorkBuddy UI/LLM 自主操作认证。WorkBuddy 5.2.6 的UI未成功发送诊断请求；安装Nomi 0.23.0只用于旧版同类红证，不据此称其为最新发行。未验证用户原项目、Windows或真实付费供应商。费用0。

## 自动回归接线

上述生成闭环、容器生命周期与中英文控件共4条旅程已登记在 `tests/ux/canvas-real-suite.mjs` 的 critical/full 清单及现有CI分桶，不依赖另起一份调度。几何边界13格矩阵、suite分桶13项单测通过。

## 生成后尺寸变化：追加红绿

只在初次选中露出还不够：真实stdio创建的第3卡生成成功后，从280px空态变成340px结果卡，挂载中的composer再次超出stage。`workbuddy-after-result-red.json/png`保留POST=1但after-result命中等待超时的证据。共享宿主依赖节点width/height后重新执行同一最小平移，`workbuddy-chain-green.json`记录同第3卡生成、最终composer bottom=817、动作栏bottom=804、全部动作命中及刷新持久结果；`workbuddy-after-result-green.png`已亲眼检查。没有增加viewport每帧订阅或ResizeObserver。

## 容器生命周期与密边性能（独立复审）

`/root`逐行复审两处生产删除：host effect保留一次三个class赋值；ReactFlow容器随host同步提交。编辑态保留原30px、role=button、tabIndex=0、click和Enter/Space处理；只读态仍保留框架原30px命中层。签名外部链在空画布、落3卡、生成结果、reload四阶段逐一断言三个alias存在。

最新闭环等待图片ready及生成/reveal层退场后截图；本地provider输出16×16实色PNG仅证明下载、解码、展示与回写，不能评价真实模型质量。root已亲眼核对`workbuddy-after-result-green.png`，没有把中途img-fx马赛克揭幕当成显示错误。

正式5轮before/after（各轮帧p95的中位）：平移28.5→16.6ms、缩放50.5→27.5ms；长任务中位10→7、14→4。after首个缩放样本36.1ms超33ms，仍有尾部尖峰；机器before load3.9–8.6，after3.1–3.7，改善幅度不能全部归因代码。全部原始样本保留；最终登记器收据另附。

完整密边实施收据与登记器逐样本输出见[密画布 DOM 修复与性能收据](2026-10-17-dense-canvas-rendering-ownership.md)。登记器pan14/14.1ms、wheel19/25.1ms均ok；wheel首样仍7个长任务，不抹去上一批残余。主线已整合至57cc1b09f（仅走查工具更新）；整合后仓库门岗及四条新旅程结果由PR验收栏记录。

## 本地全门视觉失败与干净主线对照

完整视觉检查179项，82通过、97失败。独立干净worktree在同一57cc1b09f（status为空）重跑这97个状态，97个全部失败；93个actual PNG逐字节一致。其余4个尺寸/几何一致、色通道最大差≤10：3个在干净主线自身复跑也重现相同变化；窄结果行53像素的微差保留未归因，不把它抹成零差异。见[对照收据](../evidence/2026-10-17-dense-canvas-rendering-ownership/visual-baseline-comparison.json)。

因此`pnpm run gates`不报全绿；不更新样张或放宽容差。本PR保持草稿，完整单元/构建与新增真实旅程另列实际结果。该对照只证明失败不是候选独有，不能替代视觉基线问题本身的修复。

## 最终宿主归属与整合回归

Anchor只发意图；宿主同帧判active/dragging/panning、量矩形、取消既有动画后duration0写视口，卸载/尺寸重跑取消待执行frame。原有placement禁令原样保留，最终focused37项、typecheck、lint:ci通过；四条新真实旅程在整合57cc1b09f后的最终宿主实现全部exit0（stdio生成闭环、Enter/断边/Undo生命周期、中英各16项）。证据PNG/JSON已替换为这次结果。独立线只读复审新归属并提出辅助平移guard，已采纳。

完整初版Vitest：18681通过，placement结构禁令失败后以上述宿主收敛修正，focused37项转绿；generatedMediaDecode夹具另因本机FFmpeg没有WebP编码器而未运行27例。这两种失败分开记，未称最终整库全绿；最终候选完整unit由PR CI再验。

原报告保持reviewed；两份机制合同的detected_by按实际证据来源记录walkthrough/review。调查由用户触发，但独立复现不是原病例认证，原项目/类型未知和极密长任务不能结账。本PR只交已实证修复，不给原报告伪造fixed或合入PR号。
