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
- 生态里已有？atomically https://www.npmjs.com/package/atomically（同步版占用时忙等）；graceful-fs https://github.com/isaacs/node-graceful-fs（改名重试只在目标不存在时）；write-file-atomic https://www.npmjs.com/package/write-file-atomic（不重试）；Electron 性能文档 https://www.electronjs.org/docs/latest/tutorial/performance（主进程别做阻塞 I/O）。
- TikHub 自媒体里怎么说？本题是主进程内部文件占用重试，不是创作者面向的功能，没有可查的自媒体做法：未查，原因如此。
- 结论：自研一件很小的重试策略（登记在 `docs/engineering/self-written.json` 的 `durable-json` 条目下），理由只认领域约束：保存写在持清单锁的同步暂存事务里，必须覆盖写。

## ★1 要保住的结果

- 用户改了东西，保存遇到文件被占用：最终保存上；占用超过 60 秒才报失败，且改动还在内存里、可重试。（量具：`electron/sharingRetry.test.ts` 的 2 秒占用与 60 秒耗尽用例）
- 保存期间主进程上别的请求照常响应。（量具：同一测试里事件循环延迟 < 50ms；性能场景 `save-under-sharing-violation`）
- 关窗 / 刷新 / 切项目等待不变长。（量具：`workbenchProjectSession.saveReceipt.test.ts` 的 5 秒上限用例）
- 崩溃不变差：盘上永远是旧的完整版或新的完整版。（量具：`saveFaultSweep.test.ts`）
- 1c 老用户：不改数据格式，不迁移；老项目照常读写。

## ★2 做法

- B1：`runWithoutBlockingWait`（AsyncLocalStorage）包住 `saveWorkspaceProject`；范围内同步助手立即再试一次就抛，注册表锁不自旋。范围外（结构上只能同步的调用方）逐字不变。
- B2：`projects/repository.saveProject` 用 `saveWithSharingRetry` 重排整次保存（50/100/200/400/800 后每 1000ms，上限 60s）。真没权限（EACCES / EPERM 且目录不可写）立即报写入被拒。耗尽后报「被占用」（`ProjectSaveInUseError`，原错误码保留）。渲染层显式等回执的人最多等 5 秒。
- B3：`writeJsonFileAtomic` 返回写下字节的 sha256；事务提交后把清单哈希交给同步基线；不再整读回校验；注册表仅在名字 / 位置 / 来源变化、或最近打开时间超过 60 秒才写。
- B4：两个性能场景 `save-under-sharing-violation`、`save-slow-disk`，故障只在量具进程里注入。
- B5：热路径目录下新增同步文件操作的 lint 规则，存量批量压制、只减不增。
- 异步调用方（导出改名、素材硬链接）用同一个异步重试件。

## ★3 不接现成的理由

见 ★0。

## ★4 不改的

不加按钮、对话框、面板、状态行；可见文案 0 句改动（既有「没能保存，项目文件被别的程序占用……」已写明原因与后果）。不碰清单锁语义、金钱记账调用方、`electron/feedback/**`。

## ★7 性能

场景：`save-under-sharing-violation`（2 秒持续占用）、`save-slow-disk`（fsync 慢 30ms）。主指标保存期间事件循环最大间隔，预算 100ms；原地睡毫秒数应为 0。基线不在本 PR 写，数字交协调。

## ★9 验收清单与反例

- B1：把范围内改回睡 → `saveFaultSweep` 的「保存从不同步睡」红。
- B2：去掉重排 → 2 秒占用用例红；去掉真没权限判断 → 立即写入被拒用例红。
- B3：把注册表节流去掉 → 「什么都没变不写」用例红。
- B5：在 `workspaceRepository.ts` 新增 `fs.statSync` → lint 红。
- 渲染层：去掉 5 秒上限 → 上限用例红。
