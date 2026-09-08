# 画布磁吸把手回归修复

🚧 进行中

## 范围与用户合同
用户已指定恢复既有磁吸图标/112px 外侧热区，不做新视觉提案：未选中时进入任一侧热区才显示该侧图标；text/video 与 image/asset/图片类走一个合同；panorama/折叠组代理不作为起点。拖入目标外侧热区，RF 预览与最终线停在该侧边缘；离开继续随指针。正文松手保留现有解析。

2026-09-08 22:01–22:46（Asia/Shanghai）每约 120 秒查询 PR #653，45 分钟仍 OPEN；按用户授权从 be6d4d848 主线开工。开工三行和 delivery:preflight 已通过。主线此刻没有 CanvasBatchConnectionLine.tsx；交付前再次核对该前置。

## 先查别人
- Context7 `/xyflow/xyflow`（2026-09-08 query-docs）：https://github.com/xyflow/xyflow/blob/main/packages/react/src/types/component-props.ts 提供 connectionRadius，默认 20。大圆会覆盖卡片正文，不符合矩形外侧热区；保留默认值。
- 官方 https://reactflow.dev/api-reference/components/handle ：isConnectableStart / isConnectableEnd 分开声明。已安装 @xyflow/react 12.11.5 的 dist/esm/index.mjs:1863–1990 将命中与连接合法性留给 XYHandle。
- 官方 https://reactflow.dev/api-reference/types/connection-line-component-props ：toX/toY 是内核解析后的端点；toNode/toHandle/connectionStatus 可证明已吸附。渲染单线或批量线都应直接消费这份坐标，不重算指针目标。
- 官方 https://reactflow.dev/api-reference/types/on-connect-end ：connectionState 提供最终目标；保留 useGenerationCanvasReactFlowMenus.ts:235 的正文分支。
- XYFlow 最近邻是框架自身连线实现：@xyflow/system dist/esm/index.mjs:2601 的 isValidHandle 优先 elementFromPoint 得到的 Handle，然后才用半径候选。热区用 Handle 伪元素（命中返回 Handle 本身），锚点仍 1px；因此无需第二套指针逻辑或目标状态。

## 取舍与边界
| 方案 | 用户看到 | 代价 |
|---|---|---|
| RF Handle 外侧命中区（采用） | 只在外侧矩形内吸到侧边 | 沿用 1px 锚点，伪元素只在连接期间可命中 |
| 扩大 connectionRadius | 正文/上下也提前吸附 | 与明确的外侧热区不符，排除 |

能力四列：框架提供 Handle 命中/最终连接状态/吸附坐标；我们使用原生 Handle 和预览；不另写命中扫描/指针内核；不拆散目标与提交状态。没有引入依赖或框架新层。保留 12.11.5，未来升级必须重跑三条走查，若伪元素命中优先契约改变再调整适配。

六视角自审：CTO 单内核；设计沿用现有图标仅热区 reveal；PM 不要求先选中；前端只用 RF 目标态；后端不改持久化/正文解析；用户单线与多线在松手前看得到真实落点。

## 根因与同类扫描
症状为先选中才出现，直接原因是 visual contract 的 primarySelection 和图片 kind 门；类根因是将迁移前代码当成体验规格。另一半症状是外侧热区没有 RF 目标命中，预览停在指针。统一由 visual contract 和 GenerationFlowConnectionHandle 两个共享边界负责。
扫描 source/target 双侧、text/video/image/asset/图片类、panorama/折叠组、readOnly、pending source、正文松手。引用 docs/fixes/2026-09-03-canvas-connect-regression.root-cause.json：该合同解决正文落点，不证明外侧 hover/吸附。

## 交付与验收
1. 契约红→绿、删除 dot 及 CSS，第一笔 commit。
2. RF 原生目标热区、侧别高亮、红→绿走查，第二笔 commit。
3. 三张截图人眼审查、性能对比、经验文档，第三笔 commit。
4. pnpm run gates，tokens/vocabularies/heavy-path 不增；M 规模 blank-pan/wheel-zoom/node-drag-image 各 3 次+1 warmup；隔离 Electron 真实走查。

不动 nodes/**、agentLane/**、ai/lane/**、canvasConnectionDropTarget.ts、依赖与框架包。回滚用任务 commit 的 git revert（不回写主分支）；仅创建任务 PR，不合并。

## 进度证据

#653 随后合入，已通过 git merge 整合真实 origin/main 82c671203。契约 7 项先红后绿；第一笔 733196352。真实 Electron 三条任务初步通过，截图逐张人眼核对。追加离开热区恢复自由端点断言。持久边任意指定侧涉及范围外模型，已询问用户；未擅自扩范围。


## 最新主线与性能隔离
交付前整合 #654：主线 60f9123c3，按 upstream 锁文件恢复依赖，不新增项目依赖。初步对旧 be6d 基线的脚本耗时有约20ms上升，因此把8个把手状态订阅收敛为每卡一个标量订阅，并在隔离 sibling checkout 上以 60f9123c3 做同源前后性能对照。
主线红测三项：未选中加号0个；单线预览离侧边60px；多选外侧热区不起线。修复版同三任务、离开/重新进入热区、松手 edges +1/+2 与侧边几何均通过。测试选择节点后等待真实布局安定，再取下一点；隔离 Electron 忽略共享桌面的物理鼠标，Playwright CDP 正常驱动真实 RF 事件（https://www.electronjs.org/docs/latest/api/browser-window#winsetignoremouseeventsignore-options）。
截图人工检查：只有当前 hover/连接的把手可见；目标加号中心落在卡片边缘；批量角标×2与同一吸附端点同时存在。画布布局、卡片内容和正文解析未改。

性能结构收敛：每卡一个标量 RF 订阅；目标热区空闲时 pointer-events:none，目标图标 DOM 只在该端口实际高亮时渲染。保留原生 Handle 的 1px 固定锚点，避免把所有目标图标挂在静止画布。


## 最终验收记录
- 官方 RF 12.11.5 Handle 命中优先，connectionRadius 默认20保留；目标伪元素命中返回 Handle 本身，锚点不扩尺寸。批量组件无需改写。
- 7项契约先红后绿；60f9123c3 的三条 Electron 对照均红，修复版均绿，离开/再进入热区与松手 +1/+2 都测到。最终三张图已逐张人工检查。
- `pnpm run gates` 首轮通过：1289个测试文件、11986项测试；后续运行时306项、统计13项等通过。最终提交继续按最新主线复验。
- M规模每场景3次+1预热，同机同主线60f9123c3，性能预算全通过；长任务均0。FPS（平移/缩放/拖动）120→120.2 / 120→120.2 / 118.9→119.5；P95帧间隔中位数10.3→10.4 / 9.8→9.6 / 10.4→10.2ms。
- 脚本耗时中位数107.9→117.3 / 86.0→72.1 / 142.2→138.4ms；合计336.1→327.8ms（-2.5%）。平移单项+8.7%，不声称每个指标严格不升。原始采样路径见证据目录 performance-summary.json。
- 未扩范围：任意远侧端口的持久化仍待用户授权；现有适配器松手后按相对位置选边。本次已证明相向侧最终端点和所有目标热区的实时吸附，不能把任意远侧固定端口称为已完成。

证据目录：[canvas-magnetic-handle-evidence](canvas-magnetic-handle-evidence/)。生成请求0，付费模型调用0；Ponytail提交/推送评审按项目hook执行。
