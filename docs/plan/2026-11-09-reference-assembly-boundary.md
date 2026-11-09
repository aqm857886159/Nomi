# 设计卡：生成请求的装配与发送资格（S3 防回潮，替掉静态写键扫描）

> 实现线 I-s3-reference-assembly-boundary，叠在 PR #1452（`fix/gen-chain-reference-lowering`，`1f8cb99a2`）上。
> 方向来自独立复盘 R-s3-guard-direction（未参与 #1452 实现 / 验收的线写的），整理见
> `docs/engineering/direction-checks/2026-11-09-reference-assembly-boundary.md`。四类：花钱（生成请求出网）。
> **不改**已批准的绑定 / 解析算法，**不改** 498 份 expected，不放宽任何门岗。

## ★0 先查别人

- [TypeScript 类私有字段](https://www.typescriptlang.org/docs/handbook/2/classes.html#member-visibility) · ECMAScript `#private` 不随展开 / `structuredClone` / JSON 复制，`#x in obj` 是官方的品牌检查 · **改了**：解析产物和请求体都用 `#private` 持有数据、发送端用 `#x in` 认身份，不用可被展开复制的公开 symbol 品牌。
- [TypeScript 对象类型：readonly 不参与相容性判定](https://www.typescriptlang.org/docs/handbook/2/objects.html#readonly-properties) 与 [5.9.3 `Object.assign` 签名](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/lib/es2015.core.d.ts) · readonly 可经别名改写，assign 返回交叉类型保留品牌 · **确认了**：只给 `bodyParams` 加 Readonly 不够（复盘 tsc 草稿实测 1/3），assign 必须靠运行时（冻结 + 发送端身份核对）挡。
- [ESLint no-restricted-imports](https://eslint.org/docs/latest/rules/no-restricted-imports) / [no-restricted-syntax](https://eslint.org/docs/latest/rules/no-restricted-syntax) · `importNames` 同时拦具名、命名空间导入和 `export … from` 再导出；动态 `import()` 要另配 `ImportExpression` 选择器 · **改了**：底层写接口的边界用这两条现成规则配名单，不自写流分析；名单按文件列、不给 generationLowering 整目录豁免；动态导入另配一条。
- 仓库先例 `electron/capabilityCore/verifiedCapabilityInvocationRuntime.ts:37–52`（私有 WeakMap 身份）、`eslint.config.mjs:505–508` `asset-command-owner`（受限导入名单） · **确认了**：身份登记与模块名单两种做法仓库里都有，沿用，不引新依赖。
- [eslint-plugin-functional immutable-data](https://github.com/eslint-functional/eslint-plugin-functional/blob/main/docs/rules/immutable-data.md) · 只拦原地改写，把展开新对象当正确写法 · **确认了**：不加这个插件，它答不了「这个对象有没有发送资格」。

出口：不涉及：本次不新增、扩大或挪动挡创作者的保护——正常请求逐字节不变（498 份比对），被拒的只有「不是装配主人产出的请求体 / 不是解析器产出的参考」这类代码层伪造，创作者走不到；拒发照旧在花钱前抛错、错误冒泡到现有失败卡，没有新的等待或锁。

## ★1 用户怎么用

当创作者在画布 / headless（MCP）/ Run 里带参考图发生成时，我想让参考始终落在同一个解析器算出的键上，以便「拿图改」不会因为以后某个新入口自己挑错键而变成纯文生、白扣钱。

1. 画布节点连参考图 → 点生成：renderer 用解析器算参考参数，只拿独立只读快照放进 `extras.archetypeInput`。
2. 主进程（引擎 A）`applyHeadlessParamDefaults` 用同一个解析器补 headless 参考，经主人合并函数并进参数。
3. 模板渲染出请求体后，**只在装配主人模块里**封进不透明请求体；变换在主人里受控运行，产出新的封存体。
4. 发送只认封存体：`sendProfileJson` 先核来源（`#payload in`），再取私有副本出网。
5. Run（引擎 B）授权时按同一装配主人封存，按 payload 哈希存封存体；提交时取回同一封存体发出。

不做什么：不改绑定 / 解析算法；不改 130 份档案定义；不改供应商 transform 内部；不碰音频专用 codec 与用户自写脚本（`customCallRunner` 保持沙盒协议）；不把画布的 `archetypeInput` 在主进程重新解析（跨 IPC 的那一段仍是外部输入，见 ★3 已知缺口）。
已知坑：`TaskRequest.extras` 与 Run 参数在列名单的流水线模块里仍是普通 Record；多部分表单 / CLI / 音频线缆不在 JSON 封存之内。

真实任务（量具）：
- 249 格 × 双引擎 498 份正常请求体 → `electron/parity/officialWire.matrix.test.ts`（`NOMI_OFFICIAL_WIRE_DUMP`）对 `/Users/aoqimin/Nomi-coord/tmp/V-gen-chain-s3-lowering/wire-base.json`：主指标 bodyDiff = 0、violationDiff = 0。
- 7 份真实旧目录逐模型 POST 体不变 → `electron/catalog/upgradeKeepsWorkingModels.test.ts` 等 3 个旧用户文件全绿。
- 免费演练 `tests/ux/composer-b3-reference-paid.rehearsal.walk.mjs`（回环、假 key、零花费）一次通过。
护栏指标：生成相关测试集失败数 0；`pnpm run lint` 新规则误报 0（量具：`eslint .` 全仓）。

### ★1b 连带界面
无新文案。被拒的伪造请求抛 `ProfileRequestProvenanceError` / `LoweringProvenanceError`，经现有发送失败链落到失败卡（submission_not_sent 类）；正常创作者路径碰不到。

### ★1c 老用户
- 项目 / 节点：不迁移；画布节点照旧在 renderer 算参考，只是返回值从可写对象换成冻结快照，跨 IPC 内容逐字节一样。
- 模型 / 自写目录：目录文件不改；旧目录逐模型 POST 体由 3 个旧用户测试文件（7 份真实旧数据）钉住不变。
- Run 账本：授权时封存的哈希语义不变（哈希的仍是同一份 body 字节），进行中的 Run 重启后照旧要求重建请求（原有行为）。
- 退回上一版：没有落盘格式变化，可直接退。

## ★2 谁说了算

| 概念 | 唯一 owner | 允许的消费者 |
|---|---|---|
| 参考放置（解析产物） | `electron/shared/generationLowering/lowerGenerationIntent.ts`（`LoweredGeneration` `#params`，`withLoweredReferences` 是唯一并入口） | `runReferences.ts`、`headlessReferences.ts`、`archetypeMeta.ts`（ESLint 名单）；产物外只拿得到独立快照 |
| 可发送的 profile 请求体 | `electron/catalog/profileHttpRequest.ts`（`ProfileRequestBody` `#payload`；模板渲染 + 受控变换 → 封存） | `electron/runtime.ts`、`electron/capabilityCore/apimartGenerationProvider.ts`（ESLint 名单） |
| 原始出网（`requestJson` / `requestMultipart` / `requestBinary`） | `electron/vendor/vendorHttp.ts` | 名单：`profileHttpRequest.ts`（JSON）、`runtime.ts`（仅 multipart）、`audioTaskRunner.ts` / `audio/synchronousAudioResponse.ts`（音频线缆）、`catalog/customCallRunner.ts`（用户脚本沙盒） |
| 模板渲染内部（`buildHttpRequest` / `renderTemplateValue` / `buildTemplateContext`） | `electron/ai/requestPipeline.ts` | 名单：`profileHttpRequest.ts`、`multipartOperation.ts`、`processOperation.ts`、`directKeyCredential.ts`、`integrationCertification/httpConnector.ts` |

同一份事实存几份：请求体 1 份（封存体私有），对外只有快照；参考产物 1 份（私有），对外只有快照。门表：`node scripts/door-map.mjs lowerGenerationIntent buildProfileHttpRequest requestJson`（动手前在本分支 HEAD 校准过）。

## ★3 一致与复用

以前定过：#1452 方向检查 `docs/engineering/direction-checks/2026-11-09-reference-placement-owner.md` 批准「一份绑定声明 + 一个解析写入过程」，§5 已说明 readonly / 浅 freeze 不证明 owner、「语法门只作辅助」——仍算数。第三轮验收 `V-gen-chain-s3-binding` 问题 1 证明 `staticReferenceKeyWrites` 同目录 assign / 展开漏拦、metadata 误报。
三条路（复盘 §6）：沿原方向补语法分析器（不选：跨模块 / 回调 / IPC 必漏，严格就大面积误报）；**换做法：私有装配边界 + 不透明产物 + 发送身份核对 + 现成 ESLint 模块边界（选）**；只删扫描（不选：新入口不调解析器也绿）。删旧：同一提交删掉 `staticReferenceKeyWrites` 整套与 `STANDARD_INPUT_WRITERS` 授权表，不留回退扫描。
复用：`#private` + `#x in` 品牌、`builtinRules` 包装的 `no-restricted-imports` / `no-restricted-syntax`（`asset-command-owner` 先例）；不新增依赖、不自写分析器（`check:self-written` 不新增条目）。
已知缺口（明着标，不算本次结账）：画布 `archetypeInput` 跨 IPC 后在主进程是外部输入，`referenceInputParams` 仍原样铺入——要在主进程从意图重新解析，得改 IPC 载荷和读 `archetypeInput` 的供应商变换 / 音频，超出本线停点；`TaskRequest.extras` 仍是普通 Record，由模块名单 + 生成入口登记表守调用面。

## ★4 全状态

- 空：没有参考 → 解析产物为空、并入是空操作，请求体与今天一样。
- 加载：无新加载态。
- 成功：请求体逐字节与今天一样（498 份）。
- 失败：容量超限 / 授权冲突照旧在花钱前拒；伪造产物 / 伪造请求体在发送入口抛带原因的错误，不吞掉、不重试。
- 部分成功：不适用（一次请求一份体）。
- 取消中：取消信号照旧传给 `requestJson`（封存发送透传 `signal`）。
- 过期：Run 进程重启后封存体不在内存 → 照旧报「sealed catalog identity is missing; rebuild」。
- 能力不可用：不适用（不新增要外部资源的动作）。

## 5 中途表

| 状态 | 停 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 装配中（发送前） | 未出网 · 不扣 · 无回执 | 同左 | 未出网 · 不扣 · 失败卡 | 未出网 · 不扣 · Run 要求重建 | 各自装配各自封存 · 现有幂等键不变 |
| 发送中 | 透传 signal，与今天同 · 按现有核账 | 与今天同 | 与今天同（vendorHttp 错误冒泡） | 与今天同（Run 进入核账） | 与今天同 |
| 已提交 | 与今天同 | 与今天同 | 与今天同 | 与今天同 | 与今天同 |

本次只换「谁能产出可发送的体」，出网时机、取消、核账全部不变。

## 6 外部数据与失败

| 来源 | 规范 | 我们的偏差 | 失败时 |
|---|---|---|---|
| 供应商目录 mapping body 模板 | 目录声明 | 无（渲染不变） | 渲染失败照旧报 mapping cannot render |
| 画布 IPC 的 `extras.archetypeInput` | renderer 解析器快照 | 主进程仍原样信任（已知缺口） | 与今天同 |
| 已落盘旧节点 / 自写目录 | 旧版本数据 | 无 | 旧用户测试钉住 |
| 供应商变换 | `electron/tasks/requestTransforms.ts` 注册表 | 变换收到私有副本，产出重新封存 | 变换抛错照旧冒泡 |

## ★7 性能
不适用：不新增用户操作；每次请求多一次请求体 `structuredClone`（KB 级 JSON，微秒级），不进交互路径。

## 8 真实条件
Windows：unverified（纯主进程逻辑，无平台分支）；英文界面：不适用（无新文案）；最小窗口：不适用；真规模：498 份矩阵 + 7 份真实旧目录；干净安装：unverified；真付费：不跑（本线禁花钱，免费演练代替，真付费留协调会话）；键盘全程：不适用。

## 拍板图清单
不适用：不改界面。

## ★9 验收与回滚（动手前写全）

### 验收清单（实现线自验、验收线只核这份）
1. `pnpm typecheck`、`pnpm run check:test-types` 不新增错误；`pnpm run lint` 0 error。
2. 498 份请求体：`NOMI_OFFICIAL_WIRE_DUMP` 导出与 `wire-base.json` 比对 bodyDiff = 0、violationDiff = 0（脚本仿 `compare.py`：`separators=(',',':')`、`ensure_ascii=False` 精确比较）。
3. 旧用户 3 文件（7 份旧目录）全绿。
4. 生成相关测试集（`electron/shared/generationLowering`、apimartGenerationProvider、generationProviderBootstrap、generateParamsE2E、catalog/taskParams、referenceKeyProjectionCensus、electron/parity、comfyuiLocal.integration、tikhubLocalFixture、paidPostCodeFeatureTable、productionRunE2eFixture.matrix、providerRejectionSemantics、submissionNotDispatched、unsentAttemptClaim.matrix、relayConformanceVideoAudio.integration、providerExplicitRejection、runtime.referenceSelection、retrievalKindGate）全绿。
5. `pnpm build` 后免费演练 `node tests/ux/composer-b3-reference-paid.rehearsal.walk.mjs` 通过一次。
6. 快检 + 正文预检 6 项为 0。
7. 旧扫描已删：`git grep -n staticReferenceKeyWrites` / `STANDARD_INPUT_WRITERS` 在生产与测试里 0 处。

### 反例（每条：改坏 → 红；还原 → 绿）
| 反例 | 改坏的方法 | 必须红的检查 |
|---|---|---|
| A 导出 `seal(rawRecord)` | 在 `profileHttpRequest.ts` 导出一个把任意 Record 封成请求体的函数 | 导出面性质测试（每个函数导出喂裸 Record 都拿不到可发送体）红 |
| B 发送入口不核来源 | `sendProfileJson` 去掉 `#payload in` 核对，改读公开字段 | 运行时负例（assign / 断言 / 反序列化伪造被拒）红 |
| C ESLint 名单外的新调用者 | 新文件 `import { requestJson } from "…/vendor/vendorHttp"` | lint 红（另有 lintText 合同测试覆盖命名空间、再导出、动态导入） |

### 这一类还会从哪里回来（测试覆盖的入口 / 形状 / 边界）
- 入口：画布、headless、Run 授权、Run 显式四个来源 + 「新入口」虚拟文件（lintText）。
- 形状：裸 Record、改过的快照、展开克隆、`Object.assign` 到冻结产物、`as` 断言、`JSON.parse(JSON.stringify())`、`structuredClone`、Proxy 包装。
- 边界：解析产物并入口（`withLoweredReferences`）、请求体发送口（`sendProfileJson`）、变换阶段（变换只拿私有副本）、原始出网导入（静态 / 命名空间 / 再导出 / 动态）。
- 正例：普通 metadata 赋值、合法固定参数优先、旧节点 / 自写目录恢复成标准意图后照样能发。

### 回滚
revert 本 PR 的实现提交（测试先行提交可一起 revert）；无开关、无落盘迁移。

### 独立验收
待派（四类，验收线编号不得与实现线相同）。
