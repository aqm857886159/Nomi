# 方向检查：materialize 崩在 artifact.add 和 job.status 之间（T10）

> 触发：`node scripts/fix-churn.mjs electron/productionRun/productionGenerationSubmission.ts` 命中，文件 14 天已有 4 个 fix，这一刀是第 5 个。文件本身命中，不在协调代批例外内，结构性结论交用户拍板。
> 同一页还覆盖这条线另外几处命中，见文末「同一决定里的其余命中」。
> 设计卡：`docs/plan/2026-10-31-run-retrieval-recovery.md`。

## 0. 一句话根因

一次落地要写好几份记录（产物文件、`artifact.add`、`job.status`、信封、Run 收尾），它们本来就做不到一次写完；缺的不是更原子的写法，而是「产物已经在账上，下一个来查的人负责把后面几步补齐」这条不变量。#1393 重写 materialize 时把这条补齐删了。

## 1. 归类表：前 4 个 fix → 直接原因 → 类

| 提交 | 这个文件改了什么 | 直接原因 | 类 |
|---|---|---|---|
| e24f32d62（10-17） | 1 行：`materialize` 带上冻结合同的上下文 | 重启后取产物不知道这笔任务的模型 / 模式，把回显的参考图当成产物 | 取产物读什么 |
| e849e7609（10-28） | 9 行：只有「结果未知」才记进信封 | 同步供应商答了、本机落地失败，被记成结果未知 | 提交失败的结局分类 |
| 879d8cd5c（10-30） | 2 行：同样的 pending 不写快照 | 轮询时的整份落盘造成卡顿 | 等待期间的空转成本 |
| 1fcc7ed01（10-31） | 重写 `poll` / `materialize`，约 200 行 | 两个观察者交错时旧观察盖新观察、并发落地 | 观察与落地的并发围栏 |

**是不是同一类：不是。** 前 3 个各是一类，这个文件只是「提交出口」的唯一家，所有修复都得经过它。只有第 4 个和 T10 同类：T10 就是第 4 个的回归，它的前一版有这一句（`if (job.status !== "ready") command(... materialize-job ...)`），重写时没有带过来。

#### 三条体验铁律

不适用：这是崩溃恢复的状态机，不涉及说的 / 摆的、能选到、点了等于以为的。结账挂矩阵测试（`tests/fixtures/run-retrieval-recovery-cases.json`）。

## 2. 为什么这一类会一直出现

这条路的写入跨三种存储：项目文件（产物字节）、Run 的事件日志、信封文件。任何两步之间都可能崩或抛错。只要代码里「已经落地了」的判断点不负责把后面几步补齐，每重写一次就可能丢一处。今天「已有 ready 产物」有 4 个出口（锁外早返回、锁内 `if (ready)`、`materializeOutput` 抛错后复查、写之前复查），各写各的。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 成品在、Run 永远不收尾，节点这一镜一直锁着 | `electron/productionRun/productionGenerationLifecycle.test.ts` 里的崩溃点用例 |
| 下一次重写 materialize 再丢一个出口 | 矩阵测试遍历「已有产物」的每个崩溃点，丢一个就红 |

## 4. 靶子独立性检查

矩阵和复现由另一条验收线先写（`V-gen-idle-work` 的 T10），本线按它的步骤收进仓库；反例「拿掉修复要红」按字节还原核过。

## 5. 现成方案

这是领域内的 Run 账本，没有可接入的库。文件型事务（比如换 SQLite）能把事件写进一个事务，但产物字节和信封仍在事务外，补齐一样躲不掉，而且要迁全部 Run 数据：不值。

## 甲的卖点核实：`executeBatch` 是不是全写或全不写

**结论：不是。** 被杀进程时没观察到半写；磁盘写到一半时明确会半写。「崩溃窗口从结构上消失」这个说法不成立。

看代码（`productionRunRepository.ts` 的 `appendDurableJsonLines` / `executeBatchUnlocked`）：所有事件拼成一个字符串，一次 `fs.writeSync` 写进事件日志，再 fsync，然后写命令记录、写快照。没有事务，也不检查短写。代码自己承认这一点：重放同一批时有 `Production command batch was only partly recorded`。

实测（真仓库、真 fsync，脚本在本线临时目录，不进仓库）：

| 场景 | 两条 `execute`（现状） | 一次 `executeBatch` |
|---|---|---|
| SIGKILL，单行约 30KB，各 50 次 | 半写 20 次 | 半写 0 次 |
| SIGKILL，单行约 2MB，各 30 次 | 半写 15 次 | 半写 0 次 |

事件日志切到不同位置（模拟断电或磁盘满的短写）后读回：

| 切在哪 | 读回结果 |
|---|---|
| 第一行中间 | `ProductionRunParseError`，整个 Run 读不出（单条 `execute` 也一样） |
| 正好第一行之后 | **只有第一条命令生效，就是 T10 的半状态**；重放同一批抛 `only partly recorded` |
| 第二行中间 | `ProductionRunParseError`，整个 Run 读不出 |

没核的：SIGKILL 的 0 次只是这台 Mac（APFS）上的 160 次采样，不是操作系统保证；Windows 未测；真断电没有做，上面是切文件模拟。

## 6. 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 乙：补齐 | 已有 ready 产物的出口统一走一个函数：job 不是 ready / adopted 就补 `materialize-job:<jobId>`，再 `complete()` | 一个函数，换掉重复的出口 | 半状态还会出现，但下一次观察一定收尾 | **推荐** |
| 甲：批量写 + 补齐 | 乙的全部，再把两条命令换成 `executeBatch` | 多一处改动 | 断电或短写时半状态还在，补齐一样不能省 | 不推荐现在做 |
| 重写 | 落地换成真事务 | 迁全部 Run 数据 | 字节和信封仍在事务外 | 否 |
| 删 | 去掉 `artifact.add` 和 `job.status` 其中一份 | 改 Run 账本格式，读者全要改 | 动面太大 | 否 |

**我撤回之前对甲的推荐，改推乙。** 能结束这一类的是补齐，不是批量写：旧数据（已经崩过的 Run）和断电半状态只有补齐救得了；补齐做了，批量写只是让半状态少出现几次，而半状态本来就会被下一次观察收尾。

不做甲的代价：`artifact.add` 和 `job.status` 之间仍有几毫秒窗口，进程被杀或被并发写撞上（revision conflict）时还会进半状态。用户看到的是这一镜多等一轮观察才收尾，不多花钱、不丢产物。实测的 35/80 是紧循环里故意杀出来的比例，真实使用里每次生成只过这个窗口一次。以后想再缩窗口，可以单独加批量写，不影响这次的修法。

## 7. 用户要权衡的核心

是花一次改动把这几毫秒的窗口再缩小（但断电时还在），还是只保证「不管崩在哪，下一次查都能收尾」。我推荐后者，改动更小，保证也更强。

## 特征测试清单（动结构前先锁住）

- `electron/productionRun/productionGenerationLifecycle.test.ts`、`tests/fixtures/generation-lifecycle-cases.json`：#1393 的观察与落地矩阵，现状已钉。
- `electron/productionRun/productionRunRepository.test.ts`：`surfaces a torn final event…`、`only partly recorded`，事件日志的撕裂语义已钉。

## 同一决定里的其余命中

这几处和 T10 为的是同一件事：任务号还在的单子只取回、不重下。

| 文件 | 口径 | 14 天的 fix | 这一刀 | 为什么不能挪到别处 |
|---|---|---|---|---|
| `electron/productionRun/productionRunRuntimeEnvelope.ts` | 文件本身，第 3 个 | 1fcc7ed01 写出了等锁循环（T1 的来源），879d8cd5c 与此无关 | 无限重试换成 45 秒总期限：一个常量、一个条件、一个可选参数 | bug 就在这个循环里 |
| `electron/shared/nomiErrorCodes.ts` | 文件本身，第 5 个 | 4 个都是错误码阶段表和新码，不同类 | 在已有的旧数据解码处加一条整句正则，把两句旧话解成 `retrieval-query` | 这是最早的共享边界；挪到 `classifyError.ts` 一样命中（4 个 fix） |
| `electron/capabilityCore/appIntegrationCanvasShot.ts` | 概念口径（付费卡停下 3、画布付费生成 6、结果取回 8） | 见概念页 | `pollRun` 加一段「只差取回就放回轮询再查一次」，新增分支，不算纯换或删 | 画布「查」的唯一入口 |
| `src/workbench/generationCanvas/runner/recoverTaskActions.ts` | 目录口径（13 个 fix） | 同目录其他文件 | 一行硬编码中文换 i18n，是换 | 协调代批 |

### 那两句旧中文会不会出现在真失败上

**结论：不会把真失败变成重新取回，不需要在解码处再加条件。「节点上有任务号」这个条件已经在错误卡上。**

| 旧话 | 全部写入点（`git log -S` 只有一次引入、从未搬家） | 什么时候写 | 没有任务号时 |
|---|---|---|---|
| 生成结果未能安全落入项目，请查看任务并处理 | `markSingleShotAttention` | job 还在进行中（`needs_attention` 不覆盖）。观察者、查询路径都要求有任务号 | 可能：`dispatch` 里 `start` 在写意向之前就抛错时 job 是 `authorized`，这时写的就是它。什么都没发出去 |
| 供应商返回了未识别的任务状态，需要人工核对 | `poll` 的 `onChanged`，`statusClass === "unknown"` | `poll` 开头要求有任务号，否则直接抛 | 不可能 |

- **供应商明确说失败不写这两句**：当场拒绝写 `provider_rejected`（`submissionOutbox`），任务失败写 `provider_task_failed` + 「供应商任务已返回失败状态」。这两种 job 已经是 `needs_attention`，`markSingleShotAttention` 不覆盖。
- **有任务号，但其实供应商已经判了失败**（`onChanged` 那次写撞了版本，旧版本才落下第一句）：点「重新取回」免费查一次，供应商回失败，卡片变成失败 + 重试。最多多一次 GET，不多 POST。
- **没有任务号**：`NodeErrorReport` 读节点的 `taskId`，没有就走 `narrateGenerationErrorWithoutTask`，主按钮是重试。`outboundBlockedRecoverableMessage` 同样要求节点有 `taskId` 才落可找回。矩阵的旧数据格钉住这一点。
- **一个小缺口**：没有任务号走到第一句时，说明文字是「结果放在了回答里」那一版，和实情不符；主按钮对。范围太窄，记进报告，不在这里修。

## 裁定

用户 2026-10-31 回复：「都按推荐」。协调转达，批准范围如下，再有新的文件本身命中要重新请示：

- T10 走乙：已有 ready 产物的出口收成一个函数，job 没跟上就补 `materialize-job:<jobId>`，再 `complete()`。不做批量写。
- T1：`productionRunRuntimeEnvelope.ts` 无限重试换成 45 秒总期限；损坏记录按 mtime 过期回收。
- 老项目错误卡：`nomiErrorCodes.ts` 旧数据解码加那两句。
- B4：`appIntegrationCanvasShot.ts` 的 `pollRun` 放回轮询再查一次。
- `recoverTaskActions.ts` 一行换 i18n：协调代批，事后报用户。

## 并进本 PR：本机查不了

用户 2026-10-31 回复：「并进本 PR」（协调转达）。用户看到的说明是：

- 查不了就进待取回，卡上写真实原因，不给「重试」。
- 恢复后点「重新取回」拿回第一单，不多扣钱；没恢复就点，不扣钱，卡还在。
- 这单不要了，点「标记失败」才能重新生成，这是用户知情接受的那一步。
- 关窗或重启后的第一眼是超时那句，点一次才变第三句。

**问题：** 模型或供应商被关、Key 没了时，Nomi 一个查询都发不出去，却把这一笔记成「供应商任务已返回失败状态」，主按钮是重试，点了再扣一次钱。窗口开着、关窗、重启，三种 × 三种故障，9 格实测都是这样：GET 0，POST 1。

**类：** 没问过供应商的结果被当成供应商的结论。旧注释说模型不可执行是永久条件，所以落失败终态。实际上开回来就能查，而且那时任务可能早就出片了。

**这几处命中都是这个决定直接带出来的，不是另外再补一刀：**

| 文件 | 口径 | 14 天的 fix 是不是同一类 | 这一刀 | 为什么不能挪到别处 |
|---|---|---|---|---|
| `electron/tasks/taskResultQuery.ts` | 文件本身第 4 个，目录第 15 个 | 不是。a686f84aa、ddf304f0d 管取回出口的阶段码，e849e7609 管提交失败的结局 | 一行判别码，改掉「永久条件」那段注释 | 只有这里分得清「没问」和「问了说失败」 |
| `electron/tasks/taskAdmission.ts` | 目录口径 | 同上 | 判别函数改名，加一个码，同提交删旧名，是换 | 判别已经住在这里 |
| `electron/capabilityCore/canvasTransportProvider.ts` | 概念口径（画布付费生成第 8 个，结果取回第 10 个） | 见概念页 | 查不了就抛错，走「这次没查成」那条已有的路 | 这是 Run 和传输的边界，抛错之后不用再加分支 |
| `electron/shared/nomiErrorCodes.ts` | 文件本身第 6 个 | 不是。都是加新码和阶段表，这个文件本来就是码的登记处 | 加一个码和一句固定英文 | 判别要从主进程带到界面，不从人话里猜 |
| `src/workbench/observability/classifyError.ts` | 文件本身第 5 个，目录第 7 个，概念第 7 个 | 一部分是。22eeb5760 和这次都是新的取回码要手动登记 | 手写的 4 个码换成已有的 `isRetrievalStageCode`，是换 | 不改的话新码被猜文案判成「API Key 无效」，主按钮去模型接入，次按钮重试。换了之后新增的取回码自动归族，这一类不再回来 |
| `electron/capabilityCore/appIntegrationCanvasShot.ts` | 文件本身第 3 个，概念口径 | 不是。e849e7609 管提交失败，962e31728 是这条线的 B4 | `settle` 多传一个原因 | 点过重新取回又失败是这里写账本，不传的话任务面板说不出真实原因 |
| `src/workbench/production/productionRunView.ts` | 目录第 4 个 | 不是 | 任务面板读同一份键，删掉两个写死的键 | 三处说同一句 |
| `src/workbench/generationCanvas/runner/runProjectDelivery.ts` | 目录第 15 个（`runner/`），文件本身没命中 | 不是。这个文件 14 天内只有 879d8cd5c，管等待期间的写盘 | 节点落可找回时告诉后台接手，只写这一处，复用「点停」已有的调用 | 见下面「第二次批准」 |

没命中但也改了：`readTask.ts`（改名带出来的分支，AI 读到的是「问不了，别再下单」）、`singleShotRunLifecycle.ts` 和 `appIntegrationRunObservation.ts`（传原因）、`recoverableCopy.ts` 和 `NodeRecoverableReport.tsx`（第三种说法）。

**分类器换判据前后对账：** 换之前和换之后，把每个错误码在中英两种语言下都过一遍分类器，比较分类、主次按钮、是否算服务商那一侧、说明文字和服务商原话。已有的 18 个码一个都没变，只多了 `retrieval-unavailable`（分类 `retrieval-incomplete`，主按钮 `view-task`，没有次按钮）。没有码从不给重试变成给重试。`tests` 里那张族表把每个码钉住，新增一个码不回答就红。

**不做的：** 不加从主进程到节点的新通道，所以第一眼的文案不准确，点过才准确（用户已知）。对账旧路和没有 Run 的渲染层旧路不动：前者现在只有已退役的旧剧本 Run 走得到，后者是旧记录，两条都写进交付报告。

### 第二次批准：节点落待取回时告诉后台接手

用户 2026-10-31 再次回复：「并进本 PR」（协调转达）。批的是：节点落待取回时告诉后台接手，包括点重新取回等满 10 分钟那条路。

**问题（矩阵实测）：** 窗口一直开着时，渲染层等满时限落可找回，就不再查了，可主进程不知道：Run 一直算在生成，没有人接着查。这时点「标记失败」再重试被挡，一直挡到关窗或重开项目，告诉用户的「标记失败才能重新生成」不成立。点重新取回等满 10 分钟之后也一样。

**用户知道的说法：**

- 查得到的，结果先落进项目；节点上点一下「重新取回」即现，这一下不联网、不花钱。
- 查不了就停下不再锁，标记失败再重试走得通。
- 单还在跑、还查得到时照样挡住，并说清「这一单还在跑」。

**渲染层落可找回的地方逐个判：**

| 位置 | 什么时候 | 落下之后 Run 有没有人接手 | 处理 |
|---|---|---|---|
| `generationRunController.ts` 轮询放弃 | 等够宽限、硬上限、阶段到期 | 没有，job 还在轮询 | 经投递口放手 |
| `generationRunController.ts` 取回族错误 | 轮询循环外抛出取回族错误 | 可能已收尾，放手无害 | 经投递口放手 |
| `recoverTaskActions.ts` 等满 10 分钟 | 点重新取回一直没出来 | 没有，job 还在轮询 | 经投递口放手 |
| `recoverTaskActions.ts` 查询抛错 | 点重新取回没查成 | 待取回的已收尾；否则 job 还在轮询 | 经投递口放手，观察者按 key 去重 |
| `recoverTaskActions.ts` 终态后读取或下载失败 | 查到了，落不下来 | 已收尾，放手无害 | 经投递口放手 |
| `recoverTaskActions.ts` 制作 Run 路 | 制作节点重新取回失败 | 归 Run 自己的调度 | 不动 |
| `recoverTaskActions.ts` `reopenRecoverableNode` | 错误卡回到面板 | 只是换一张卡 | 不动 |
| `canvasSnapshotNormalizer.ts` | 重开项目收敛卡住的节点 | `recoverOrphans` 接手 | 不动 |
| `capability/multiShotCanvasLanding.ts` | 制作 Run 的投影 | 归 Run | 不动 |

**收口：** 前五个都经过 `deliverRunOutcome`，所以只在它的「落可找回」那一支写一处，不到处加一行。落完再放手，观察者先落了结果也不会被盖掉。放手失败不影响落可找回，重开项目还会接手。

**不做的：** 后台查到的结果不自动显示到节点上。协调定的乙：这是又一条从主进程到节点的新通道，上一轮已经因为同样的理由拒过。代价只是点一下卡上本来就写着让点的按钮，立刻出。放手后观察者和点击撞在一起时，素材可能多一份相同文件（不多扣钱，矩阵钉住上限），协调定不修：合并在途查询会让两条路耦合，单独想清楚再做。

## 这一节的裁定

用户原话「并进本 PR」批了做法，批了两次：第一次是本机查不了，第二次是节点落待取回时告诉后台接手。`classifyError.ts`、`nomiErrorCodes.ts`、`appIntegrationCanvasShot.ts` 三个文件本身命中，协调判定是这个决定直接带出来的，算进这次批准，事后告诉用户改动面变大了。`runProjectDelivery.ts` 只是目录口径命中。批准只到这几个文件。

