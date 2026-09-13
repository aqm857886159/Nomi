# PR #658 CI round5：能力一致性与时间轴取证

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：两处修复已通过定向验证与完整 gates，待正常提交推送。仅在指定 worktree / feat/process-feedback-phases-20260908 推进。

## 范围与不动项
性能等待场景从产品共享能力边界派生 fx/静态数量；时间轴先跑完整 2/2 与 1680×993 独立场景，记录状态与点击，不预判原因。不改产品布局、reactFlow/**、断言强度、超时或 CI 分支。保留已有未提交资料。

## 初始事实与假设
- useReducedProcessMotion.ts 软件渲染/无 WebGL 降级；waitingFxScenario.mjs prepare/cleanup 均写死 4 个 fx。分类 recurring，遗漏硬件能力作为测试前提。
- canvas-real-suite.mjs 每个场景 spawn 独立进程；_launchApp.mjs 每次隔离 profile；batch-production 自己创建三个目录。因此同窗复用需实证，不能沿用猜测。
- GenerationWorkspace.tsx 展开入口只受 timelinePanelCollapsed 控制，无宽高阈值；同类入口包含展开按钮、addAssetToTimeline、adoptionReceipt。
- preflight 已执行，因既有 PF-LAST 与未跟踪证据报 dirty_worktree；按任务书保留并继续原分支。提交前刷新并整合 origin/main。

## 验收与回滚
保留性能软件红、软件/硬件绿日志；时间轴顺序运行和相同视口证据，明确实际原因再修。两条能力分支都验证计数与卸载，不跳过。变更收敛后完整加锁 pnpm run gates exit 0，再正常 commit/push 既有 PR；不提交 LAST/PF-RULINGS。回滚为撤回本轮 scoped commit，不重写历史。

## 时间轴实证结论
完整分片 2/2 改前 7/7，前序 node-context-menu，不复用 profile；macOS setBounds 1680×1020 实际页面仅 1680×840。明确 setViewportSize 1680×993 后原断言稳定失败：固定 stage (900,100) 点击的日志是 `加入时间轴（点击贴尾 · 拖拽自选位置）`，末尾 count=0 / timelines=1 / expanded=true。因此 (a)(b) 均非根因：测试误点击产品采纳动作，正常展开时间轴。

修在走查动作边界：clearSelection fallback 与全选前点空白统一复用 _canvasHit.mjs/findCanvasBlankPoint，删除坐标猜测和吞错；保留 1680×993 作为跨平台回归输入。点击后立即验证展开入口仍在，末尾原断言不变。无需改生产文件或新增布局补丁，reactFlow/** 零改动。同类扫描：canvas-shortcuts.walk 已用共享命中函数；本 walk 两处漏接现已统一。属于 recurring 测试几何假设失败。

## 现有标准与依赖决策
本轮不新增外部格式或框架层。复用项目 _canvasHit.mjs 的 pane 白名单，不自建几何规则；motion 分类是应用自身策略，WebGL/React/img-fx API 与版本均不变。能力观测与纯分类拆开，Electron 测试通过已有 tsx 加载无 React 依赖的同一模块，在页面执行观测、Node 执行纯分类。删除历史 PF_FX_BASELINE 跳过分支。

## 定向收据
- perf-software-red.log exit 1：原 warmup/sample 均计数失败。
- perf-software.log exit 0：SwiftShader，初始 0 fx/8 静态，交接后 0/4，离屏与清理 canvas=0。
- perf-hardware.log exit 0：真实 Apple M5 Metal，初始 4/4，槽位交接后 4/0，离屏与清理 canvas=0。
- timeline-sequence-red.log exit 0：原顺序 2/2=7/7，页面 1680×840；文件名沿用取证阶段，明确不是红证据。
- timeline-red.log exit 1：1680×993 原逻辑误点加入时间轴，末尾入口 0。
- timeline-green.log exit 0：相同视口、真实空白命中，原断言通过。
- focused-green.log：共享能力与 canvas suite 22 项通过；无真实模型请求，费用 0。

- 整合 main #666 后完整 2/2 再次 7/7，timeline-sequence-green.log / full-2of2-summary.json；同一 Linux 视口场景绿。实际截图 timeline-green-dock.png 显示底栏与展开入口各有空间。

## 完整 gates
指定加锁命令 exit 0，日志 ci-round5/gates.log，摘要与测试文件 SHA256 见 gates-receipt.json。76 contracts：73 通过、0 阻断、3 advisory；视觉 153/153；Vitest 12110 通过、2 跳过；完整构建通过。无 CI 特判、无延长等待、未修改产品布局。
