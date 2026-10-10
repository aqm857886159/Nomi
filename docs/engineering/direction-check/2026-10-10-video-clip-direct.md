# 方向检查：视频节点「直接剪辑」（2026-10-10）

> 触发：`node scripts/fix-churn.mjs` 命中 `NodeVideoFrameToolbar.tsx`（14 天 4 个 fix，本刀第 5 个）、`ClipNodeTimeline.tsx`（5 个，第 6 个）、`electron/video/`（3，同概念）、`electron/preload/`（7）、`src/desktop/`（9）。
> 设计卡：`docs/plan/2026-10-10-video-clip-direct.md`；上游：第一片方向检查 `docs/engineering/direction-check/2026-10-10-video-frame-capture.md`（本机处理失败这一类就是那里立的）。用户 10-10 看过样张拍板，便签 3 点按推荐。

## 0. 一句话根因

这不是在修同一个 bug：热点文件之所以热，是因为它们是「视频卡所有动作」「剪辑时间轴所有手势」「主进程视频能力」的唯一入口，每来一个功能都要碰。本刀要防的是另一件事——**本机耗时处理（提取深度、剪辑）各自长一套进度 / 取消 / 失败的判断**。

## 1. 归类表

| 提交 / 改动点 | 直接原因 | 类 |
|---|---|---|
| `ClipNodeTimeline.tsx` 近 5 个 fix（手势归属、命中垫、打断回弹） | 手势入口分散、被打断没有统一回到拖之前（#1145 / #1149 已按类收进 `timelineGesture`） | 手势类；本刀**不动手势**，只加一个只读回调 `onResizeLive`，拖动小牌改色 |
| 遮罩 / 状态条 / 取消入口 / 可中断判据四处各问「是不是深度处理」 | 「本机处理阶段」没有唯一出处，深度先建了自己的前缀 | 本刀加剪辑就会第 5 处——先收成 `isLocalProcessingProgressPhase` |
| `NodeVideoFrameToolbar.tsx` 近 4 次 | 3 次 feat/chore + 1 次布局 | 文件是入口，不是同一个 bug 反复 |
| `electron/preload/mediaBridge.ts`、`src/desktop/bridgeMedia.ts` | 每个新 IPC 加三处声明（主进程 / preload / 渲染层类型） | 本刀加 3 个通道（trim / cancel / progress），沿用现有 video 族形状，不另开桥 |

## 2. 为什么这一类会一直出现

「本机处理」是产品里一个真实的类（没有服务商、没有模型、可取消、失败只能重试），但代码里它是被各功能逐个再发明的：深度写了自己的进度前缀、自己的取消登记；若剪辑再抄一份，第三个本机步骤（拆片）又抄第三份。铁律对应：⑫ 点了 = 以为的——「取消」要真的杀进程、删卡；「撤销」要真的整张卡没有。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 第 3 片「拆成视频片段」又写一份进度前缀与取消判断 | `git grep -n "isVideoDepthProgressPhase\|isLocalProcessingProgressPhase" src` 的调用点数 |
| 剪辑成片用 `addNodeResult` 落地（「钱已花、撤销不许撤掉」的语义），Ctrl+Z 把带结果的卡叠回来 | 真 Electron 走查 05（成片落下之后一次 Ctrl+Z）——**这个坑本刀踩到过一次，已修**：本机免费处理的成片作为建卡那一步的一部分落下 |

## 4. 靶子独立性检查

尺子：用户 10-10 拍板原话（卡 + 线 + 结果一步撤销；取消不留空壳；失败只留重试；红色小牌改中性）。走查读真窗口里的读数 / 按钮 / 文件，不读实现；成片「从原视频第几秒开始」从像素反推（夹具每一帧写着自己的时间），时长从成片文件读。

## 5. P0：这些是我们独有的吗？现成方案有哪些

- 剪视频：ffmpeg（已在用）。**不新接库**：Remotion / ffmpeg.wasm 等是另一条渲染链，主进程已有原生 ffmpeg。导出管线（`exportTimelineToMp4`）能剪，但按 1080p 档 + 预设画幅重新排版，不是「保持原样切一段」，看过、不用。
- 时间轴 UI：看过 `react-timeline-editor`（总设计卡已记录：另一套数据模型和拖拽，接进来就是仓库里第二条时间轴）；用户明确要求复用剪辑节点时间轴。
- 自写：「视频 + 区间 → 新素材」这一个主进程动作（领域：镜头 / 素材；落成项目素材 + 项目绑定复验）。

## 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 走导出管线剪 | 小 | 分辨率 / 画幅被改，用户剪一段得到一个被重排的片子 | 否 |
| 补（深度旁边再抄一份） | 剪辑自己写进度前缀 / 取消判断 | 小 | 第三个本机步骤再抄第三份 | 否 |
| 补（按类） | 新增 `localProcessingPhase`（深度、剪辑共用），遮罩 / 状态条 / 取消入口 / 可中断判据四处改读它；主进程新动作复用 export 的 ffmpeg 路径与进度解析 | 中 | 低：深度的行为不变（单测 / 走查覆盖） | **推荐** |
| 重写（限一个模块） | 把剪辑节点时间轴重写成可复用裁切控件 | 大 | 手势类刚收口，重写会把 #1145 / #1149 的成果丢掉 | 否 |
| 删 | 不做 | — | 用户已拍板要做 | 否 |

选「补（按类）」：没有旧实现要替，缺的是一个共用的入口。

## 7. 用户要权衡的核心

已拍板：默认精确切 + 重编码（慢但帧精确）。代价：长视频要等；靠进度条 + 取消兜住。「无损快切」作为显式选项留到以后。

## 特征测试清单（动结构前先锁住）

- `src/workbench/generationCanvas/runner/` 与 `nodes/` 下现有进度 / 取消相关测试（深度行为不变）。
- `tests/ux/video-depth-real-task.walk.mjs`（提取深度真任务，保持）。
- `src/workbench/generationCanvas/nodes/ClipNodeTimeline` 相关测试与 `tests/ux/` 剪辑手势走查（只加回调、改小牌色）。
- 第一片的 `tests/ux/video-frame-capture.walk.mjs`（浮条按钮仍在）。

## 追加：载入收口（V-clip1 阻断的修复）与自写登记 canvas-undo-journal-write-boundary

触发：修复提交碰了 `store/canvasDocumentCommit.ts`（命中自写登记 `canvas-undo-journal-write-boundary`，under-review，评估方向是「撤销栈改成 Immer 反向补丁」）与 `store/canvasSnapshotNormalizer.ts`、`runner/localTaskControl.ts`、`electron/video/videoIpc.ts`。

- 为什么现在换不了现成方案：本次在 `canvasDocumentCommit.ts` 只改了「事件尾巴重放（`load-tail`）」那一行——重放之后对整张画布再调一次共享的收口函数 `convergeStuckMidFlightNodes`（此前只收口拆解表）。没有碰撤销日志、提交口或写边界本身；这一行是「载入后状态收敛」，与撤销栈用不用 Immer 反向补丁无关。
- 哪天换：该评估出结论时一并处理；届时撤销栈改写不会让这一行成为迁移负担（它只读重放后的节点，不读也不写日志）。
- 类根因与修法见 `docs/fixes/2026-10-10-local-task-interrupted-on-reopen.root-cause.json`：载入有两道门（快照 / 事件尾巴），收口只在第一道跑，第二道把存盘时的 running 写回；本机任务没有远端 job，也没人登记「被打断」的含义。现在两道门共用同一个函数，带重来事实（`hasLocalRedoFacts`）的 running 卡收成「被打断」失败卡（只留重试）；关窗 / 切走项目时把在跑的任务走同一个取消入口。
