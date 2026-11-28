# 第④刀：并发限流与文件租约

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

实现线：t8-r4-impl

## ★0 先查别人

工作区锁的行号对应基线 `1f4d15189`。

- https://github.com/sindresorhus/p-limit/blob/v3.1.0/index.js · CommonJS 版本在任务拒绝后仍释放槽位 · 确认复用已锁定的 3.1.0。
- https://github.com/moxystudio/node-proper-lockfile/blob/v4.1.2/README.md#compromised · 续约失败可报告，但明确列出锁目录被移除重建时的检测盲点 · 确认保留盘上所有者校验。
- `electron/workspace/workspaceManifestLock.ts:324` · 仅已死 PID、宽限期已过的未完记录或本进程残留可回收 · 确认保留锁目录协议。
- `electron/productionRun/productionRunLock.ts:145` · 独占文件、过期时钟和单调写入栅栏各有职责 · 确认文件记录与目录记录保留各自盘上协议，文件记录可注入编解码、时钟、栅栏发布回调和错误。
- `electron/workspace/workspaceRepository.ts:5` · 主进程已有相同版本的导入形式 · 确认不用升级依赖。

出口：`electron/workspace/workspaceManifestLock.ts:471` · 等待有截止时间，释放共享冲突有补收 · 确认等待预算、退避与补收继续有效。

## ★1 用户结果

创作者保存项目、导入浏览器素材、拆解源片时，能够继续完成手上的工作。打开项目、开始保存、提交另一笔保存、等待写入完成、重新打开核对内容。另两条真实任务为从浏览器导入两个 blob，以及对有多镜的素材执行拆解。验收量具为锁及保存测试的成功提交比例、并发特征测试的峰值/上限和结果顺序、错误后队列的成功完成比例，目标与主线一致。界面量具未在本刀运行。

- ★1b 保存、素材导入、拆解沿用原状态和错误。
- ★1c 保留工作区锁目录、owner.json schema、暂存名和恢复协议，升级与回退继续读取同样记录。项目、模型和设置无格式迁移。

## ★2 主人和入口

锁机械操作归 `electron/shared/fileLeaseLock.ts`，项目根存在性和工作区错误归工作区锁入口，制作栅栏归制作运行。排队及拒绝后释放槽位归 p-limit，项目 ID、真实根路径、WebContents ID 和拆解执行各自确定队列范围。锁释放后的残留由下一次取锁及已有后台回收处理。

| door-map 目标 | 写 | 读 | 合计 |
| --- | ---: | ---: | ---: |
| electron/workspace/workspaceManifestLock.ts | 7 | 15 | 22 |
| electron/workspace/workspaceManifestTransaction.ts | 3 | 3 | 6 |
| electron/projects/projectCanvasWrite.ts | 3 | 1 | 4 |
| electron/browser/media/browserViewMedia.ts | 8 | 1 | 9 |
| electron/video/deconstructVideo.ts | 2 | 16 | 18 |

用 `rg` 检查 Promise 尾链、worker、队列、计数器及已有 p-limit。残留锁恢复原合同的锚随实现迁至共享层，见 `scripts/boundary-owners-ledger.json`。项目目录规则登记在 `docs/engineering/concept-owners/project.directory-lifecycle.json`，制作运行锁登记在 `docs/engineering/concept-owners/production.run-lock.json`。两条工作区事务入口分别服务同步立即失败、异步等锁，暂存入口再保住同根 FIFO。画布入口服务 patch 和 gateway，浏览器与视频各由现有 IPC 路径进入。

## ★3 一致与复用

重复队列机制属于可复发的维护风险。本刀是现有行为的替换，无用户报告的失效实例。保留自写队列会延续四份槽位管理，删除调度会丢掉互斥或并发预算，采用已有 p-limit。保留工作区目录协议和同步盘隔离语义（2026-09-24 共享冲突合同及 2026-10-22 项目根合同），复用 jsonFile 的重命名与原子写。制作运行 `productionRunLock.ts` 延后迁移的唯一原因是避免与停泊的 #1642 冲突。保留 3.1.0，待 Electron 运行和构建可验证 ESM 入口后再评估升级，验收用本卡 FIFO 和限流回归。

## ★4 全状态

空闲时可取锁，忙时同步拒绝或按现有期限等待，成功提交保持原回执，失败保留原因，单镜失败保留其原因并继续，取消沿用拆解已有信号及停止派发，进入恢复的锁由所有权判断阻止旧持有者操作。能力不可用及其出口沿用现有入口。无新界面、布局或文案。

## ★5 中途与出口

关闭或重启时同机死 PID 由下次取锁恢复。断网由素材和拆解调用原有错误路径处理。连点由原键粒度排队。拆解取消由已有 signal 控制，派发与收费规则沿用现有授权。

出口：`electron/workspace/workspaceManifestLock.ts:471` · 等待有截止时间，释放共享冲突有补收 · 确认等待预算、退避与补收继续有效。

## ★6 外部数据

磁盘旧记录继续按原格式解析。其他主机、未知 PID、共享冲突按忙处理。制作型文件租约的 TTL 用注入的时钟验证，保存 owner token、比较、更换和清理由共享层统一提供。文件协议在本机用同一份目录锁串行化 read/renew/reclaim/release，确保写者不会在核验和删除之间换手。制作运行接入时，同一租约的写入进程需一起切换到受此互斥保护的入口。

## ★7 性能

现有操作预算。并发峰值由视频与三个串行入口特征测试测量，基线为拆解配置上限与每键一个写者。无新增交互。

## ★8 真实条件

真实文件系统由工作区保存测试覆盖。Windows FileShare.Read、真桌面英文界面、真账号、真付费、干净安装、最小窗口及键盘链在实现线记为 unverified。拍板图不适用，改动位于主进程。

## ★9 验收与回滚

先在主线运行特征测试，再运行相同测试及共享租约单测。完成与全拦截均须有可区分的测试结果。验证同根 FIFO/拒绝续跑、画布同键 FIFO/拒绝续跑/跨键并行、浏览器同 WebContents FIFO/拒绝续跑、拆解上限/逐镜错误/结果顺序。实盘覆盖活锁保持、死 PID 接管、替换 owner 不删除、EPERM/EACCES 退避、目录锁原格式。文件租约覆盖 wx 冲突、超时续期和接管、旧 owner 释放、发布失败回退。反例为加一个并发槽、跳过 owner 校验、关闭 stale 接管，各在独立工作树先红再恢复绿。合并前按同表独立核对。回滚为 revert 实现提交，特征测试仍适用于原实现。
