# 设计卡：保存热路径「安全的那一小块」（#1500 两轮验收不通过后走退路）

改动名：save-hotpath-safe-subset　线：I-save-hotpath-safe-subset（实现）　类别：[其他]
方向检查：`docs/engineering/direction-checks/2026-11-13-main-thread-sync-wait.md`（第 3 轮结论在末尾）。

**先说清楚：主进程原地睡的冻结，这一刀没有解决。** Windows 上杀毒 / 同步盘占着项目文件时保存，主进程仍会原地睡约 400ms 再失败，和 main 一样。#1500 想用「不睡、定时器重排整次保存」解决，两轮独立验收都不通过（Agent / MCP 已回执的写入之后被整份盖回；注册表锁删不掉留孤儿锁、下一次操作卡约 3 秒），协调定走退路：重排机制和 `updateProject` 新入口这一轮都不要。真正的解法留给下一刀：把保存整体搬出主进程，在那边照旧原地等。

## ★0 先查别人

| 出处 | 它怎么做 | 对决定的影响 |
|-|-|-|
| write-file-atomic（https://www.npmjs.com/package/write-file-atomic） | 临时文件 + fsync + 改名，改名失败不重试 | 确认了：导出改名要自己带重试，它给不了 |
| graceful-fs（https://github.com/isaacs/node-graceful-fs） | Windows 上 rename 遇 EPERM / EACCES 用定时器退避重试，但只在目标不存在时 | 确认了：导出改名是覆盖旧成品，正好不在它的覆盖范围；退避用定时器、不睡这一点照搬 |
| atomically（https://www.npmjs.com/package/atomically） | 异步版暂存 + 改名、带重试；同步版占用时忙等 | 确认了：异步重试助手是对的形态；同步版就是我们要远离的忙等 |
| Electron 性能文档（https://www.electronjs.org/docs/latest/tutorial/performance） | 主进程别做阻塞 I/O | 确认了：热路径上不再新增同步文件操作（lint 规则） |

## 先查别人

- 依赖里已有？项目没装 atomically / graceful-fs；`node_modules/write-file-atomic/lib/index.js`（传递依赖）只做临时文件 + 改名，改名失败不重试。
- 仓库里已有？origin/main 上 `electron/jsonFile.ts:22`（同步睡眠 `sleepSync`）与 `electron/jsonFile.ts:45`（同步助手 `retryOnSharingViolation`）是现状；仓库里没有异步的共享冲突重试（`git grep -n "retryOnSharingViolationAsync" origin/main` 为空）。本刀把判定和退避表收成 `electron/sharingRetry.ts` 一处，同步助手引用它。
- 生态里已有？graceful-fs：https://github.com/isaacs/node-graceful-fs （Windows 上 rename 遇 EACCES / EPERM / EBUSY 用定时器退避，但重试前先 stat 目标、只在目标不存在时再试；导出改名覆盖旧成品，不在它的覆盖范围）。
- 生态里已有？atomically：https://www.npmjs.com/package/atomically （异步版带重试，管的是它自己的整文件写；导出是对已有中间文件的覆盖改名，接不上）。
- 生态里已有？Electron 性能文档：https://www.electronjs.org/docs/latest/tutorial/performance （主进程别做阻塞 I/O，lint 规则的依据）。
- TikHub 自媒体里怎么说？本题是主进程内部的文件占用重试，不是创作者面向的功能，没有可查的自媒体做法：未查，原因如此。
- 结论：自研一个很小的异步重试助手（登记在 `docs/engineering/self-written.json` 的 `durable-json` 条目下），理由只认领域约束：导出收尾是覆盖旧成品的改名，现成库要么不重试、要么只管目标不存在的情形。

出口：不涉及：这一刀不新增、不扩大、不挪动任何挡人的保护（导出改名的重试只是把同步睡换成定时器等，失败时报的错和 main 一样）。

## ★1 要保住的结果

- 当创作者保存项目时（自动 / 手动 / Agent 画布补丁 / MCP 写文稿 / 能力网关写入），盘上落什么、修订号、备份、回执、错误类型和文字、被占用时等多久再失败，**全部和 main 逐项相同**。量具：`electron/workspace/saveParity.test.ts`（9 组，指纹在 origin/main e45202755 的代码上录下）+ 现有 `saveFaultSweep.test.ts`（断言不改）。
- 当导出收尾、旧成品 MP4 被播放器 / 资源管理器预览开着时：改名用定时器退避（约 2.6 秒长表）再失败，**主进程不原地睡**；成功时成品在、中间文件不留。量具：`electron/export/ffmpegRunner.test.ts` 两条新用例。
- 以后谁在保存 / 项目 / 目录这些热路径上新写同步文件操作，lint 当场红。量具：`pnpm run lint`（规则 `hot-path-sync-fs/no-restricted-syntax`）。
- 下一刀的基线（量具 `tests/perf/save-hotpath-bench.mjs`，Mac，负载约 15、量具判 noisy，只作参考）：一次普通保存同步读盘 22 次、写盘 12 次，中位数 50.9ms；照 #1500 删掉两处读之后是读 19 次、写 12 次、51.2ms——**量不出时间差**，所以少读少写这一刀不搬（见 ★3）。
- ★1c 老用户：不改数据格式、不迁移；保存行为逐项不变，升级后什么都不用做。
- 不做什么：不修重排机制、不搬保存出主进程、不改任何界面文字和状态显示、不登记性能场景（`save-under-sharing-violation`、`save-slow-disk` 在 main 的等待语义下过不了预算）。

## ★2 谁说了算

- 「文件被别的程序占着就退避重试」的策略唯一一处：`electron/sharingRetry.ts`（判定 `isSharingViolation` + 退避表 + 异步助手）；`electron/jsonFile.ts` 的同步助手改为引用同一张表和同一个判定，`jsonFile` 继续转出 `isSharingViolation`，现有调用方不改。
- 保存的唯一入口仍是 `projects/repository.saveProject` → `workspace/workspaceRepository.saveWorkspaceProject`，这一刀两者都不碰。调用方 5 个文件（`git grep -l -E "saveProject\(" origin/main -- electron ':!*.test.ts'`）：repository / projectsIpc / projectCanvasWrite / documentSurface / gateway，后果都是「无」。

## ★3 一致与复用

- 以前定过：#1500 方向检查第 2 轮写明退路「这一轮验收再不过就走这条：撤回本 PR 的重排」；协调 11-13 定走退路，只落和重排无关的 (c) 部分。
- 三条路：沿原方向修（第三轮修重排）——不选，协调已定不做第三轮；换做法（保存搬出主进程）——下一刀，要先写设计；删掉——选：重排机制和 `updateProject` 不搬。
- 少读少写（#1500 的 B3：写后整读回比对、提交后再读一遍算哈希、注册表节流）这一刀**不搬**：①量不出时间差（51.2 vs 50.9ms，读 22→19 次）；②被占用时结果和 main 不同——main 里「刚写下的备份 / 清单读回被占」会把这次保存报失败（清单那次已经写上、同步基线却没更新），删掉读回就变成成功，对照测试看得见；注册表节流改变了 `lastOpenedAt` 的盘上内容。答不出「逐字节相同」就不搬。
- 复用：导出改名用新的异步助手（和 graceful-fs 同样的定时器退避），同步助手和退避表合成一份，不另起一套。

## ★4 全状态

不改任何界面：没有新增提示、状态显示或文案（对照 `docs/design/nomi-design-system.md` §1.0、§1.5 只核这一件事：0 处）。导出改名耗尽仍报原错误码（EPERM / EBUSY / EACCES），走现有导出失败显示。

## ★9 验收清单与反例

验收：另一条线跑 `pnpm exec vitest run electron/workspace/saveParity.test.ts electron/workspace/saveFaultSweep.test.ts electron/export/ffmpegRunner.test.ts electron/sharingRetry.test.ts electron/assets/projectAssetStore.test.ts`、`pnpm run lint`，并按下表逐条改坏 → 红、还原 → 绿。回滚：revert 本 PR 的提交。

| 反例（改坏的方式） | 应当 |
|-|-|
| 保存热路径（如 `workspaceRepository.ts`）新写一处 `fs.statSync` | lint 红 |
| 照 #1500 删掉事务里「写后读回比对」 | `saveParity`「刚写下的备份读不了」「读回比对读到了、求指纹那一次被占」两组红 |
| 照 #1500 把提交后算哈希改成内存算（不再读清单） | `saveParity`「读回比对读到了、求指纹那一次被占」红 |
| 导出改名改回 `renameSyncWithRetry` | `ffmpegRunner.test.ts`「一直被占着」红，且 lint 红 |
| 导出改名改用默认短表 | 「长表 9 次尝试」红 |
| 素材硬链接改用长表 | `projectAssetStore.test.ts`「默认表 6 次尝试」红 |
| 同步助手加回 `noWait` 不睡分支 / 加回 `saveRetry` | 没有自动拦：靠人记（`saveParity` 只在保存路径真的传了 `noWait` 时才红） |

反例（不该发生的）：任何一组对照指纹和 main 不同；本 PR 新写的同步文件操作 > 0；冻结清单里出现 main 上没有的条目；`git grep -n -E "noWait|saveRetry|runWithoutBlockingWait|project_save_superseded|updateProject\(" -- electron src` 出现 main 上没有的结果。
