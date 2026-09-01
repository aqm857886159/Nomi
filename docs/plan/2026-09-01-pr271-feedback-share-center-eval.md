# PR #271 拆项评估 —— 反馈与分享中心（low-friction feedback & share center）

> 状态：📎 交接/日志（只读评估结论；若获批，落地按下文各方向的落地形状另立 📋 计划）

日期：2026-09-01 ｜ 评估对象：PR #271 `codex/feedback-share-center`（用户 @青阳 自开）｜ **只读评估，不合并 / 不关闭 / 不评论 #271 本体，零产品代码。**
评估分支：`docs/pr271-eval-20260901`（从 `origin/main` 拉，不开 PR）。

---

## 0. 先把 #271 的真面目说清楚（读之前必须知道）

**GitHub 页面数字（+964/-4，26 文件）这次是真实的**——但「behind 178 commits」的红字会让人误以为这是坨大杂烩，不是。拆开看：

- **merge-base** = `7b70993b`（`git merge-base origin/main origin/codex/feedback-share-center`）。
- 分支**严格领先 merge-base 5 个 commit**（4 个 non-merge authored + 0 merge 噪音）；main 在 merge-base 之后又走了 **178 个 commit**（这就是「behind 178」的来源）。
- ⚠️ **两点 `origin/main..branch` 视图会骗人**：它显示「394 文件 / +9561 / −32797」，那 3 万行删除全是**分支尚未 rebase、缺掉 main 上 178 个 commit（含 agent-system harness、model-access-journeys 测试重构等）造成的「反转幻影」**，不是 #271 删的。**真实贡献只能看 authored commit**（`git log --no-merges $MB..branch`）。
- **真实 authored 内容**（4 个 commit，核心是 `b5202dcb`）：
  - `b5202dcb feat: add low-friction feedback and share center` —— 24 文件（含 6 个样张 png/html），这是**整个功能**。
  - `7889d4c9 docs: index feedback share center plan` —— 计划入 INDEX。
  - `49324bce chore: refresh delivery ledger and test fixture`
  - `33c38966 docs: mark feedback share center delivered` —— 台账收尾。
- **没有 B 类 merge 噪音**（对比 #258 那种从已合 PR 漂回一堆 archetype）。#271 是一个**聚焦、自洽、可整体评估的单功能 PR**。**唯一的结构债是「分支落后 178」——合入前必须先 rebase / update-branch 到最新 main**（走服务端并线，见 memory `stale-branch-merge-use-update-branch`；本地 push 追平 15-88MB diff 会撞 ponytail ENOBUFS）。

下文 file:line 均指 authored tip `33c38966`（功能代码在 `b5202dcb`）。SHA：merge-base `7b70993b` · 分支 tip `33c38966` · main tip `59e1f6c0` · 功能 commit `b5202dcb`。

**它到底新增了什么（一句话）**：在 App 里加了**一个**「反馈与分享中心」——从 **设置→关于** 一个规范入口 + **生成失败卡**一个情境入口打开；用户选意图/阶段、写一句话，然后 Nomi **打开系统浏览器**跳到 **私密 Tally 表单**（`https://tally.so/r/GxPrx2`）或 **公开 GitHub Issue**，**只把有界的运行时上下文（版本/平台/架构/语言/阶段/Provider/Model/错误分类）**带进 Tally hidden fields，反馈正文和截图都由用户在浏览器页面里自己填/传。本地留一个 outbox 草稿（localStorage）。

---

## 1. 方向①：App 内主动外发面（Tally 私密表单 + GitHub 公开 Issue）—— 这是本 PR 的核心与唯一真正需要拍板的东西

**这是什么**：main 现状的用户反馈体系是**「单向情报雷达」**——`scripts/feedback-radar.mjs`（`nomi-feedback-radar` 技能）从 GitHub issue / B站评论 / 微信群**只读收集**反馈，**从不往任何渠道发消息**（技能描述原话 + 脚本里 grep 无任何 POST/create-issue/send，已核实）。#271 引入的是**方向相反的第一条通路：从 App 内主动把用户反馈外发出去**。这是一个**全新的对外暴露面**，安全/隐私必须单独评（也是本任务点名要重点看的）。

**解决哪个真实摩擦（大白话 + 例子）**：现在用户遇到问题想反馈，得**自己离开 App**——去翻 GitHub 会不会用、去微信群 @、或者干脆算了。摩擦最大的一刻恰恰是**生成失败那一秒**：他正卡在「接了模型点生成没反应」，此时最该能一键说「这里坏了」，但 App 里没有任何入口，情报只能靠雷达**事后**去群里/评论区捞。#271 把「报告问题」这个动作**搬到摩擦发生的现场**（失败卡上一个「反馈此问题」链接，`NodeErrorReport.tsx:305`），并自动带上「他用的哪个模型、哪一步、什么错」——省掉用户重复描述机器已知的信息。这贴 D1（从用户真实摩擦出发、effect-first）。

**外发面安全/隐私评估（逐条，file:line 实据）——结论：设计是克制且可辩护的，不是后台遥测**：

1. **发什么数据**：只发一个**有界上下文信封**。`buildFeedbackDiagnostics`（`src/ui/community/feedbackDiagnostics.ts`）产出的 `FeedbackDiagnostics` 只含 `app.{version,platform,arch,locale}` + `context.{intent,stage,errorKind,provider,model}`。带进 Tally URL 的更少（`buildPrivateFeedbackUrl` in `communityLinks.ts`）：`nomi_version/platform/arch/stage/provider/model`。**每个字段都过 `safeFeedbackValue`**（`feedbackTypes.ts`：剥控制字符、`.slice(0,120)` 截断）。**反馈正文 summary/details、截图字节、项目路径、完整 prompt、API key/Authorization 一律不进 URL**——正文只在用户于浏览器 Tally/GitHub 页面里**自己敲**，截图在那两个页面**自己传**（`FeedbackShareDialog.tsx` 的 `handleOpenDestination` 只 `openExternal(url)`，不上传任何字节）。单测把这条钉死：`feedbackDiagnostics.test.ts` 断言 `JSON.stringify(result)` **不含** `'prompt'` / `'Authorization'`，并验证控制字符被脱敏、标识符截到 120。`provider/model` 只是**模型身份**（vendorKey/modelKey，如 `apimart` / `seedance-2.5`），不是凭据——泄露面可忽略。

2. **发到哪**：两个**硬编码的单一真相源**（`NOMI_COMMUNITY_LINKS` + `PRIVATE_FEEDBACK_URL` in `communityLinks.ts`），不是用户可注入的任意 URL。Tally = `tally.so/r/GxPrx2`（匿名可访问、附件≤10MB，plan 已验收匿名访问）；GitHub = 仓库 issue 模板页。

3. **用户知情吗 / 有没有后台上传**：**没有后台上传，全程用户可见**。① 打开动作走 `window.open(url,'_blank','noopener,noreferrer')`，而本 App 的 `electron/main.ts:320` `setWindowOpenHandler` **把每个 `window.open` 拦成 `shell.openExternal(url)` 并 deny 内嵌窗口**——所以反馈永远落在**用户自己的系统浏览器**里，用户亲眼看着 URL 打开、亲手在页面上提交，这就是 PR body 说的「browser confirmation」。② 提交前有渐进披露：`FeedbackShareDialog` 有一个 `<details>「查看将附带的脱敏信息」`，**原样 `JSON.stringify(diagnostics)` 给用户看**将要带走的每个字段（`FeedbackShareDialog.tsx` 的 diagnostics `<pre>`）。③ i18n 文案三处明写承诺：`trustLine`「默认只保存在本机；不会后台上传对话、素材或密钥」、`diagnosticsHint`「仅包含版本/系统/语言和问题分类；不包含对话、素材、路径、密钥」、`destinationHint`「两边都由你在浏览器里最后确认」。

4. **本地留痕**：`feedbackOutbox.ts` 只往 `localStorage['nomi:feedback-outbox:v1']` 写用户**主动创建**的草稿（上限 20 条、正文截 4000、含 destination 标记），存满/禁用也不阻断打开 GitHub（catch 吞掉）。不落盘敏感字节。

**⚠️ 需在落地阶段核实/补的三个点（不是阻断，是收口）**：
- **(a) 「confirmation」名实**：plan doc 写「提交前再确认目的地和发送内容」，但代码里**没有独立的「即将打开外部 URL，确认？」模态**——「确认」= 提交前那一屏（选 Tally/GitHub + 可展开的 diagnostics 预览），点「私密提交/公开」后**直接** `openExternal` 打开浏览器。这在本 App 语境**可接受**（外链本就统一走系统浏览器、URL 里没有正文只有有界上下文），但**给用户/群里表述时别说成「有二次确认弹窗」**——诚实说法是「跳转前让你看清带走哪些字段、由你在浏览器里最后提交」。
- **(b) `provider/model` 是否可能带业务敏感名**：vendorKey/modelKey 目前是通用模型身份，无凭据；仅需确认没有把「用户自定义 vendor 的私有 base-url / 别名」塞进 provider 字段的路径（错误卡走的是 `nodeSelectedModelAddress(meta)` 的 vendorKey，`NodeErrorReport.tsx:180`，看着是安全的键名，落地时 grep 一遍 custom-vendor 分支即可钉死）。
- **(c) GitHub 公开路径的隐私提示**：私密 Tally 有「私密」措辞保护，但**公开到 GitHub = 内容永久公开**。目前 `publicOpened` 文案是「GitHub 已打开：提交前可以再次检查，内容不会自动发布」——**建议再补一句「公开可见」的明示**（用户可能不清楚 issue 是全网可搜的）。这是文案层小补，非架构问题。

**成本/风险**：代码面小（~955 行含样张，纯前端 + 一条既有 Electron 外链通路复用，**零主进程新代码、零新 IPC、零后台任务**）；门岗友好（作者已主动登记 `FeedbackStage` 到 `vocabularies-baseline.json` 并给了单一-owner 理由、更新 `settingsDialogStructure` 基线**且加了正向断言**不是只换 hash、i18n 双语齐全）。真实风险集中在**表述诚实**（上面 a/c）和**第三方依赖**（Tally 免费层可用性/可访问性——plan 的「明确不做」已诚实声明不承诺 100% 可达）。

**档位建议：🟢 值得接（这是三个方向里唯一真正的产品决策，也是它的招牌）**。它贴真实摩擦（失败现场反馈）、是通用能力、外发面设计克制可辩护（有界信封 + 浏览器最终确认 + 无后台上传 + 单测钉死无泄漏），与 main 的「单向雷达」**互补不重复、不违 P1**（雷达继续收、这条负责发，两条不同方向不同渠道）。**落地形状**：① 先 rebase/update-branch 到最新 main（消 178 落后）；② 补 (a)(c) 的文案诚实化 + (b) 的 custom-vendor grep；③ **这是明显的用户可见 UI，必须过 R8/R13 样张闸**——PR 已带 6 张样张（about/hub/feedback/report + html）且 PR body 声称在 v0.21.0 真机走查过 About 入口/报告页/outbox/Tally URL，但**本评估未亲眼验证走查截图**（见诚实边界），落地前需按 R13 眼见链复核一次（同构建/同入口）。

---

## 2. 方向②：单一入口聚合（设置→关于 的规范入口 + 失败卡情境入口 + 全局单宿主）

**这是什么**：不是新功能，是**入口治理**。#271 给「反馈与分享」定了**一个家**——`AboutSection.tsx` 加一行 `AboutActionRow`（`about.feedbackShare`）作规范入口；`NodeErrorReport.tsx:305` 失败卡加「反馈此问题」作情境入口；两者都只 `window.dispatchEvent('nomi-open-feedback-share')`，由**全局唯一挂载**的 `FeedbackShareHost`（`NomiStudioApp.tsx:774`，跟付费确认卡同一「挂公共根」的姿势）接住。**没有新增常驻顶栏按钮、没有第二套反馈心智。**

**解决哪个真实摩擦**：符合 CLAUDE.md「一功能一个家」+ 设计系统 §1.5 控件层级（先分组→去重→归位→最后才收纳）。反馈入口天然是低频动作，放 L4（关于页）+ 情境触发（失败卡），不占常驻预算——这是**教科书式的正确归位**，不是往顶栏塞按钮。

**与现状关系**：纯新增、无重复、不违 P1。事件驱动 + 单宿主的架构和 main 既有 `globalBrowserDialog` / 付费确认卡一致（都挂公共根、任一视图可弹）。`settingsDialogStructure.test.ts` 加了正向断言锁住「About 里保留这个入口 + dispatch 逻辑 + onClose」，防意外漂移。

**成本/风险**：极低。唯一注意：`FeedbackShareHost` 用全局 `window` CustomEvent 通信（非 Zustand store），和 App 里既有的 spend-confirm 等模式一致，可接受；若未来要携带更复杂状态再考虑升级到 store。

**档位建议：🟢 直接随方向①走**。这块没有独立产品决策，是①的入口骨架，质量高、门岗齐、归位正确。

---

## 3. 方向③：本地反馈 outbox（localStorage 草稿留痕）

**这是什么**：`feedbackOutbox.ts` —— 用户每次发起反馈，把草稿（intent/stage/summary/details/screenshotName + 有界 diagnostics + destination 标记）存进 `localStorage`（上限 20、正文截 4000）。success 页告诉用户「草稿已保存在本机，浏览器页面会继续提交」，并给「重新打开私密表单/GitHub」的重试入口。

**解决哪个真实摩擦**：反馈这件事有「我点了但浏览器没打开 / 打开了但我关掉了 / 离线了」的断点。outbox 让草稿**不丢**，用户可重试打开目的地——对齐 plan 交互契约的 offline/error「不丢草稿、给重试」。

**与现状关系**：纯新增本地能力，不违任何原则；**不是遥测/后台上传**（只写 localStorage、不外发）。

**成本/风险**：极低。`localStorage` 满/禁用有 catch 兜底不阻断主流程。**一个小观察（非阻断）**：plan 的 error 恢复路径写了「导出 JSON/ZIP 两条恢复路径」，但当前实现只有 localStorage 草稿 + 重新打开目的地，**没看到导出 JSON/ZIP 的实现**——属 plan 承诺 > 实现的小缺口，落地时要么补上要么把 plan 那句删掉（别留言实不符）。

**档位建议：🟢 随方向①走**。附属能力，质量 OK，唯一收口是 plan 里「导出 ZIP」的名实对齐。

---

## 4. #271 本体处置建议

**核心判断：#271 是一个聚焦、自洽、质量高的单功能 PR，方向正确、外发面设计克制——原则上可接，但不该按现状直接合，需先做三件收口。**

| 部分 | 内容 | 档位 | 去向 / 落地形状 |
|---|---|---|---|
| **① App 内主动外发面** | `communityLinks.ts` / `feedbackDiagnostics.ts` / `FeedbackShareDialog.tsx` + Tally/GitHub 通路 | 🟢 | **保留、接**。先 rebase 消 178 落后 → 文案诚实化(a「跳转前看清字段」不叫二次确认弹窗 / c 公开=全网可见) → custom-vendor 字段 grep(b) → **过 R8/R13 样张闸眼见链复核**。 |
| **② 单入口聚合** | `AboutSection` 规范入口 + `NodeErrorReport` 情境入口 + `FeedbackShareHost` 单宿主 | 🟢 | 随①走。归位正确、门岗齐。 |
| **③ 本地 outbox** | `feedbackOutbox.ts` + success/重试 | 🟢 | 随①走。补 plan「导出 ZIP」的名实对齐（补实现或删该句）。 |
| **结构债** | 分支 behind main 178 commit | —— | **合入硬前置**：走 `gh pr update-branch` / 服务端并线 rebase 到最新 main，别本地 push 追平（15-88MB diff 撞 ponytail ENOBUFS，见 memory）。 |

**给 #271 的一句话建议**：**方向对、实现干净、外发面克制可辩护 → 值得接**；合入前三步收口（rebase 178 / 三处文案诚实化 / R13 眼见链复核走查），非阻断的都是文案与名实对齐层，无架构返工。这不是 #258 那种需要大拆的杂烩，是一个可整体推进的单功能。

---

## 附：本评估未做的事（诚实边界，D4）

- **未亲眼验证 PR body 声称的 v0.21.0 真机走查**（About 入口 / 报告页 / outbox / 生成 Tally URL）。PR 附了 6 张样张 png，但本任务是**只读拆项评估、零产品代码、不跑 App**——R13 眼见链（截图须自己 Read 过、验证物=用户所见物）留给落地阶段。故方向①的 🟢 是**基于代码 + 样张文件 + 门岗证据**的判断，**不代表已过体验走查**。
- **未真实提交一条反馈到 Tally/GitHub**（不代用户外发、避免污染真实渠道）；Tally 匿名可访问性以 plan 自述为准，未复验。
- **未在本地跑 #271 的测试/build/gates**（PR body 自述 937 files/8929 tests passed + 六门绿）；本评估只**静态读**了单测断言（`feedbackDiagnostics.test.ts` 的无泄漏断言、`settingsDialogStructure.test.ts` 的正向断言、`communityLinks.test.ts`/`feedbackOutbox.test.ts` 存在）确认覆盖方向对，未执行。
- **未逐一核对 6 张样张与真实 SettingsDialog 外壳的 token/间距对账**（plan 验收门①）——留给落地阶段的 R8 对账。
- **`provider/model` 字段的 custom-vendor 私有 base-url 泄露路径未穷尽 grep**（方向① (b)），仅从错误卡的 `nodeSelectedModelAddress` 键名判断安全；落地前需实扫。
