# 设计卡：主进程不再原地等待（第二刀，保存热路径）

方向检查：`docs/engineering/direction-checks/2026-11-13-main-thread-sync-wait.md`。本卡只写第二刀与代码对得上的部分。

## ★0 先查别人

| 出处 | 它怎么做 | 对决定的影响 |
|-|-|-|
| atomically（npm） | 异步版是暂存 + 改名；同步版在占用时忙等 | 异步版放不进持清单锁的同步事务；同步版就是要删的东西：不采用 |
| graceful-fs（npm） | 改名遇 EPERM / EBUSY 时重试，但只在目标不存在时 | 我们的保存是覆盖写，正好不在它的覆盖范围：不采用 |
| write-file-atomic（npm） | 临时文件 + fsync + 改名，改名失败不重试 | 与现有一致，没有重试：不采用 |
| Electron 性能文档 | 主进程别做阻塞 I/O | 方向依据：用定时器重排，不睡 |

结论：自写一件很小的重试策略（`electron/sharingRetry.ts`），理由只认领域约束——保存写在同步暂存事务里、持清单锁，且必须覆盖写。登记在 `docs/engineering/self-written.json`。

## 先查别人

- 依赖里已有？项目没有装 atomically / graceful-fs；`node_modules/write-file-atomic`（经传递依赖）只做临时文件 + 改名，改名失败不重试（node_modules/write-file-atomic/lib/index.js）。
- 仓库里已有？`electron/jsonFile.ts:27`（同步睡眠）与 `electron/jsonFile.ts:50`（`retryOnSharingViolation`）就是现状；`electron/workspace/workspaceRegistry.ts:73` 是锁自旋。本刀收敛成 `electron/sharingRetry.ts` 一处策略。
- 生态里已有？atomically：https://www.npmjs.com/package/atomically（同步版占用时忙等；异步版放不进持锁同步事务）。
- 生态里已有？graceful-fs：https://github.com/isaacs/node-graceful-fs（改名重试只在目标不存在时，覆盖写不适用）。
- 生态里已有？write-file-atomic：https://www.npmjs.com/package/write-file-atomic（临时文件 + 改名，不重试）。
- 生态里已有？Electron 性能文档：https://www.electronjs.org/docs/latest/tutorial/performance（主进程别做阻塞 I/O，方向依据）。
- TikHub 自媒体里怎么说？本题是主进程内部文件占用重试，不是创作者面向的功能，没有可查的自媒体做法：未查，原因如此。
- 结论：自研一件很小的重试策略（登记在 `docs/engineering/self-written.json` 的 `durable-json` 条目下），理由只认领域约束：保存写在持清单锁的同步暂存事务里，必须覆盖写。

## ★1 要保住的结果

- 用户改了东西，保存遇到文件被占用：最终保存上（不会把占用期间 Agent / MCP 已回执的写入盖掉；会盖掉的那份明说被抢先）；占用超过 60 秒才报失败，且改动还在内存里、可重试。（量具：`electron/sharingRetry.test.ts` 的 2 秒占用与 60 秒耗尽用例）
- 保存期间主进程上别的请求照常响应。（量具：同一测试里事件循环延迟 < 50ms；性能场景 `save-under-sharing-violation`）
- 关窗 / 刷新 / 切项目等待不变长。（量具：`workbenchProjectSession.saveReceipt.test.ts` 的 5 秒上限用例）
- 崩溃不变差：盘上永远是旧的完整版或新的完整版。（量具：`saveFaultSweep.test.ts`）
- 1c 老用户：不改数据格式，不迁移；老项目照常读写。

## ★2 做法

- B1：保存路径上的调用方显式传 `{ noWait: true }`（`writeJsonFileAtomic`、`renameSyncWithRetry`、清单锁取锁 / 放锁、同步基线、注册表 `noWait: { waitedMs }`）：同步助手立即再试一次就抛，注册表锁不自旋。第 2 轮删掉了 AsyncLocalStorage 隐式范围层（`runWithoutBlockingWait` / `blockingWaitAllowed`）。没传的调用方（结构上只能同步的）逐字不变。
- B1b（第 2 轮）清单锁 owner.json 读不到：保存路径上报 `WorkspaceManifestLockOccupiedError`（共享冲突，可重排），不判锁丢；自己刚建的锁目录先核 owner 再收走，收不走交给后台补收（250ms / 1 / 4 / 15 / 60 秒），不留孤儿锁目录。
- B1c（第 2 轮）保存分三段：提交前（取锁、读、核修订号、写备份和清单）可整体重排；清单写上 = 提交成功；提交后（放锁、注册表、同步基线）撞占用只在后台按保存退避表补写（同一目标新一次保存作废旧的补写），不回头重新提交，最终放弃只记日志、下次保存补上。
- B1d（第 2 轮）修订号核对：`saveProject` 记第一次进锁时读到的修订号，之后每次重排在锁里核对，变了就抛 `ProjectSaveSupersededError`、不写盘（渲染层按现有「项目正被别处占用」那一类失败显示，不新造文案）。主进程三个读改写写入方（`projectCanvasWrite.applyCanvasNodePatch`、`gateway.writeDiskSnapshot`、`documentSurface.writeProjectDocument`）改走 `repository.updateProject`：重排单位包含「读」，每次重读最新、再调纯回调，核到修订号变了就重读重算（最多 5 次）；目标没了照现有行为收尾（applied:false / 项目不存在 / document_not_found），回执字段不变。
- B2：`projects/repository.saveProject` 用 `saveWithSharingRetry` 重排整次保存（50/100/200/400/800 后每 1000ms，上限 60s）。真没权限（EACCES / EPERM 且目录不可写）立即报写入被拒。耗尽后报「被占用」（`ProjectSaveInUseError`，原错误码保留）。渲染层显式等回执的人最多等 5 秒。
- B3：`writeJsonFileAtomic` 返回写下字节的 sha256；事务提交后把清单哈希交给同步基线；不再整读回校验；注册表仅在名字 / 位置 / 来源变化、或最近打开时间超过 60 秒才写。
- B4：两个性能场景 `save-under-sharing-violation`、`save-slow-disk`，故障只在量具进程里注入。
- B5：热路径目录下新增同步文件操作的 lint 规则，存量批量压制、只减不增。
- 异步调用方用同一个异步重试件，各自的退避表不同：导出改名（`ffmpegRunner`）用长表 `SHARING_RETRY_LONG_DELAYS_MS`（8 次等待），素材硬链接（`projectAssetStore`）用默认表 `SHARING_RETRY_DELAYS_MS`（5 次等待）；两张表各有测试钉住。`workspaceSync` 不在保存路径上，本刀不碰。

## ★3 不接现成的理由

见 ★0。

## ★4 不改的

不加按钮、对话框、面板、状态行；可见文案 0 句改动（既有「没能保存，项目文件被别的程序占用……」已写明原因与后果）。不碰清单锁语义、金钱记账调用方、`electron/feedback/**`。

## ★7 性能

场景：`save-under-sharing-violation`（2 秒持续占用）、`save-slow-disk`（fsync 慢 30ms）。主指标保存期间事件循环最大间隔，预算 100ms；原地睡毫秒数应为 0。基线不在本 PR 写，数字交协调。

## ★9 验收清单与反例

- B1：把保存路径改回睡 → `saveFaultSweep` 的「保存从不同步睡」红；同步助手 `noWait` 改回按表退避 → `sharingRetry.test.ts`「不睡」红。
- B2：去掉重排 → 2 秒占用用例红；去掉真没权限判断 → 立即写入被拒用例红。
- B3：把注册表节流去掉 → 「什么都没变不写」用例红。
- B5：在 `workspaceRepository.ts` 新增 `fs.statSync` → lint 红。
- 渲染层：去掉 5 秒上限 → 上限用例红。

第 2 轮新增（量具 `electron/projects/saveUnderOccupancy.test.ts`、`sharingRetry.test.ts`、`ffmpegRunner.test.ts`、`projectAssetStore.test.ts`、`workbenchProjectSession.saveReceipt.test.ts`；改坏 → 红、还原 → 绿，日志随报告）：

- 清单锁 owner.json 占用改回判锁丢 → 「占用 300ms」「单次保存抛共享冲突」两条红。
- 去掉孤儿锁清理 → 「锁目录随后被收掉」红。
- 提交后失败改回重排整次 → 「同步基线占用 300ms」「设置目录持续 60 秒」两条红（修订号 / 备份断言）。
- 去掉修订号核对 → 「两份快照先后发起」「占用期间别的进程写上了」两条红。
- 读改写重排单位改回只包写 → 7 条读改写用例全红。
- 重排期间状态显示成已保存（提前调 onSaved）→ 渲染层「重试期间不报已保存」红。
- 去掉真没权限判断 → write-denied 用例按断言红（假时钟，不再空转耗尽内存）。
- 素材硬链接改表 → 「默认表 6 次尝试」红；导出改名改回默认表 → 「长表 9 次尝试」红。

反例（不该发生的）：重排期间 onSaved 被调用；被抢先的那份写上了盘；提交后步骤失败导致修订号 +2 或备份等于当前版；锁目录在占用结束后仍留在 `.nomi/` 里。
