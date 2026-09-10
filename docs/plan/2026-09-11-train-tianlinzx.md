# 合并列车：外部贡献者 tianlinzx #701–#719

> 状态：🚧 实施中
> 分支：`fix/train-tianlinzx-701-719`（19 个 cherry-pick + 1 个手工重构 commit）
> 范围：把 fork 上 19 个各自独立的小修 PR（基于 7b3e1945d，落后 origin/main 362 个提交，
> fork 上从未跑过 CI）收成一条列车，在当前 main 上重新验证一遍，一次 PR 交付，保留
> 原作者署名（`cherry-pick -x` + `Co-authored-by`）。
> 不动项：不改任何 PR 的修复逻辑本身（除 #710 因文件冲突需要手工重新落位）；不新增走查框架；
> 不动这 19 个 PR 触及范围之外的代码。
> 回滚：`git branch -D fix/train-tianlinzx-701-719` + 删除本 worktree，对 main 零影响
>（尚未合并）。
> 验收门：`pnpm run gates` 全绿 + 每个 PR 自带测试（若有）单独跑绿 + #708/#709/#719 的
> R13 走查断言。

## 背景

fork 分支基线 `7b3e1945d` 落后当前 `origin/main`（`9809892c5`）362 个提交，且 GitHub
Actions 从未在这些 fork PR 上跑过（fork PR 默认不触发需要 secrets 的 workflow）。逐个单独
合并会让 19 条流水线各自排队、各自触发一遍全套 CI（contracts + unit + 相关 journey/canvas
门岗），墙钟成本远高于收益——19 个都是同一形状的小修（root-cause 级的资源卫生/边界守卫/
一致性补丁），适合按 `docs/engineering/agent-orchestration-playbook.md` §27 的合并列车做法
收成一条分支一次验证。

## 先查别人

- 分诊证据文档：`docs/plan/2026-09-11-triage-board-evidence/fork-prs-triage.md` ——
  19/19 PR 逐条核实仍适用于当前 `origin/main`（读了每条 PR body 点名的确切函数/行号），
  18/19 `git merge-tree` 三方合并干净，仅 #710 与本仓 `afac7546d`（通知策略重构）在
  `useNodeImageEditing.ts` 的同三处写回点产生逐行冲突。
- 内部近邻先例（对应 R6 的仓库内版本）：#703（时间轴删片段不清转场引用）修的是
  `src/workbench/timeline/timelineEdit.ts:120-160` 的 legacy 编辑路径；kernel 编辑路径
  `src/workbench/timeline/kernel/timelineKernel.ts:423` 早就有
  `timeline.transitions?.filter((transition) => !ids.includes(transition.fromClipId) && !ids.includes(transition.toClipId))`
  这一行——#703 的修复就是把 legacy 路径补成跟 kernel 路径一样的清理逻辑，不是发明新概念。
- 各 PR 自身：每条 PR body（`git show refs/pr/<N>` 可查）都点名了它照抄的「同文件既有
  姊妹写法」作为落地依据，例如 #711 抄 `updateTimelineTextClip`（`workbenchStore.ts:721`）
  已有的 push-undo-clear-redo 写法给 `updateTimelineTextClipFont` 补齐；#717 抄同文件
  `rebuildCachedTaskFromPayload` 已有的守卫模式给 `findExecutableModel` 调用补 try/catch；
  这些都不是「自研新解法」，是「补齐同文件内已有的一致性」，风险面因此可控。
- GitHub PR 元数据核实（`gh pr view <N> --repo aqm857886159/Nomi --json author,commits`）：
  确认 19 个 PR 的 GitHub 作者都是 `tianlinzx`（提交里的 `calvin <calvin@local>` 是其本地
  commit author 配置，不影响署名认定）。

## 19 个 PR 状态

| PR | 标题 | cherry-pick | 测试 |
|---|---|---|---|
| #701 | flush-save 跨项目切换保活防抖存盘意图 | 干净 | 自带（persistence.test.ts）绿 |
| #702 | poll 失败先给 45s 宽限期再判付费任务失败 | auto-merge 干净 | 自带（core.test.ts）绿 |
| #703 | 删片段连带清理引用它的转场 | 干净 | 自带（timelineEdit.test.ts）绿 |
| #704 | 仅 query op 供应商不许落空成功 | 干净 | 自带（queryOpEmptySuccess.test.ts）绿 |
| #705 | 豆包 TTS NDJSON 走加了字节上限的 fetch | 干净 | 自带（audioTaskRunner.test.ts）绿 |
| #706 | 文本流正常结束时解绑 destroyed 监听 | 干净 | 自带（textStreamIpc.test.ts）绿 |
| #707 | V51→V60 迁移门也查 meta.referenceImageUrls | auto-merge 干净 | 自带（migration.test.ts）绿 |
| #708 | 手动缩放不再被自动 fit 弹回 | 干净（无自带测试） | 补：R13 走查，已实跑通过（见下） |
| #709 | 自愈结论不覆盖重新生成的结果 | 干净（无自带测试） | 未补：见「未完成」 |
| #710 | 图片编辑合并到节点最新状态而非渲染快照 | **手工**（与 afac7546d 冲突） | typecheck 绿；行为走 R13（见下） |
| #711 | 换字体压 undo 栈清 redo 栈 | auto-merge 干净 | 自带（timelineUndo.test.ts）绿 |
| #712 | 批量重新生成回填时间轴片段 | auto-merge 干净 | 自带（generationQueue.test.ts）绿 |
| #713 | 渲染层崩溃 IPC 通道补 sender 守卫 | auto-merge 干净 | 自带（crashLog.test.ts）绿 |
| #714 | comfyui 转换清 race 定时器+停轮询已销毁窗口 | 干净（无自带测试） | 检视证明（见 PR body） |
| #715 | comfyui open 超时关闭僵尸 websocket | 干净 | 自带（comfyuiProgressSocket.test.ts）绿 |
| #716 | 观察窗口按墙钟计不只计 sleep | 干净 | 自带（singleShotGenerationObserver.test.ts）绿 |
| #717 | 模型解析失败落诚实终态 | auto-merge 干净（与 #704 同文件） | 自带（modelUnresolvableQuery.test.ts）绿，且与 #704 测试共存绿 |
| #718 | 字符串错误码不限 3 位 | 干净 | 自带（requestPipeline.test.ts）绿 |
| #719 | 去重 '?' 快捷键 + pointercancel 清理 scrub 监听 | auto-merge 干净 | 补：'?' 去重 R13 走查已实跑通过；pointercancel 部分见「未完成」 |

## #710 手工重新落位

`useNodeImageEditing.ts` 的裁剪/旋转翻转/抠图三处写回点，原 PR 加的是
`latestNodeSnapshot()`（await 后重读 store 最新 result/history/meta，防止跨多段 await
期间节点被新一轮生成写入后旧快照覆盖新结果）。本仓 `afac7546d`「通知策略」重构在同
三处写回点改了签名，把内联 `toast(...)` 换成 `reportFeedback` 回调参数——两处改动语义
正交（数据新鲜度 vs 通知管线）但 diff 行重叠，`git merge-tree` 判定冲突。手工把
`latestNodeSnapshot` 模式重新套到 `reportFeedback` 版本上，`nodeHistory` 局部变量按原 PR
思路一并删除（全部读点改走 `latestNodeSnapshot()`），`nodeMeta` 局部变量保留（
`handleRemoveBackground` 的同步前置写入仍需要它）。`npx tsc --noEmit` 对该文件无新增
错误。

## R13 走查断言

复用现有走查文件，未新建走查框架：

- **#708**（手动缩放不被自动 fit 弹回）：`tests/ux/editing-real-user-pass.walk.mjs` 第 8
  步「缩放键」测试区块内新增一条——第一版想法是按 `⌘=` 后读盘上 `timeline.scale` 前后
  两次比对，实跑发现 `setTimelineZoom` 不 bump `persistRevision`（缩放是视口态、故意不
  落盘，`workbenchStore.ts:699-701`），`persisted()` 永远读不到它，误判成假红——已改用
  DOM 里 `.workbench-timeline` 的 `--workbench-timeline-content-width` 这个活信号（它是
  `scale` 的单调函数）：按键前记一次，按键后 250ms 记一次，再等 500ms 记第三次，断言
  「按键后变了」且「变了之后不再弹回去」。PR #708 的根因是自动 fit 的 effect 订阅了
  `timeline.scale`，任何手动缩放都会被同一个 effect 重新计算 fittedScale 后弹回去；
  本断言直接钉住「弹没弹回去」这件事，而不是原有断言只查了「CSS 变量非空」，修复前后
  都会为真、测不出回归。已实跑通过（见下）。
- **#719a**（'?' 快捷键去重）：同一走查文件第 8 步快捷键面板测试区块内新增——先用
  `proveProbe` 证明面板能被找到，Escape 关闭后**用键盘**（不是按钮）按一次 `'?'`，
  断言面板真的打开。本走查在第 237 行已经从默认的「生成」模式切到「预览」模式，
  两个 `TimelinePanel`（生成用 compact、预览用 full）此刻按 `hidden` 属性同时挂载在
  DOM 里——正是 PR #719a 描述的 keep-alive 双挂载场景。已实跑通过（见下）。
- **#719b**（`pointercancel` 清理 scrub 监听）：**未补**。scrub 监听泄漏只有在系统级
  中断（触控板手势/切 App）发出真实 `pointercancel` 事件时才会触发，Playwright 的
  `mouse`/`touchscreen` API 不提供合成 `pointercancel` 的入口；唯一可靠路径是
  `page.evaluate` 里手写 `new PointerEvent('pointercancel', …)` 直接 `dispatchEvent`
  到 window——这已经不是「驱动真实用户交互」而是在测试代码里绕过输入层直接造事件，
  产品说明书 `docs/lessons/tests-must-drive-ui-like-a-human.md` 明确禁止这类灌事件。
  该改动本身是纯资源卫生（`finally` 必清监听），已用代码检视确认对称性（`pointerup`/
  `pointercancel` 现在共用同一个 `stopScrubListeners`），contracts/typecheck/lint 全绿
  保非回归；R13 走查缺口如实标注，不假装补上。
- **#709**（自愈结论不覆盖重新生成的结果）：**未补**，原因见下「未完成」。
- **#714**（comfyui 定时器/已销毁窗口卫生）：无生产构建以外真实 ComfyUI 服务可连，
  原 PR 自己也只用代码检视证明（`try/finally` 必清、循环首查销毁），不新增走查缺口。

## 已跑验证

- 逐个 cherry-pick 后单独跑该 PR 自带测试文件：全部绿（见上表）。
- `npx vitest run src/workbench/timeline/`：37 文件 245 测全绿（覆盖 #703/#708/#711/#719
  共享的 timeline 子系统)。
- `npx tsc --noEmit -p .`：#710 手工改动的文件无新增错误。
- `pnpm run check:root-cause-contracts`：36/36 测试绿，4 个高风险生产文件（本列车带入
  的 `docs/fixes/*.root-cause.json`）合同齐全。
- `pnpm run check:symptom-cluster`：无未评审的高频模块聚簇（369 份合同，仅早于阈值的
  历史聚簇，本列车新增的 6 份合同未触发新聚簇）。
- `pnpm run build`：Vite + electron tsc 通过。
- `node tests/ux/editing-real-user-pass.walk.mjs`：新增的 #708/#719a 断言实跑通过。

## 未完成

- **一条与本列车无关的既有走查断言持续红**：`node tests/ux/editing-real-user-pass.walk.mjs`
  跑出「全屏上只有一个「叫回 Nomi」入口（旧的浮动胶囊已删）— count=2」。核实
  `git log --oneline origin/main..HEAD --name-only` 里 19 个 commit 一个都没碰
  `AgentPanelV4Dock.tsx` / `PreviewWorkspace.tsx`（这条断言涉及的两个文件），判定为
  **main 上已有的、与本列车无关的预先存在问题**，不在本次任务书范围内（任务书明写
  「不动这 19 个 PR 触及范围之外的代码」），未在本分支修——已用
  `mcp__ccd_session__spawn_task` 另开一条 chip 交给后续处理，不混进这条合并列车的
  验收范围。
- **#709 的活体竞态断言未补**：PR 描述的竞态（自愈 `ensurePlayable` 在飞时节点被
  重新生成，旧 healedUrl 不得覆盖新 result.url）需要在真实渲染进程里，于自愈异步链
  挂起期间，对同一节点写入一次「新结果」。生产构建下没有暴露任何测试钩子能从
  Playwright 侧直接够到 `useGenerationCanvasStore`（`react-flow-read-only.walk.mjs`
  能做到是因为它专门起了一个不同的开发态 harness `NOMI_DESKTOP_DEV=1` +
  `VITE_DEV_SERVER_URL`，直接 `import('/src/....ts')`，这属于「新走查框架」，
  本次任务书明确不许）；纯 UI 路径触发「重新生成」需要真实调用生成供应商（不确定、
  不是零额度、且计时不确定，测不出稳定的竞态窗口）。因此该断言如实标记为缺口，
  而不是伪造一个测不出回归的弱断言。`contracts/typecheck/lint` 全绿保非回归，
  这与原 PR 自己的测试缝说明（「无正确缝记录」）一致。
- 未跑 `pnpm run test:system:focused` 全量（见交付时最终验证记录，若本文档更新时
  尚未跑完会在这里补一行时间戳）。
