# 声明登记的自定义供应商进入正式生成（issue #975）· 设计卡 + 方向检查

```
改动名：声明登记 → 正式生成的所有权交接     线/负责人：fix/declared-provider-production（Opus 修复线）     类别：[花钱]
```

## 用户现场与一句话根因

v0.23.0，外部宿主经 Nomi MCP：`submit_declaration` 登记一个本机 HTTP 视频适配器（连接 id `local-52931`）→ 存 key → `nomi_try_model` 真打到适配器拿到 task_id → `nomi_operation_plan` 建得出 operation → 一进正式生成就报 `Provider local-52931 lacks required recovery capabilities: configured_provider`。画布那台发动机（`runtime.runTask`）照常能跑同一个模型。

**类根因**：「这条连接归认证管」（`catalog/certificationOwnership`）回答的是「代码拥有的策展契约有没有被认证 / 声明接管」，它只对**内置 direct-key 家**有意义——只有那里有一份代码契约、被接管时正式生成的执行器必须让开。正式生成的 provider 装配（`generationProviderBootstrap`）却对**所有家**都问这句，并在「归认证管」时让出连接；而非 direct-key 家（声明卡、AI 接入、设置页手接的中转、内置的非 direct-key 家）根本没有第二个执行器来接——执行器本来就只渲染目录里那条 mapping，认证晋升和声明登记写的也正是它。让出去的东西没人接，就绪停在初始值 `configured_provider`。

**设计意图核对（叫它 bug 之前）**：这句「让出」是 09-21 BL-1（`47e4a5f1a`，执行器从「只认 APIMart」改成遍历所有家）从 APIMart 时代搬过来的——那时它防的是「APIMart 写死的 Bearer / 端点悄悄接管一条被认证改写过的连接」。09-29 A10b（`cfd73e79b`）把判据收成一份，合同 `docs/fixes/2026-09-29-connection-certification-ownership-one-owner.root-cause.json` 的 `residual_risks` 第二条已经点名：「非内置家的认证连接（AI 接入 / 声明卡），引擎 B 仍不装配（交给认证适配器）而画布照常出图：这是既有的发动机分工……改分工时只改这一处」。全仓查过：没有任何「认证适配器」实现 `GenerationProvider`（`git grep "certified transport"` 只有错误文案与注释），`providerAdapter/serviceCatalog.ts` 的认证晋升写的就是 mapping 行。所以这条「分工」从来没有另一半。

## 9 格

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我让自己的 AI（Codex / Claude）把一个自定义 HTTP 供应商接进 Nomi，我想让它和画布一样能被正式生成（Agent 付款卡、执行计划、外部 MCP `nomi_start_generation`、全自动 Run、续批）使用，以便多镜头批量生成不用手点。步骤：①AI 读接入套件 ②`submit_declaration` 交整份卡 ③存 key（用户在 Nomi 页面粘或 AI `set_key`）④`nomi_try_model` 试跑 ⑤`nomi_operation_plan` ⑥付款卡确认 / 全自动 ⑦派发、轮询、取产物、回填。**不做**：不给单个供应商加白名单；不整体放开私网（只信连接自己的精确 origin）；不改参考图通道（B，另开）。**已知坑**：产物不在连接自己的 origin 上时仍取不回（进「已生成但取回失败」，可重新取回）。真实任务：(a) #975 报告者的本机适配器三模式（fast / quality / reference）；(b) 设置页手接的中转站上手加一个模型后让 Agent 生成；(c) AI 接入（继续验证）晋升过的中转连接走全自动 Run | `electron/capabilityCore/modelOnboarding/declaredProviderProduction.test.ts`（本机假适配器走完 ①–⑦ 的前六步 + 派发 / 轮询 / 产物描述）；(a)(b)(c) 真机 `unverified` |
| ★2 谁说了算 | 概念 `catalog.connection.certification-ownership`（主人 `certificationOwnership.isCertificationOwnedConnection`）不变；变的是消费者：正式生成那一侧只有内置 direct-key 家问它（`hasSafeDirectKeyScope`、`resolveConnection`、生成器的 `assertDirectKeyContract`），设置页鉴权锁照旧对所有家问。正式生成就绪的唯一边界仍是 `createGenerationProviderBootstrap`；「一行发布哪些模式」仍归 `shared/modelPublication`。碰 1 个概念 | `node scripts/door-map.mjs isCertificationOwnedConnection`（4 扇门：bootstrap / apimartGenerationProvider / directKeyCredential / rendererCatalogMutation）；`node scripts/door-map.mjs createGenerationProviderBootstrap`（appIntegration / liveGenerationRuntime / mcpStdioServer / parity 夹具） |
| ★3 一致与复用 | 就绪：不新增判据，删掉 bootstrap 里对非 direct-key 家的「让出」，与画布对同一份目录给同一个答案。取回（A）：不新造分类器——例外从提交侧已有的 `declaredVendorOrigins` 派生，「是不是私网字面量」问出站策略 owner 的名字层。A2：自己写了「取回失败是暂时还是确定」一个判定（只读策略错误类型与 hardenedFetch 诊断）和一条「重新取回」命令；任务面板按钮与错误卡复用既有槽位，只加文案 | `git grep -n isCertificationOwnedConnection electron`；`electron/parity/certificationOwnershipParity.test.ts` 仍绿 |
| ★4 全状态 | 没有新界面。正式生成里用户可见状态不变，只是「configured_provider（没配）」这条假话对非 direct-key 家消失：就绪 → 付款卡照常弹（或按档位代答）→ 派发中 → 轮询 → 成功回填 / 失败进 needs_attention / 取消沿用既有 Run 语义。文案无改动 | 不适用：无新文案、无新界面 |
| 5 中途表 | 见下表 | `declaredProviderProduction.test.ts`、`generationProviderBootstrapOwnership.test.ts`；断网 / 重启 / 连点沿用既有 Run 测试，本改动不碰那段 |
| 6 外部数据与失败 | 外部来源：用户 / AI 声明的卡（mapping、鉴权放法、地址）。偏差：卡写错 → 供应商回 4xx / 任务失败，job 进 needs_attention，原文经脱敏回传；鉴权放法错 → 401，不甩锅成「key 不对」之外的别的话（沿用既有分类）。新增风险：声明了却从没试跑成功的卡现在也能进正式生成（与画布一致），花钱前仍过付款卡 | 不适用官方链接：供应商是用户自己声明的 |
| 7 性能预算 | 就绪判断少一次 `isCertificationOwnedConnection` 扫描，不新增 IO | 不适用：无热路径新增 |
| 8 真实条件 | Windows 本机跑过单测与本机 HTTP 假适配器端到端；真 App、真付费、英文界面、干净安装均 `unverified`（本线不发起真实付费） | 测试输出见报告 |
| ★9 验收与回滚 | 验收（另一条线）：①在 v0.23.0 形状的目录上（声明卡标记、带 key）问 `createLiveGenerationRuntime().readBootstrap()`，该家 `providerReady: true`；②真 App + 本机假适配器走一次 `nomi_start_generation`，确认付款卡仍弹、派发打到适配器、产物描述回来；③内置 APIMart 上 A10b / certification-owned 两条仍按旧答案拒。回滚：revert 本线的 fix 提交（单文件一行删除 + 注释），无数据迁移 | 独立验收报告待补（四类强制，验收线不得是本线） |

### 格 5 · 中途表（正式生成，本机 / 自定义声明供应商）

| 处境 | 修前 | 修后：用户看到什么 | 花费 | 回执 |
|---|---|---|---|---|
| 声明了、没试跑 / 试跑没过 | 就绪失败 `configured_provider`，不发请求 | 就绪；付款卡照常弹（或按档位代答）；卡写错则上游报错，job 进 needs_attention，原文可读 | 走付款卡；是否扣费取决于上游在哪一步拒（创建即拒通常不扣） | Run 账本 / job attention |
| 试跑过了 | 同上，仍 `configured_provider` | 同上一行：试跑成功不落盘、不改变就绪（与画布一致） | 同上 | 同上 |
| key 被删 | `configured_provider` | 仍 `configured_provider`（`credentialIsUsable` 拦，计划 / 授权阶段就停）；授权后才删：提交时 `resolveConnection` 取不到 key，发请求前报 provider 错 | 不扣 | 授权失败 / provider 错 |
| 适配器离线（提交时） | 到不了这一步 | 连接被拒 = 请求未到达，按既有「未到达」分类处理，不盲目重发已到达的请求 | 不扣（请求没到） | job 错误 / attention |
| 适配器离线（轮询时） | 到不了这一步 | 轮询错误按既有逻辑记 warn、下轮再查，直到批次时限 | 上游可能已扣（任务已受理） | 批次轮询日志 |
| 产物就在这条连接自己的本机 origin 上 | 到不了这一步 | 取回放行（#975 A：只信连接 base URL 的精确 origin），落盘、回填 | 正常 | Run 产物 / 画布节点 |
| 产物在别的本机 / 内网地址（同主机换端口也算） | 到不了这一步 | 出站策略照旧拒；这一镜进 needs_attention「已经生成，但结果没能取回」，Run 停下；任务面板给「重新取回」（#975 A2） | 已扣（任务已做完）；重新取回只再查一次、再下一次，不重新提交 | job.errorCode `output_retrieval_failed` + 带稳定码的人话 |
| 停 / 关窗 / 重启 / 连点 | 不变 | 沿用既有 Run 语义（Run 耐久、重启后按 reconcile 续），本改动不碰 | 同既有 | 同既有 |

## 方向检查（RW：`generationProviderBootstrap.ts` 14 天内第 3 个 fix）

**0. 一句话根因**：正式生成的就绪是引擎 B 自己的一份答案，它的判据是从「只认 APIMart」时代逐条搬来的，没有一条规则保证它和画布（引擎 A）对同一份目录给同一个答案。

**1. 归类表**

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| `47e4a5f1a` BL-1 | 装配只认 `apimart` 一家 | 引擎 B 就绪判据带着单一供应商时代的假设 |
| `cfd73e79b` A10b | 用户自加一行带标记 → 整家 APIMart 关门 | 同上：模型级标记被当连接级归属 |
| 本次 #975 | 非 direct-key 家带标记 → 整条连接让出、没人接 | 同上：「让出给认证」只对有代码契约的家成立 |

**2. 为什么一直冒**：引擎 B 的装配不读引擎 A 的「能不能用」（`catalogModelAvailability`），而是自己列条件；每条条件都在 APIMart 上成立、在别的家上没人验证。对拍矩阵（`electron/parity`）的目录里只有内置家，非内置 / 声明 / 本机这几类人群不在矩阵里。

**3. 不改结构的话接下来会冒的（可验证预测）**

| 预测 | 怎么验证 |
|---|---|
| 声明 `authType: "none"` 的本机适配器在正式生成仍是 `configured_provider`（`credentialIsUsable` 要求有 key；画布对 none 放行，见 `catalogStore.ts` 的 `listOnboardingAgentCandidates`、`catalogModelAvailability.ts`） | 在 `generationProviderBootstrapOwnership.test.ts` 里加一格 `authType: "none"`、不存 key，断言就绪 |
| 参考素材走 `inline-base64` 的家（内置 modelscope / minimax / meshy，以及接入套件第二份样例教 AI 写的形状）带参考图进正式生成必拒：`productionReferenceUrls.ts` 只收 `http(s)` | 给这几家任一镜头挂一张参考图走 `prepareProductionGenerationAuthorizationWithReferences`，期望 `generation_reference_url_unavailable` |
| 本机适配器产物在私网地址：正式生成扣了钱拿不到产物，批次反复重试下载直到时限（与 #975 报告里「后 3 镜一直 polling、主进程高 CPU」形状一致，未证同源） | `declaredProviderProduction.test.ts` 最后一条（materializer 拒 127.0.0.1）+ `multiShotBatchScheduler.observeUnitOnce` 把下载失败当 pending |

**4. 靶子独立性**：对拍矩阵与引擎 B 是同一批人写的，矩阵目录只有内置家——靶子漏了人群。本次新增的类测试把「非内置 / 内置非 direct-key」两类人群 × 四个写标记的真实写门放进来。

**5. P0**：不是我们独有的东西要现成方案；「同一份目录、两台发动机给同一个答案」是我们自己的双引擎结构问题，没有现成库可接。

**6. 补 / 重写 / 删**

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 补 | 给声明卡来源单开一条白名单 | 小 | 又一个特例分支；手加模型 / 导入 / 认证晋升那几类照样关门 | 否 |
| 删（本次） | 删掉 bootstrap 对非 direct-key 家的「让出」，认证判据在正式生成侧只留给有代码契约的家 | 一行 + 注释 + 两份测试 | 声明了但没试跑过的卡也能进正式生成（与画布一致，付款卡仍在） | **是** |
| 重写（限一个模块） | 让 bootstrap 的就绪直接派生自 `catalogModelAvailability` + 「这家需要哪种传输、引擎 B 有没有」一张表，把上面三条预测一起收掉 | 中：牵涉 authType none、私网产物信任、inline 参考三处，各自有安全 / 存储取舍 | 会顺带放开私网下载与大体积 data URL 入封存信封，需要用户拍板 | 本次不做，交协调会话 |

**7. 用户要权衡的核心**：要不要让「用户自己声明的本机供应商」享有和 ComfyUI 一样的待遇——信任它自己那个本机地址来取产物、把参考图以内联方式送过去；这两件放开了，本机适配器才算在正式生成里真正走通，但它们都是「AI 写进来的地址能让 Nomi 访问本机私网」的安全口子。

**特征测试**：`electron/capabilityCore/generationProviderBootstrapOwnership.test.ts`（修前 21 红 / 7 绿，修后全绿）；`electron/capabilityCore/modelOnboarding/declaredProviderProduction.test.ts`（修前就绪 / 派发 / 重启三条红，修后全绿；materializer 拒私网那条修前修后都绿，钉住既有安全边界）；既有 `generationProviderBootstrap.test.ts` 的 A10b 与 certification-owned APIMart 两条不变、仍绿。

## 协调会话拍板（2026-10-04）与落地

- **A（已做）本机供应商产物下载**：取回只额外信任「这条连接自己的 base URL 的精确 origin」（协议 + 主机 + 端口完全一致），且只在它是私网 / 回环字面量时给例外；同主机换端口、别的回环 / 内网地址照旧拒；链路本地永远不给；公网家（内置 APIMart 等）不给例外（给了反而会关掉跟随跳转）。key 由谁填不另设条件。判据只有一处：`electron/vendor/vendorOutboundGuard.ts` 的 `trustedRetrievalOrigin`，与提交侧的 `declaredVendorOrigins` 同源；画布（`localizeTaskAsset`）与正式生成（`generationOutputMaterializer`）两扇取回门都只问它。旧的 `trustedLocalOutputOrigin`（只信 ComfyUI）同批删除。`downloadAsset.fetchAssetBytes`（另存到磁盘）、`assetsIpc` 导入网址、参考图导入、TikHub 连接器不是「取回某家供应商产物」，没有连接身份可问，维持原策略。
- **A2（已做）确定性取回失败停下来**：`generationOutputMaterializer` 按结构化事实判「再取一次会不会不一样」（出站策略拒 / 对方 4xx / 跳转 / 类型不对 / 超上限 = 确定性；超时、断流、5xx / 408 / 429、连不上 = 暂时）；`productionGenerationSubmission.materialize` 把确定性失败耐久地记成 needs_attention（`output_retrieval_failed`，人话带 `NOMI_ERR::output-retrieval-failed::`）；`multiShotBatchScheduler.observeUnitOnce` 把它当「已结清」不再重查重下。重新取回 = `job.retry_retrieval` 命令（任务面板「重新取回」按钮 / 渲染层 IPC），只把这一镜放回轮询并叫醒批次调度器：零新提交、不预留、不弹付费卡；停着的 Run 只观察在飞的镜，不派新的。画布节点错误卡按稳定码说「已经生成，但结果没能取回」，主动作只指路去任务面板，绝不给「重试」（= 再生成）。海报取回改为尽力而为：成片已落盘时，海报取不回来不再把整镜判成失败。
  - **限制**：重新取回只对多镜批次的镜开放（单镜路已在 `appIntegrationRunObservation` 把任何物化失败落成 attention，不会循环；单镜的「重新取回」入口另开）。暂时性失败（大文件超时等）仍按原逻辑每轮重试到时限再由重踢续上——这一类是否也要设次数上限，交协调会话。
  - **高 CPU 是否同源**：机制已证实——修前同一镜在一趟 120 秒的驱动里被重查、重下 12 次（`batchOutputRetrievalFailure.e2e.test.ts` 修前红：`expected 12 to be 1`），默认 300 秒一趟约 20 轮，且每次重踢从头再来；每一轮若连上了就整段下载到内存。#975 报告者「后 3 镜停在 polling、主进程高 CPU、1.7–2.3GB」与这个形状一致，但没有他的诊断包，不能断定他那 3 镜的失败是确定性的（若是大文件超时，属于暂时类，仍会循环）。
- **V-975 验收追加（已做）**：①落盘校验失败（坏 MP4：字节认不出 / 解码不了 / 类型对不上）也归确定性——`generatedMediaDecode` 给它一个结构化类型 `GeneratedMediaValidationError`，取回器据此判定，不读人话；供应商没给出唯一一份产物也一并停下（同为「已生成待取回」），这家根本没有物化通道则如实停下但不给「重新取回」。②「已生成、待取回」有了自己的镜头阶段 `unretrieved`，判据只有 `productionShotPhase.jobAwaitsRetrieval` 一处；投到节点上是「可找回」（recoverable），于是分镜表行是「可找回」而不是「生成失败」、不进批量，画布「生成全部」也不算它；节点 / 分镜表上那枚免费的「重新拉取」对制作镜走 Run 的 `job.retry_retrieval`。要重新生成只能对这一镜明确操作（照常走付费卡）。
- **B（不在本 PR）内联参考图进正式生成**：推荐只把「素材身份 + 内容哈希」封进授权信封，提交那一刻由执行器按连接声明的 `inline-base64` 现算 data URL（字节随哈希校验），不把整段 base64 落进 Run 快照。影响面：`productionReferenceUrls.ts` 的 http(s) 断言、`apimartGenerationProjection.ts` 的 `assertReferenceValue` / `isProviderUrl`、授权信封与请求指纹（`productionGenerationAuthorization`）、内置 modelscope / minimax / meshy 与所有声明 `inline-base64` 的连接（接入套件第二份样例就是这种）。
- **C（不改）**：声明了但没试跑成功的卡按与画布一致放行，付款卡仍在。

### 方向检查 · 第二节（取回 / 观察这一族，A 与 A2 碰到的热点文件）

`generationOutputMaterializer.ts`（14 天 4 个 fix）、`multiShotBatchScheduler.ts`（6 个）、`productionGenerationSubmission.ts`（9 个）、`productionRunService.ts`（8 个）都命中 RW。

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 09-07 出站策略分家（`networkOutboundPolicy` 文件头） | 提交不判目的地、取回判 → 付了钱取不回 | 「同一次生成，提交与取回对目的地给两个答案」 |
| 09-25 付费卡下载超时（materializer 文件头） | 付费卡路自带一份时限 | 取回策略有两份 |
| 本次 A | 提交侧信任连接自己的 origin，取回侧只信 ComfyUI | 同第一行：提交与取回对目的地给两个答案 |
| 本次 A2 | 观察循环把一切物化失败当「还在处理」 | 「失败是暂时还是确定」没有主人，各循环自己猜 |

**一句话**：取回这一步的两个问题——「这个地址能不能去」与「这次失败还会不会好」——各自只该有一个主人；前者现在由 `vendorOutboundGuard` 同时回答提交与取回，后者由取回器（materializer）回答、观察循环只读答案。**预测**：画布那条（`localizeTaskAsset` → `runtime` / `taskResultQuery`）在取回失败时的「可找回」判定仍是渲染层按 `outbound-blocked` 码猜（`outboundBlockedRecovery.ts`），没有读取回器的确定性答案——下一次「画布取回失败却给了付费重试」会从这里回来；验证：在画布节点上让产物落在别的本机端口，看错误卡给的是不是「重新拉取结果」。**推荐**：下一刀把画布取回失败也落成同一个码，`outboundBlockedRecovery` 改认 `output-retrieval-failed`，删掉按 `outbound-blocked` 单码判的那支。
