# 设计卡：项目库「回库」不再同步等全库（P-library）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：项目列表摘要唯一异步读面 + 卡片同步状态批量检查　线/负责人：P-library（nomi-worker）　类别：[其他]（性能）
功能分类：- [x] 大数据量 / 画布 / 长列表　- [x] 新增功能 / 性能（性能类改动，只填 ★ 5 格 + ★7）
方向检查：`docs/plan/2026-10-21-project-library-direction-check.md`（fix-churn 命中，用户 10-21 放行「接入现成」方案）

| 格 | 内容 |
|---|---|
| ★1 用户怎么用 | 当我在大项目里点「回项目库」，我想立刻看到全部项目卡，以便接着挑下一个。不做：封面图可以晚到；同步状态徽标可以晚到。量具：perf 场景 `project-library-list`（库里 41 个项目，点菜单项到 41 张卡可见再过两帧，预算 300ms） |
| ★2 谁说了算 | 「项目列表摘要」唯一 owner：主进程 `electron/projects/repository.ts` 的 `listProjects()`（异步，`list-async` 通道是唯一读口，没有同步版）；渲染层唯一消费者 `localProjectStore.useLocalProjects`（SWR 缓存）。「卡片同步状态」唯一 owner：渲染层 `projectSyncInspectScheduler`（调度）+ 主进程 `inspectProjectsSyncBatch`（执行，限并发）。同一份事实存一份：列表在 SWR 缓存，同步状态在调度器；门表：`node scripts/door-map.mjs listLocalProjects` / `refreshProjects`（读入口 1 + 3，写入口 2，全部经同一个异步读面） |
| ★3 一致与复用 | 限并发用现成的 `p-limit@3.1.0`（CJS，已在锁文件里，升为直接依赖）；列表缓存沿用 SWR；空闲调度用浏览器 `requestIdleCallback`。自写的只有领域部分：清单快照读的判定（`snapshotFromRawManifest`，同步版与异步版共用一份）。没有第二份定义 |
| ★4 全状态 | 沿用现有占位，不加新界面元素。列表加载中：首次读取沿用现有骨架（`projectsLoading`）；回库时 SWR 缓存是热的，卡片直接出，后台重读。读取失败：沿用现有「读不到本地项目 + 重新读取」错误态。卡片同步状态晚到 / 查不到：不显示徽标（与检查能力上线前一样，不显示错的状态）；结果到了才出徽标。损坏的项目：用注册表里的名字和时间照出卡，清单读不出来不拖垮其余项目。项目文件夹被删：卡片标 missing |
| ★7 性能 | ①新增操作：无新增，改的是「回项目库」。②最坏规模：41 个项目（40 个带 4 张图 + 1 个 96 图）。③预算：300ms（approved，不动）。④场景 `project-library-list`：修前（同机同负载）中位 688.8 / p95 811.9；修后数见 PR 正文。主进程侧另有两条结构性约束的单测：列举盘读并发 ≤ 6、批量检查并发 ≤ 2 |
| ★9 验收与回滚 | 验收：不属四类（性能改动），协调会在安静窗口复测 `pnpm run perf:scenarios -- --id project-library-list`。反例清单（动手前列）：坏清单、文件夹被删、空库、41 个项目并发上限、聚焦不全量重发、增删发布后列表刷新、紧挨着两次发布不丢、同步通道不得复活（`check:renderer-sync-ipc` 基线已删 `nomi:projects:list`）。回滚：revert 本 PR 的结构提交；通道、桥接口、调度器同批进出 |
