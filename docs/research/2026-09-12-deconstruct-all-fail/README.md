# 视频拆解全部失败：根因诊断（2026-09-12）

> **结论（2026-09-12 真机坐实）**：根因既不是 B 也不是 C，是 **D — 文本路被付费令牌闸拦死**。
> `2d907292a`（2026-09-09 `fix(spend): bind paid runtime submissions to confirmed catalog quotes`）
> 给 `runtime.ts` 的 `wantedKind === "text"` 分支加了 `consumeTaskSpend`，而 `deconstructVideo`
> 的两处 `runTask` 从来不带 `grantId`/`nodeId` → 每一镜在**发请求之前**就抛
> `SpendNotAuthorizedError`，被 catch 吞成 `visionFailed` → 每格「没读出」。

## 现象

用户看到每个镜头每格“没读出”，并出现 `0.0333333s`。代码路径是 `deconstructVideo`：本地切点→抽帧→多模态任务→JSON 解析；失败镜头被标 `visionFailed`，UI 用 `shotTable.unread`。

## 静默吞错门

|位置|吞的是什么|用户看到|
|---|---|---|
|`deconstructVideo.ts:157`|音轨/ffmpeg/下载异常|对白为空，画面仍继续|
|`deconstructVideo.ts:186`|转写或供应商异常（**含本次根因的音轨半边**）|对白为空|
|`deconstructVideo.ts:134-142`|raw 非 `choices[0].message.content`|画面整格“没读出”|
|`deconstructVideo.ts:243`（已改走 `logError("tasks","deconstruct.frame-failed")`）|任一帧抽取异常|该镜全空、“没读出”|
|`deconstructVideo.ts:263`（已改走 `logError("tasks","deconstruct.model-failed")`）|VLM 请求/解析异常（**含本次根因的画面半边**）|该镜全空、“没读出”|
|`detectShotCuts.ts:159`、`extractVideoFrame.ts:69,156,234,321`|临时文件清理异常|用户无感，非根因|
|`depthVideo*`|深度视频支线异常|本功能无关|

## 复现与证据

**怎么跑的**（bridge-only，不点 UI，因此不受下面「走查选择器已死」影响）：`evals/lib/isoApp.mjs` 的
`prepareIsolation` 把用户**真实** `model-catalog.json`（v12 = 被测 app v12，未被 quarantine）种进隔离
profile，再走 `window.nomiDesktop.video.deconstruct({videoUrl, projectId})`；素材 = `tests/ux/fixtures/real-shot-640x360.mp4`
（5.000s / 30fps / `select(scene>0.1)` 零切点 → 1 镜 [0,5]）。诊断日志打在 `dist-electron/`（gitignored）
的临时副本上，跑完已还原，**仓库源码未因诊断改动**。

### 跑 ① 原样（未改任何闸）——**一字不差复现了用户的症状**

```text
[diag:brain] {"vendor":"api-moonshot-cn","modelKey":"moonshot-v1-128k-vision-preview","shots":1,"boundaries":[[0,5]],"cutSeconds":[]}
[deconstruct:model-failed] Authorization expired or does not cover this target; confirm again
→ 0.2s 返回；shots[0] = { shotSize:"", mood:"", visual:"", onScreenText:"", imagePrompt:"", motionPrompt:"", visionFailed:true }
→ failedShotIndexes:[1]；抽帧成功（sourceFrameUrl = frame-at-2.5s-*.png）
```

`0.2s` 就是判据：**根本没发出任何 HTTP 请求**。那句话的唯一产地是
`electron/spendGrant.ts:137`（`assertAndConsumeQuotedSpend`）。

### 根因链（逐跳可指）

1. `deconstructVideo.ts:247` 调 `runTask({ kind:"image_to_prompt" })`，extras 里**没有** `grantId`、也没有 `nodeId`。
2. `billingKindForTaskKind("image_to_prompt")` → `"text"`（`catalog/types.ts:603`）。
3. `runtime.ts:424-427` 现在是
   `if (wantedKind === "text") { await consumeTaskSpend({grantId, nodeId, ...}); return executeTextTask(...) }`。
   **`2d907292a^` 时这一行是** `if (wantedKind === "text") return executeTextTask(...)`——没有闸。
4. `tasks/taskSpend.ts:17-18` → `assertAndConsumeQuotedSpend(undefined, undefined, charge, confirm)`。
5. `spendGrant.ts:131-138`：`GRANTS.get("")` = undefined → **立即抛**
   `Authorization expired or does not cover this target; confirm again`，
   **连 `confirm()` 报价卡都不弹**（不弹卡的分支在拿到 grant 之后才走）。
6. `deconstructVideo.ts:263` 的 catch 吞掉 → `parsed:null` → `visionFailed:true` → 每格「没读出」。

时间线吻合：闸 2026-09-09 合入，用户 2026-09-11 撞上。

### 这是一类，不是一处（三个无 grant 的 runTask 出口）

| 出口 | kind → 计费口径 | 闸的位置 | 现状 |
|---|---|---|---|
| `deconstructVideo.ts:247` 画面分析 | `image_to_prompt` → text | `runtime.ts:425` | **红**，吞在 `:263` |
| `deconstructVideo.ts:166` 取对白 | `transcribe` → audio | `runtime.ts:344` | **红**，吞在 `:186`（所以对白列也是空的，不只是画面列）|
| `capabilityCore/shotVerifyDeps.ts:155` `callJudge` | `image_to_prompt` → text | `runtime.ts:425` | **红**（审片环判分）|

后两处的注释还写着「`runtime.ts` 早于 grant 校验返回（不花生成额度）」——**那条前提已被 `2d907292a` 删掉，注释是陈旧的**，
下一个人照着它写还会再踩。

### 跑 ② / ④ 把闸临时旁路 → 撞上**第二堵墙**（选到的脑是退役模型）

```text
[diag:brain] {"vendor":"api-moonshot-cn","modelKey":"moonshot-v1-128k-vision-preview",...}
[nomi:vendor] call vendor=api.moonshot.cn model=moonshot-v1-128k-vision-preview status=404 ms=5061
[nomi:vendor] 404 Not Found ← https://api.moonshot.cn/v1/chat/completions ::
  {"error":{"message":"Not found the model moonshot-v1-128k-vision-preview or Permission denied","type":"resource_not_found_error"}}
```

`resolveTextBrainKeys({preferImageInput:true})` 只按 `imageInputRank` 做**稳定排序**再取第一个有凭据的
（`textBrainResolver.ts`），既不看用户在「接入模型」里选的文本大脑（`generation-model-defaults.json` 根本没被读），
也不验模型还活着。用户这份 catalog 里 18 个 enabled text 模型、10 个判为可读图，排序把
`moonshot-v1-128k-vision-preview` 顶到了第一——**不是**代码注释里写的 `gemini-3.5-flash`。

### 跑 ② / ④ 还暴露了**第三堵墙**：供应商报错会打死主进程

两次都是：404 之后 ~23s，IPC 侧拿到
`Error invoking remote method 'nomi:video:deconstruct': reply was never sent`——即
`deconstructVideo.ts` 文件头注释里写明的那种主进程崩法。`streamTextTask` 在 `textStream` 抛错时直接
`throw err`，**没有消费 `result.finishReason` / `result.reasoning` 这两个 promise**（成功路径才给它们挂
`.catch`，`ai/streamTextTask.ts:165-168`）→ AI SDK v4 的 rejection 无人处理 → 进程死。
用户机上闸抛得更早（第 5 跳，同步抛），所以没走到这里；但**任何一次真实供应商报错都会触发它**。

### 跑 ③ 闸旁路 + 指定 `apimart:gemini-3.5-flash` → **整条链全绿**

```text
[diag:texttask] {"kind":"image_to_prompt","vendor":"apimart","modelKey":"gemini-3.5-flash","images":3,
                 "maxTokens":4000,"finishReason":"stop","reasoningLen":0,"textLen":410}
[diag:model-raw] {"shot":1,"frames":3,"rawType":"object","rawKeys":["choices"],"choicesIsArray":true,
                  "choicesLen":1,"choice0Keys":["message"],"messageKeys":["role","content"],
                  "finishReason":"stop","textLen":410,"textFromTaskResultEmpty":false,"parsedOk":true,
                  "parsedKeys":["shotSize","mood","visual","onScreenText","imagePrompt","motionPrompt"]}
→ 9.6s；failedShotIndexes:[]；shotSize"全景" mood"悬疑紧张" visual/imagePrompt/motionPrompt 全有内容
```

### 花费

**¥0.0x（远低于 ¥5 预算）**。跑 ① 零请求（闸挡住）；跑 ②④ 只吃了两次 Moonshot 404（不计费）；
真正花钱的只有跑 ③ 一次 APIMart `gemini-3.5-flash`：3 张 640×360 帧 + 410 字输出。

### 顺带：三条走查的选择器已**整体死亡**（不是漂移）

`data-deconstruct-panel` / `data-deconstruct-start` 在 `src/` 里**一个渲染者都没有**——
`87adc5b6a feat: replace deconstruction rail with projected shot table nodes` 把右槽拆解面板整个换成了
画布上的 `shot_table` 节点（入口现在是 `NodeVideoFrameToolbar.tsx:86` → `factBridge.ts` 的
`deconstructToShotTable`）。所以上一轮「探针计数 0」不是探针写错，是**被测的那个面已经不存在**。
受影响：`tests/ux/deconstruction-panel.walk.mjs`（断言它存在 → 假红）、
`tests/ux/tikhub-project-video-breakdown.e2e.mjs`、`tests/ux/real-user-long-video.e2e.mjs`。
按「死选择器同时造假红和假绿」的处置：三条都要连**断言前提**一起重写到 shot-table 节点上，
不是把选择器换个名字。`tests/ux/video-deconstruct.e2e.mjs` **不受影响**（它只走 bridge，没有 UI 锚点），
本次诊断即用它的手法。

## 三候选判定

- **A 抽帧抛错：排除。** 三次跑里 `extractVideoFrameToAsset` 都成功（`sourceFrameUrl` 恒有值，跑 ③ 里 3 帧全进模型），
  `[deconstruct:frame-failed]` 一次都没出现。
- **B 返回体解析不到：排除（此路不可能）。** `ai/streamTextTask.ts` 的**每一条**返回路径都把 raw
  **自己合成**成 `{choices:[{message:{role,content:text}}]}`（正常路 `return {text, raw:{choices:[...]}}`；
  antigravity 路同形），供应商原始报文根本到不了 `textFromTaskResult`。跑 ③ 实测
  `rawKeys:["choices"]`、`messageKeys:["role","content"]`、`textFromTaskResultEmpty:false`、`parsedOk:true`。
  上一轮把它排第一，是因为**只读了 `deconstructVideo.ts` 没读上游 `streamTextTask.ts`**。
- **C 截断：排除。** 跑 ③ `finishReason:"stop"`、`maxTokens:4000`、`textLen:410`、`reasoningLen:0`——没有截断。
  另附一条本次查到的**结构性缺陷**：`textTaskRunner.ts:47` 的 `executeTextTask` 只把 `raw` 放进 `TaskResult`，
  **`finishReason` 被原地丢掉**，所以 C 这一类问题在今天的代码里**根本无法被下游观测到**——
  这也是为什么上一轮无法证伪它。
- **D 付费令牌闸（新）：坐实，即根因。** 见上。

## 秒数 0.0333333

视频 30 fps，帧间隔 `1 / 30 = 0.0333333s`。`detectShotCuts` 的 `select(scene>0.1)` 会在第 2 帧
（`pts_time=0.033333`）给出近首帧切点；`shotTimeline.ts:47` 只过滤 `s > 0.01 && s < duration - 0.01`，
**`0.0333 > 0.01` 所以被放行**，切出一个 1 帧长的镜头（`durationSeconds` 再 `toFixed(2)` 成 `0.03`）。
副作用不止是多一行：`sampleSecondsForShot` 会在这 0.0333s 内取 3 个几乎相同的时刻 → 给模型喂 3 张同样的帧，白花钱。

**阈值必须派生，不许写常量**（`probeMediaMetadata` 已经返回 `fps`，`deconstructVideo` 也已经在调它，
只是没把 fps 传下去）：

```
frameStepSeconds = (1 - 2 * INSET) * minShot / (framesPerShot - 1)   // 与 sampleSecondsForShot 同源
minShot          = max(1 / fps, 最小可区分帧间隔)
保留切点 s  ⟺  s >= minShot 且 s <= duration - minShot 且 s - 上一个保留切点 >= minShot
```

即 `buildShotBoundaries(cutSeconds, durationSeconds, { fps, framesPerShot })`，`0.01` 那个字面量删掉。

## 建议（按该修的顺序）

1. **P0 · 根因（一行级，但必须三处一起）**：给三个无 grant 的 `runTask` 出口一条正当通路。
   这三处都不是「用户按了生成」的付费动作（拆解是用户点「拆解」时已经确认过的一次动作），
   所以**不该**在这一层各自铸令牌——正解是让 `deconstructToShotTable` / 审片环在发起时
   **带上本次动作的 grantId**（`capabilityCore/core.ts:450-451` 的 `gateway.confirmSpend` 已是现成范式），
   或由 `video:deconstruct` 的 IPC 入口铸一颗覆盖本次全部镜头的 grant 再往下传。
   **不许**在 `spendGrant` 里开「text 免闸」后门——那正是 `2d907292a` 要关的洞。
   同 commit 删掉 `shotVerifyDeps.ts:154,159` 与 `deconstructVideo` 里那两条已失效的「早于 grant 校验返回」注释（P1 加新删旧）。
2. **P0 · 同类防线（R28，建在最早能拦住的那层）**：`runTask` 的付费出口现在靠「调用方记得传 grantId」，
   漏传只在**运行期**炸且被 catch 吞掉。应让 `TaskRequest.extras` 的 grantId 对付费 kind
   成为类型/门岗级必填（或加一条 `check:*` 扫「调 runTask 但 extras 里没有 grantId」的调用点），
   否则下一个新出口还会再掉进来。
3. **P1 · 别再静默**：两个 catch（`:243` / `:263`）与音轨那两个（`:157` / `:186`）必须把结构化原因
   带回 `DeconstructShot`（`failureReason`），UI 顶部显示原因 + 重试入口。
   今天用户看到的「没读出」背后其实是一句完全可以说人话的「这次生成没经过付费确认」。
4. **P1 · `finishReason` 不许再丢**：`executeTextTask` 把 `finishReason`（和 `reasoning` 长度）
   一并放进 `TaskResult`，否则 C 这类问题永远无法自证。
5. **P1 · 主进程别再被供应商报错打死**：`streamTextTask` 在抛错前先把 `result.finishReason` /
   `result.reasoning` 挂上 `.catch(() => undefined)`（或 `void` 掉），消掉未处理 rejection。
6. **P1 · 选脑要验活、要听用户**：`resolveTextBrainKeys({preferImageInput:true})` 目前无视用户在
   「接入模型」里选定的文本大脑，且能选中已退役模型。至少要：优先用户显式选择；选中的模型失败时
   把 vendor 报文原样带给用户（现在是「没读出」三个字）。
7. **P1 · 切点阈值按 fps 派生**（见上），删掉 `0.01`。
8. **P2 · 三条走查重写到 shot-table 节点**（见「走查选择器已整体死亡」），并按
   `dead-selector-lies-both-ways` 逐处判断假红/假绿。

## 下次复现要导出什么

本次已证明这几条足够定位：`[diag:brain]`（vendor/modelKey）、`runTask` 抛出的原始 message、
`[diag:texttask]`（images / maxTokens / finishReason / textLen）、`[diag:model-raw]`（rawKeys / choicesLen /
textFromTaskResultEmpty / parsedOk）、`[nomi:vendor]` 的 status + 报文。
**禁止记录 API key、图片 base64 或完整提示词。**
