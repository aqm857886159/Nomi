# 设计卡：接入新模型时「调用方式」只在一处判对错，三条接入路只拿结果

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：动手前写的（2026-11-17）。行号指 `origin/main` 4832b523b。
类别：其他（不是花钱 / 长跑 / 可打断 / 新界面）；行为会变，★ 五格写全。修复类，不是新功能，★7 不适用。
不改界面：没有拍板图；设计规矩只引用 `docs/design/nomi-design-system.md` §1.0「一个东西一个家」。

## 先查别人

- `eslint.config.mjs:283-350` · 生成请求装配边界：受限名单逐文件写理由，具名 / 命名空间 / 再导出 / 动态 import / require 都拦，同目录不豁免 · **确认了**：这次「谁能拿到草稿构建口、模式语义口、编译器专用收件口」照抄这套名单写法，不另写扫描器。
- https://eslint.org/docs/latest/rules/no-restricted-imports · `importNames` 可以挂在 `patterns` 上，但规则只管静态 import，不管 `import()` 和 `require` · **确认了**：必须同时配 `dynamicModuleSelectors`（`eslint.config.mjs:297-306`）那组 no-restricted-syntax，只配 no-restricted-imports 拦不住动态拿法。
- `electron/shared/contracts/modelAccessCapabilities.ts:53-80` · 「哪种模式要声明参考槽」是一张带 `satisfies` 穷尽检查的三档表，新增模式不分类 tsc 就红 · **改了**：自检里 `startsWith("image_to_")` 那份和投影里手抄的三项数组都删掉，改读这张表（自检把 `image_to_prompt` 误判成要槽，就是没读它）。
- `electron/providerAdapter/validator.ts:336-353` · 09-03 那次把「模式语义」从全量校验里抽出来给两个生产者共用，三条出处 / 形状豁免逐条写理由 · **确认了**：内置模板继续只过语义、不过出处；这次把「来源」写成两个导出口（外部卡 / 内置编译器），不让调用方传一个放宽开关。
- 主干那张设计卡（第三方托管只由设置开关说了算，2026-11-17）的 ★2 / ★9 · 一个判断只留一处算，调用方拿不到「允许」，再加一条检查让第二处写不出来 · **确认了**：本卡 ★2 / ★9 按同一结构写，「第二处自己判一份要红」是验收项。

## ★1 用户怎么用

当我（创作者）让 AI 帮我接一个中转站或新模型时，我想不管从设置向导、从外部助手的接入会话、还是让外部助手整卡提交，同一份调用方式得到同一个结论：能用就都能用、写错就都在同一个字段上被指出来，以便我不会遇到「这条路能用、那条路缺请求格式」或「这边被拒、那边放行」。

步骤（三条路共用一段）：①入口拿到「谁、哪个模型、卡（如有）」→ ②交给唯一的草稿主人选出这次用哪份调用方式 → ③唯一的收件校验判对错 → ④自检只转述校验结论 + 免费查 key → ⑤投影成产品能力并写目录（现有主人不变）。

不做：不改发布规则、花钱确认、模型可用性判定（另一条线）、接入引导界面；不删任何一条接入路；不改错误信封的样子（B 的 proposalRejected、C 的 rejections、内部编译的 docs_not_understood 各自保留）；不迁移、不重验已经登记的模型。
已知坑：内置标准模板没有出处、带运行期键 `paramMap`，它本来就不过全量收件校验（`validator.ts:346-351`），不能因为「统一」把它拉进去；外部卡也不能借模板的豁免。

真实任务（全部本机回环假服务，不连真供应商、不付费）：
1. 设置向导接自建中转 `http://127.0.0.1:9000`，图片模型登记为 `custom-1`、别名 `gpt-image-2`：改图通道是 multipart `/v1/images/edits`（今天变成 `/v1/chat/completions`）。
2. 同一中转接视频模型，连接上写明协议 `openai-videos-v1`：文生视频有 create / query / result 三段（今天是空模式、报「没有通用协议」）。
3. 外部助手在接入会话里为私网中转交了一张卡，create 路径 `/vendor-image`：认证用的就是这张卡（今天被内置模板静默盖掉）。
4. 外部助手把同一张卡整卡提交（MCP submit_declaration）：结论与任务 3 逐字段相同；卡缺 `assetIngestion`、参数键写成 `seconds`、改图漏 `referenceShape` 时，两条路都在同一字段拒。
5. 旧会话恢复：任务 3 的 run 已落盘（卡在边表里），重启后恢复，用的仍是这张卡、结论相同。

指标与量具：
- 三条路对同一份卡的结论逐字段一致（接受 / 拒绝、拒绝字段、最终 create 路径、能力模式集合）= 8 条差异样本全部一致 · 量具：新增 `electron/providerAdapter/declarationEntryParity.test.ts`，从真实入口（`ProviderAdapterService.start` / 接入会话 propose→start / `submitDeclaration`）喂同一份卡。修前基线：U1–U8 每条至少一处不一致（本卡第一步按准备线静态推演，实现时先写测试跑红作为修前证据）。
- 同一判断的家数 = 1（草稿来源、模式语义、中性参数、外部必填各 1）· 量具：`node scripts/door-map.mjs <符号>` 前后对比 + `declarationOwnership.lint.test.ts`。
- 不放行发不出请求的声明：U4 / U6 样本在收件处就拒、0 张进目录 · 量具：同上对拍测试。

### ★1b 连带界面

- 不改任何界面元素和文案。自检原因码仍是那三个（`no_channel` / `async_without_query` / `reference_slot_missing`），界面 `src/ui/onboarding/adapterFailureAdvice.ts` 照旧读；只有自检的英文诊断句改成校验器原句（折叠在「看原始报错」里）。
- MCP 回执：U6、U8 的拒绝从「登记失败 provider_failed」提前成「卡被拒 declaration_rejected」并带字段路径；U7 的拒绝码是现有的 `upload_strategy_unsupported`（`submitDeclaration.ts:63`）。onboarding kit 两个示例本来就写了 `assetIngestion`（`kitExamples.ts:60,174`），说明不改。

### ★1c 老用户

- 已经登记 / 认证进目录的模型：升级后不重验、不改写。依据：收件校验的生产调用只有四处（door-map：`submitDeclaration.ts:171`、`agentCompileRequest.ts:62`、`compiler.ts:305/316/342`、`serviceCompilation.ts:126`），都在接入当下；登记时落盘的原卡 `declarationSource` 只有写入处（`declaredProviderRegistration.ts:132`），生产代码里没有任何读取它的地方（`git grep declarationSource`），启动和读目录不碰收件校验；「重新登记」就是重新交卡，按新卡判。什么都不做照常用，由 ★9 第 13 条守。
- 接到一半的认证 run：run 有 5 分钟总时限（`serviceLifecycle.ts:6`），重启恢复时超时的直接判 timed_out（`service.ts:323`），不会拿新规则重判旧卡。时限内恢复的，卡来自接入会话的严格交件 schema（`agentCompileRequest.ts:37-40`，09-18 起 `assetIngestion` 必填），新规则下同样通过；唯一会变的是卡里写了 `seconds` 这类线缆名参数——以前认证会投影出一个叫 seconds 的控件，现在在收件处拒并给出可照做的改法。
- 整卡提交的老卡重交：缺 `assetIngestion` 的卡以前能登记，现在被拒（这次唯一对 MCP 外部助手可见的变化，见 U7 裁定）；写 `seconds` 和 `image_to_audio` 的卡以前也是拒，只是拒得晚、码不同。
- 私网中转 + 别名 / 显式视频协议的连接：已认证的路由不动；下次重新验证时才得到正确的改图 / 视频通道（这是修复本身）。
- 退回上一版：不改任何落盘格式，照常打开。
- 已发安装包：`git diff v0.24.1 origin/main` 在本卡涉及的生产文件上只有 `promotionMeta.ts` 4 行变化（不涉及上面任何一条判断），所以以上对旧版行为的描述对 0.24.1 同样成立；没有在安装包上实跑，记「未查（安装包实跑）」。

## ★2 谁说了算

| 判断 | 唯一的家 | 允许的消费者 | 删掉的第二处 |
|---|---|---|---|
| 这次用哪份调用方式（外部卡 / 私网内置模板 / 内置编译 / 标准模板兜底）+ 模型完整身份（别名、显式协议、Nomi 锁定的 key/kind） | `electron/providerAdapter/serviceCompilation.ts`（新增一个准备入口，service 只给它连接、run 输入和编译回调） | `service.ts#process` 只拿结果 | `service.ts:360-383` 里先建内置模板当布尔、再用丢身份的 `genericCompilation` 重建的那段；`externallyCompiledDraft` 用卡自己的模型清单当「用户所选」那一句改为 run 的所选 |
| 标准模板怎么建（带别名和协议） | `builtinOpenAiCompatibleDraft.ts#buildOpenAiCompatibleDraft` | 只经 `serviceFallback.ts#genericCompilation`，后者只给 `serviceCompilation.ts` | 两个构建口各传一半身份 |
| 这条模式在语义上合不合法（taskKind 属于哪种模型、要不要参考槽、交付形状、结果映射） | `validator.ts#assertAdapterModeInvariants`（新增同文件 `adapterModeDefect` 返回结构化缺陷，前者只是把它抛出来）；两张事实表各归原主：参考档 `modelAccessCapabilities.ts`，taskKind→模型种类 `capabilityModeManifest.ts#modelKindForTaskKind` | 全量收件校验、内置模板构建、自检、投影 | `validator.ts:221-234` 手抄的 12 项 taskKind→kind 表（改读 `modelKindForTaskKind`，文本三种照旧）；`selfCheck.ts:116-118` 的 `startsWith`；`promotionMeta.ts:70,168` 手抄的三项参考数组 |
| 自检的「卡站不站得住」 | 同上（自检只把 `adapterModeDefect` 的码转成自己的三个原因码） | `verifier.ts`、`submitDeclaration.ts` | `selfCheck.ts#checkAdapterModeContract` 里自己的三条判断 |
| 写出来的卡（外部交来的、内置编译器写的）参数键必须是 Nomi 中性键 | 全量收件校验 `validator.ts`（调用 `promotionMeta.ts#assertNeutralDeclarationParameters`，定义不搬） | 所有过收件校验的卡 | `declaredProviderRegistration.ts:86` 只在整卡登记门单独调的那一次 |
| 外部卡必须显式写 `assetIngestion` | `validator.ts` 外部收件口（`validateProviderAdapterDraft`，B、C、旧 run 恢复都走它） | — | `validator.ts:217` 的 partial 只留给内置编译器专用口（新导出，只许 `compiler.ts` 导入） |
| 能力投影 / 路由替换 / 目录事务 | 不动：`promotionMeta.ts#projectDeclaredModel`、`assertDeclaredReplacementOwnership`、`mutateCatalog` | — | — |

门数（`node scripts/door-map.mjs`，修前原始输出在证据目录）：
- 「选草稿 / 建标准模板」：修前 2 个文件在选（`service.ts` 两处、`serviceCompilation.ts` 三处调 `genericCompilation`；`builtinDraftForUndocumentedEndpoint` 在 `service.ts`）→ 修后 1 个（只在 `serviceCompilation.ts`）。
- 「模式语义 / 参考集合」：修前 3 处各有一份（validator 表、selfCheck startsWith、promotionMeta 数组）→ 修后 0 份手抄，全部读两张事实表；语义判断入口 1 个（`adapterModeDefect`）。
- 「中性参数」：修前 1 个调用者但只覆盖整卡登记 → 修后 1 个调用者（收件校验），覆盖全部写出来的卡。
- 「外部必填」：修前 2 份 schema 对外部卡松紧不同 → 修后外部 1 份。
- 状态默认归主进程：全部在主进程，没有靠「东西不见了」猜意图。

## 准备线 8 条差异的裁定

判据两条：同一份声明从哪条路进来结果都一样；不放行发不出请求的声明。

| 编号 | 裁定 | 统一成哪边 / 为什么 |
|---|---|---|
| U1 外部卡 vs 私网模板谁先 | 统一 | 交了卡就用卡；私网内置模板只在没有卡时用。接入会话对私网主机本来就要求外部显式交卡（`integrationAdapterContract.ts:51-61`），交了又被盖掉没有理由。 |
| U2 丢别名 | 统一 | 标准模板只有一个构建口，带上 `modelAlias`。别名选改图协议有正反测试（`builtinOpenAiCompatibleDraft.test.ts:324-345`），丢它是 09-08 旧案的第三次。 |
| U3 丢显式视频协议 | 统一 | 同 U2，带上 `mediaProtocols`。私网和公网兜底都用这一个口；多个协议照旧拒猜。 |
| U4 漏 referenceShape | 统一到「拒」 | 自检改转述校验结论。缺 shape 时探针和生产都不知道参考怎么放，放行就是发不出正确请求。 |
| U5 image_to_prompt 无槽 | 统一到「过」 | 同上。它的参考走运行期写死的通道（`modelAccessCapabilities.ts:64-71`），要它声明槽等于要一个没人读的字段。 |
| U6 image_to_audio | 统一到「在收件处拒」 | 产品里没有能跑这种模式的能力（`capabilityModeManifest.ts:24-29` 不含它），投影一定拒；把同一张表用到收件校验，让拒绝提前到卡被交来的那一刻、带字段路径。**要不要支持 image_to_audio 是另一件功能，本卡不做**——请协调确认。 |
| U7 外部卡省 assetIngestion | 统一到「拒」 | 外部卡（会话交件、整卡提交、旧 run 恢复）一律必填；只有内置编译器的卡可省（它走内置上传注册表，理由已写在 `validator.ts:214-217`），这条差异保留，写成「只许编译器导入的专用收件口」，不是调用方可传的开关。对 MCP 老卡重交可见，见 ★1c——请协调确认。 |
| U8 中性参数 | 统一 | 规则挪进收件校验，所有写出来的卡（外部 + 内置编译）都过；内置标准模板不过收件校验，照旧不受（保留差异，理由：模板是 Nomi 自己的契约，参数由 `newapiTransport` 定，不是作者写的）。代价：内置编译器写出 `seconds` 时这次编译算失败、退回标准模板（编译器的重试不带错误反馈，`compiler.ts:213-253`）；同时在编译提示词里加一句中性键规则（交件说明与编译器共用这份提示词，`agentCompileRequest.ts:17`）。请协调确认是否含编译器。 |

协调 2026-11-17 回话后的定稿：
- U6：照上表，在收件处拒、带字段路径；支持 image_to_audio 另立一件。
- U7：只对「新交的卡」变严。已登记的声明在启动、读目录、重新登记时都不再过收件校验（见 ★1c 出处），不加任何兜底分支。旧会话恢复时卡里缺这个字段：run 以一句明确的拒绝结束（`upload_strategy_unsupported`、字段路径 `assetIngestion`、合法取值列表），不崩、不挂在处理中。拒绝句里带字段路径和全部合法取值，让助手一轮改对。onboarding kit 给外部助手的整卡 schema 同时改成 `assetIngestion` 必填（它此前从 partial 那份派生，告诉助手这格可省）。
- U8：外部卡全查。编译器：现有重试每次发同一句提示词，没有放反馈的位置，但补上只要十几行（校验拒绝的原句接到下一次尝试的提示词末尾），属于「改动小」→ 编译器也查、同时带反馈，提示词加一句中性键规则。仓库里的编译器输出样本过新检查，报「原来过、现在被拒」的条数。
- 补充：★9 第 13 条老用户验收、内置模板 `size` 单列待办（见下）。

有意保留、写成参数或来源的差异（准备线 I1–I7，照旧）：整卡无 key 可交 vs 会话先要凭据；内置模板无出处 / 带 paramMap；会话锁定身份 vs 整卡自带身份；文本条目不读假 HTTP 路由；声明发布全部模式 vs 认证只发布自检过的；界面候选去重 vs 作者卡重复报错；各入口的错误信封不同但判据同一份。

顺手发现、不在本卡修（报协调）：内置 `openai-videos-v1` 模板的参数键 `size`（`builtinOpenAiCompatibleDraft.ts:215`）本身就是中性参数表里的线缆名；它不过收件校验所以不受 U8 影响，但已认证模型的控件就叫 size。改它要动老用户已存的控件，另立一件。

## ★3 一致与复用

- 以前定过：09-03 模式语义两生产者共用（`validator.ts:336-353`，还算数）；09-18 私网主机外部路要显式选模板（`integrationAdapterContract.ts:51-61`，还算数，U1 就是它没落到执行处）；10-30 能力与线缆一起编译（097643761，`projectDeclaredModel` 是唯一投影，不动）；10-31 中性参数拒绝要能照做（0df4b046c，文案不动，只换调用处）；用户 11-16「第二处写不出来」、11-17「13 组同类全收」。
- 三条路：沿现有主人扩（选这条）；新抽一个声明核心模块（多搬依赖、容易成新壳，已有的投影主人不值得重写）；删掉设置向导和接入会话两条路只留整卡提交（会断无外部助手的用户和旧 run 恢复，属产品取舍，不选）。
- 方向检查（提交时 commit-msg 命中）：口径命中两条——目录 `electron/capabilityCore/modelOnboarding/` 近 14 天 3 个 fix（都在 `tryModel.ts` 及其测试，与本卡无关）、概念 `relay.video-wire-selection` 近 14 天 2 个 fix（出网层、供应商结果读取，与本卡无关）。本卡改到的生产文件自身近 14 天 fix 数为 0（核法：`git log origin/main --since="14 days ago" --no-merges -- <文件>` 逐个看；只有 `eslint.config.mjs` 是 3，它是各组都往里加一段的登记文件）。改法是换和删（删私网第二个模板口、手抄表、自检自判、登记门单独判），不新增分支或特例；编译器走「带反馈一起查」而不是豁免分支。协调 2026-11-17 按 P1 例外代批，事后报用户。
- 复用：现有校验器、两张事实表、`modelKindForTaskKind`、`assertNeutralDeclarationParameters`、eslint 边界名单写法、`declaredProviderRegistration.test.ts` / `service.test.ts` 现有夹具。不引库、不加新概念对象；概念登记在 `relay.video-wire-selection` / `catalog.declared-capability-projection` 里补引用，不够表达「草稿来源」时新增一份窄登记。

## ★4 全状态（这一组没有界面，写各入口回给调用方的结果）

- 空：卡里没有模型——整卡提交照旧报「没有模型」；向导 / 会话照旧要求先选模型。
- 加载：认证 run 的阶段照旧（准备 → 编译 → 自检 → 发布）。
- 成功：三条路同一份卡得到同一组模式与 create 路径；整卡提交标「未试跑」照旧。
- 失败：同一字段、同一原句；信封各自的样子不变。
- 部分成功：认证只发布自检过的模式（I5 照旧）。
- 取消中：run 取消照旧；收件校验是同步纯函数，没有半截。
- 过期：run 超过 5 分钟时限照旧判超时，不拿新规则重判。
- 能力不可用：标准模板对这种模型没有通道（如 3D、未写协议的视频）——照旧 `no_generic_contract`，下一步是写调用脚本或交一张卡；U6 的 image_to_audio 拒绝句写明「Nomi 不能把这种模式投成产品能力」，下一步是改成能跑的模式。
- 最大值 / 最长文字：拒绝句沿用 600 字截断（`submitDeclaration.ts:68`）。

## ★9 验收与回滚

应该通过（实现线自验、验收线只核这份清单）：
1. 三条路对拍：同一份合格卡分别从 `ProviderAdapterService.start`（带卡）、接入会话 propose→start、`submitDeclaration` 进来，接受与否、最终各模式 create 方法 + 路径、能力模式集合逐字段相同。
2. U1：私网 `127.0.0.1` + 已交卡 `/vendor-image`——认证 run 的候选草稿 create 路径是 `/vendor-image`；没交卡时仍是内置模板。
3. U2：私网、`custom-1` + 别名 `gpt-image-2`——设置向导 run 的改图 create 是 multipart `/v1/images/edits`。
4. U3：私网、视频、协议 `openai-videos-v1`——run 草稿有文生视频 create / query / result；公网编译失败兜底同样带上。
5. U4：改图缺 referenceShape——三条路都拒，字段同；自检对同一模式返回 `reference_slot_missing`。
6. U5：`image_to_prompt` / `transcribe` 无参考槽——收件、自检、投影三处都过；整卡提交 `selfCheck.contract = passed`。
7. U6：`image_to_audio` 合格卡——三条路都在收件处拒，原句含 taskKind；目录 0 写入。
8. U7：外部卡省 `assetIngestion`——会话交件和整卡提交都拒（整卡码 `upload_strategy_unsupported`）；内置编译器的卡省它照旧通过。
9. U8：参数键 `seconds`——会话交件、整卡提交、内置编译器三处都拒，原句是现有可照做的那句（`promotionMeta.ts:140`）；内置 `openai-videos-v1` 模板照旧通过。
10. 旧会话恢复：落盘了卡的 run 用新 service 实例恢复，草稿与首次一致；超时的 run 判 timed_out。
11. 正常样本不误伤：现有 `validator.test.ts`、`selfCheck.test.ts`、`declaredProviderRegistration.test.ts`、`declarationDurability.test.ts`、`builtinOpenAiCompatibleDraft.test.ts`、`service.test.ts`、kit 两个示例整卡提交全部仍绿。
12. 门数：上面四个判断的 door-map 修后数字与 ★2 一致，原始输出进证据目录。
13. 老用户：按最近发布标签（v0.24.1）代码写出的两种已登记记录——缺 `assetIngestion` 的声明模型、参数键是线缆名（`seconds`）的已认证模型——升级后照旧读得出、对本机回环假服务发得出请求。
14. 旧会话恢复时卡缺 `assetIngestion`：run 进终态 failed，错误句含 `upload_strategy_unsupported`、`assetIngestion` 和合法取值，不挂在处理中。
15. 编译器写出线缆名参数：第二次尝试的提示词里带着第一次的拒绝原句。

故意改坏必须报红（实现线交「反例 → 改坏后哪条检查红 → 还原后绿 → 日志」表）：
- R1 在 `service.ts` 里重新 import 并调用 `builtinDraftForUndocumentedEndpoint` / `genericCompilation` 自己选草稿 → lint 测试红。
- R2 用命名空间 / 动态 `import()` / `require` 绕过 R1 的名单 → lint 测试红。
- R3 `selfCheck.ts` 恢复 `startsWith("image_")` 自判参考 → lint 形状检查红 + 对拍 U5 红。
- R4 在投影或任何接入文件里再手抄一份参考 taskKind 数组 → lint 形状检查红。
- R5 `serviceCompilation` 里把私网模板放回外部卡之前 → 对拍 U1 红。
- R6 标准模板构建时去掉 `modelAlias` → 对拍 U2 红 + `builtinOpenAiCompatibleDraft.test.ts` 别名用例红。
- R7 去掉 `mediaProtocols` 传递 → 对拍 U3 红。
- R8 收件校验里删掉中性参数调用（规则只回到登记门）→ 对拍 U8（会话交件那一路）红；在登记门再调一次 → lint 名单红（第二处）。
- R9 外部收件口改回 partial（省 assetIngestion 也过）→ 对拍 U7 红；非编译器文件导入编译器专用口 → lint 红。
- R10 收件校验的 taskKind→kind 恢复成手抄表、含 `image_to_audio` → 对拍 U6 红 + lint 形状检查红。
- R11 自检里新增任何一条自己的语义判断（不经 `adapterModeDefect`）让 U4 过 → 对拍 U4 红。
- R12 把已登记声明的读取（读目录 / 发请求）接到新收件校验上 → 第 13 条老用户测试红。
- R13 编译器重试不再带上一次的拒绝原句 → 第 15 条红。

这一类还会从哪里回来：新增第四条接入路自己选草稿；新增 taskKind 时有人在接入文件里手写一张表；新增一个「内部来源」的放宽开关；新加的模板构建口只传一半身份。分别由草稿构建口名单、形状检查、编译器专用口名单、对拍矩阵守。

真实场景复现：不是用户报的问题，是准备线静态读出来的 8 条；修前在对拍测试里跑红留证，修后跑绿。和真实使用的差别：本机回环假服务、假 key，不连真供应商。

回滚：一个提交，`git revert` 即可；不改落盘格式。
独立验收：非四类不强制；如协调安排，另一条线按本格清单验。
