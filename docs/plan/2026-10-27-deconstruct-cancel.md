# 设计卡：拆解点取消后不再发新的付费调用（第一刀）

```
改动名：点了取消，主进程不再发这次拆解的任何新付费调用、不再起新的本机子进程   线/负责人：I-deconstruct-cancel-r2   类别：[花钱][可打断]
```

- 状态：**用户 2026-10-27 拍板「五件都按推荐办」，分两刀，本卡是第一刀（0.24）**：点取消之后不再发任何新的付费调用——付费闸外层判 signal、编排里每一步发之前判 signal、ffmpeg 收到信号就停；`electron/runtime.ts` 一行不动。**取消时已经发出去的那一次请求照常结算**（立即断开挪到 0.25 的第二刀，见文末「不做」）。
- 方向检查（类根因复盘 + 选项表 + 拍板结果）：`docs/engineering/direction-checks/2026-10-27-deconstruct-cancel.md`。
- 前提实测（第 1 轮特征测试，全绿 = 修前现状；实现提交里翻成第一刀口径）：`electron/video/deconstructCancellation.test.ts`、`electron/video/videoIpcSession.test.ts`、`src/workbench/generationCanvas/nodes/shotTable/deconstructionTerminalState.test.ts`。

### 功能分类
- [ ] 新界面 / 改交互
- [x] 花钱
- [x] 长跑 / 可打断
- [ ] Agent 行为
- [x] 大数据量 / 画布 / 长列表（路径推出：改 `src/workbench/generationCanvas/`；不改画布渲染与规模，证据写「不适用」+理由）
- [ ] 生成效果
- [ ] 数据格式
- [x] 新增功能 / 性能（路径推出：新增 `AbortSignal`、文件名含 cancel；不新增交互，见 ★7）

| 格 | 结论 | 证据 |
|---|---|---|
| ★0 先查别人 | ① Electron `ipcRenderer.invoke(channel, ...args)`：只有通道和结构化克隆的参数，没有取消机制（<https://www.electronjs.org/docs/latest/api/ipc-renderer#ipcrendererinvokechannel-args>）· **确认了**「取消必须是第二条按 requestId 寻址的通道」，AbortSignal 过不了 IPC；② Node `child_process.spawn` 的 `signal` 选项：abort 等同 `kill()`，子进程发 `error`（`AbortError`），默认 `SIGTERM`（<https://nodejs.org/api/child_process.html#child_processspawncommand-args-options>）· **改了**「三处 ffmpeg 叶子各自手写 kill」的打算：直接把 signal 交给 spawn；`error` 与 `close` 都会来，Promise 只认第一次落定；③ 补预览的请求登记 `electron/assets/previewRequests.ts:23-67`：`发送方:requestId` 寻址（别的窗口撤不了）、发起窗口 `destroyed` 即撤、项目会话按周期复核、finally 清登记 · **确认了**登记形状；拍板第 5 题：挪成中立模块 `electron/ipcRequestRegistry.ts`，补预览与拆解共用一份，旧文件同提交删；④ 两个取消口的好坏先例：`electron/ai/antigravityIpc.ts:54-58` 校验发起者（`ANTIGRAVITY_OWNER_MISMATCH`），`electron/ai/textStreamIpc.ts:118-124` 不校验、谁拿到 streamId 都能撤 · **改了**取消口的校验：按 `发送方:requestId` 寻址（同一个窗口才撤得动，requestId 是渲染层现生成的 UUID），项目归属在开始时由 projectBinding 校验、过程中由项目会话复核；⑤ `electron/video/depthVideoIpc.ts:59-69`：同族视频长活的取消口 + `registerQuitDrain` 退出收摊 · **确认了**退出时走 `registerQuitDrain`，不在 `main.ts` 加行；⑥ `electron/outboundDispatchEvidence.ts:1-15`「已发 / 未知」口径 · **确认了**日志措辞：过了付费闸的记「已发或未知」，不说退款、不说没花钱；⑦ 本仓 09-22（`docs/plan/2026-09-22-deconstruction-node-terminal-state.md` §4）与 10-11（`docs/plan/2026-10-11-canvas-ux-8-issues.md` 中途表）两张卡把「取消 = 结果作废、已发出的照常结算」当成可接受 · **改了**：「没发出的照样发」是坏先例，本卡把「停止」收回主进程；「已发出的照常结算」第一刀保留（拍板），第二刀断开；⑧ `electron/capabilityCore/canvasTransportProvider.ts:162-168`：`runTask` 的第二个参数 admission 本来就是付费闸的接缝（画布单镜 Run 传 `RUN_APPROVED_ADMISSION`），`runtime.ts` 的每条付费出口发请求之前都先调 `admission.spendGate` · **确认了**第一刀的落点：在 admission 外层包一层「先看 signal」，`runtime.ts` 零改动 | 链接 / 文件行 |
| ★1 用户怎么用 | 当我拆一条参考片、报价确认后发现选错了视频（或不想等了），我点「取消」，以便后面的读图、转写**不再花钱**、电脑也不再跑。步骤：选视频节点 → 拆解 → （长片）确认报价 → 进度走到读图 → 点取消 → 表显示「已取消」→ 重新选视频再拆。**不做**：不改取消按钮和任何文案；不给单镜重试加取消按钮；不撤令牌；不新增落盘字段 / Run 收据；不改报价范围与涨价比较；取消那一刻已经发出去的那一次不断开（第二刀，见「不做」）。**已知坑**：报价卡是模态，卡开着时画布上的取消按钮点不到（卡上「取消」= 不确认，现状）；取消那一刻已经过了付费闸的那几次（并发 4：最多 4 次读图 + 1 次转写）照常发完、照常结算，结果作废不进表；在途的本机转写会跑完它那一段（几分钟）。**真实任务**：① 40 秒、20 多镜的广告片（超过 30 次调用要弹报价卡），确认后读到第 4 镜点取消；② 拆到一半切去另一个项目；③ 单镜重试时关窗。**指标**（目标 → 信号 → 指标）：主指标「取消后新过付费闸的调用 ÷ 取消那一刻还没过闸的报价行」，基线 100%（四个时机取消后又新发 7 / 3 / 1 / 2 次，全部发满），目标 0%，量具 `electron/video/deconstructCancellation.test.ts`（六个时机，替身照 runtime 的顺序「准备 → 付费闸 → 发出 → 回来」）；真 App 量具「零花费走查 + 回环假供应商计到达数」仓库里没有 → **未验证：缺量具**。质量指标：「取消那一刻在跑的本机子进程（探测 / 切点 / 取音轨 / 抽帧）收到同一个 signal」目标 100%，量具同一单测（替身记 options.signal）+ 叶子单测（spawn 收到 signal、abort 后不发布素材不写缓存）；「取消不记成失败」目标 100%（零条 `*-failed` 错误日志、回执里转写腿记 stopped / settled），量具同一单测；「点取消到主进程不再起新步骤」目标 = 下一步开始之前（同步判），量具同一单测；「点取消到主进程停稳」第一刀取决于在途那几次多久回来，**未验证：缺量具**（第二刀断开后再定预算）。护栏：「不取消的拆解结果不变」100%，量具 `electron/video/deconstructVideo.test.ts` 等现有拆解单测全绿 + 本单测「不取消」用例；「其余 runTask 门行为不变」，量具 `git diff` 里 `electron/runtime.ts` 0 行 + runtime / tasks 相关单测全绿 | 单测 / 走查缺 |
| ★1b 连带界面 | 不新增、不改任何文案。连带面逐个：分镜表顶上的「已取消」那句（现状，按当前语言渲染）不变；报价卡不变；Agent 读表看到的状态仍是 `cancelled`（概念 `agent.canvas-read-shot-table`，不改）；任务中心 / 通知：拆解不在任务表里，不露出；单镜重试：主进程回「已停」时不写表、不弹错；主进程日志新增一条 `deconstruct.cancelled`（不是界面） | 现有 `shotTableComposerStates.test.ts` / 日志断言 |
| ★2 谁说了算 | 「这次拆解停没停」唯一 owner 改到**主进程请求登记**（中立模块 `electron/ipcRequestRegistry.ts`，补预览与拆解共用；videoIpc 按 `发送方:requestId` 登记），新登记概念「主进程在途 IPC 长请求的停止」；「停了不许再进付费闸」只在 `electron/tasks/taskSpend.ts` 的 `stoppableAdmission`（同一个概念的第二个写接口）。渲染层 `deconstructionLifecycle` 只留「迟到结果作废」与表的终态，并在取消时把 requestId 交给取消口，不再是停止的依据。付费令牌仍是 `spendConfirmGrant → mintSpendGrant → consumeTaskSpend` 那一条：闸里面（`consumeTaskSpend` / `assertAndConsumeQuotedSpend` / 确认）一行不改，不新造取消令牌。碰到的已登记概念（只往下传 signal，不改语义）：`audio.transcript-shape`、`catalog.mode-serving`、`catalog.row-status`、`asset.video-cover`（登记挪走，概念不变）、`spend.pending-identity`（只用 `TOKEN_ADMISSION`，不碰它禁的四个符号）、`host.quit-teardown`。同一份事实：停止 1 份（主进程登记）。意图全走显式事件：用户点取消、`project.signal` abort、发送方 `destroyed`、项目会话失效、退出 drain，不靠「东西不见了」猜。门表：`deconstructVideo` 1 扇（`videoIpc.ts`）；`cancelDeconstruction` 1 扇（`ShotTableComposer.tsx:105`）；`deconstructToShotTable` 1 扇（`ShotTableComposer.tsx:51`）；`retryShot` 1 扇（`ShotTableNode.tsx:98`）；`runTask` 拆解那 1 扇（两处调用）改传带 signal 的 admission，其余门不变；`extractVideoFrameToAsset` 2 扇（拆解传 signal，`videoIpc.ts` 交互抽帧不传）；`extractAudioTrack` 1 扇（拆解）；`detectShotCuts` 2 扇（拆解传 signal，`videoIpc.ts` 切点面板不传）；`probeMediaMetadata` 拆解那 1 处传 signal；`createPreviewRequestRegistry` 1 扇（`assetsIpc.ts`）→ 换成 `createIpcRequestRegistry` 2 扇（`assetsIpc.ts`、`videoIpc.ts`）。不传 signal 的调用方行为不变 | `node scripts/door-map.mjs <符号>` |
| ★3 一致与复用 | 取消机制全用现成的：`AbortController` / `AbortSignal`（`signal.throwIfAborted()`）；ffmpeg 用 spawn 自带 `signal`；探测 `probeMediaMetadata.signal`、下载 `hardenedFetch.signal` 早就在，只缺接线。登记复用补预览那一份（拍板第 5 题）：挪成中立模块、旧文件删、`assetsIpc.ts` 改过去，补预览行为不变；退出收摊复用 `registerQuitDrain`。付费闸外层：`stoppableAdmission(signal, admission, onAdmitted)` 包住 `runTask` 本来就收的 admission——进闸前判一次（已取消不进闸、不扣钱），闸回来再判一次（闸里等人确认时取消了也不放行），一处判、全部 runner 共用；`TaskAdmission` 类型不改、`runtime.ts` 零改动（拍板第 6 题选 (b)）。`runTask` 下游的取消口（`executeProfileOperation.signal`、`executeTextTask.abortSignal`、`runCustomCallScript.signal`、`requestMultipart`、`runLocalSpeechTranscription.signal`）第一刀不接，第二刀接。`git grep` 结论：没有第二个拆解 IPC，也没有浏览器直连供应商的出口；导入转码那份登记（`electron/assets/importRequests.ts`）还没进 origin/main，本刀只收补预览与拆解两家 | `git grep` / `check:self-written` / `node scripts/check-file-sizes.mjs` |
| ★4 全状态 | 空 / 加载（三段进度）/ 成功 / 失败 / 部分成功（几镜没读出）：都不变。**取消中**：不新增过渡态——点取消，表立即是「已取消」（现状）；主进程从这一刻起不再起新的抽帧 / 读图 / 取音轨 / 转写，在跑的 ffmpeg 收信号退出；已经过了付费闸的那几次照常回来、结果作废；两条腿都回来后 IPC 回「已停」（`null`）。取消不落「失败」，不进 `failedShotIndexes`，不出「改用云端」那个按钮（只有 `failureKind = local-speech` 才出）。窗口关了 / 项目换了：同一个停止，表收敛成「已中断」（现状那句）。过期：令牌余额不撤，30 分钟后自然失效（`electron/spendGrant.ts:30`）。能力不可用：不适用（不新增能力）。文案：零改动，`check:i18n` 照旧 | `check:i18n` / 单测 |
| 5 中途表 | 见下文「中途表」：5 个阶段 × 停 / 关窗 / 断网 / 重启 / 连点 / 切项目，每格写看到什么 · 花费 · 回执 | 单测；走查缺 |
| 6 外部数据与失败 | ① Node spawn signal：规范见 ★0 ②；偏差：无；abort 之后即便抽帧恰好成功也不发布素材、不写缓存（叶子在发布前再判一次）；② 供应商 HTTP：第一刀不断开在途请求，已过付费闸的照常发完、照常结算，日志记「已发或未知」；③ 本机转写：在途的那一段跑完（`runLocalSpeechTranscription` 的 signal 第二刀才接）；取消之后回来的任何失败（含 `LocalSpeechError`）都按「已停」收，不认成本地转写失败；④ 付费闸里等人确认：确认回来时已取消 → 闸外层不放行，不发；⑤ 远端视频源（https）：`resolveVideoLocalPath` 的下载（`hardenedFetch`）收 signal；⑥ 用户输入：渲染层发来的 requestId / projectBinding 不可信——缺 requestId、缺 projectBinding、projectBinding 与 projectId 不符直接拒；绑定已失效（项目换了）按「已停」回 `null` | 官方文档链接 / 文件行 |
| ★7 性能 | 不适用：不新增用户操作（取消按钮照旧，点击后仍是一次同步的表状态写 + 一次不等回话的 IPC），只让主进程少做事；`perf-scenario：不适用：不新增交互，取消只减少主进程的抽帧 / 转写 / 读图`；`perf-real-scale：不适用：不改画布渲染、节点规模与列表` | — |
| 8 真实条件 | 单测在 macOS 跑；Windows `unverified`（ffmpeg 收信号的行为两平台不同，靠 spawn signal 抹平，未实测）；英文界面：不改文案，`unverified`；真规模（200 镜以上长片）`unverified`；干净安装：不涉及；**零花费走查** `unverified`：仓库里没有覆盖拆解取消的走查（查过 `deconstruction-interrupted-recovery`、`shot-table-node`、`shot-table-vision-leg`、`deconstruction-panel` 四条）；**真付费** `unverified`：由协调在专用工作树跑一次（见 ★9 D2）；键盘全程：取消按钮不变，`unverified` | 协调 |
| 拍板图清单 | 不适用：pure-bugfix（不改布局、元素、文案，只修行为） | — |
| ★9 验收与回滚 | 见下文「验收清单与反例」（A 验收项、B 反例、C 复发面、D 真实条件、E 自验命令），全部在动手前写定；回滚：revert 实现提交即恢复修前行为（无数据迁移、无落盘形状变化）；硬门 ⑫「点了 = 以为的」逐项对账在 A1–A3；⑩ ⑪ 不适用（不涉及意图参数与可选项）；独立验收：待协调派验收线 | 本卡 / PR 正文 |

## 中途表

格内依次是：看到什么 · 花费 · 回执。「主进程撤」= 请求登记里那一个 AbortController abort，信号同时到编排、付费闸外层、ffmpeg。表「已取消」= 表顶上现状那句「你取消了这次拆解。已拆出的都还在，点「重新拆解」可以重来。」；表「已中断」= 现状那句「这次拆解被中断了（应用关闭或切换了项目）……」。两句都不改。

| 阶段 | 停（点取消） | 关窗 | 断网 | 重启 | 连点 | 切项目 |
|---|---|---|---|---|---|---|
| 探测 / 切点（报价前，本地） | 表「已取消」；主进程撤，在跑的 ffmpeg 退出，报价卡不出 · 0 · 日志 `deconstruct.cancelled`（报价 0 行） | 发送方 `destroyed` → 主进程撤 · 0 · 日志 | 本地源不受影响；https 源下载失败 → 表「失败」+原话（现状） · 0 · 表上原话 | 进程没了；重开后表从 running 收敛成「已中断」（现状） · 0 · 无 | 取消后按钮换成「重新拆解」（现状）；重复取消无副作用；运行中不能再起第二条（现状） · 0 · — | `project.signal` abort → 同一个取消口；主进程项目会话复核也会撤 · 0 · 日志 |
| 报价卡待确认（超过 30 次调用才有卡） | 卡是模态，点不到画布上的取消；卡上「取消」= 不确认 → 表「失败」+「这次拆解没有确认，因此没有发出请求。」（现状） · 0，不铸令牌 · — | 待决卡按不确认收（现状）+ 主进程撤 · 0 · 日志 | 不影响（还没发） · 0 · — | 进程没了，卡也没了 · 0 · 无 | 同一时间只有一张卡（现状） · 0 · — | 待决卡按项目释放成不确认（`spendConfirm.ts:340`）+ 主进程撤；确认与切项目同时到达时，编排在令牌回来后先看 signal，不发 · 0；令牌没用，30 分钟失效 · 日志 |
| 读图并发 + 取音轨 / 转写在途 | 表「已取消」；主进程不再起新的抽帧 / 读图 / 取音轨 / 转写，在跑的 ffmpeg 退出；还没进付费闸的一律不进；已过付费闸的那几次照常发完、照常结算、结果作废；在途的本机转写跑完它那一段 · 没过闸的不花；过了闸的「已发或未知」；令牌余额 30 分钟后失效 · 日志：报价行数 / 已过付费闸（已发或未知）/ 从未发出 / 转写腿 | 同「停」 · 同「停」 · 日志 | 在途请求失败 → 该镜「没读出」+原话（现状，不重试）；转写失败 → 对白列顶上一句原因（现状）；不是取消 · 失败的请求是否计费由供应商定（已发或未知） · 表上原话 | 进程没了，在途请求随之断开；重开后表收敛成「已中断」 · 在途的「已发或未知」，没发出的不花 · 无持久回执（不改落盘，见残余风险） | 取消幂等；取消后立刻再拆 = 新 requestId、新报价、新令牌；旧那次回「已停」、不回写（现状保护保留） · 新的一次另算 · 日志两条 | 同「停」 · 同「停」 · 日志 |
| 收尾组表（两条腿都已回来） | 表「已取消」；主进程发现已取消就不交结果（回「已停」） · 已全部发出，花费已发生 · 日志（已过闸 = 报价行数） | 结果不写回 · 同左 · 日志 | 不涉及 · — · — | 收敛「已中断」 · 同左 · 无 | 幂等 · — · — | 结果不写回 · 同左 · 日志 |
| 单镜重试在途（1 次读图） | 没有取消按钮（不改界面） · — · — | 主进程撤：没进闸的不发；已过闸的照常结算、回「已停」、不写表 · 没发出不花；在途「已发或未知」 · 日志 | 那一镜「没读出」+原话（现状） · 已发或未知 · 表上原话 | 进程没了 · 同左 · 无 | 每次重试一个新 requestId、各自一次读图（现状） · 各算各的 · 日志 | 渲染层调取消口 + 主进程项目会话复核 → 同「关窗」（修前照发） · 同「关窗」 · 日志 |

## 验收清单与反例（动手前写定，实现线按它自验，验收线只核它）

**A 验收项**

- A1 六个取消时机（报价待定 / 取音轨中 / 第一镜读完 / 下一镜即将起跑 / 读图与转写还没进付费闸 / 付费闸里等人确认）：取消之后「过了付费闸」的次数**不再增长**（等于取消那一刻：0 / 4 / 6 / 5 / 0 / 0），进闸次数也不再增长（取消后新进闸 0 次 = 不扣钱），抽帧、取音轨不再新起；`deconstructCancellation.test.ts` 由「现状特征」翻成第一刀口径后全绿。
- A2 取消那一刻已经过了付费闸的那几次照常结算（照常回来、结果不进表，`runTask` 不收 signal）；在跑的探测 / 切点 / 取音轨 / 抽帧收到同一个 signal；叶子把它交给 spawn，abort 后不发布素材、不写缓存（叶子单测）。
- A3 取消不记成失败：编排抛专用错误 `DeconstructCancelledError`；抽帧 catch、读图 catch、转写腿的两个 catch（取音轨 / 转写，含 `LocalSpeechError` 归类）、`transcribeShots` 的 `.catch` 都先认取消——零条 `deconstruct.*-failed` 错误日志、不进 `failedShotIndexes`、不触发 `gateFailure`、不被认成 `local-speech`；IPC 对取消回 `null`（结构化，不靠文案）；表终态 `cancelled`，不是 `failed`。
- A4 IPC：缺 requestId / 缺 projectBinding / projectBinding 与 projectId 不符 → 拒，编排一次都不调；绑定已失效 → 回 `null`、编排不调；开始 → 取消（`ok:true`）→ 编排收到的 signal 已 abort、IPC 回 `null`；别的窗口撤不了（`ok:false`）；陌生 requestId `ok:false`；动态 import 期间到达的取消也生效（登记在第一个 await 之前）；发起窗口销毁 → abort；项目会话失效 → abort；退出 drain → 全撤；调用结束后 finally 清登记（在途数归 0）。
- A5 渲染层：`cancelDeconstruction` 标记之后**立即**调 `video.cancelDeconstruct({ requestId })`（和开始那次同一个 requestId）；`project.signal` abort（切项目 / 关窗）走同一个口；迟到结果保护保留；主进程回 `null` 不写失败——用户点的取消留「已取消」，窗口 / 项目没了收敛成「已中断」。
- A6 `retryShot` 带 requestId 与 projectBinding、走同一条边界：项目被换走 → 调取消口；主进程回 `null` → 不写表、不报错。
- A7 结构回归：已 abort 的 signal → 0 次解析源、0 次探测、0 次切点、0 次抽帧、0 次取音轨、0 次 `runTask`、0 次报价（`authorizeSpend` 不调）；`deconstructVideo` 的 options 里 `signal` 必填（typecheck）。
- A8 其余 `runTask` 门不变：`electron/runtime.ts` 0 行改动；`stoppableAdmission` 只有拆解一个调用方（`git grep`）；runtime / tasks 相关单测全绿；不取消的拆解照常发满、结果不变。
- A9 日志：取消时主进程记一条 `deconstruct.cancelled`（projectId、nodeId、requestId、报价行数、已过付费闸行数「已发或未知」、从未发出行数、转写腿 none / stopped / settled / failed）；全文不出现「退款」「没花钱」「未扣费」。

**B 反例（必须红；至少真做前三条，做完还原）**

- B1 拿掉付费闸外层的 signal 判断（`stoppableAdmission` 不判 signal）→ A1「还没进付费闸」「付费闸里等人确认」两个时机红（取消后照样进闸、照样发）。
- B2 恢复三处吞掉取消中的任意一处（读图 catch / 转写腿 catch 的 `LocalSpeechError` 归类 / `transcribeShots` 的 `.catch`）→ A3 红（出现 `*-failed` 错误日志，或回执的转写腿写成 failed）。
- B3 主进程放行缺 requestId 的拆解请求 → A4「缺 requestId 被拒」红。
- B4 编排每镜开跑前不判 signal → A1「第一镜读完」「下一镜即将起跑」红（新起抽帧 / 读图）。
- B5 叶子 spawn 不带 signal → A2 叶子单测红。

**C 这一类会从哪回来（复发面，各有拦法）**

- C1 新调用方复用 `deconstructVideo`：options 里的 `signal` **必填**，typecheck 拦。
- C2 编排里新加一个子步骤（比如再抽一张缩略图）：A7 的「已 abort → 每一步都是 0 次」按 mock 全集断言，新步骤不判 signal 就红。
- C3 新的付费执行路径（runtime 下游新 runner）：「停了不许进付费闸」在 admission 外层判，runtime 每条付费出口发之前都先调 `admission.spendGate`，新路径自动被拦（不改 runtime.ts）；在途断开要第二刀给 runner 接 signal（残余风险）。
- C4 多窗口：登记按 `发送方:requestId` 寻址，一个窗口撤不了另一个窗口的拆解（A4）。
- C5 旧数据 / 重启：表上残留的 running 由现有收敛规则变「已中断」（`canvas.interrupted-node-convergence`），主进程登记随进程消失，不留僵尸。
- C6 版本：渲染层与主进程同一个包发版，主进程对缺 requestId / projectBinding 的请求直接拒（A4），不存在「旧渲染层发来的停不了的拆解」。
- C7 同类入口：补预览与拆解共用一份登记（中立模块），旧的 `createPreviewRequestRegistry` 列入概念的禁止定义（概念门拦第二份）。

**D 真实条件（花钱走查）**

- D1 零花费走查：仓库里没有覆盖拆解取消的零花费走查 → 本刀不建，记 `unverified`（缺量具），留给协调另派。
- D2 真付费一次（协调跑）：专用工作树；产物标记字面量 = 主进程日志事件名 `deconstruct.cancelled`（修前不存在）；拆一条短片，第一镜读完点取消 → 供应商账单的调用数 = 日志里「已过付费闸」的行数（取消那一刻已经发出的照常结算），且之后不再增长。

**E 自验命令（实现线，每条记退出码）**

改到的 vitest（经锁）；ESLint；`node scripts/typecheck.mjs`（经锁）；`node scripts/check-concept-owners.mjs`；`node scripts/check-root-cause-contracts.mjs`；`node scripts/check-file-sizes.mjs`（`runtime.ts` 0 行）；`git diff --check`；推送前快检。

## 实现要点

- `electron/ipcRequestRegistry.ts`（新，中立模块）：`createIpcRequestRegistry` = 原 `previewRequests.ts` 那一份，加 `abortAll`；signal 被 abort 之后干活那一层抛的任何错都回 `null`。`electron/assets/previewRequests.ts` 同提交删，`assetsIpc.ts` 改用它。
- `electron/video/videoIpc.ts`：拆解进请求登记；缺 requestId / projectBinding、projectBinding 与 projectId 不符直接拒；在任何 await 之前按绑定固定项目会话（失效 = 已停，回 `null`）；新增 `nomi:video:deconstruct-cancel`（可信发送方 + requestId）；退出 drain 全撤。
- `electron/tasks/taskSpend.ts`：`stoppableAdmission(signal, admission, onAdmitted)`——付费闸外层先判 signal、闸回来再判一次；闸里面不动。
- `electron/video/deconstructVideo.ts`：options 加必填 `signal`；解析源 / 探测 / 切点 / 报价前后 / 每镜开跑与发读图前 / 发转写前判 signal；两处 `runTask` 传带 signal 的 admission（过闸计数）；抽帧、读图、转写腿两个 catch 与 `.catch` 先认取消；收尾等两条腿回来，已取消就抛 `DeconstructCancelledError` 并记 `deconstruct.cancelled`。
- `electron/video/extractVideoFrame.ts`、`extractAudioTrack.ts`、`detectShotCuts.ts`：可选 `signal` 交给下载、探测、spawn；abort 后不发布素材、不写缓存。不传 signal 的调用方不变。
- `electron/preload/mediaBridge.ts`、`src/desktop/bridgeMedia.ts`：`video.cancelDeconstruct({ requestId })`；`deconstruct` 的 requestId 与 projectBinding 必填，回值可为 `null`（已停）。
- `src/workbench/generationCanvas/nodes/shotTable/deconstructionLifecycle.ts`、`factBridge.ts`：标记取消时交出 requestId 并立即调取消口；`project.signal` abort 调同一个口；`retryShot` 生成 requestId、带 projectBinding；`null` 认成已停。
- 根因合同 `docs/fixes/2026-10-27-deconstruct-cancel.root-cause.json`（v3）+ 新概念 `ipc.inflight-request-stop`；`asset.video-cover` 的写接口挪走；旧合同 `2026-10-16-canvas-image-preview-contract` 改不动（历史合同一改就按新合同全量复核），它声明的共享边界按边界主人台账记 `reanchored` 到新模块。提交带 `Direction-Check:` trailer。

## 不做（第二刀 0.25 与其它）

- **在途那一次立即断开**（第二刀，0.25）：把 signal 交给 runtime 的 4 种 runner（`executeProfileOperation.signal`、`executeTextTask.abortSignal`、`runCustomCallScript.signal`、`requestMultipart` / `runLocalSpeechTranscription.signal`），取消时在途的读图 / 转写当场断开、本机转写当场停。要动 `electron/runtime.ts`（格式化后 665 行，顶在冻结上限），同一刀里必须从它迁出等量代码。第一刀里这几次照常结算，PR 正文与根因合同的残余风险写明。
- 把拆解迁进制作 Run（停止原因、收据、可续）：另立项，赶在令牌路例外到期（2026-11-15）前。
- 给单镜重试加取消按钮（改界面，要走设计流程）。
- 撤令牌作纵深（signal 在付费闸前后都拦；令牌 30 分钟自然失效）。
- trim、antigravity、depthVideo 各自的取消口收进中立登记：另一刀。
- 导入转码那份请求登记（`electron/assets/importRequests.ts`）：还没合进 origin/main，本刀不收，协调另派收口。
- 零花费走查 `tests/ux/deconstruction-cancel.walk.mjs`：本刀不建（D1）。
