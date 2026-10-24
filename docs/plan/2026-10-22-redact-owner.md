# 设计卡：上游原话的唯一出口 · 第 1 步「落盘出口不存上游原话」

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：落盘出口不存上游原话（PR 1）   线/负责人：G-redact-owner   类别：[其他：安全 / 隐私] 按四类 9 格全填（任务书要求）
```

方向检查：[docs/audit/2026-10-22-redact-owner-direction.md](../audit/2026-10-22-redact-owner-direction.md)（用户 2026-10-22 拍板「按推荐」）。

| 格 | 结论 | 证据 |
|---|---|---|
| ★0 先查别人 | ① pino `redact`（https://github.com/pinojs/pino/blob/main/docs/redaction.md）只按**路径**擦结构字段，错误 message 照写 → **确认了**「哪段文本能落盘」得我们自己定，不靠换库解决；② electron-log（https://www.npmjs.com/package/electron-log）只管落盘与轮转 → **确认了**本步只改序列化规则、不动落盘写手，日后按自写登记 `logging-and-crash` 换库时 `diskSafeError` 原样当它的错误序列化钩子；③ OWASP Logging Cheat Sheet（https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html）把访问令牌、密码、会话标识等列为不应直接写进日志的数据，建议去掉、遮盖或改记散列 → **改了**：日志里错误原文换成指纹 `msg#<8 位>`，相同失败仍能归到一起；④ pi 回放跳过 error 消息（`node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js:153-159`）→ **确认了**会话存档（A2）的原文不是模型回放所需，但重试判据与面板历史在读它，所以 A2 不在本步动、交协调定 | 链接 / 文件行 |
| ★1 用户怎么用 | 当创作者把项目文件夹同步到网盘、或在设置里「导出诊断包 / 反馈」时，我想确认里面不会有服务商回显的密钥和网关原话，以便放心分享。**本步只做到一部分（照实写）**：项目事件 `.nomi/events`、主进程日志与崩溃日志、Agent 派生轨迹这四个出口不再有原话；但制作运行账本 `.nomi/runs/*/run.json` 与 `events.ndjson` 仍存上游原话，而 `electron/diagnostics/diagnosticsBundle.ts` 会把 `run.json` 原样打进诊断包（独立验收 V-redact N1），会话存档、画布节点、镜头表也还存着——所以**诊断包与项目文件夹整体仍可能带服务商回显的密钥**，归第 2 步收。步骤：①配置自定义头的中转站；②一次性生成失败（401 回显头值）；③项目 `.nomi/events`、主进程日志、Agent 轨迹各写一次；④打开这三处文件看。**不做什么**：不改任何界面文案与错误卡（第 2 步）；不动 A2 会话存档；不改上游原话的脱敏算法（第 2 步换成唯一主人）。**已知坑**：日志不再有错误原文，排障靠事件名 + 类名 + 码 + 指纹 + 栈帧。真实任务：①中转站 `X-Stainless-*` / `User-Agent` 自定义头 401 回显；②中转站把头值做 `%xx` 小写回显；③SSE 里 200 带错误回显。主指标：落盘文件里凭据原值与任一编码形态出现次数 = 0（量具 `electron/logging/diskSafeFailure.test.ts`，4 夹具 × 3 出口）；质量指标：结构事实（category / httpStatus / upstreamCode）保留率 100%（同一量具）；护栏：我们自己的错误码形 message 照留（同一量具「错误码形 message 照留」） | `pnpm exec vitest run electron/logging/diskSafeFailure.test.ts` |
| ★1b 连带界面 | 无可见改动：错误卡、Agent 面板、通知、回执文案一字不动（界面那份原话在第 2 步收）。开发态终端仍能看到完整原文（`logDevDetail`，打包版是空操作） | 人工核：本 PR 不改 `src/**` |
| ★2 谁说了算 | 概念「上游失败能落盘的部分」→ 唯一 owner `electron/logging/diskSafeFailure.ts`（`vendorFailureFacts` / `diskSafeError`）。消费者：`vendorCallTrace.traceVendorCompleted`（项目事件）、`eventLogRepository.appendEvents / readEvents`（唯一写者 / 读者，旧数据读出也只给事实）、`logging/redact.redactError`（日志与崩溃道两扇门）、`agentLane/laneTrace` 与 `laneTraceRecorder`（派生轨迹）。同一份事实 1 份 | `node scripts/door-map.mjs traceVendorCompleted`（4 扇写门，全走 trace 投影）/ `appendEvents`（7 扇写门，全走唯一写者）/ `redactError`（2 扇：logger、crashLog）/ `deriveLaneTrace`（1 扇） |
| ★3 一致与复用 | 分类复用 `vendorHttp.categorizeVendorFailure` 已算好的 `category`；上游码复用 `pickUpstreamCode` 的结果；Agent 错误类别复用 `laneAssistantFaultOf` 与 `normalizeProviderErrorText` 已有的标记，不新造词表。没有第二份定义 | `check:self-written`；`git grep -n "vendorFailureFacts\|diskSafeError"` |
| ★4 全状态 | 落盘侧状态：成功（不受影响）/ 失败（只留事实）/ 部分成功（同失败）/ 取消（不经此路）/ 旧数据（读出时去掉原话字段，不崩、seq 接续）/ 能力不可用：不适用（不新增要外部资源的动作）。文案：无新增 i18n | 同上量具「旧数据」用例 |
| 5 中途表 | 本步只改「写什么」，不改「何时写」：停 / 关窗 / 断网 / 重启 / 连点下的写入时机与花费逻辑一行未动；唯一新增行为是读旧事件时投影，纯函数、无副作用 | 人工（diff 只动序列化与投影） |
| 6 外部数据与失败 | 外部来源：供应商错误体（任意文本 / JSON）、pi 的 `errorMessage`、各层包装的 Error。我们的偏差：不再信任任何自由文本，落盘一律不收；上游码只收码形（≤64 字符、`[A-Za-z0-9_.:-]`），不像码就不收 | 同上量具 |
| ★7 性能 | 不适用：不新增用户操作；落盘每条只少写文本、多一次 8 位 sha256 指纹（仅错误路径） | 人工 |
| 8 真实条件 | Windows：本机 Windows 跑测试；英文界面 / 最小窗口 / 键盘：不适用（无界面改动）；真付费：不适用（夹具走本机假上游，零额度）；真规模：unverified（未在真实长项目上看日志体量） | 本机测试输出 |
| 拍板图清单 | 不适用：internal-no-visible-change（无可见改动） | — |
| ★9 验收与回滚 | 验收线 V-redact（待出）按下列清单核：①`diskSafeFailure.test.ts` 4 夹具 × {项目事件, 日志·结构化错误, 日志·SSE 原话, 日志·无 cause 包装} 全绿，凭据原值与 7 种编码形态、上游人话都不在盘上；②结构事实保留（category / httpStatus / upstreamCode）；③旧事件带 `upstreamMsg` 能读、读出不含原话、seq 接续；④派生轨迹 errors 只含类别、失败工具摘要为空；⑤变异：把 `upstreamMsg` 加回 `vendorFailureFacts` → 项目事件用例红；把 `error.message` 加回 `diskSafeError` → 日志用例红；把 `errorMessage` 加回轨迹 → 轨迹用例红；⑥反例（会从哪回来）：新的 `logError` 调用点（日志格式本身挡）、新的事件写入方（唯一写者读写两侧都投影，但只认我们 schema 的 `upstreamMsg` 键；把原话放进 `message` 一类键的新写入方挡不住，见 V-redact N4）、旧数据（读出投影）、崩溃道（同一个 `redactError`）、渲染层上报（`rendererLog` 走同一个 logger）。回滚：revert 本 PR 的提交。独立验收报告：V-redact 待出 | `## 独立验收` |

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [x] Agent 行为（路径推出：只改 `electron/agentLane/` 派生轨迹里错误的写法，不碰提示词、工具、模型选择）
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [x] 数据格式（项目事件里供应商失败的形状变了；旧事件读出兼容）
- [ ] 新增功能 / 性能

### 17 条出口在本步的落点

| # | 本步 | 说明 |
|---|---|---|
| T1 | 第 2 步 | 界面回显 |
| T2 | 第 2 步 | 界面回显 |
| T3 | 第 2 步 | 界面回显（一次性门 IPC 编码） |
| T4 | 已删 | 项目事件只存 `VendorFailureFacts`（`vendorCallTrace` 投影 + 唯一写者兜底），`taskIpcGuard.ts` 未改 |
| T5 | 第 2 步 | 渲染层错误卡 |
| T6 | 已收归（日志）/ 第 2 步（failureReason） | `logError` 那份经 `diskSafeError` 只留事实；`failureReason` 是界面文本，但它随镜头表落盘（新发现，见下） |
| T7 | 第 2 步 | MCP 结果 |
| A1 | 第 2 步 | Agent 面板 |
| A2 | 待协调定 | 会话存档原文：pi 运行中重试判据与面板历史都读它，选项见交货报告 |
| A3 | 已删 | 派生轨迹 errors 只存类别；失败工具摘要不存；Nomi 写进会话的运行记录 `error` 只存类别 |
| A4 | 已收归 | `logWarn('lane-resume-failed', …, error)` 经 `diskSafeError` |
| M1 | 已删（事件）/ 第 2 步（界面） | 同 T4 那条 trace |
| M2 | 不适用（事件）/ 第 2 步（界面） | `customCallDispatch` 写失败事件时本就不带 error（`customCallDispatch.ts:123`）；界面部分第 2 步 |
| M3 | 已收归 | `multiShotBatchScheduler` 的 `logWarn(…, error)` 经 `diskSafeError` |
| M4 | 已收归 | `generationTransportAdapters` / `productionRunDriverOps` / `generationOutputMaterializer` 的日志经 `diskSafeError` |
| M5 | 已收归（日志）/ 第 2 步（界面） | 转写 / 配音包装错误即使不带 cause，日志也只留类名 + 指纹 |
| D1 | 不适用 | 开发态终端，打包版不输出，不落盘 |
| 清单外 N1 | 第 2 步 | 制作运行账本 `.nomi/runs/*/run.json`、`events.ndjson` 存上游原话，`run.json` 随诊断包出机（V-redact 实测）；本 PR 不修 |
