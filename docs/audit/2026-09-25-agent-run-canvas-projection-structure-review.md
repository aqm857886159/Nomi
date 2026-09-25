# Agent 付费卡「视频早出好了节点还在转」的结构评审：耐久事实在边界上被换成了进程内记忆

> 状态：已完成（2026-09-25）· 触发：`check:symptom-cluster`（electron/assets 4 份、electron/capabilityCore 26 份、electron/productionRun 17 份、electron/shared 24 份、src/workbench 58 份，7 天内）
> 对应合同：`docs/fixes/2026-09-25-agent-run-node-state-single-owner.root-cause.json`

## 这一份为什么落进五个桶

门岗按前两级目录分桶。这一份合同一次碰了五个桶，是因为「Agent 付费卡生成的镜头在画布上显示什么」这件事的链条本来就横跨它们：Run 的耐久账本（electron/productionRun）→ 供应商查询与产物取回（electron/capabilityCore、electron/assets）→ 两侧共用的判定（electron/shared）→ 画布节点与任务面板（src/workbench）。它不是五个问题，是一条链上的三个断点。

## 三个断点是同一种形状

| 断点 | 耐久的事实 | 被什么顶替了 | 后果 |
|---|---|---|---|
| 查询身份（capabilityCore） | Run 冻结合同里记着这笔任务的模型 / 模式 | 供应商实例内存里的 `selectionByTaskId` | 观察窗过后的重踢、重开项目、重启都换了新实例，查不了；Run 永远停在 polling |
| 节点运行状态（productionRun ↔ src/workbench） | Run 的 jobs[] | 渲染层自己轮询的一份 Run 快照 + 第二套画法；主进程只在出片那一下投递 | 同一个「在生成」两份真相，一份停了另一份不知道 |
| 产物取回（assets ↔ capabilityCore） | 「供应商产物怎么取」一份线路策略 | 三个调用方各写一组超时 / 上限 | 付费卡那一处少了超时与线路，大文件永远下载超时 |

共同的形状：**跨一个边界时，接收方没有拿到耐久的那一份，而是拿到了一份只在某个进程 / 某个实例 / 某个调用点里成立的替身**。替身在「一次跑完」的测试里永远正确（同一个实例交、同一个实例查；同一个进程投、同一个进程画），只在时间拉长（真视频 > 5 分钟）、进程换代（重踢 / 重开 / 重启）、多次生成并存时才露馅——而这些恰好是单元测试和短走查最少覆盖的情形。

## 本 PR 在结构上做了什么

- **把耐久身份放进边界签名**：`GenerationProvider.query(taskId, context)`，`productionGenerationSubmission.poll` 从冻结合同取值递下去。供应商实现里「调用方明说」这条路早就写好了，只是从没有调用方走过。
- **把判定搬到两侧共用的一层、把投影挂在唯一的持久化必经点**：`electron/shared/productionShotPhase.ts` 一个判定（穷尽 mapper），`canvasLandingHost.followRunChange` 挂在仓库 `execute` 的事件旁路上——所有状态转移都经过它，不需要每个转移点各自记得通知画布。节点状态写进节点自己的运行记录，与普通生成同一份。
- **把取回策略收成一个 owner**：`electron/assets/providerMediaFetch.ts`。

## 还没收口的（不在本 PR）

- `createCatalogGenerationProvider` 里还有别的实例内存表（`preparedByPayloadHash` / `requestByPreparedKey`，授权与提交之间的对账）。它们的生命周期是「一次确认内」，目前由同一个 submission 实例覆盖；如果将来提交也能跨实例恢复，需要同样把身份从 Run 账本里读，而不是靠实例记忆。
- 渲染层还有一份 Run 的只读投影缓存（`productionCanvasLandingStore`，现在只喂「排队中 / 已停」小标与返工判断）。它读的是同一个判定函数，不再判「在不在生成」；若将来排队 / 已停也能投影进节点，这份缓存可以整个删掉。
- 门岗按两级目录分桶：一条跨层链路的修复会同时累加五个桶，如实记录，不在这里改门岗。
