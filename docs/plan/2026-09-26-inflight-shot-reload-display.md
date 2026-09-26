# 重开窗口后，在跑的制作镜头不再显示成空白节点（2026-09-26，v0.22.1）

> 状态：✅ 已实现（09-26 协调会话收尾：本机 Windows 走查修前红、修后绿） — 协调会话派工（真付费 T5 顺带发现 #4），协调会话定：修法 A、进本版。
> 根因合同：[2026-09-26-inflight-shot-reload-display.root-cause.json](../fixes/2026-09-26-inflight-shot-reload-display.root-cause.json)

## 用户那一刻卡在哪

真付费 T5（Seedance 两镜「全部」确认）：两镜都在供应商那边跑，重开窗口（EN）之后第 2 镜「Generating」，
第 1 镜却是一张空白的「Video node · Add an image first as the video first frame」——看着像没在跑。

零额度复现（`tests/ux/agent-inflight-shots-reload.walk.mjs`，loopback 视频任务压在 processing）：zh / en 两次重开都一样，
盘上两镜的 job 都还在 `polling`、节点落盘是 `running`，只有渲染层里的第 1 镜被收成了空闲。

**钱没有被重复扣**：↑ 与「生成全部」由制作 Run 判归属（#875，`canRunGenerationNode` / `eligibleGenerationNodeIds` 先查
`isNodeGenerationOwnedByProduction`），不看节点显示；重开后画布落地 store 在节点到场后 0–32ms 内就读回 Run。真付费 T5 重开后
底栏只算用户自己那个闲置节点。问题是节点**说假话**。

## 根因

`canvasSnapshotNormalizer.convergeStuckMidFlightNode`（每次加载快照都跑，窗口重开也算）把「没有任务号的生成中」当上次退出留下的
幽灵转圈，收成空闲。制作投影写的那条记录（`production-<jobId>`）**本来就没有任务号**——任务住在主进程的 Run 里——于是两镜都被收掉；
回不回得来全看事件尾巴：快照之后才开始生成的那一镜被尾巴重放写回「生成中」，之前开始的那一镜留在空闲。
主进程也不会补：跟随者按投影指纹去重（`canvasLandingHost.ts` 的 `projectedSignature`），窗口重开不重置它。App 完整重启时主进程是新的、
打开项目会整份补齐，所以只有「重开窗口」看得到。

类根因：「这个制作节点在不在跑」有两个写的人——画布自己的重开收敛（本地启发式，不知道制作记录的存在）和制作投影（#870 定的唯一写者）。

## 做法（修法 A）

1. 共享判定收进 `electron/shared/productionShotPhase.ts`（#870 定下的「制作镜头在画布上的运行状态」owner，主进程与渲染层都已经在读它）：
   `productionRunRecordId(jobId)`（主进程写 id）与 `isProductionRunRecord(record)`（渲染层认 id）。
   两处各写一份的 `production-` 字面量删掉（主进程 `multiShotCanvasLanding.productionRunRecordId`、渲染层 `PRODUCTION_RUN_RECORD_PREFIX`）。
   没照「从渲染层 multiShotCanvasLanding 导出」来放，是因为那个模块本身依赖画布 store，画布 store 的归一化器再引它会成环。
2. `convergeStuckMidFlightNode`：最新那条记录是制作投影写的 → 原样留着。同一个节点上用户自己跑的那一次（本地记录）照旧收敛。
3. 概念登记：「制作节点的运行记录由谁写」，owner = 制作投影（渲染层 `applyShotGeneration`，主进程 `buildMaterializeShotsPayload` 喂它）。

## 残余风险（为什么可以接受）

**Run 在窗口关着（或重开）期间结束了，节点会一直显示「生成中」，直到投影到来。** 可以接受，因为投影一定会来：
- **App 重启**：主进程是新的，`projectedSignature` 为空，打开项目时整份补齐（`canvasLandingHost` ③ reconcile）→ 结束 / 失败 / 出片 都会投到节点上。
- **只重开窗口**：主进程一直在跑。Run 的每次耐久变化都经跟随者投影（④ followRunChange）；投影时渲染层不在（正在重开）会失败，
  失败的那次**不记指纹**（`landOnce` 只在落地成功时写 `projectedSignature`），于是下一次变化照样投过来。
  变化已经发生、之后再没有变化的那一刻（极少：刚好在重开那一瞬间出片且之后无事件）才会一直停在「生成中」，下次打开项目时 reconcile 补上。
- 比起改之前「在跑的显示成空闲、看着像没跑」，「结束的多显示一会儿生成中」方向更安全：前者会让人以为没跑而想再点一次。

## 范围 / 不动项

- 不动 ↑ 被禁用时的原因文字（「先添加一张图片作为视频首帧」是另一张卡 T-CV-22）。
- 不动主进程跟随者的去重（修法 B 被否：两个写者仍在，还会闪一下空闲）。
- 不动花钱链路。

## 回滚

单 PR，revert 即回；无数据迁移（节点落盘本来就是 `running`）。

## 验收门

- 归一化器回归测试（改前红）：running / queued + 制作记录 → 原样留着；同一节点上用户自己的本地记录照旧收敛成空闲。
- 零额度走查 `tests/ux/agent-inflight-shots-reload.walk.mjs`：两镜「全部」确认、供应商压住 → 重开之前、zh 重开之后、en 重开之后，
  两镜都是「生成中」（状态行 + 等待画面），两镜 ↑ 都按不下去，底栏不提供它们；整场只有两次视频提交；放开后两镜都出片。

## 先查别人

- 收敛规则的 owner：`src/workbench/generationCanvas/store/canvasSnapshotNormalizer.ts:34`（`convergeStuckMidFlightNode`，重启收敛，写给画布本地运行的）。
- 制作投影的写者：`src/workbench/capability/multiShotCanvasLanding.ts:425`（`applyShotGeneration`，注释里已经预期「被收掉的照常续上」）。
- 主进程跟随者去重：`electron/productionRun/canvasLandingHost.ts:147`（`projectedSignature`）。
- 「制作镜头在画布上的运行状态」唯一 owner：`electron/shared/productionShotPhase.ts`（#870）。
- 依赖 / 生态：不适用——这是本仓画布与制作流程之间的约定。
