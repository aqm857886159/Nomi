# electron/workspace 结构评审（症状簇触发，2026-09-24）

触发：`check:symptom-cluster` 报 `electron/workspace` 在 2026-09-20 到 2026-09-24 的 7 天里收到 3 份根因合同，同时 `electron`（顶层文件的粗分桶）也收到 3 份。R21 的要求是：第三份合同出现后，先回答「这一层的结构有没有问题」，再继续修。

## 三份合同放在一起看

| 合同 | 修的是什么 | 暴露了 workspace 层的哪个假设 |
|---|---|---|
| `2026-09-20-storyboard-confirmation-target` | 异步提交时，前台选择与持久化的项目绑定被混用 | 只是顺带碰到 `workspaceRepository.ts`（绑定身份），不是本层的缺陷 |
| `2026-09-24-library-missing-assets-blocks-open` | 项目库的同步预检把「从别的项目拖进来的素材」算成缺失，拦住了打开 | **项目文件夹会被第三方同步工具搬来搬去**，引用关系必须经得起这件事 |
| `2026-09-24-manifest-lock-sharing-violation` | 同步盘 / 杀毒软件开着 `owner.json`，Windows 上释放锁失败，锁永久卡在本进程 | **项目文件夹里的文件会被别的程序在任意时刻打开** |

## 结构结论

后两份合同同根，第一份不是。

`electron/workspace` 的持久化设计（清单事务、目录锁、事件日志、备份文件）默认项目文件夹是**本机私有、独占、按 POSIX 语义工作**的磁盘目录：

- 锁用「目录改名」发布和释放，用「pid 活没活」判断持有者；
- 锁、事件日志、候选目录、备份文件都和用户素材放在同一个 `.nomi/` 里；
- 保存是整份覆盖（最后写的赢），打开期间不回读磁盘。

2026-09-02 上线的「换电脑继续」（`docs/superpowers/plans/2026-09-01-cross-device-project-continuation.md`）引导用户把项目文件夹放进坚果云、微力同步这类同步工具。这一步**改变了这一层所在的环境**：文件夹变成被第三方程序持续扫描、复制，跨主机共享。可这一层的假设没有随之重审。于是出现了两类问题：

1. **Windows 上的共享冲突**：同步工具或杀毒软件打开刚写出的文件，改名或删除就会失败（本次的锁问题）。
2. **跨主机的状态被一起同步**：锁目录、候选目录、事件日志跟着同步到另一台电脑。另一台电脑看到「别的主机正持有」的锁，就会一直忙下去。缺素材的误判也属于这一类，引用关系被同步工具打乱。

本次锁修复解决了第 1 类在本进程里的永久化，并尽快清理残留，缩短第 2 类的影响窗口；**第 2 类本身没有解决**。只要锁文件还放在会被同步的目录里，机器 B 崩溃后留下的锁仍会挡住机器 A（合同 residual_risks 已写明）。

## 建议（结构层面，不在本 PR 实施）

1. **给项目文件夹写一份「存储环境契约」**，三档分开说清楚：
   - (a) 本机私有目录：完全支持；
   - (b) 同步盘，同一时刻只有一台电脑在写：支持，这是「换电脑继续」承诺的场景；
   - (c) NAS 或共享盘，多人同时写：**不支持**。今天会互相覆盖，锁也可能互相挡住。
   每一档都要写明锁、日志、备份的行为。
2. **把「只对本机有意义的状态」移出同步目录**：事务锁、候选目录、进程内事件序号都属于这类，可以放进本机 userData，按项目的规范路径做键。项目文件夹里只留需要跨设备的东西（清单、备份、素材）。这样同步工具就再也看不到锁文件，第 2 类问题从结构上消失。它会改变锁的跨进程语义（同机多个 Nomi 进程仍需互斥，跨主机改用清单 revision 判断冲突），属于架构岔路，需要单独出方案并由用户拍板。它和用户提出的「NAS 团队协作」是同一个设计问题，建议合并讨论。
3. **Windows 纳入验收平台**：这一层和渲染层（同日的 WebGL 着色器卡死）的问题都只在 Windows 上出现，而此前的性能和持久化验收全在 macOS 与 Linux CI 上跑。同一轮的 Windows 巡检脚本（真实 Electron、10 条用户动作、三处计时，外加模拟同步盘占用）应该固定成发版前在 Windows 机器上跑的一步（对应 TODO T-QA-09）。

## 补充：`electron/assets` 这一簇（同日第二次触发）

同一天的 Windows 巡检（`tests/ux/windows-freeze-sweep.walk.mjs --held`）又抓到一条：项目文件夹被同步盘 / 杀毒占用时，工具栏导入偶发「本地素材复制失败」。原因是素材已经链接进项目了，但随后清理暂存目录时撞上 Windows 的共享冲突，这个清理错误把成功改写成了失败。修复合同是 `2026-09-24-asset-import-sharing-violation`，它让 `electron/assets` 在 2026-09-18 到 2026-09-24 之间累计到 4 份合同：

| 合同 | 和 assets 的关系 | 是否同根 |
|---|---|---|
| `2026-09-18-verb-host-input-conformance` | 模型动词与宿主入参之间的手写翻译没有对账；只是顺带改到 `projectAssetStore.ts` | 否 |
| `2026-09-19-composer-lifecycle` | 参数框等临时 UI 状态没有唯一 owner；只是顺带改到素材引用身份 | 否 |
| `2026-09-21-config-never-silently-lost` | 读配置时把「缺失 / 损坏 / **被占用**」混成同一个默认值 | **是**：同样是「文件被别的程序占着」没有被当成独立状态处理 |
| `2026-09-24-asset-import-sharing-violation` | 清理暂存时的共享冲突把导入成功改写成失败 | 是 |

结论：`electron/assets` 的结构问题和 `electron/workspace` 是同一个。项目文件夹被放进同步环境以后，这两层对文件系统的默认假设（能随时独占地删除、改名、读取）都不成立了；「被别的程序短暂占用」从来没有被当成一种独立状态设计进去。今天的处理方式是：

- 共享冲突的同步重试只保留一份策略（`jsonFile.retryOnSharingViolation`），锁、注册表、导入的链接和改名都用它；
- 异步清理用 Node 自带的 `rm` 退避重试；
- 所有「清理」都不能改写「结果」（锁的释放、导入的暂存清理）。

上面「建议 1、2」里的存储环境契约，应把素材库一并写进去：哪些文件是跨设备的真相（素材本体、`.meta`），哪些只是本机过程状态（暂存、预览草稿、锁），后者应当离开同步目录。

## 关于 `electron` 顶层这一簇

`electron` 这一簇的三份合同分别是 `2026-09-21-run-path-prompt-projection`（`electron/runtime.ts` 的提示词投影）、`2026-09-22-vendor-connection-identity`（连接身份）和本次锁修复（`electron/jsonFile.ts`）。三者只是都碰了 `electron/` 顶层文件，被门岗按目录归到了同一个模块键，并不共享结构缺陷。本次对 `electron/jsonFile.ts` 的改动，是把「Windows 共享冲突重试」收成唯一一份策略（`retryOnSharingViolation`），它不是第三次修同一处。结论：顶层这一簇不需要结构改动；门岗按两级目录分桶，把 `electron/` 下所有顶层文件归为一类，这个粒度偏粗，已如实记录，不在这里改门岗。

## 补充：`electron/agentLane` 这一簇（同日第三次触发）

同一天真模型走查（Windows 11，apimart DeepSeek V4 Pro）发现：Windows 上 Agent 面板**点发送没有任何反应**。合同 `2026-09-24-lane-identity-host-path` 让 `electron/agentLane` 在 2026-09-18 到 2026-09-24 之间累计到 **18 份**根因合同。这个数字本身就是结论的一半：这一层一周里被改了 18 次，门岗要求的「第三份合同先出结构评审」在这一层早就不是第三份了。

**本次这一份和前 17 份是不是同根：不是。** 前 17 份的类根因集中在三件事上（按合同的 `class_root` 归并）：

| 归并后的类根因 | 代表合同 |
|---|---|
| 同一个能力被重述多遍（动词声明 / 传输翻译 / 契约 schema / handler / 投影），靠手抄保持一致 | `verb-transport-translation-derived`、`verb-host-input-conformance`、`draft-shots-drops-declared-model-identity`、`shot-envelope-fields-die-in-hand-written-projections`、`model-face-refers-to-fields-the-model-cannot-fill` |
| 同一个语义有第二个家（分镜方案、权限档位、「在等用户」、任务身份） | `agent-storyboard-single-ledger`、`agent-plan-one-home`、`permission-tier-single-owner`、`waiting-for-user-one-owner`、`core-task-identity` |
| 生命周期不同的东西共用一份输入/身份（历史 vs 运行时、界面寿命 vs 已批准的执行、Stop 前后的输入） | `pi-history-read-side`、`original-input-replay`、`stop-pre-admission`、`storyboard-confirmation-target` |

本次是第四类，而且和本文前两节同根：**平台假设**。会话身份 `/nomi-lane/<名字>` 被当成「POSIX 上的绝对路径」交给宿主 `path.resolve`，Windows 给它补了盘符；外加准入步骤把「无法接收输入」表达成静默的 null。它之所以活过 16 天，不是这一层的结构让它难修（修法是在 pi 拿到的唯一 `FileSystem` 上加一行），而是**这一层的全部测试从来没在 Windows 上跑过**——`tests/agent-runtime` 在 Windows 上用 Electron 自带 Node 跑，至今仍有约 19 条红，从没人看过（分诊中）。

结构结论：

- 平台这一类：修在最早边界（`createLaneFileSystem`）即可，不需要改 agentLane 的分层；需要补的是 Windows 验证链（`docs/release-process.md` §4 已加「Windows 上 Agent 真能说话」一项；agent-runtime 进 win-gate 等分诊结论）。教训见 `docs/lessons/mac-only-testing-ships-windows-blind.md`。
- 前三类：18 份里 17 份指向「重述与第二个家」，这是真正的结构问题，本评审**没有**逐份核对其修复是否已经把重述收成单一来源，也不在本 PR 处理。建议单独做一次 agentLane 结构评审：以 `docs/engineering/concept-owners.json` 为底，列出这一层每个概念的 owner 与所有重述点，看 18 份合同之后还剩几处手抄。
