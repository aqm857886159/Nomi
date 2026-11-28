# 短版设计卡：Q-walk-real-signal（走查断言量真信号结构修）

改动名：走查断言量真信号结构修（`Q-walk-real-signal`） · 线/负责人：`impl-q-walk-real-signal` · 类别：[其他]（纯测试/走查断言与夹具加固，不改 `src/` / `electron/` 产品代码，不碰用户可见界面）

## 变更意图
- 意图：纯修复（收紧 `#1705` 走查断言遗留的 3 条假绿阻断项，让断言直接量取真实渲染/可见性/HTTP 到达时序信号）
- 候选档位：短（仅改动 `tests/ux/**` 与 `docs/plan/**`，零产品代码/UI 改动）
- 单一意图：是
- 声明：纯修复：不改用户可见元素、布局、文案

## 短版设计卡

- **★1 用户怎么用**：当走查与 CI 验证图片节点内联画板打开、任务仍在跑时的二次确认弹窗、以及用户点确认后才真正发起第 4 笔 HTTP POST 时，我想让断言直接量取真实渲染像素、元素自身可见性与 HTTP 入口到达时序，以便把「落盘了但画板空白/图层隐藏」「弹窗可见但扣费提示被隐藏」「确认前已提前发 POST 但晚记账」三类假绿全部当场拦红；不做什么：不改产品代码与界面文案、不跑真付费（严禁 `NOMI_SPEND_OK=1`）、不破坏 `run-retrieval-recovery-real.paid.mjs` 兼容性；已知坑：`pb13` 在 `tb-whiteboard` 前先做了抠图，须在真 Electron 实测抠图结果载入画板后的真实 `<canvas>` 像素分布；量具：`tests/ux/_assert.test.mjs`、`tests/ux/_assertVisibleText.test.mjs`、`tests/ux/_retrievalRecoverySignal.test.mjs`、`tests/ux/run-retrieval-recovery-real.rehearsal.walk.mjs`、`tests/ux/full-walk/playbooks/pb13-node-toolbar-actions.walk.mjs`；老用户升级后怎样（★1c）：不适用（纯测试断言与走查夹具改动，不碰任何用户数据或存量格式）；连带界面（★1b）：不适用（零产品界面改动）。
- **★2 谁说了算**：① 可见文本断言唯一 owner 落在 `tests/ux/_assert.mjs#expectVisibleText`，替代 `tests/ux/_runRetrievalRecoverySteps.mjs` 中会命中隐藏后代的 `toContainText`；② 内联画板 `<canvas>` 像素探针唯一 owner 落在 `tests/ux/full-walk/whiteboardCanvasProbe.mjs#probeInlineWhiteboardCanvas`，由 `pb13` 的 `readPage`/`act`/`judge` 共同消费，并与可见图层状态一起核对；③ 回环夹具提交请求发起时刻与在途计数唯一 owner 落在 `tests/ux/process-feedback-real-fixture.mjs#createProcessFixture`（在 HTTP `POST` 入口读 body 之前同步记账），由 `tests/ux/_runRetrievalRecoverySteps.mjs` 的 `assertNoPostBeforeConfirm` / `assertPostInitiatedAfterConfirm` 强制消费（`run-retrieval-recovery-real.paid.mjs` 仅调 `recoveryJourney`，不受影响）。证据：`node scripts/door-map.mjs createProcessFixture` / `windowOpenJourney` / `recoveryJourney`（`src/`、`electron/` 0 扇门；全仓 `grep` 确认 `_runRetrievalRecoverySteps.mjs` 仅 2 个调用方：`run-retrieval-recovery-real.rehearsal.walk.mjs` 与 `run-retrieval-recovery-real.paid.mjs`，`createProcessFixture` 的 6 个既有调用方全部向后兼容）。
- **★3 一致与复用**：此前 `52ff9d8f9`（PR `#1705`）已补上 `whiteboardAssetUrls`、`mightChargeAgain` 与 `posts()` 计数核对，但三处仍测代理信号而非最终真实信号；三条路比较：① 沿原方向再补局部 wait/断言（无法消除 `toContainText` 匹配隐藏后代与晚记账 POST 假绿）② 在共用边界收紧真信号（`_assert.mjs#expectVisibleText` + `whiteboardCanvasProbe.mjs` + `process-feedback-real-fixture.mjs` HTTP 入口前置记账，选此路）③ 删掉断言（会退回无检出力）。复用现有 `tests/ux/_assert.mjs`、`tests/ux/design-lab/popupGeometry.mjs` 式的 `win().evaluate(probe)` 模式与 `tests/ux/_shell.test.mjs` 的真实 Chromium 契约单测范式。证据：`git log -n 8 -- tests/ux/_assert.mjs tests/ux/_runRetrievalRecoverySteps.mjs tests/ux/full-walk/playbooks/pb13-node-toolbar-actions.walk.mjs`、`git grep -n "_runRetrievalRecoverySteps\|createProcessFixture"`.
- **★4 全状态**：纯测试与走查层改动不改产品 UI；断言覆盖状态：画板未开 / 图未入 `canvasAssets` / 图层不可见 / `<canvas>` 空白或全透明或 tainted / 正常绘出源图；文本不存在 / 位于 `display:none` 或 `[hidden]` 或 `visibility:hidden` 后代 / 可见但同文本有隐藏副本 / 正常可见；确认前已发起且读完 POST / 确认前已发起但仍在读 body 的在途 POST / 确认后未发起 POST / 确认后发起第 4 笔 POST。
- **★9 验收与回滚**：
  - 验收清单与反例（动手前写全）：
    1. `expectVisibleText`（真实 Chromium 契约测 `tests/ux/_assertVisibleText.test.mjs` + 参数校验 `tests/ux/_assert.test.mjs`）：
       - 正例：可见标题、可见多行 `<p>`（`white-space: pre-line`）拆行匹配、同文本一隐一显时通过。
       - 反例：`display: none` 后代、`[hidden]` 后代、`visibility: hidden` 后代、可见 `<p>` 内嵌 `display: none` `<span>`、空白字符串参数、文本缺失——全部必红失败（且验证传统 `toContainText` 在 `display: none` / `[hidden]` 上确实假绿）。
    2. `probeInlineWhiteboardCanvas`（真实 Chromium 契约测 `tests/ux/_assertVisibleText.test.mjs` + `pb13` 真实 Electron 走查）：
       - 正例：`[data-nomi-inline-whiteboard="true"]` 下可见 `<canvas>` 绘有真实多色源图 → `hasRenderedContent === true`。
       - 反例：画板未打开 / `<canvas>` 不可见或 `0×0` / 全透明 `<canvas>` / 仅涂了 `#fbfbfa` 空白底色的 `<canvas>`（模拟 `canvasAssets` 已写入但图层不可见或源图未绘出）→ 全部 `hasRenderedContent === false`，`pb13` 的 `tb-whiteboard` 必红失败。
    3. `process-feedback-real-fixture.mjs` + `assertNoPostBeforeConfirm` / `assertPostInitiatedAfterConfirm`（真实回环 HTTP 单测 `tests/ux/_retrievalRecoverySignal.test.mjs` + 零费用取回走查 `run-retrieval-recovery-real.rehearsal.walk.mjs`）：
       - 正例：3 笔 POST 完成后记录 `confirmClickedAt`，之后发起第 4 笔 POST → 通过。
       - 反例 A（核心假绿）：第 4 笔 POST 在 `confirmClickedAt` 前已发出请求头（`flushHeaders()`），但请求体延迟到 `confirmClickedAt` 后才发完（`provider.jobs.length` 在确认前仍为 3、确认后变 4）→ 确认前守卫（`postInitiatedAt().length === 4` / `inFlightPosts() === 1`）与确认后时序守卫（`receivedAt < confirmClickedAt`）双双必红拦截。
       - 反例 B：第 4 笔 POST 在 `confirmClickedAt` 前已提前完成 → 必红拦截。
       - 反例 C：确认后第 4 笔 POST 未发起 → 必红拦截。
    4. 兼容性与门岗：`run-retrieval-recovery-real.paid.mjs` 仅调用 `recoveryJourney` 保持 100% 兼容（零修改或无破坏）；`pnpm run check:walkthroughs && pnpm run typecheck && pnpm exec eslint <改动文件> --max-warnings=0` 与 `NOMI_PR_BODY_FILE=/tmp/q-walk-real-signal-pr-body.md node scripts/check-pr-judgement.mjs --stage=push` 全绿。
  - 回滚：`git revert <commit>` 单提交可无副作用回滚。
