# 一次扫全：记录并继续与完整证据

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已实现，复核修正后完整 gates 通过，待 PR 评审。范围 tests/ux、scripts、本文；package.json 仅注册 sweep 命令及其验证入口。生产代码、C0 原断言与预算不变。回滚撤回任务提交；不迁移用户数据。

## 先查别人

2026-09-09 通过仓库 .mcp.json 的 Context7 HTTP tools/call query-docs 查询 /microsoft/playwright，并直接核对官方文档。

| 方案 | 它提供什么 | 我们还缺什么 |
|---|---|---|
| [BrowserContext tracing](https://playwright.dev/docs/api/class-tracing) | 浏览器动作、截图时间线、DOM 快照、network；[Electron context](https://playwright.dev/docs/api/class-electronapplication#electron-application-context) 返回 BrowserContext | 业务 store、主进程模型请求、原生 pi 转录、费用与断言 |
| [expect.soft](https://playwright.dev/docs/test-assertions#soft-assertions) | Playwright Test runner 内失败继续并使测试失败 | 独立 Node 走查不支持；本任务保留 runner，只在断言边界记录 |
| 现有截图等待入口 `tests/ux/_assert.mjs:532` | screenshotSettled 等待画面稳定并保存截图 | 不含动作/网络轨迹；只复用每站截图，轨迹仍用 tracing，不自建录像器 |

保留已安装 Playwright 1.60.0；直接 start({screenshots:true,snapshots:true,sources:true}) / stop({path})。不安装 SDK、不拆框架 internals、不自建录像。trace 不声称包含模型隐藏思考；只保存实际收到的原生思考块。console 的渲染/主进程边界分开记录。原生转录只拷贝真实文件，缺失即 deviation，禁止由 UI 消息重建冒充。

框架四列表：它提供 tracing/expect；我们用公开 context/tracing/expect；我们另写领域站点记录与 repair；未拆散框架。公开接触字段只有 screenshots/snapshots/sources（常量 true）、path（按 case 派生）。没有新框架或生产接入层。规范采用 Playwright trace.zip、pi 原生 JSONL；仓内 deviation 是测试报告，不是外部互通协议。

## 根因与边界

按 root-cause-remediation 流程分类 recurring（测试机制，不涉及生产修复）。症状：C0 首次失败使后续站完全不可观测。直接原因：step catch 重抛；类根因：验收 fail-fast 和探索 collect 未区分。实查 C0.step、_assert 的导出 expect、agent-runtime-walk-support.finalizeRuntimeWalk：都以首错终止或最终失败处理。共享断言边界保留默认 fail-fast；显式 collect 会记录每次失败，站边界捕获不可执行动作，repair 前保全证据。修补不算通过，后续站标 reachedViaRepair。失败的探针证明不得生成有效 provenBy。

## 实施与验收

- 共享 collect session 与断言适配；站点上下文隔离；所有 deviation 包含断言/期望/实际/时间/证据/repair。
- 每个 case/input 独立 profile 和 trace；每站截图、payload、费用增量、时间、情绪日志；Agent 原生转录与工具调用、R30 原始 n/d。
- cases.json 增加 surfaces/inputs；原 stage-4/gap 保持不跑，当前可用子任务明确限定覆盖范围，不冒充完整 C0 或未来功能验收。
- runner 串行全量收集，单 case 错误不影响其余 case；全局预算默认 ¥3，媒体仅 loopback，真实文本显式开启，拒绝未知报价。
- 单测先红后绿，loopback sweep 与截图人工检查；完整 gates 排锁最长 40 分钟；推分支与 PR（引用本文和报告），SWEEP-LAST ≤15 行。

六视角自审：CTO 复用 tracing；设计 保留失败现场；PM 统计未到达而非假覆盖；前端 不改 UI；后端 原生转录不重建；用户 一次拿全问题清单，repair 单列可追溯。

## 实测与兼容边界

- C0 保留原始断言和默认 fail-fast；collect 在原 step 外加站点 session。首轮零费用完整 00–07 通过，含模拟 MP4 与冷重启。原脚本当前 main 是 8 站、预算常量 ¥8，与任务书描述的候选分支 13 站/¥50 不同；本任务不改其预算或断言。
- 旧运行时原生转录实际住在 `.nomi/agent-thread-context-v1.json` 的 native 快照内（`electron/harness/runtime/pi/snapshot.mts:64` 原样导出 SessionManager）；校验 SHA256 后将原始 header/entries 原样写为 JSONL，并保留完整原容器、leafId、来源说明。新 lane 的 `.nomi/agent-sessions/**/*.jsonl` 直接拷贝。两者均不从 UI 气泡重建。
- 实施阶段 #662 尚未合入，缺失时每站写原因、case 记 deviation。交付前 #662 已合入 main `ac9f5cf22` 并整合进任务分支；`scanFeel(page,{label})` 公开 API 未变，直接复用实际扫描结果。未复制扫描器，也未改 installFeelObserver 接线。
- 9 surfaces 各 ≥3 runnable 输入。现有 G1 的未来整链状态不变，S1 当前输入只测已可用的技能导入，不声称新 lane 自动触发通过。T1/T3/M1/M3/D1 输入明确为当前 surface 子任务，完整原始任务仍按 G1 卡独立验收。
- 真实 APIMart 文本 gpt-5-nano：已捕获 HTTP 400 `nomi_generation_plan` schema 错误；先截图、存原始请求/响应与原生转录，再测试侧写固定分镜并重开创作。两条样本的 Agent 站仍 failed/repaired，下游 storyboard passed/reachedViaRepair。没有生产修复，没有媒体付费请求。
- 文本预留沿用 c0-real-budget.requestQuote/reserve，外层共享 sweep ceiling ≤¥3；只允许 APIMart 文本端点，报价未知/非文本/预算超限在发送前拒绝。站点费用记预留增量，case 最终费用取 APIMart token balance 增量（共享 token 并发可能计入别人使用，保留归因限制）。
- Collect、repair、并发隔离、原生转录 checksum/来源、报告失败保留、文本预算/并发重试/媒体拒绝共 13 项 Node 测试已通过，纳入 check:walkthroughs。

### 已取得的收据（提交前最终验证仍在进行）

- 全量 loopback：`artifacts/sweep/2026-09-08T21-38-47.504Z/report.md`；33 输入 / 213 站 / 33 trace / 6 pi 转录；费用 ¥0；32 条均为 #662 未合入导致的 feel 缺失。九面截图并排人工检查见同目录 contact-sheet.jpg。
- 真文本：`artifacts/sweep/2026-09-08T21-40-08.786Z/report.md`；两次 gpt-5-nano HTTP 400，均 repaired，后续 storyboard reachedViaRepair；余额增量 ¥0，预留上界 ¥0.0953344。原始 response 明确指向 nomi_generation_plan schema.type 缺失，初判契约层；root_cause_cluster 保持空。
- 单测现为 14 项，新增证据扫描失败不能被领域 fixture 误标 repaired；check:walkthroughs 已绿。C0 情绪日志所有站保留，重启截图链接使用 restart/ 前缀。
- 交付性质是收集机制与当前 surface 子任务覆盖；并未承诺所有原始 G1 大任务（深度模型整链、外部双宿主完整出片等）已验收通过。
- 补充：站点 requires 前置失败时记 unreachable，仍继续独立站点，不计入到达站数；仅领域断言失败可触发其 repair，截图/体感问题不会被领域 fixture 洗成 repaired。单测合计 15 项。

### 最终全量复扫（05:52–05:56，零费用）

- 最终报告：`artifacts/sweep/2026-09-08T21-52-31.897Z/report.md`。33 输入 / 213 站记录 / 33 trace / 6 原生 pi 转录，¥0。所有 case 均被执行；不等于所有功能通过。
- 40 条 deviation：33 条 `_feel.mjs` 缺失；C0 第 04 站模拟审片超时、05/06/07 后续步骤失败、子进程退出共 6 条；人工看图新增 1 条「缩略图加载失败但显示已生成 8/8」。保留本轮红收据，不用此前完整出片的绿收据替换。
- 先读 C0 原生转录与 model-requests：两次分镜请求、两次审片请求，未收到另外六次预期审片。初判与证据进总账，未把猜测当根因，root_cause_cluster 留空。生产不修改。
- 人工检查九个 surface 的截图与 C0 失败现场，见 human-review.md；并非 213 张逐张签收。当前覆盖仍以登记子任务为限。
- 报告按每站/每条 deviation 的实际 surface 汇总；跨页面输入可以计入多面，费用仅归输入主 surface，避免重复记账。报告单测覆盖跨面不可达场景。保留原执行 source-files.json，报告重算另记 report-generator.json。
- 本会话真实文本站累计 10 次请求、全部 HTTP 400；预留总上界 ¥0.476672，所核对余额增量 ¥0。媒体请求均 loopback。最终不再追加真模型请求。
- 完整 contracts 首轮唯一阻断为 lint 扫到 artifacts 中的临时 CJS 桥接与撤回草稿；所有其他门岗通过。修在临时桥接 owner：attach 的 finally 清理一次性 loader，成功/失败路径单测覆盖；旧证据与撤回草稿只追加 .txt 后缀、字节保留，没有放松 lint。独立 lint 复核已绿；重新跑完整 gates。
- 最终 gates：`artifacts/sweep/gates-delivery.log` exit 0；75 项 contracts 全部阻断项通过，Vitest 1294 文件 / 12077 测试通过（另 1 文件、2 测试跳过），Agent/runtime 检查与构建通过。新机制及 cases 校验共 16 项 Node 测试；远端基线 `bbc2d037efba` 已整合。首次正式排锁约 22 分钟，未绕锁或跳钩子。

### 提交后只读复核的收敛范围

Ponytail 独立明细发现四项机制问题，推送前一并修正：timeline/export/settings 输入要驱动不同宿主状态；C0 collect 的 R30 从实际工具结果与 Agent 站断言派生；原始响应写入必须在关闭 Electron 前 drain 且失败入账；供应商错误按 HTTP status/结构化 error 判断，不能匹配正文单词。沿用现有输入登记表，不增加平行真源；原 C0 断言仍不动。验证：失败场景 Node 测试 + 新 case 全量零费用复扫 + 完整 gates，真模型不追加请求。

- 四项已修正，18 项 Node 测试通过。时间轴/导出驱动空、单图、双图三种真实状态；设置分别切语言、滚轮语义、主题。正向 MP4 核对时长并完整解码。
- 修正后全量：`artifacts/sweep/2026-09-08T22-43-05.905Z/report.md`，33 输入 / 221 站 / 33 case trace / 6 pi 转录；截图与 store 全部存在，C0 冷重启路径及八站情绪日志保留。¥0，33 条全部为尚未合入的体感扫描器缺失。以前 C0 超时/缩略图红收据仍链接保留，本轮未复现不等于修复。
- 二次复核确认输入状态、R30、错误分类已修正；另发现尚未收到响应头的请求也必须等待。已把登记前移到 transport 调用前，drain 关闭新请求入口并动态等待后来登记的 body；可控延迟响应头/body 的测试覆盖此竞态。相关 Node 测试总计 19 项，walkthroughs 门岗通过；未追加真实请求。
- 最终树完整验证：`artifacts/sweep/gates-final-tree.log` exit 0；75 项 contracts 无阻断、1294 个 Vitest 文件 / 12077 测试通过，Agent/runtime 与构建通过。最终使用这份收据交付；Ponytail 150KB diff 上限要求按机制/登记/复核修正拆提交并分批推送，同一个 PR 交付全部内容。
- 推送前 #662 合入，已整合 `ac9f5cf22`（合并提交 `53e964aa2`，只处理 package.json 命令并列注册冲突）。重新全量 sweep/gates 验证实际扫描器；R30 将体感/证据失败与 Agent 领域失败区分，防止字体或截屏问题误计成工具写错，单测覆盖。
- 带 #662 的最终 sweep：`artifacts/sweep/2026-09-08T23-10-36.886Z/report.md`，33 输入 / 221 站 / 33 trace / 6 pi 转录，¥0；体感实际运行并记录 5,897 条逐站原始命中（字号 2,669、遮挡 2,420、重叠 725、截断 83），功能断言无新增失败。原始命中不等于已确认问题，人工去重归因见 human-review.md。


### PR #666 合 main 与总账聚合（2026-09-09）

范围：保留 main 的两层体感、提醒音夹具和 C0 ¥50 预算/原生记录；仅合并测试机制与总账呈现。不改生产代码，不增加扫描器或观察器。package.json 唯一冲突保留 main 带锁 feel:nightly，并列保留 sweep 命令。SWEEP-LAST.md 取消跟踪但保留本地文件，不改忽略规则。

总账问题分类 recurring（测试报告，非生产修复）：症状是同一批小字逐站重复使总账不可读；直接原因 saveReport 把 captureIssues 全量逐条输出；类根因是原始证据粒度与阅读粒度没有区分。实扫 startEvidence.capture → _collect.record 和 C0 createC0Collection.capture → 同一 saveReport，两类入口共用报告边界。按原始 rule/text/target/surface 元组聚合，不用坐标或站点作身份；每组保留首次站、次数、证据链接。功能 deviation 仍逐条；原始 deviations/stations/feel JSON 保持完整。依赖生命周期 not-applicable，无旧实现并行保留。

验收：三站同命中先红后绿；不同规则/文字/目标/面不误合、跨 case 可合、功能断言不合并。相关 Node 测试、完整 loopback sweep、完整带锁 gates（排锁上限 40 分钟），正常 hooks commit/push 到现有 PR #666，确认无冲突。SWEEP-LAST 顶部 ≤8 行记录本轮数字与 push 后 HEAD。回滚撤销本轮测试/报告改动，保留 main 合并。

## 混合模式（2026-09-09）

用途：簇 A 这类模型契约验收只花文本钱；显式 `sweep --case C0 --real-text --planner-model <档> --budget <元>` 让规划请求走真实文本模型，媒体生成和审片使用有标识的本地测试信号，不能称为真实成片验收。默认 loopback 不变，不改生产代码。

根因分类 recurring（测试机制）：C0 子进程始终 dry-run，CLI 的 real-text 意图未传到调度器；付费开关把文本与媒体绑在一起。实扫 scripts/sweep.mjs 的 C0/非 C0 两个入口、c0-real-main.mjs 的 appFetch/global fetch 两个出口、c0-real-budget.mjs 与 sweep-real-main.mjs 的预留边界。修在测试调度/发送边界，所有混合媒体请求只能本地响应或拒绝，文本按所选公开报价、请求字节上界和强制输出上限预留后才能发送；缺凭据明确失败，不回退。依赖版本不变，无生产修复合同；迁入补丁缺少的测试侧预算模块，不引入框架或新协议。

范围：仅 scripts/tests 与本文；保留 main #668 视频等待、原生转录观察器和真实 C0 原预算。nano 输出最高 16000、deepseek 8192，报价低于上限时取小值。撤回本任务提交即可回滚，无数据迁移。验收：参数/预算传递、零媒体出站、并发及超预算拒发先红后绿；无 key 明确报错；完整 loopback 复扫及完整 gates exit 0，正常 hooks 后 push/PR。

Ponytail 复核：两种模式统一复用 `c0-fixture.mjs` 的 `createSyntheticC0Media`，删除调度器内重复的 FFmpeg 编码配方；真实文本和媒体隔离发送边界不变。参数/缺 key/并发及失败预留共新增 5 项测试，和原预算测试合计 12 项通过。全量 loopback 与最终完整 gates 的收据写入 SWEEPC-LAST.md；真模型 HTTP 400 及 repair 保留，不把本任务称为生产模型契约修复。

## 凭据预检（C14）

范围仅测试装配与脚本。recurring：sweep attachRealText 与 C0 scheduler.attach 都在付费装配前同步调用隔离应用的 catalog/secrets 解密，锁屏可令 Electron 主线程永久阻塞；缺少的是 Node 宿主拥有的限时边界，不是模型失败。统一在原解密调用旁写无秘密的完成标记，宿主以最多 9 秒看守；不额外解密、不缓存或绕过钥匙串。超时直接终止该隔离进程，原生错误不进报告。系统 IORegistry 锁屏探测有独立短期限，unknown 保留为 unknown，不能推断 locked。

失败记录 credential-precheck.json（blocked，locked-screen/keychain-denied/no-key，系统探测证据）；依赖真实凭据的后续站 unreachable，本 run blocked，独立零额度输入继续。无 key 在准备隔离前拒绝并留相同收据。成功仍使用原应用解密函数与原 dispatch 闭包，不把 key 返回 Node。依赖不升级：本任务修测试宿主看守，不改变 Electron/safeStorage 行为。回滚撤回本节与测试脚本修改，无生产或用户数据迁移。

验收先红后绿：模拟解密永不返回、抛错/空值、无 key、成功仅解密一次；验证期限、终止、blocked/未到达收据、无密钥输出。完整 gates exit 0 后正常 hooks 提交推送 PR。

C14 定向收据：旧 attach 在模拟解密挂起时由外部 1 秒超时终止且没有 blocked 收据（artifacts/c14/red-baseline.log）。七项回归覆盖同步主线程挂起、解密拒绝、缺 key、一次解密、账单阶段独立期限、C0 八站未到达及 sweep 独立零额度结果。打包 /Applications/Nomi.app 的真实应用解密在本次 locked 系统状态下返回 ready（零请求）；不能声称复现了该签名实例的真实钥匙串挂死。另对同打包应用注入同步主线程阻塞，9,037ms 返回 blocked/locked-screen，收据 elapsedMs=9,005，后续八站未到达（artifacts/c14/packaged-timeout）。没有真实模型出站或费用。

同类扫描另覆盖 c0-real-assembly.e2e.mjs：改为同一看守入口，用原余额请求内的合成凭据断言证明解密，删除此前多余的独立解密。已安装 Nomi.app 缺少本分支需要的 dist-electron/appFetch.js，完整 dispatch 装配不能用该旧包证明；该失败按装配失败保留，没有伪装成凭据 blocked。完整装配改用当前构建验证，打包实例仅证明上述应用解密与外部期限。
