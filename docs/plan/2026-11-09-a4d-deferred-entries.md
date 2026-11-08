# 设计卡：脚本存文件、本机进程两处入口——没项目先拒，生成文件走同一道落盘关口（2026-11-09）

计划表 A4d「同类延后」。上一刀（配音落盘，复盘 `docs/engineering/direction-checks/2026-11-07-tts-save-expected-kind.md`）把「结果只能写成项目文件」收成一个判据、配音改走生成产物关口，同时登记了两处同类、受影响、延后的入口：自定义调用脚本的 `saveFile`、进程类（即梦 CLI、Codex 本机生图、Antigravity）的本地下载。这一刀把这两处接上。根因合同 `docs/fixes/2026-11-09-a4d-deferred-entries.root-cause.json`。

这次碰了花钱路径（没项目时在付费闸之前拒），按四类填 9 格。

### 功能分类
- [ ] 新界面 / 改交互
- [x] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [x] 数据格式
- [ ] 新增功能 / 性能

数据格式是按改动路径推出来的（`docs/engineering/test-routing.json` 的 pathRules：`electron/catalog/`、文件名 `projectFileResult.ts`）。这次不改目录、不改落盘格式，按要求交老用户升级证据（★1c）。

## ★0 先查别人

- 上一刀复盘第 6 节「换一种做法」② · 「一个函数判出『结果只能是项目文件』，runTask、自定义调用、进程类、try_model 都在 spendGate 前问它」，并写明「自定义调用脚本若交回与任务种类不同的字节，改后会被关口拒（这是对的，但行为会变）」 · **确认了**方向：判据只有 `resultOnlyLandsAsProjectFile` 一处，自定义调用和进程类并进去，不另写第二份；try_model 也问同一份。
- `electron/catalog/customCallContract.ts:77`（Agent 写脚本时读的合同）· 「上游只给字节、不给地址时，调 `saveFile(bytes, 'mp4')`，把它返回的东西 return」 · **确认了**「脚本里调 saveFile」就是这类模型的声明：Agent 被教成这样写，所以判据看脚本有没有用到 `saveFile`，不新增声明字段（新增字段是模型可见 schema，按任务书不在本次）。
- [OpenAI Videos 下载内容](https://developers.openai.com/api/reference/resources/videos/methods/download_content) · `GET /videos/{video_id}/content` 直接回视频字节（「Download the generated video bytes」），没有地址可以先交回；该接口所属模型 2026-09-24 已下线，但「只给字节流」的形状通用（customCallRunner 注释里点名的 Stability v2beta 同形） · **确认了**脚本 saveFile 那类结果和同步配音同一类：没项目就没地方放，只能在发生成请求之前拒。
- [Cloudflare Workers 绑定](https://developers.cloudflare.com/workers/runtime-apis/bindings/) · 脚本要用的外部资源（如 R2 存储桶）先在配置里声明绑定，代码只经 `env` 拿到它，「绑定既是权限也是 API」 · **改了**修法：原想让 saveFile 在没项目时到运行中再报错（沿原方向修），改成跑脚本之前就看它要不要「存文件」这个能力，缺项目就不让它开跑——和「先声明、再执行」同一个思路。
- `docs/research/2026-09-01-dreamina-cli-v1417-matrix.md:133`（即梦 CLI 实抓）· `query_result --submit_id=<id>`（可选 `--download_dir`）把结果下到本地目录 · **确认了**进程类的结果是本机文件：Codex 本机生图只在本机目录留图（`codexCli.ts` 的 `latestGeneratedImageForThread`），Antigravity 回的是字节（`antigravityImageOperation.ts` 只经 `writeDeterministicAsset` 落盘），即梦下到本机目录。三种都只能写进项目，所以判据按「声明了进程」整类判，不按哪一家判。Antigravity 的映射不在内置种子里，连上、自检过后由 `syncAntigravityCatalog` 投影进目录，矩阵用同一个投影函数取它。

出口：`electron/runtime.ts:303`（修前，main 22df46ad6）同步配音 / 文件流视频「没项目先拒」· 别人怎么让人继续：先打开项目再生成，拒绝不留锁、不留半截单子，点一次重新生成就能继续 · **确认了**这次新增的两类拒绝走同一个出口、同一句文案：tasks:run / 画布报 `tasks.resultNeedsProject`；try_model 回 `needs_input`。都不开试用单、不铸令牌，没有要释放的东西。

## ★1 用户怎么用

当我让 Agent 接一个「上游只回文件流」的中转模型（它写的脚本里用 `saveFile` 存字节），或者在项目画布上用即梦会员 / Codex 本机生图 / Antigravity 出图出片时，我点生成、等结果，节点上要出现能用的图片或视频，素材库里多一个文件。没开项目的时候，我不该被扣钱、等到最后才发现结果没地方放。

1. 打开项目，在画布上建节点，选一个脚本接入的模型（脚本用 `saveFile`）或进程类模型（即梦、Codex、Antigravity）。
2. 写提示词，点生成，确认付费卡。
3. 主进程发请求或起本机进程；脚本 / 进程拿到字节。
4. 字节经生成产物关口（暂存 → 按任务种类解码校验 → 原子发布）进入项目 `assets/`，记成生成产物，期望类型 = 任务种类（视频任务就是视频）。
5. 节点显示结果，可以拖进时间轴。

没项目时，三入口零生成请求、零进程、不核销令牌、不弹卡；连接处于待复验时，仅允许先发一次免费的凭据复验请求（GET 模型列表），再拒「先打开项目」。凭据已验过时所有 HTTP 方法均为零。

**不做什么**
- 不改付费闸、批准方式、模型可见 schema，不加新文案。
- 不让 try_model 在项目里落盘试跑（A4f，方向未定）。
- 不改脚本试跑面板（`customCallIpc.ts` 的试跑 saveFile 本来就只做小预览、不写项目，不是这一类）。
- 不改进程类「单个文件导入失败不阻断其余结果」那条（下载目录里可能同时有封面图，拒一个就丢整单，见已知坑）。

**已知坑**
- 连接待复验时会先做一次免费凭据复验，再拒；顺序问题归 runtime.ts 热点另行复盘。
- 判据看脚本里有没有 `saveFile` 这个名字，不分析脚本逻辑：脚本里只在注释里提到 saveFile、或者有时 return 地址有时存文件，没开项目时也会被拒（多拒，不多花）。反过来，故意不写这个名字去调宿主函数的脚本，判据看不出来，会在花钱之后落盘时失败（Agent 按合同写的脚本不会这样）。
- 进程类不管有没有远端地址都按「只能写进项目」判：即梦以前没项目时还能交回远端地址，现在没项目直接拒。画布永远带项目，受影响的只有 Agent 在没开项目时调即梦。
- 进程类下载目录里有不是该种类的文件（如视频任务里的封面图）时，那个文件照旧跳过、其余结果照常落盘（原逻辑，不改）。
- try_model 改成和 runTask 用同一个脚本解析：只回地址的自定义音频脚本，以前被映射的形状（音频、没查询步）误判成「只能写文件」、不让试，现在可以试（放宽，按真实的结果去向判）。存文件的脚本反过来在开单、弹卡之前就回 `needs_input`，不再先弹一张注定白确认的付费卡。

**真实任务**
1. Agent 接一个只回字节的中转视频模型，脚本 `saveFile(bytes, 'mp4')`，在项目画布上生成：结果落进项目、类型是视频。
2. 同一个模型，Agent 没开项目时调 try_model：当场回 `needs_input`，不弹卡、不开单。
3. 即梦会员在项目画布上出片：本地下载的视频落进项目。Agent 没开项目时 tasks:run：发进程之前拒。

**指标**
- 主指标：脚本 saveFile / 进程本地文件在有项目时落成项目生成产物、类型 = 任务种类的比例。目标 100%。量具：`electron/tasks/syncBytesResultLandsInProject.test.ts` 新增的「有项目」格（脚本配音、脚本视频、进程本地下载）。
- 护栏指标：没项目时「发出生成请求 / 起本机进程 / 扣令牌 / 弹付费卡 / try_model 开单」的比例。目标 0%。量具：同一矩阵的「没项目」组（脚本 saveFile 两格 + 内置目录里每一条进程声明 × 三个入口）。
- 护栏指标 2：没用 saveFile 的脚本没开项目时照常跑（不多拒）。量具：同一矩阵「脚本只回地址」格 + `electron/runtime.customCall.test.ts` 现有的无项目用例。
- 质量指标：真上游字节过真关口。未验证：缺量具（本次不花钱，协调跑一次，见 ★9 花钱走查）。

### ★1b 连带界面
- 没项目时的拒绝沿用已有的 `tasks.resultNeedsProject`（zh「这个模型的结果只能存成项目里的文件，请先打开一个项目再生成。这次的请求没有发出。」/ en 同义），不新增文案；这里的“请求”指生成请求，待复验时允许先发免费模型列表 GET。
- try_model 沿用已有的 `needs_input` 回执（message、nextAction 原样）。
- 脚本存的字节不是任务种类时，沿用生成产物关口已有的拒绝（`generated_output…`），节点照旧报失败。
- 成功时的节点、素材库不变：多出一个生成产物。

### ★1c 老用户
- 目录：一字不动，请求路径和请求体都和升级前相同（`electron/catalog/upgradeKeepsWorkingModels.test.ts` 照旧通过）。
- 项目：以前 saveFile 存进去的文件不动，sidecar 里的 kind 仍是当时写的「video / audio / image」；升级后新存的记成 `generated`，和其他生成产物一样。素材列表不按这个字段分组，老文件照常显示。
- 升级那一刻还在跑的、没项目的进程类任务（只有 Agent 在没开项目时调即梦 / Codex / Antigravity 才会有）：续查时会报「请先打开项目」，不再静默丢文件；即梦那单以前能交回远端地址，现在交不回。钱在升级前已经花了，找不回。画布上的任务都带项目，不受影响。
- 退回上一版：没有新的落盘格式，旧版照常打开。

## ★2 谁说了算

- 「结果只能写成项目文件吗」：`electron/tasks/projectFileResult.ts` 的 `resultOnlyLandsAsProjectFile(kind, mapping, customCallScript)`，只此一处。第三个参数必填（可以是 `undefined`），调用方漏想「这次是不是走脚本」编译就不过。
  - 走脚本：只看脚本用没用 `saveFile`（脚本替掉了映射的 HTTP 传输，映射那几条规则不适用）。
  - 映射声明了进程（create 或 query 带 `process`）：是。
  - 其余照旧：同步回字节的音频（不含转写）、声明文件流结果的视频。
- 消费者两个，都在付费闸、开单之前问：`runtime.ts` 的 runTask（画布、tasks:run），挪到自定义调用分流之前；`tryModel.ts`，用同一个解析函数 `resolveCustomCallExecution` 拿脚本。
- 进程执行器自己也守一道：`executeProcessOperation` 没项目号直接拒（结构上跑不起来），给 runTask 之外的调用者（续查、`testModelCatalogMapping`）兜住，不靠调用方记得。
- 「生成的字节怎么落盘」：`electron/assets/projectAssetStore.ts` 的 `writeGeneratedAsset`（期望类型必填）。脚本 saveFile 直接 import 它，不再由 runtime 注入一个同步的 `writeAsset`；进程类本来就注入它。
- 期望类型只来自任务种类，不看扩展名、content-type、脚本给的后缀。
- 门表（`node scripts/door-map.mjs`，改前 → 改后）：
  - 生成字节绕过 `writeGeneratedAsset` 的写入：1 → 0（`customCallDispatch.ts` 的 saveFile 经 runtime 注入的 `writeAsset`）。
  - `writeAsset`：11 扇 → 9 扇（去掉 runtime 注入和 customCallDispatch）。剩下的是用户文件、示例图、素材库内部，以及进程类三处注入形参（注入的正是 `writeGeneratedAsset`）。
  - `writeGeneratedAsset`：8 扇 → 9 扇（customCallDispatch 换到关口上）。
  - `resultOnlyLandsAsProjectFile` 2 扇（runtime.ts、tryModel.ts），都传脚本。
  - `executeProcessOperation` 1 扇（runtime 的 `executeProfileOperation`，三个调用者：提交、续查、`testModelCatalogMapping`）。`testModelCatalogMapping` 的 `execute: true` 只有 IPC，渲染层没有界面调用它；它不带项目号，进程声明在执行器入口被拒。
  - 根因合同门表合计 18 → 17。

## ★3 一致与复用

- 以前定过什么：
  - 上一刀（2026-11-07 复盘第 6、7 节）定了判据一处、生成产物走有类型的入口，并把这两处登记为同类延后，现在照做。
  - #1213（2026-10-17）定了「生成产物落盘按任务期望类型核字节」，仍然算数，脚本 saveFile 现在也受它管。
  - 2026-10 定过「文件流视频没项目先拒」，同一个出口。
- 三条路：
  - 沿原方向修：saveFile 里补一句「没项目就报错」、进程类留着跳过。钱照样先花了再报错，不选。
  - 换做法（选这条）：判据看「走脚本且用 saveFile」「声明了进程」，在付费闸之前拒；saveFile 改走 `writeGeneratedAsset`；进程执行器没项目就不跑。钱不会花在注定放不下的结果上，脚本交错类型的字节也会被关口拦下。
  - 换做法 2：没项目时所有自定义调用的媒体任务都拒。准，但会把只回地址的脚本也拒掉，try_model 试接中转模型（AI 接入的主路）就整条断了，不选。
  - 删掉：saveFile 是「只给字节」上游的唯一出路（Agent 合同就是这么教的），进程类是会员 / 本机生图的唯一通道，删不掉。
- 复用：`writeGeneratedAsset`、`tasks.resultNeedsProject`、try_model 的 `needs_input`、`resolveCustomCallExecution`。没有第二份判据，没有新文案。

## ★4 全状态

- 空 / 加载：不变。
- 成功：节点上出现结果，素材库多一个生成产物（脚本 saveFile 修前不经解码校验）。
- 失败：
  - 脚本 saveFile 存的字节不是任务种类：关口拒，节点报失败（修前会存成一个打不开的文件）。
  - 供应商 / 进程失败照旧。
- 部分成功：进程下载目录有多个文件时，不是该种类的跳过，其余照常（不变）。
- 取消中 / 过期：不变。
- 能力不可用（没有打开项目）：
  - 画布、tasks:run：`tasks.resultNeedsProject`，下一步打开项目再生成。
  - try_model：`needs_input`，下一步请用户到项目画布上试。

## 5 中途表

只列和这次有关的状态。

| 状态 | 停 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 没项目被拒 | 没东西可停 · 不扣 · 回执是拒绝原因 | 同左 | 凭据已验时同左；待复验时可能先报凭据错误或等待探测超时，生成请求 / 进程仍未发出 | 同左 | 每次都同样被拒，不扣，不弹卡 |
| 有项目、脚本 / 进程在跑 | 沿用现有取消 · 供应商可能已计费 · 节点失败回执 | 同左 | 请求失败 · 供应商结算 · 节点失败回执 | 进程类续查照旧（带项目） | 令牌一节点一次（spendGrant，不变） |
| 有项目、落盘中 | 关口暂存清掉，不留半截文件（不变） | 同左 | 不涉及 | 暂存下次启动清理（不变） | 同上 |
| 没项目的进程类续查（升级前留下的） | — | — | — | 续查报「请先打开项目」，不静默丢文件 | 同样被拒 |

## 6 外部数据与失败

- 脚本 saveFile：脚本交来的字节、后缀、content-type 都不可信，只按任务种类核。失败时关口拒，报生成产物错误码，不提 key。
- 即梦 CLI：下载目录里的文件按任务种类核；三无输出照旧按 `describeDreaminaFailure` 报。
- Codex / Antigravity：本机文件 / 字节按「图片」核（原样）。

## ★7 性能

不适用：不新增用户操作。付费前多一次纯函数判断（读映射两个字段、对脚本做一次正则），落盘走已有的 `writeGeneratedAsset`。

## 8 真实条件

- 真付费：unverified（任务书：本线不花钱，协调跑最小一次）。
- 英文界面：拒绝文案沿用已有的 en 一轨。界面截图不适用（不改界面）。
- Windows：unverified（不改路径拼接）。
- 老用户：`upgradeKeepsWorkingModels.test.ts`（真实老目录）。

## 拍板图清单

不适用：不新增、不改界面元素、布局和文案。

## ★9 验收与回滚

本轮只补测试与文档，不改产品代码。连接待复验时会先做一次免费凭据复验，再拒；顺序问题归 runtime.ts 热点另行复盘。

**真实场景复现**
- 用户的流程（来自上一刀独立验收登记的同类延后，不是用户报的单）：① Agent 接只回字节的中转模型，脚本 `saveFile`，在没开项目时 try_model / tasks:run；② Agent 没开项目时调即梦 / Codex / Antigravity。
- 我走的：同一条主进程路径（tasks:run 令牌路、画布 Run 路、try_model → runTask → 自定义调用分流 / 进程分流 → 关口）。本机回环假服务回真音频 / 视频字节；即梦 CLI 换成合成输出（指向真 MP4 夹具）；Codex / Antigravity 的进程执行换成计数桩（不起真进程）；关口是真的。
- 差别：没有真供应商、真本机 CLI。真上游那一段留给协调付费跑一次。
- 修前（先写测试、不改生产代码跑的那一轮，矩阵 46 格红、进程执行器单测 3 格红）：
  - 没项目、脚本 saveFile 两格：tasks:run 和画布都**没拒**——请求发出去了、令牌被核销。测试里的项目目录替身对任何项目号都返回同一个目录，所以落盘「成功」了；真实环境下项目号为空会在写盘时报 Project not found，就是「先花钱后失败」。
  - 没项目、进程格（即梦 6 条、Codex 2 条、Antigravity 2 条、合成进程 1 条）：文生图 / 文生视频各起了 1 次进程，即梦那条 tasks:run 直接「成功」返回（本机下载的文件被静默丢掉）；改图 / 图生视频几格修前是被「缺参考图」先拦下的（报错不是「请先打开项目」），之后给这几格补了参考图，下面的反做检查确认去掉判断后它们会真起进程。
  - try_model：脚本 saveFile 视频格、全部进程格都没回 `needs_input`（开了单、往下走）。
  - 有项目：脚本存的文件 `.meta` 的 kind 是 audio / video，不是 generated；图片字节存成 .mp4 没被拒。
  - 进程执行器：三种解析器项目号为空时都照跑。
- 修后：见下面的验收清单。

**本轮收据**：原矩阵 130/130、pending 新格 0/0（矩阵合计 130/130）；相关 37 个测试文件、373/373 通过；pnpm run typecheck 通过。

**本轮合同**：没项目时，三入口零生成请求、零进程、不核销令牌、不弹卡；连接处于待复验时，仅允许先发一次免费的凭据复验请求（GET 模型列表），再拒「先打开项目」。凭据已验过时所有 HTTP 方法均为零。

**验收清单**（验收线只核这份）
1. `npx vitest run electron/tasks/syncBytesResultLandsInProject.test.ts`：全绿。
   - 有项目：脚本配音、脚本视频、进程本地下载三格各 1 次请求 / 进程、成功、项目 `assets/` 多一个文件、`.meta` 的 kind 是 generated、资产类型 = 任务种类。
   - 脚本把图片字节存进视频任务：被关口拒，项目里不多文件。
   - 没项目：脚本 saveFile 两格 + 目录里每一条进程声明（内置的即梦、Codex，加上 Antigravity 连上后由 `antigravityImageMappings` 投影进来的两条），tasks:run 令牌路、画布 Run 路零生成请求 / 零进程，令牌原样留着，不弹卡；try_model 回 `needs_input`，不开单、不铸令牌。凭据已验时断言所有 HTTP 方法零请求；新增 verificationPending 形状（两种 saveFile 脚本 + 全部进程声明 × 三入口），仅豁免模型列表精确路径的 GET，最多一次，其余所有 HTTP 方法 / 路径均为零。try_model 在复验前拒，仍为全部方法零请求。上游照常回真字节，不能靠坏响应掩盖生成请求。
   - 没项目、脚本只回地址：照常跑，1 个请求、成功（不多拒）。
2. `npx vitest run electron/catalog/processOperation.test.ts`：没项目号时三种 parser 都不起进程、直接拒。
3. `npx vitest run electron/runtime.customCall.test.ts electron/catalog/customCallTextAndFile.test.ts electron/catalog/codexCli.test.ts electron/catalog/upgradeKeepsWorkingModels.test.ts electron/catalog/oldUserDubbingLandsAfterUpgrade.test.ts electron/assets/generatedOutputKindGate.test.ts electron/audioTaskRunner.test.ts electron/runtime.asyncAudio.test.ts` 以及 Antigravity / 即梦 / try_model / 参考链接投递相关的用例（`runtime.antigravity*`、`antigravityWriteGuard`、`dreaminaCli`、`tryModel*`、`referenceLinkDelivery.matrix`、`taskIpcHandlers`、`runtime.provider-adapter`、`relayConformance*`）：全绿。
4. `pnpm run typecheck`：通过（判据第三个参数必填；saveFile 的 meta 是 `generated`、期望类型必填）。
5. `node scripts/check-root-cause-contracts.mjs`、`pnpm run check:escape-ledger`：通过。

**反例**（这一类会从哪里回来）
- 入口：tasks:run、画布、try_model 三个入口都进了矩阵；runTask 之外直接调进程执行器的（续查、`testModelCatalogMapping`）由执行器自己拒。
- 形状：进程声明从目录枚举（内置种子里的即梦、Codex，Antigravity 用同一个投影函数生成），以后新加的进程声明自动进矩阵；矩阵另有一格断言三种解析器都枚举到了，防止矩阵悄悄变空。
- 调用者：新代码调判据不传脚本参数，编译不过；saveFile 改回 `writeAsset`，矩阵「有项目」格的 kind 断言变红。
- 反做：删掉 runTask 里的付费前判断，「没项目」组变红（各 1 个请求 / 进程、令牌被核销；实跑 46 格红 = 23 格 × tasks:run / 画布两个入口，try_model 由它自己的判断拦，不受这处影响）；去掉执行器的项目守卫，processOperation 单测变红。

**花钱走查**：unverified。给协调的最小一次见报告（模型、入口、预计花费）。

**回滚**：revert 本 PR 的提交即可，不改数据格式，没有开关。回滚后脚本 saveFile 重新绕过解码校验、没项目时先花钱后失败。

**独立验收**：四类（花钱），合并前由另一条线按上面的清单核，报告链接在 PR 正文 `## 独立验收`（验收线编号不能是本实现线）。
