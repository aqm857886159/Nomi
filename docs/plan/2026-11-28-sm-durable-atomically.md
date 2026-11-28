# 2026-11-28 · SM-durable · 生产侧 durable-json 收归 atomically 并消除主线程 Atomics.wait

状态：✅ 已完成
改动名：sm-durable-atomically　线/负责人：impl-sm-durable　类别：[长跑][其他]

### 功能分类
- [x] 长跑 / 可打断
- [x] 数据格式
- [x] 新增功能 / 性能

## ★0 先查别人

- https://www.npmjs.com/package/atomically · `atomically@2.1.1`（MIT，仓库已锁定安装）：异步 `writeFile` 串行同路径调度、同目录暂存、通过 `Readable` 流按 `WriteStream` 完整写满字节、支持 `fsync` / `fsyncWait` 开关并在 `EBUSY` / `EPERM` / `EACCES` / `EAGAIN` / `EMFILE` / `ENFILE` 上用 `setTimeout` 异步退避重试（无 `Atomics.wait`），同步 `writeFileSync` 负责同目录暂存 + `fsyncSync` + `renameSync` · **确认了**：将 `electron/jsonFile.ts` 的 JSON 原子写/读底层交给 `atomically`，主进程构建（`tsc` CommonJS 输出 `dist-electron/`）需把 `atomically` 从 `devDependencies` 迁入 `dependencies`。
- https://www.npmjs.com/package/write-file-atomic · `write-file-atomic` 提供同目录临时文件 + `fsync` + `rename`，但 Windows 上目标或暂存文件被杀毒/索引器短暂占用时改名不退避重试 · **确认了**：不引入第二个原子写库，全仓统一收敛到已安装的 `atomically@2.1.1`。
- https://github.com/isaacs/node-graceful-fs · `graceful-fs` 在 Windows 上对 `rename` 遇 `EPERM` / `EACCES` 采用定时器退避，但仅在目标不存在时生效，且不管已生成成品文件（如导出 MP4、暂存目录）的覆盖改名 · **确认了**：保留 `electron/sharingRetry.ts` 的共享冲突判定与 `renameWithRetry` 覆盖改名薄边界，管 `atomically` 整文件写入之外的已有文件/目录覆盖改名。
- https://www.electronjs.org/docs/latest/tutorial/performance · Electron 官方性能指南明确禁止在主进程热路径阻塞事件循环 · **改了**：删除 `electron/jsonFile.ts` 中的 `sleepSync`（`Atomics.wait`），并将项目保存热路径（`saveWorkspaceProject` 全链：清单暂存提交、清单锁获取与释放、最近项目登记与同步基线落盘）及已在 `async` 上下文中的生产调用方（`projects/repository.ts`、`browserPromptExtractionSettings.ts`、`localSpeechInstall.ts`、`projectAssetStore.ts`）全部迁入异步 `writeJsonFileAtomicAsync` / `renameWithRetry` / `retryOnSharingViolationAsync`。
- 出口：https://nodejs.org/api/timers.html#settimeoutcallback-delay-args · 异步退避通过有界 `timeout`（默认 400ms，导出长表 2600ms）到期自动结束并原样抛出底层 `ErrnoException`（`EBUSY` / `EPERM` / `EACCES` / `ENOSPC`），暂存文件在 `catch` / `finally` 与进程退出钩子中清理 · **确认了**：不新增或扩大任何挡人锁，遇到持续占用或磁盘满时按原错误码立即交回上层保存/导入错误分类，下次保存或重启新进程可直接恢复且零残留。

## ★1 用户怎么用

- 当创作者编辑画布或分镜触发自动/手动保存、导入本地素材、安装本地语音引擎或更新工作区设置时，我想在 Windows 杀毒软件、搜索索引器或同步盘短暂占用文件（≤300ms）时依然平滑写盘成功且不冻住主进程窗口与 IPC，并在磁盘满（`ENOSPC`）或持续占用时保留上一份完整的 `project.json` 且不残留坏锁，以便项目数据跨掉电与异常始终完整可恢复。
- 真实任务与量具：
  1. 项目完整保存与双进程崩溃恢复：目标（掉电/I/O 故障不撕裂清单、主进程零同步睡眠）→ 信号（146 项故障矩阵全恢复 + 主线程 `Atomics.wait` 请求睡眠毫秒数占比 0%）→ 指标与量具：`electron/workspace/saveFaultSweep.test.ts`（140 项 `project`/`settings` × 7 类系统调用 × 5 类错误码 × 瞬态/持续故障 + 冷启动新 PID 恢复，目标通过率 100%，`SAVE_DEBT_JSON.sleep` 由 `jsonFile 5200ms + workspaceRegistry 3010ms` 降至 `0ms`）与 `electron/workspace/saveParity.test.ts`（9 组保存指纹通过率 100%，`syncWait.totalMs = 0`）。
  2. 落盘屏障与共享冲突容忍：目标（生产必刷 `fsync`、测试 `ephemeral` 免刷、300ms 占用不败且不阻塞事件循环）→ 信号（`fsync` 调用率与事件循环最大延迟）→ 指标与量具：`electron/durability.test.ts`（生产 `durable` 100% 触发 `fsync`/`fsyncSync`、`ephemeral` 0% 触发）、`electron/jsonFile.test.ts`（含短写拒公布与失败零 `.tmp` 残留）与 `electron/sharingRetry.test.ts`（300ms 占用恢复率 100%，异步路径事件循环延迟 `<50ms`）。
  3. 随包依赖与构建完整性：目标（装机版 `dist-electron` 外部依赖可解析且不超包体预算）→ 信号（主进程产物引用闭包完整率）→ 指标与量具：`pnpm run build`、`pnpm run check:packaged-deps`、`pnpm run check:package-budget`、`pnpm run check:supply-chain-pins` 100% 通过。
- ★1b 连带界面：纯主进程持久化基础设施重构，不新增或改动任何界面元素、布局、Toast 或错误文案；保存失败仍经既有 `projectSaveFailure` 返回相同 `in-use` / `disk-full` / `write-denied` 结构化原因。
- ★1c 老用户：磁盘文件格式（`project.json`、`project.backup.json`、`recent-workspaces.json`、`workspace-sync-baseline.json` 及全部配置 JSON，均为 2 空格缩进 + 尾换行 UTF-8）与锁目录结构逐字节不变；老项目、老配置升级后零迁移直接读写，回退上一版本同样直接可读（由 `electron/workspace/legacyProjectMigration.test.ts`、`electron/catalog/upgradeKeepsWorkingModels.test.ts` 与 `saveParity.test.ts` 守住）。

## ★2 谁说了算

- 概念与唯一主人：
  - `persistence.atomic-rename`：唯一主人 `electron/jsonFile.ts`（`writeJsonFileAtomicAsync`、`writeJsonFileAtomic`、`readJsonFileAsync`、`readJsonFile`、`renameWithRetry`、`renameSyncWithRetry`、`renameSyncOnce`），底层整文件原子读写委托 `atomically@2.1.1`，原生 `fs.rename` / `fs.renameSync` 由 `generic-raw-rename` ESLint 规则封口。
  - 落盘屏障开关：唯一主人 `electron/durability.ts`（`isDurable` / `fsyncIfDurable` / `fsyncDirectoryIfDurable`），`jsonFile.ts` 将 `fsync: isDurable(), fsyncWait: true` 传给 `atomically`，全仓仅测试 harness `tests/setup/durability.ts` 可切 `ephemeral`，由 `check:heavy-path` `unguarded-fsync` 与 `durability.test.ts` 共同把守。
  - Windows 共享冲突判定与退避表：唯一主人 `electron/sharingRetry.ts`（`isSharingViolation`、`SHARING_RETRY_DELAYS_MS`、`SHARING_RETRY_LONG_DELAYS_MS`、`SHARING_RETRY_BUDGET_MS`、`retryOnSharingViolationAsync`）。
  - `project.location`：唯一主人 `electron/workspace/workspaceRegistry.ts`（同步 `bindWorkspaceLocation` / `bindWorkspaceLocations` / `removeWorkspaceReference` 与供异步保存调用的同源 `bindWorkspaceLocationAsync`，共用同一份 `mergeWorkspaceBinding` 与冲突判据）。
- `door-map` 普查基线：`electron/jsonFile.ts` 共 82 扇门（写 67 / 读 15）、`electron/durability.ts` 共 20 扇门、`electron/sharingRetry.ts` 共 11 扇门。无根据状态缺失猜用户意图的行为。

## ★3 一致与复用

- 既有裁定：`#1586#issuecomment-7225010070`（`U-5` / `SM-durable`）拍板将生产侧 `durable-json` 换成已安装的 `atomically@2.1.1` 并去掉主线程 `Atomics.wait`，全仓只留 `atomically` 一个原子写库；`docs/engineering/direction-checks/2026-11-13-main-thread-sync-wait.md` 指出此前未直接换同步版是因为其忙等、未做无锁 60 秒重排是因为锁外快照陈旧。
- 三条路选择：**换一种做法（接入现成库 `atomically@2.1.1` + 锁内异步提交）**——① 继续保留 `jsonFile.ts` 手写 `openSync + writeFileSync + fsyncSync + closeSync + Atomics.wait` 会保留重复轮子与主线程阻塞，不选；② 全仓一次性把同步调用方（含在途 `#1703` `productionRunRuntimeEnvelope.ts`、`SM-2` `liveHarness.ts` 与 `SM-4` `approvalReceipt.ts` / `sendSync` 配置桥）全部改成 `async` 会击穿跨线边界与百余处同步签名，不选；③ 底层统一交给 `atomically`：项目保存热路径在持住 `WorkspaceManifestLockLease` 与 `pLimit(1)` 锁内走 `atomically.writeFile` 异步提交（既不阻塞主线程，又避免锁外快照竞争），其余已在 `async` 函数内的生产调用方同步切到异步入口，同步面删除 `Atomics.wait` 并委托 `atomically.writeFileSync` + 单调时钟有界重试以保持在途同步调用方零冲突，同时把 `self-written.json` 的 `durable-json` 收口为最小桥接 `justified`。

## ★4 全状态

- 空 / 首次创建：目标文件或父目录不存在时先递归建父目录再由 `atomically` 暂存写入并原子改名发布，无半截文件。
- 加载 / 写入中：项目保存持清单锁与 `pLimit(1)` 异步落盘，期间主进程事件循环与窗口响应不被阻塞。
- 成功：完整 UTF-8 JSON（经 `Readable` 流循环写满字节 + `durable` 模式下 `fsync` 落盘屏障）原子替换目标文件，暂存文件零残留。
- 失败（`ENOSPC` / `EIO` / 超出退避预算的 `EBUSY` / `EPERM` / `EACCES`）：立即清理暂存 `.tmp` 文件并原样抛出底层 `ErrnoException`，旧 `project.json` 与备份逐字节完好。
- 部分成功：备份已落盘而主清单改名失败时，下次打开/保存沿用既有备份身份恢复协议，不丢失项目身份。
- 取消中 / 过期 / 能力不可用：本地文件系统原语不涉及外部模型或网络资源，无新增 UI 文案或 i18n 键。

## 5 中途表

| 状态 | 停止 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 获取清单锁 / 注册表锁 | 调用方等待超时（5s / 3s）后抛原忙错，零花费 | 既有退出排空照常执行，零花费 | 纯本地磁盘操作不受断网影响，零花费 | 冷启动新 PID 按 `owner.json` 存活检测隔离死锁并恢复保存，零花费 | `pLimit(1)` 与目录锁串行排队，零重复扣费 |
| 暂存写入与 `fsync` 中 | 异常中止时 `catch`/`finally` 删 `.tmp`，旧文件完好，零花费 | `atomically` 的 `when-exit` 钩子同步清扫未发布暂存件，零花费 | 本地写盘不受断网影响，零花费 | 未改名的 `.tmp` 不影响正式 `project.json`，重启读旧完整版，零花费 | `atomically` 同路径 `Scheduler` 与外层清单锁双重串行，零花费 |
| 原子 `rename` / 释放锁共享冲突退避中 | 400ms 预算内定时器退避，耗尽原样抛错，零花费 | 已提交清单不因锁释放 `EPERM` 改判失败，后台定时器补收锁目录，零花费 | 本地改名不受断网影响，零花费 | 下次进程认出残留 `release-*` / `candidate-*` 元数据自动清零，零花费 | 排队等待前序事务释放后读取最新 `revision`，零花费 |

## 6 外部数据与失败

- Node.js 文件系统错误契约（https://nodejs.org/api/errors.html#common-system-errors ）：`EPERM` / `EBUSY` / `EACCES` 在重试入口走 400ms（导出 MP4 走 2600ms）退避，耗尽后原样保留 `code` 与 `syscall` 交给 `projectSaveFailure`；`ENOSPC` / `EEXIST` / `ENOTEMPTY` / `ENOENT` / `EXDEV` 不做共享冲突重试，单次即抛。
- `atomically@2.1.1` 流写入契约（https://github.com/fabiospampinato/atomically ）：异步 `writeJsonFileAtomicAsync` 传入 `Readable.from([bytes])`，经 Node `WriteStream` 循环写满全部字节；若底层出现零字节短写或 `ENOSPC`，在 `rename` 之前即报错并清理 `.tmp`，绝不覆盖旧文件。

## ★7 性能

- ① 新增用户操作：0 个（纯内部持久化层替换与去阻塞重构）。
- ② 最坏规模：`saveFaultSweep.test.ts` 1MiB 大 JSON 项目保存与 140 组全路径 I/O 故障注入重试。
- ③ 预算：保存全路径主线程 `Atomics.wait` 请求阻塞时间目标 `0ms`（原基线 `jsonFile.ts` 5200ms + `workspaceRegistry.ts` 3010ms）；异步共享冲突 300ms 占用期间事件循环最大延迟 `<50ms`。
- ④ 性能场景：不涉及 UI 交互帧率场景（`perf-scenario` 证据填「不适用：纯主进程 JSON 原子写替换与移除 Atomics.wait，无新增或变更渲染层交互规模场景，保存阻塞与大 JSON 预算由 saveFaultSweep.test.ts 钉死为 0ms」）。

## 8 真实条件

- 本机 macOS 真实临时文件系统实跑全套单元与故障扫掠（含真实跨进程冷启动子进程 PID 恢复、`ENOSPC` / 短写 / `EBUSY` / `EPERM` / `EACCES` / `EEXIST` 注入、真实 `pnpm run build` 产物校验）。
- Windows 真实杀毒软件句柄竞争（`workspaceManifestLock.transientRelease.test.ts` 的 `win32` PowerShell 用例按平台门控在 Windows CI 执行）、英文界面、最小窗口、真规模媒体、干净安装包双击、真付费、纯键盘全程在本次本地重构中记为 `unverified`。
- 拍板图清单：不适用：纯主进程文件持久化重构，未触碰任何 `src/` 界面组件、样式或文案。

## ★9 验收与回滚

- 独立验收：合并前由另一条独立盲验线 `V-SM-durable` 对照本卡及反例清单核验，运行 `VITEST_MAX_WORKERS=2 npx vitest run electron/workspace/saveFaultSweep.test.ts electron/workspace/saveParity.test.ts electron/workspace/workspaceSaveLock.test.ts electron/jsonFile.test.ts electron/durability.test.ts electron/sharingRetry.test.ts` 及门岗链。
- 体验铁律对账：⑩ 说的=摆的、⑪ 模型参数可选、⑫ 可点击目标预期表均不适用（未改动任何 Agent 意图、模型参数或界面可点击元素）。
- 回滚：单笔提交交付，如需回滚直接 `git revert <commit>` 即可原子恢复 `package.json`、`electron/` 与测试夹具。

| 检查项 | 反例（改坏方式 → 预期必红） | 自验证据 |
|---|---|---|
| 主线程零 `Atomics.wait` | 在 `electron/jsonFile.ts` 加回 `Atomics.wait` → `eslint` `main-sync-wait/no-restricted-syntax` 立即报红，且 `saveFaultSweep.test.ts` `sleeps` 断言报红 | `pnpm exec eslint electron/jsonFile.ts --max-warnings=0` + `saveFaultSweep.test.ts` |
| 生产 `fsync` 屏障开关唯一有效 | 将 `jsonFile.ts` 传给 `atomically` 的 `fsync` 硬编码为 `false`（什么都不做）→ `electron/durability.test.ts` 的 `'durable' 模式下真的 fsync` 用例报红；硬编码为 `true` → `'ephemeral' 模式下不 fsync` 用例报红 | `electron/durability.test.ts` |
| 短写 / `ENOSPC` 绝不损坏旧文件且不留 `.tmp` | 注入 `fs.write` 只写前 4 字节后持续返回 0 字节或抛 `ENOSPC`，或 `rename` 抛 `ENOSPC` → 若仍改名或漏删暂存件，`jsonFile.test.ts` 与 `saveFaultSweep.test.ts` 的原文件字节与 `leftovers(root) === []` 断言立即报红 | `electron/jsonFile.test.ts` + `saveFaultSweep.test.ts` |
| Windows 共享冲突 300ms 退避不降级 | 将退避超时砍为 `0`（全部拦下不重试）→ `sharingRetry.test.ts` 持续 300ms `EBUSY`/`EPERM` 用例与 `saveParity.test.ts` 300ms 占用保存用例全部报红 | `electron/sharingRetry.test.ts` + `electron/workspace/saveParity.test.ts` |
| 外部运行时依赖随包完整 | 将 `atomically` 留在 `devDependencies` 不进 `dependencies` → `pnpm run check:packaged-deps` 立即报 `missing: atomically` 红灯 | `pnpm run check:packaged-deps` + `pnpm run build` |

## 明确不做

- 不改动其他非 `durable-json` 领域的 4 处历史同步锁自旋（`hostConfigWrite.ts`、`operationLedger.ts`、`promotionJournal.ts`、`providerAdapter/store.ts`），避免越界触碰 MCP 宿主迁移与认证账本。
- 不强行把在途分支（`#1703` `productionRunRuntimeEnvelope.ts`、`SM-4` `approvalReceipt.ts` 与 `modelOnboardingBridge.ts` 同步配置链路）的 24 个同步调用方改成 `Promise` 异步签名；保留无 `Atomics.wait` 的同步 `writeJsonFileAtomic`（委托 `atomically.writeFileSync`），实现跨线零冲突。
- 不引入 `write-file-atomic` 或任何新 npm 包，全仓统一使用已安装的 `atomically@2.1.1`。
