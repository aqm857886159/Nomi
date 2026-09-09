# 左侧栏设计成文与拆解表节点实施

> 🚧 状态：已实施，最终验证与 PR 交付进行中（2026-09-10）。
> 依据：用户 09-08 A/B/C 分组拍板与本轮任务书；设计源为 Nomi-handoff-20260909 本地导出。
> 本单：三组设计成文；B 第一项 shot_table。A 左侧栏、框工具、C 过程反馈仅记录，不实施。

## 先查别人

- 依赖已有：React Flow utility classes（https://reactflow.dev/learn/customization/utility-classes）；既定方案 `2026-09-07-storyboard-table-node.md` §2 实查了 nodrag / nowheel / 项目 no-pan。复用现役 NodeResizer 和节点注册，不建交互内核。
- 仓库已有：`src/workbench/creation/storyboard/shotRow/shotRowModel.ts:78` effectiveShotValue：plan 默认、原始镜头显式 override 优先；`exec/storyboardProjection.ts:68` 与 `workbenchDocumentSlice.ts:300` 已有写入投影桥。不复制 rows，不加同步循环。
- 生态已有：既定方案 §2.3 核对 Krita `libs/ui/StoryboardItem.h:181` / `StoryboardModel.cpp:1210` 的位置耦合、Storyboarder `src/js/models/board.js:79` 稳定身份。列按 columnId 稀疏存储、行身份独立于排序。来源 https://github.com/KDE/krita 与 https://github.com/wonderunit/storyboarder 。
- 用户实践已有：既定方案 §2.4 的 TikHub 实抓记录 https://www.douyin.com/video/7658695151618952474 支持横向扫镜头结构；本轮只复核既有证据，不声称重新抓取。
- 反方只读复核：本轮 prior_art 独立审查确认 lesson 记设计意图，与现役 plan + override 兼容。旧方案 raw plan selector 须消费 effectiveShotValue，才不丢手改。

## 实施边界

1. 导出 14 张画板 PNG，三组分别规格/差异/实施次序成文。
2. 注册 shot_table 与跨进程 schema；storyboard source 只持来源及视图，deconstruction source 自持事实。生产行从既有 owner 和节点有效值派生。
3. 文稿拆解写入方案时产生来源唯一的表节点；双击行回现役全页编辑并定位，既有方案写入桥同步镜头；不在节点重造提示词编辑器。
4. 表节点三档密度、稳定行、内滚与选中、参考槽按 mode.slots、状态按 deriveShotRowExec。实验室使用生产组件与宿主 store。

## 不动项与回滚

不改 A、框工具、C、v6 视觉、beat 语义、供应商能力；不碰用户真实资料库。撤销本单提交回滚代码；删除表节点不删除方案 owner。持久化 schema 必须拒绝无效来源，禁止把表降级成图片。

## 验收与交付

结构/有效值/持久化单测；specimen 与基线；隔离 Electron 实走文稿拆解→表节点→全页改一行→镜头同步，前后截图进 PR。执行 `python3 scripts/with-gates-lock.py -- pnpm run gates`，等锁；整合最新 origin/main 后 scoped commit/push/PR，不跳 hook，不改断言/超时换绿。写 sidebar-doc-LAST.md 并复制指定 scratchpad。

## 实施对账

- 事实表替代旧拆解右栏：沿用真实切点/视觉/对白引擎，阶段来自主进程事件，requestId/projectId 匹配；旧右槽、角标、旧铺图函数删除。
- 生产表读穿 effectiveShotValue；不存 rows。参考片表自持 columns/rows，列按 ID 改名/删除不串值；事实进入生产方案是显式一次采用，重复采用复用稳定来源身份，保留用户修改。
- 选中生成沿现役 runStoryboardBatch/confirmAndRunPlan，表批次落地共用一个手势与撤销；已有用户节点和分组不能被重建或挪走。
- 原稿全页仍是提示词唯一编辑入口；表行双击使用稳定 shotId 导航，隐藏挂载的全页不得提前消费焦点请求。
- R13 首轮暴露 Agent 提议写表缺少事务上下文：setStoryboardPlan 新增画布投影后必须在既有 inCtx 内同步调用，否则取消自身提议。批修覆盖 propose 与 patch_shots，不另建同步系统。
- 历史 `tests/ux/deconstruction-panel.walk.mjs` 与 `tikhub-project-video-breakdown.e2e.mjs` 断言右栏互斥/旧铺图，和用户批准的画布表替换有语义冲突。本单不删减或放宽这些走查断言来换绿；新旅程验证新表，旧脚本执行状态在交付报告如实列明。

## 六角色复核

CTO：两个来源 owner 与节点 override 边界保持，生成入口重用现役事务。设计：三档密度同组件，32px 行与关键帧、状态末列，原稿只读投影。PM：A/框/C 不实施，事实采用与生产生成分开。前端：React Flow useStore 分档防视口每帧刷新，全页可见后消费焦点。后端：共享 schema、有效项目资产引用、异步请求代际保护。用户：一眼横扫结构、双击改行后镜头同步，失败可单镜重试，删除表保留原稿方案。

## 最终走查补修

- 真实 React Flow 默认缩放下限使卡片档不可达；宿主、适应视图与滑条现在共用既有 20–300% 范围。真实 Home 到 20% 已验卡片。
- 旧项目迁移按 shots 分类重排编号会把表也算镜头；复用现役 isShotNumberedNode/backfillShotIndexes，仅补缺失身份，已有镜号保留。UI 复制方案与冷启动均确认新表无镜号。
- 详细验收证据与脚本中断/同项目续验边界见 [真实用户走查](../audit/2026-09-10-shot-table-storyboard-walk.md)。
