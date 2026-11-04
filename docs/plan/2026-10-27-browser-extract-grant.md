# 浏览器「提取提示词」接上付费令牌 · 设计卡（方案 B：每次提取都问）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

日期：2026-10-27。线：I-browser-extract-grant（第 1 轮：特征测试、设计卡、方向复盘）→ I-browser-extract-grant-r2（第 2 轮：实现）。基线：第 1 轮 `origin/main` @ `6c05eebae`，第 2 轮 `50b12b763`（协调已并上最新 origin/main）。

**状态：用户 10-27 放行（「五件都按推荐办」，记在 approvals.jsonl），第 2 轮按本卡实现。** 热点文件 `src/workbench/capability/capabilityApplyHandler.ts` 只放行付费卡分流那一处，换成按 intent 查表。方向复盘：[`docs/engineering/direction-checks/2026-10-27-browser-extract-grant.md`](../engineering/direction-checks/2026-10-27-browser-extract-grant.md)。第 2 轮定稿见下面「第 2 轮定稿」一节；它和后文冲突的地方，以定稿为准（后文相关处已同步改过）。

协调定向（10-27）：
- 选 B：每次提取都弹确认卡。派工书原第 2 条「点提取＝确认，`askWhenCallsAbove: 1`」作废。
- 卡上写清读的是哪张图。
- 新 IPC 只认可信发送方。
- 补普查测试，改正登记。
- 防卡被刷屏，只做现有边界上几行能做的部分。
- C（套通用卡）不做。

## 第 2 轮定稿（实现线 I-browser-extract-grant-r2，动手前写定）

**用户拍板（10-27「五件都按推荐办」）：**

1. 热点文件只放行付费卡分流那一处：`confirmSpendFromMainProcess` 里凭据验证那个 `if` 换成一次按 intent 查表。表在自己的文件 `src/workbench/capability/spendCardByIntent.ts`，凭据验证卡、提取卡各占一行；热点文件不再加 `if`。实现提交带 `Direction-Check:` trailer。
2. 新建提取付费卡 `src/workbench/capability/promptExtractionSpendCard.ts`，文案照 3.3 的表（中英），图标 `source: 'user'`；弹的仍是全仓唯一那张卡，不新画界面、不改布局。
3. 每次提取都弹卡：页内图片的提取、悬停菜单、工具栏截图提取，三处都经同一个 runner、同一条主进程链，没有「点一下就算确认」的特例。
4. 整次提取挪进主进程（3.2 选的接法），由 `confirmSpendAndMintGrant` 问人、铸令牌、发出；渲染层不铸令牌。
5. 新 IPC 只认可信发送方（`assertTrustedSender`）。

**协调定（第 1 轮留下的两件）：**

- 功能分类只勾「花钱」，不勾「新界面 / 改交互」：复用现有对话框，不改布局。花钱类合并前要另一条线独立验收，协调派。
- 发出中途切了项目：结果照样存进提示词库（库是全局的，钱已经花了）。只丢和项目绑定的副作用——这一路上没有：模板设置的读取、参考图的抓取 / 截图落盘都发生在弹卡之前，那两处切项目仍然整次取消、一分钱不花；弹卡之后只剩「存进全局库」和「在发起的标签页原地报一句」，都不绑项目。

**实现时写定的细节（拍板范围内，不改方向）：**

- **IPC 形状**：`browser:prompt-extraction:run`（invoke），请求 `{ vendor, modelKey, prompt, imageUrl, mode, projectId, pageUrl, imageSourceUrl }`，回 `{ outcome: 'done', result } | { outcome: 'not-confirmed' } | { outcome: 'busy' }`；失败照 `nomi:tasks:run` 的编码抛出（`runTaskIpcGuard`）。
  - `imageUrl` 是模型真正读的那张（抓到的原图 / 截图的 data URL）；`imageSourceUrl` 是它的来处（原图地址，截图时为空串）；`pageUrl` 是来源页。
  - 卡上的两行（来源页主机名、图片名）由主进程用共享合同 `electron/shared/contracts/browserPromptExtraction.ts` 算好、编进 `prompt` 字段，卡模块用同一个模块解开。这样 3.3 原写的 `page` / `image` 两个字段换成了它们的来处，格式仍只有一个主人。
- **转发抽成纯函数**：`browserViews.ts` 里页内「提取」的 console 转发搬进 `electron/browser/core/browserViewUtils.ts` 的 `promptCaptureEventFromConsole`，`pageUrl` 取 `contents.getURL()`。这样 ★9 第 4、5 格能用真转发喂伪造的 console 行。
- **令牌路普查的登记表放在非测试文件里**：`scripts/spend-token-doors.mjs`（`SPEND_TOKEN_DOORS` 表 + 纯判定 `judgeSpendTokenDoors`），普查测试 `electron/spendTokenDoors.census.test.ts` 读它、用 `scripts/door-map.mjs` 数门。
  - 为什么不全写在测试里：根因合同（contract v3）要求「复发类」修复的预防件里有一件不是测试的结构件，并且执行边界必须是登记概念的写接口。登记表就是这件结构件，照 `scripts/ui-money-format.mjs` + 普查测试的先例。
  - 登记表挂在概念 `spend.pending-identity` 上（它 notes 里的例外 ①–④ 就是这张表的文字版）：`write_api` 加 `scripts/spend-token-doors.mjs#SPEND_TOKEN_DOORS`，`parity_test` 指向普查测试，notes ③ 改成和代码一致。不新建概念。
- **登记表之外要跟着登记的三处**（门岗要求，不是新能力）：
  - `scripts/generation-entrances-ledger.json`：新模块里的 `runTask(` 是一个新的发请求调用点，登记成「文本任务，不是生成入口」（`check:generation-entrances`）；
  - `docs/engineering/self-written.json` 的 `domainRoots`：加 `electron/browser/prompt/` 与 `electron/shared/contracts/browserPromptExtraction*`（新文件落在领域目录外，`check:self-written` 会拦；它们是按次付费的领域语义，不是通用能力）；
  - `tests/fixtures/textTasks/textTaskCallerHarness.ts`：`#7` 换成真入口测试，`RENDERER_ENTRY_GAP_EXCEPTIONS` 清空。
- **派工书文件清单外、新 IPC 必须的接线**（各一两行）：`electron/main.ts` 注册一行 + import 一行；`electron/preload/mediaBridge.ts` 桥一个方法；`src/desktop/bridgeBrowserTypes.ts` 类型一行。
- **模式类型只留一个主人**：`'replicate' | 'style'` 定义在共享合同里，`src/ui/browser/prompt/browserPromptExtraction.ts` 改成从那里转出，渲染层用的地方不动。
- **重试次数**：不传 `maxAttemptsPerNode`，用 `spendGrant` 的缺省（本卡 3.1 原定）。闸只在 `runTask` 里核一次；传输层的自动重试在闸之后，不再过闸。
- **拍板图**：登记过的例外里最接近的是 `pure-bugfix`，但它写着「不改文案」，而本单新增了卡上的文案（用户 10-27 已拍板）。没有更合适的登记例外，本线不新造；PR 正文先写 `pure-bugfix` 并注明这一点，交协调定。路径规则推不出「新界面」（本单没有 `.tsx`），门岗不判这一节。

## 零、一句话

用户在浏览器面板里点「提取提示词」，今天每次都在主进程的付费闸被拒：供应商 0 次请求，什么都不进库。

修法是把整次提取挪进主进程，走登记的那条唯一链 `confirmSpendAndMintGrant`：弹卡问人，铸令牌，再发请求。卡上写清读的是哪个页面的哪张图。之所以每次都要问，是因为页内的「提取」按钮长在网页里，网页自己就能冒充这一下点击。

## 一、前提实测（特征测试，修前，`6c05eebae`）

- **测试**：`electron/browser/prompt/browserPromptExtraction.ipc.integration.test.ts` 钉的是现状，跑出来是绿的。
  - 走的都是真路：渲染层真入口 `runBrowserPromptExtractionToLibrary` → 真 preload 桥 → 真 `nomi:tasks:run` handler（含真发送方守卫）→ 真 runtime 准入 → 真执行器 → 本机假上游（零额度、不出网）。
  - 只换掉了三样：Electron 的 IPC 传输、目录（一条假的文本模型）、提示词库落盘。
- **拒在哪**：
  - `electron/spendGrant.ts:149`：`assertAndConsumeQuotedSpend` 找不到令牌；
  - 上一层是 `electron/tasks/taskSpend.ts:17` 的 `consumeTaskSpend`；
  - 再上一层是 `electron/runtime.ts:405`：`runTask` 文本分支的付费闸，缺省走 `TOKEN_ADMISSION`。
  - 抛出的错误：`SpendNotAuthorizedError: Authorization expired or does not cover this target; confirm again`。
  - 后果：供应商 0 次请求，提示词库 0 条，没弹卡（错误抛在问人之前），标签页里报失败。
- **直接原因**：`src/ui/browser/prompt/browserPromptExtractionRunner.ts:93` 直接调 `runWorkbenchTaskByVendor`，extras 里没有 `grantId`；没有任何地方为这次调用铸令牌。
- **从哪天坏的**：`2d907292a`（2026-09-09）给 `runTask` 的文本分支补上付费闸，从那天起就坏了。
  - 同一批里拆解也这样坏过，见 `scripts/check-run-task-grant.mjs` 文件头记的 09-11 事故。那次补好了主进程那几处调用。
  - 渲染层这一处门岗看不见：门岗只认 `runTask` / `runTaskFn` 调用里自己写了 `request:` 的那种。
- **红灯证据**：期望行为在修前跑出的红灯输出，存在 `docs/evidence/2026-10-27-browser-extract-grant/extract-ipc-before.txt`。
- **登记和代码对不上**：
  - `docs/engineering/concept-owners/spend.pending-identity.json` 的 notes ③ 说，提示词提取走 `electron/spendConfirmGrant.ts`，调用方点名 `electron/browser/settings/browserPromptExtractionSettings.ts`。实际那个文件只有读、写设置的两个 IPC；`confirmSpendAndMintGrant` 只有拆解一个调用方（见门表）。
  - 文本调用方矩阵 `tests/fixtures/textTasks/textTaskCallerHarness.ts:52` 早就把它记成「既有缺陷」。但那只是一行记录，不会让任何东西变红。

## 二、信任边界：页内「提取」按钮可以被网页伪造

**这条路是怎么走的：**

- **按钮注入在远端网页的主世界里**：`electron/browser/core/browserViewBridges.ts:560` 用 `contents.executeJavaScript(promptHoverBridgeScript(), true)` 注入。用户点菜单 → `sendPromptRequest`（`:327-343`）→ `console.info(consolePrefix + JSON)`（`:341`）。
- **主进程把带这个前缀的任何 console 消息都转给主窗口**：见 `electron/browser/core/browserViews.ts:150-180`（`console-message` → `browser:view:prompt-capture`）。图片地址、标题、`pageUrl`、`pageTitle`、模式，全部取自网页给的 JSON。
- **渲染层收到就开跑**：`src/ui/browser/dialog/useBrowserDialogActions.ts:347-353`。

**后果：**

- 网页里一行 `console.info('__NOMI_BROWSER_IMAGE_PROMPT__{"url":"…"}')`，就等于用户点了「提取」，不需要任何真实点击。
- 今天这件事无害，因为每次都被闸拒。如果照原第 2 条「点了就是确认、不弹卡」接上令牌，任何网页每调一次 console，就能花掉用户一次读图调用。
- 所以在这个入口上，「点提取＝确认」不成立。这就是选 B 的理由。

**截图提取：**

- 截图提取是 Nomi 工具栏上的「截图提取提示词」（`useBrowserDialogActions.ts:376-415`），框选在 Nomi 自己的浮层里完成，所以这一下是可信的。
- 但它和页内按钮走的是同一个 runner。0.24 两个入口一条规则：都问。0.25 再分开处理。

**0.25 根治（本单不做，走设计流程，协调另记账）：**

1. 把「提取这张图」挪到 Nomi 自己的面上：主进程 `webContents` 的原生右键菜单（`context-menu` 事件带 `mediaType: 'image'` / `srcURL`），或 Nomi 的素材浮层。
2. 删掉页内注入的提取按钮，以及那条 console 转发。
3. 触发点可信之后，再恢复「点一下就是确认」（`askWhenCallsAbove: 1`，照拆解先例），不再弹卡。

## 三、方案 B

### 3.1 改后的数据流

整条链：渲染层 runner（准备参考图：截图或抓原图，照旧）→ 新 preload 桥 `browser.runPromptExtraction` → 新 IPC `browser:prompt-extraction:run` → 主进程新模块 `electron/browser/prompt/browserPromptExtractionRun.ts`。

新 IPC 用 `assertTrustedSender`，只认主窗口主帧。

主进程新模块按下面 6 步做：

1. **校验窄 payload**：`{ vendor, modelKey, prompt, imageUrl, mode: 'replicate' | 'style', projectId: string | null, pageUrl, imageSourceUrl }`（第 2 轮定稿：卡上两行由主进程从 `pageUrl` / `imageSourceUrl` 算出，见「第 2 轮定稿」）。
   - 温度、maxTokens、任务种类 `image_to_prompt` 由主进程按 mode 定。
   - 这几项今天写在渲染层 `browserPromptExtractionRunner.ts:96-101`，挪过来以后只在一处定。
2. **报价身份等于执行身份**：用 `findExecutableModel(vendor, modelKey, 'text')` 取 `vendor.key` / `model.modelKey`。
   - 这和 `runTask` 解析模型用的是同一个函数（拆解先例：`electron/video/deconstructSpend.ts`）。
   - 不这样做的话，目录里的模型别名一漂，闸上会再弹第二张卡。
3. **同一时刻只挂一张提取卡**：模块里用一个布尔量包住问人那一步。
   - 卡开着时来了新请求，直接回 `{ outcome: 'busy' }`，记一行警告日志；不排队，也不弹第二张。
   - 布尔量在 `finally` 里放开：确认、取消、渲染层没了，都会放开。
4. **问人并铸令牌**：调用

   ```
   confirmSpendAndMintGrant({
     nodeId: 'browser-prompt-extraction-<uuid>',
     projectId?,
     intent: 'prompt-extraction',
     vendor, modelKey,
     prompt: <读哪张图>,
     legs: [{ role: 'vision', vendor, modelKey }],
     lines: [<这一次调用；参数和第 5 步完全相同>],
   })
   ```

   - **不传** `askWhenCallsAbove`：每次都问。
   - 不传 `maxAttemptsPerNode`：用 `spendGrant` 的缺省。
   - 返回 `null` 时，回 `{ outcome: 'not-confirmed' }`。
5. **拿到令牌后发请求**：在 `runTaskIpcGuard` 里调用

   ```
   runTask({ vendor, request: {
     kind: 'image_to_prompt', prompt,
     extras: { modelKey, referenceImages: [imageUrl], temperature, maxTokens, projectId?, nodeId, grantId },
   } })
   ```

   - 走缺省的 `TOKEN_ADMISSION`，令牌在 `consumeTaskSpend` 里核销。
   - 成功回 `{ outcome: 'done', result }`。
   - 供应商错误照 `nomi:tasks:run` 的编码透传。
6. **注册**：在 `electron/main.ts` 里，紧挨 `registerBrowserPromptExtractionSettingsIpc`（`:573`）注册。

渲染层：

- **删旧**：`browserPromptExtractionRunner.ts` 的 `runPromptExtraction` 改调新桥，**同一提交删掉** `runWorkbenchTaskByVendor` 那条调用。不留开关，不留回退。
- **传给主进程的两个字段**（第 2 轮定稿）：
  - `pageUrl`：来源页。原图那一路取主进程转发时记下的浏览视图真实地址（见 3.3），截图那一路取标签页状态里的地址（同样来自主进程的 `browser:view:state`）；
  - `imageSourceUrl`：截图时是空串，原图时是主进程真正抓图的那个地址（抓图结果的 `sourceUrl`）。
- **按 outcome 分三种处理**：
  - `done`：照旧解析，进库；
  - `not-confirmed`：在标签页原地报「已取消提取」；
  - `busy`：在标签页原地报「上一张提取确认还没处理」。
- **切项目**（协调 10-27 定）：弹卡之前的两处 `stillCurrent` 判断保留（那时一分钱没花，整次取消）；弹卡之后的那一处删掉——钱已经花了，结果照样存进全局提示词库。
- **失败文案**：过 `classifyGenerationError`（`src/workbench/observability/classifyError.ts`）。`NOMI_VENDOR_ERR_B64::` 标记和 Electron 的 `Error invoking remote method …` 前缀都不印给用户。
  - 修前这条路抛在闸上，从没走到过供应商那一步，所以今天的 runner 直接印 `error.message` 也没人发现。

### 3.2 两种接法的比较（派工书第 1 条要求比）

| 接法 | 门 | 令牌在哪 | 报价身份 | 结论 |
|---|---|---|---|---|
| 渲染层先要令牌，再走 `runWorkbenchTaskByVendor` | 新 IPC（问人 + 铸）加旧的 `nomi:tasks:run`，两次往返 | 不透明 id 进渲染层 | 主进程算一次，渲染层再发一次参数，两处 | 不选：参数一漂（温度、模型别名），闸上就再弹第二张卡；而且渲染层持有令牌 |
| **整次提取挪进主进程** | 一个新 IPC；`runWorkbenchTaskByVendor` 少一个令牌路调用方 | 只在主进程 | 同一个函数里算，同一份参数发 | **选**：门少一扇，分层和拆解一致（主进程问、铸、发） |

### 3.3 卡上写什么（文案，用户 10-27 已拍板）

- **卡模块**：照凭据验证卡的先例（`src/workbench/capability/credentialProbeSpendCard.ts`），单独一个模块 `src/workbench/capability/promptExtractionSpendCard.ts`。
- **对话框**：弹的仍是全仓唯一那张卡（`useSpendConfirmStore` → `SpendConfirmDialog`）。不新画界面，不改布局。

| 位置 | 中文 | English |
|---|---|---|
| 标题 | 把这张图写成提示词？ | Turn this image into a prompt? |
| 说明 | 读图模型会看一次这张图，写好的提示词存进提示词库。 | A vision model reads this image once and saves the prompt to your library. |
| 行：来源页（值是主机名） | 来源页 | Page |
| 行：图片（值是原图文件名，取不到就是缩短的地址；截图时写「页面截图」） | 图片 / 页面截图 | Image / Page screenshot |
| 行：读图模型 | 沿用 `runtime.capability.visionModelLine` | （沿用） |
| 确认钮 | 提取 | Extract |
| 图标 / 来源 | `source: 'user'`（金币图标，同拆解）；不写「AI 助手想生成…」 | — |

卡上的约束：

- 不写钱：界面不谈钱，`check:i18n` 会拦。
- 不加倒计时：卡永不因空闲超时（09-11 拍板）。
- **「来源页」只用可信值**：`browserViews.ts` 在转发 `browser:view:prompt-capture` 时，把 `pageUrl` 换成主进程手里的 `contents.getURL()`，这个值网页改不了。
  - 网页自报的标题不上卡，只在提示词库条目没有标题时兜底。

「读哪张图」怎么传到卡上：

- `confirmSpendAndMintGrant` 这条链不改，所以只能借它现有的 `prompt` 字段。
- 主进程按共享合同 `electron/shared/contracts/browserPromptExtraction.ts` 把来源页和图片编成两行，卡模块用同一个模块解开。格式只有这一个主人，用往返单测钉住。
- 备选是给链加一个带类型的 `subject` 字段。不选，因为它要多改两处：
  - `electron/spendConfirmGrant.ts`（这是派工书的停点）；
  - 热点文件里的 `SpendConfirmPayload` 类型。

### 3.4 卡的分流：查表，不再加 if（P1「第三个特例分支」）

今天 `confirmSpendFromMainProcess`（`capabilityApplyHandler.ts:153`）已经有两种专用措辞：

- 凭据验证在 `:156` 提前 return，交给它自己的卡模块；
- 拆解在通用分支里，内嵌了三处 `isDeconstruct` 三元。

提取是第三种。两种接法比一比：

| 做法 | 热点文件改几行 | 新文件 | 下一个专用卡来了怎么办 | 推荐 |
|---|---|---|---|---|
| 再加一个 `if (info.intent === 'prompt-extraction') return …` | 加 1 行，加 1 个 import | 卡模块 | 热点文件长出第四个分支，记第 4 个 fix | 否 |
| **按 intent 查表** | 换 1 行，import 换 1 行 | 表 + 卡模块 | 在表文件里加一行，热点文件不动 | **是** |

查表的具体做法：

- 新文件 `src/workbench/capability/spendCardByIntent.ts`，内容是 `{ 'credential-probe': confirmCredentialProbeSpend, 'prompt-extraction': confirmPromptExtractionSpend }`。
- handler 里 `:156` 那一行换成一次查表。
- 凭据验证那一支同一提交搬进表。它的行为不变，由特征测试 `src/workbench/capability/spendCardRouting.test.ts` 第一格钉住（本单先写，修前绿）。
- 拆解那三处内嵌三元，本单不搬：搬就要动通用分支的正文，热点文件的改动会变大。这条记进残余风险：以后谁要给拆解换措辞，先把它也搬进表。

### 3.5 不放行时的备选（D，未采用：用户 10-27 放行了 B，留作回滚时的紧急方案）

热点文件不放行，B 就做不了。那样的话 0.24 的提取还是每次被拒，不能让用户继续撞墙。D 的做法：

- **删页内的图片「提取」**，三样一起删：
  - `promptHoverBridgeScript` 里的图片按钮和菜单；
  - `browserViews.ts` 里那条 `BROWSER_IMAGE_PROMPT_CONSOLE_PREFIX` 转发；
  - 渲染层的 `onPromptCapture` 监听。
  - 只藏按钮不够：转发还在，网页照样能伪造。
  - 页内选中文字的「保存提示词」不调模型，留着。
- **工具栏「截图提取提示词」**：它是 Nomi 自己面上的可信手势。两种处理任选其一：
  - 照拆解先例用 `askWhenCallsAbove: 1`（点一下就是确认，不弹卡），接上同一条主进程链。不需要新卡，热点文件不动。
  - 或者 0.24 一并藏起，0.25 再一起放出来。
- **0.25**：在 Nomi 自己的面上恢复「提取这张图」（见第二节）。
- **代价**：0.24 少了「悬停一张图 → 提取」这一下，要提取某张图只能用截图框选。
- **好处**：可伪造的入口从源头删掉。按 P2 的强弱排序，「删掉」排在「靠人看卡」前面。

## 四、设计卡（花钱：9 格全填 + ★0）

```
改动名：浏览器提取提示词接上付费令牌   线：I-browser-extract-grant（设计）/ 实现线待协调派   类别：[花钱]
```

| 格 | 结论 | 证据 |
|---|---|---|
| ★0 先查别人 | 下面「先查别人（★0）」小节，共 4 条 | 链接 / 文件行；`node scripts/check-prior-art.mjs` |
| ★1 用户怎么用 | 见下面「★1 用户怎么用」小节 | 集成测试；指标量具缺口如实写 |
| ★1b 连带界面 | 见下面「★1b 连带界面」小节 | 文案测试；中英真截图（实现线交） |
| ★2 谁说了算 | 见下面「★2 谁说了算」小节 | 门表（下）；`check-concept-owners` |
| ★3 一致与复用 | 见下面「★3 一致与复用」小节，含系统改进 | 普查测试；`git grep` |
| ★4 全状态 | 见下面「★4 全状态」小节 | `check:i18n`；集成测试各格 |
| 5 中途表 | 见第五节 | 集成测试；其余人工 |
| 6 外部数据与失败 | 见下面「6 外部数据与失败」小节 | 故障注入格（★9 第 10 条） |
| ★7 性能 | 不适用：这是修复，不是新增功能，没有新交互路径的计算量。多一张卡复用现有对话框；提取本身是一次网络调用，耗时由供应商决定。 | — |
| 8 真实条件 | 见下面「8 真实条件」小节 | 截图（实现线 Read 过） |
| 拍板图清单 | 不适用：复用现有付费确认对话框，不新画界面、不改布局（按「逻辑 bug 不出样张」那一条；协调 10-27 定不勾「新界面」）。新文案见 3.3，用户 10-27 已拍板。PR 正文的例外 id 见「第 2 轮定稿」最后一条（`pure-bugfix` 不完全贴，交协调定）。 | — |
| ★9 验收与回滚 | 验收：见第六节「验收清单与反例」。回滚和独立验收见下面「★9 验收与回滚」小节 | `## 独立验收` |

### 先查别人（★0）

1. **Electron 安全清单**（https://www.electronjs.org/docs/latest/tutorial/security ，第 17 条「Validate the sender of all IPC messages」、第 20 条「Do not expose Electron APIs to untrusted web content」）。
   - 它怎么做：远端内容发来的东西一律不可信，IPC 要验发送方。
   - **确认了**：新 IPC 用 `assertTrustedSender`，浏览视图里的网页一律拒。
   - **改了**原第 2 条：「页内按钮 → console → 主进程转发」这条路，等于网页直通的 IPC，不能当成用户的确认。
2. **Eric Lawrence「The Line of Death」**（https://textslashplain.com/2017/01/14/the-line-of-death/ ）。
   - 它怎么做：网页内容区里的像素都可能是网页自己画的，安全决定要放在宿主自己的界面上。
   - **确认了** B：确认要在 Nomi 自己的卡上做，不能靠网页里那颗按钮。
   - **确认了** 0.25 方向：触发点挪到 Nomi 自己的面上。
   - **确认了**：卡上「来源页」只用主进程拿到的真实地址。
3. **MDN「User activation」**（https://developer.mozilla.org/en-US/docs/Web/Security/User_activation ）。
   - 它怎么做：`PaymentRequest.show()` 这类 API 要求真实输入带来的瞬时激活，只有 `isTrusted` 的输入事件才算数。
   - **确认了**：「点一下就是确认」只对可信输入成立。页内按钮的点击是经 console 转出来的，主进程判断不了是不是真人点的，所以 0.24 一律问。
   - 0.25 换成原生右键菜单（`webContents` 的 `context-menu` 事件，`menuSourceType` 为 mouse / keyboard / touch，https://www.electronjs.org/docs/latest/api/web-contents#event-context-menu ）之后，再恢复一键。网页能不能合成这个事件，留到 0.25 设计时实测（未验证）。
4. **仓库先例**：
   - **拆解**：`electron/video/deconstructSpend.ts` 和 `deconstructVideo.ts:440-506`。主进程问、铸、发；用 `findExecutableModel` 定报价身份；10-18 拍板「短片不弹」。
     - **确认了**：整次挪进主进程，报价身份照这样写。
     - **改了**「不弹卡」那一半：拆解的触发点是 Nomi 画布上的按钮，提取的触发点在网页里。
   - **试跑**（`electron/capabilityCore/modelOnboarding/tryModel.ts:163-174`）和**认证**（`electron/integrationCertification/integrationSession.ts:425-470`）：令牌都在主进程里铸，铸完紧接着发。
     - **确认了**：令牌不进渲染层。
   - **凭据验证卡**（`src/workbench/capability/credentialProbeSpendCard.ts`）：专用卡单独一个模块，弹的仍是全仓唯一那张卡。
     - **确认了**卡模块这么拆。
     - **改了**分流方式：查表（见 3.4）。
   - **改写**：10-21 挪到了流式门（`tests/fixtures/textTasks/textTaskCallerHarness.ts:44`）。
     - **否了**把提取也挪去流式门：流式门不过钱闸，再配上可伪造的触发点，就是静默花钱。

### ★1 用户怎么用

当我在浏览器面板里看到一张想学的图，我想点一下就把它写成提示词存进库，以便之后在画布里用。

步骤：

1. 悬停图片 → 点「提取」→ 选「复刻」或「风格」；或者点工具栏「截图提取」→ 框选。
2. 标签页里出现「正在提取…」。
3. 弹卡：「把这张图写成提示词？」，卡上有来源页、图片、读图模型三行。
4. 点「提取」。
5. 标签页显示「已存入提示词库：<名字>」。点取消的话，显示「已取消提取」。

**不做**：

- 卡上不放缩略图：这算新界面，0.25 随触发点一起设计。
- 不做「本次会话不再问」。
- 不在网页里画确认。

**已知坑**：

- 页内触发点可伪造（见第二节）；网页可以反复弹卡骚扰用户，但花不了钱，记进残余风险。
- 登记的令牌路例外的到期日在概念 `spend.pending-identity` 的 `exception_deadlines` 里（见 ★2）。

**真实任务**：

- A：在一个图片站悬停一张海港照片 → 复刻 → 确认 → 库里出现条目，带参考图。
- B：用工具栏截图框选一块海报 → 风格 → 确认。
- C（对抗）：打开一个会自己发 console 提取消息的页面。什么都不点也弹卡 → 取消 → 供应商 0 次请求。

**指标**：

| 指标 | 定义 / 目标 | 量具 |
|---|---|---|
| 主指标 | 点提取并确认之后，成功进库的比例；目标 100% | 未验证：缺量具。提取没有遥测事件，`telemetryCapability` 不认 `image_to_prompt` |
| 护栏 | 没经确认的供应商调用 = 0 | 集成测试的伪造格和取消格；这只证明代码路径，生产环境未验证：缺量具 |
| 质量 | 卡上写的那张图 = 发出去的那张图 | 集成测试断言卡上的 subject 和请求里参考图的来源一致 |

### ★1b 连带界面

- **标签页原地反馈**：沿用 `notify` inline，已有三句（正在提取 / 已存入 / 失败）；新增两句（「已取消提取」「上一张提取确认还没处理」）。
- **付费确认卡**：新内容，复用现有对话框。
- **提示词库条目**：不变（标题、提示词、模式标签、参考图）。
- **日志**：busy 时记一行警告；失败照旧记 `browser-prompt-extraction-failed`。
- **不涉及**：Agent 回执、通知中心、任务列表。提取不经过 Agent，也不进任务中心。

### ★2 谁说了算

- **问人 → 铸令牌 → 核销**：归主进程唯一链 `confirmSpendAndMintGrant` 加 `spendGrant`。
  - 这条链属于概念 `spend.pending-identity` 的 `exception_deadlines` 里 `legacy-spend-ports` 那一项，到期日以那里为准（合并 main 后是 main 定的日期），本单不动它；到期前要么迁进 Run，要么按 0.25 方案换掉，由协调记账。
  - 令牌不出主进程。这比派工书写的「渲染层拿不透明 grantId」更窄。
- **提取参数**（种类、温度、maxTokens）：归主进程新模块，只在一处定（今天在渲染层）。
- **提取提示词模板**：归用户设置。主进程 `browserPromptExtractionSettings` 负责存；渲染层拼好整句传过来；主进程当作不透明文本，不改。
- **来源页**：取主进程转发时浏览视图的真实地址。
- **碰了几个概念**：1 个，`spend.pending-identity`：写接口加登记表 `SPEND_TOKEN_DOORS`，`parity_test` 指普查；notes 只留一句话，指向登记表和 `exception_deadlines`（10-28 改，合并 main 后例外的日期与原因已在结构化字段里）。
- **同一份事实存了几份**：1 份。报价身份和执行身份由同一个函数算。
- **有没有靠猜意图**：没有。取消是卡的显式回复；渲染层没了一律按没确认处理（fail-closed，用 `requestRendererDecision` 的 until-recipient-gone）。

### ★3 一致与复用

**复用的现成件**：`confirmSpendAndMintGrant`、`findExecutableModel`、`assertTrustedSender`（`electron/ipcSenderGuard.ts`）、`runTaskIpcGuard`、`useSpendConfirmStore` / `SpendConfirmDialog`、`spendModelLine` / `visionModelLine`、`classifyGenerationError`、`notify` inline。不新建对话框，不新开令牌路。

**系统改进**：让「登记在令牌路上的付费口，少接了铸令牌那一步」以后会变红。

- 新普查 `electron/spendTokenDoors.census.test.ts`：用 `scripts/door-map.mjs` 的 `doorsForTargets(['runTask', 'runWorkbenchTaskByVendor'])` 数出全部门，不写第二个扫描器；铸令牌的门用同一个函数数 `mintSpendGrant` / `confirmSpendAndMintGrant`。
- 登记表与判定（第 2 轮定稿）住在非测试文件 `scripts/spend-token-doors.mjs`：`SPEND_TOKEN_DOORS`（一扇门一行，身份 = door-map 的 `kind|path|symbol`）和纯函数 `judgeSpendTokenDoors`。普查测试只做「数门 → 判定 → 期望零条」，反例往纯函数里注入门。
- 每扇门在表里登记一个角色：

| 角色 | 含义 / 必须写清什么 |
|---|---|
| `mints` | 同一文件里必须有 `mintSpendGrant` 或 `confirmSpendAndMintGrant` 门，并点名真入口测试 |
| `forwards` | 点名转到哪一扇 `mints` 门 |
| `run-approved` | 走 `RUN_APPROVED_ADMISSION`（画布单镜 Run） |
| `free-local` | 本地 ComfyUI，闸放行；渲染层经 `nomi:tasks:run` 的门也登记成它：没有调用方带令牌，付费种类在 `electron/spendGrant.ts` 被拒（10-28 改：原先设想的「令牌由渲染层带来」那个角色已删，说法对不上代码） |
| `test-utility` | 测试工具 |
| `known-gap` | 写明缺什么、谁跟 |

- 四条断言，任一不满足就红：
  1. 有没登记的门；
  2. 表里有、代码里已经没了的行；
  3. `mints` 行所在文件没有铸令牌的门；
  4. `forwards` 指向的不是 `mints` 行。
- **和文本调用方矩阵的关系**：普查是矩阵「真入口登记」（`electron/ai/textTaskCallers.integration.test.ts:35-38`）的推广，覆盖所有令牌路的门，不是第二份。文本矩阵管文本任务在各入口的行为；普查只管令牌从哪来。
- **和 `scripts/check-run-task-grant.mjs` 的关系**：普查不替代它。那道门管一个调用点性质：主进程自己拼 `request:` 的调用必须带 grantId。普查管一份清单：谁在花钱、令牌从哪来。两者不重叠，普查文件头写清分工。

**登记改正**：

- `spend.pending-identity.json`：notes ③ 的调用方改成 `electron/browser/prompt/browserPromptExtractionRun.ts`；加 `parity_test`，指向普查测试；`write_api` 加 `scripts/spend-token-doors.mjs#SPEND_TOKEN_DOORS`（例外 ①–④ 的结构化形状，第 2 轮定稿）。
- 文本矩阵 `#7`：`entry` 改成 `{ from: 'renderer', test: <本集成测试> }`，`RENDERER_ENTRY_GAP_EXCEPTIONS` 清空。
- 热点文件的分支数只减不增：`spendCardRouting.test.ts` 加一格，`capabilityApplyHandler.ts` 里 `intent ===` 只许剩拆解那一处、不许直接 import 任何专用卡的 `confirm…Spend`（专用卡只经查表进来）。

### ★4 全状态

| 状态 | 用户看到什么 |
|---|---|
| 空（没选到图） | 沿用 `promptImageMissing` / `promptReferenceMissing` |
| 加载中（准备参考图、等卡、等模型） | 标签页「正在提取{{mode}}提示词…」；卡开着时这一句保留 |
| 成功 | 「已存入提示词库：{{name}}」 |
| 失败 | 过 `classifyGenerationError` 的 reason（加 hint），不印 IPC 标记；模型空返回、返回不可用，沿用现有两句 |
| 取消（卡上点取消） | 「已取消提取」（新） |
| 另一张提取卡开着 | 「上一张提取确认还没处理」（新）；不弹第二张 |
| 过期 | 卡开超过 30 分钟再点确认 → 报价过期（`takeSpendQuote` 抛错），什么都没发出去，走失败那一句；再点一次提取就好 |
| 部分成功 | 不适用：只有一次调用 |
| 取消中 | 不适用：发出后没有取消入口，和今天一样（见残余风险） |
| 能力不可用：没有支持读图的文本模型 | 沿用 `promptVisionModelMissing`：「请先在『设置 → 模型』里启用一个支持图片输入的文本模型」，下一步就写在句子里 |
| 能力不可用：有模型，但主进程解析不到可执行模型（没 key、被停用） | 弹卡之前就失败；过分类器给出原因 |

文案全进 i18n，不写钱。

### 6 外部数据与失败

外部来源：

| 来源 | 信不信 / 怎么用 |
|---|---|
| 供应商 | OpenAI 兼容的读图对话，沿用 `executeTextTask`，本单不改 |
| 网页给的图片地址 | 不可信：只用于抓图，和卡上「图片」那一行 |
| 网页给的标题 | 不可信：只在库条目没有标题时兜底；来源页用主进程拿到的真实地址 |
| 用户的提取模板设置 | 可信，原样用 |
| 本机截图 | 在 Nomi 浮层里框选，可信 |

失败时：

- 供应商错误经 `runTaskIpcGuard` 编码，到渲染层分类成人话。
- 网络断了、结果未知时，不说「没扣」。
- 未知失败不甩锅给用户的 key：分类器的 unknown 类只转述原话。

### 8 真实条件

| 条件 | 情况 |
|---|---|
| Windows | unverified |
| 英文界面 | 实现线交中、英两张卡的真截图，自己 Read 过 |
| 最小窗口 | 对话框沿用现有响应式；unverified |
| 真规模 | 不适用：一次调用 |
| 干净安装 | unverified |
| 真付费 | 协调做一次最小真付费（`_paidRun`，一次提取）；本线 unverified |
| 键盘全程 | 卡沿用现有对话框（Enter / Esc）；unverified |
| 零花费走查 | 仓库里没有覆盖整次提取的走查（`tests/ux/reference-capture.walk.mjs` 只走到截图框选）；unverified，不新写大走查 |

### ★9 验收与回滚

- **回滚**：revert 实现那一个 fix 提交。会回到「每次都被闸拒」的旧现状：安全，但不能用。紧急时可以走备选 D（删页内触发）。
- **独立验收**：协调派另一条验收线，按第六节清单逐条核。红灯用固定复现命令（`pnpm exec vitest run <文件>`），一字不改。报告链接写进 PR 的 `## 独立验收`。
- **花钱走查**：本线不跑真付费。协调的 `_paidRun` 跑一次提取，规矩照旧：免费演练先过；产物含修复标记（字面量由协调定）；在专用工作树里跑。

### 门表（`node scripts/door-map.mjs`，在 `6c05eebae` 上跑）

**`runWorkbenchTaskByVendor`：2 扇门**

| 门 | 角色 | 本单 |
|---|---|---|
| 写 `src/ui/browser/prompt/browserPromptExtractionRunner.ts` | 浏览器提取，渲染层一次性门，**没有令牌** | 删 |
| 读 `src/workbench/generationCanvas/runner/catalogTaskActions.ts` | 画布非 Run 路，经 `nomi:tasks:run`：没有调用方带令牌，付费种类被闸拒，本地 ComfyUI 放行（10-28 改：新手试生成的死令牌已在 main 上删掉，它走 `comfy-candidate-test`） | 不动；普查登记 `free-local` |

**`confirmSpendAndMintGrant`：1 扇门**

| 门 | 角色 | 本单 |
|---|---|---|
| 写 `electron/video/deconstructSpend.ts` | 拆解（不碰清单内） | 不动 |
| （新）`electron/browser/prompt/browserPromptExtractionRun.ts` | 浏览器提取 | 加 |

**`runTask`：19 处出现，按文件归角色**

| 文件 | 角色 | 令牌从哪来 |
|---|---|---|
| `electron/capabilityCore/canvasTransportProvider.ts` | `run-approved` | 不核令牌：批准住在单镜 Run 的门上 |
| `electron/capabilityCore/modelOnboarding/tryModel.ts` | `mints` | 同文件 `mintSpendGrant`，铸完紧接着发 |
| `electron/integrationCertification/integrationSession.ts` | `mints` | 注入的 `mintSpendGrant`，铸完紧接着发 |
| `electron/integrationCertification/integrationSessionRuntimeInstall.ts` | `forwards` | 把真 `runTask` 和铸令牌一起装给认证会话 |
| `electron/main.ts` | `forwards` | 能力核的 `runTask` 注入 → 试跑（`mints`） |
| `electron/capabilityCore/appIntegration.ts`、`dispatcher.ts`、`host.ts`、`mcpStdioServer.ts`、`rpcServer.ts`、`modelOnboarding/dispatch.ts` | `forwards`（读：把函数递下去） | 最终到试跑（`mints`） |
| `electron/tasks/comfyCandidateTest.ts` | `free-local` | ComfyUI 候选试跑，闸放行 |
| `electron/tasks/taskIpcHandlers.ts` | `free-local`：`nomi:tasks:run` 的主进程那一端 | 渲染层没人带令牌：付费种类被闸拒，本地 ComfyUI 放行 |
| `electron/video/deconstructVideo.ts` | `mints`（经 `deconstructSpend.ts`） | 拆解开跑前问人、铸令牌 |
| `electron/parity/generationParityTestUtils.ts` | `test-utility` | 测试自己铸 |
| `src/workbench/generationCanvas/runner/catalogTaskActions.ts` | 同名的渲染层局部函数，不是 runtime 的 `runTask` | 普查里单独标出 |
| `electron/catalog/customCallDispatch.ts` | 不调 `runTask`，接的是 `spendGate`（`consumeTaskSpend`） | 跟随调用它的那一路 |

结论：令牌路上的付费口里，没接令牌的只有浏览器提取这一个口。其余各口的令牌都有来处，普查表里逐行写清。

## 五、中途表（改后的目标行为）

| 状态 \ 打断 | 停（卡上取消） | 关窗 | 断网 | 重启 | 连点 / 再点 |
|---|---|---|---|---|---|
| 准备参考图（弹卡前） | 没有取消入口，同今天；很快就过去 · 不扣 | 渲染层没了，什么都不发 · 不扣 · 无回执 | 抓原图失败 → 原地报失败，卡都不弹 · 不扣 | 什么都没留下 · 不扣 | 每点一次各走一次；到了弹卡那一步，按「卡开着」那一行处理 |
| 卡开着 | 取消 → 「已取消提取」· 不铸令牌、不扣 | `requestRendererDecision` 立即按没确认处理（fail-closed）· 不铸、不扣 · 守卫放开 | 卡照旧开着；点「提取」之后才发，发的时候断网就按「发出中 × 断网」处理 | 卡和令牌都在内存里，随进程消失 · 不扣 | 新请求回 busy，记一行警告，原地显示「上一张提取确认还没处理」· 始终只有一张卡 |
| 发出中（等模型） | 没有取消入口，同今天 · 这一次照常花 | 主进程照样跑完这一次，但结果没地方落，不进库 · 扣一次 · 无回执（提取没有账本，见残余风险） | 结果未知：报失败（分类器转述原话），不说没扣 · 可能已扣 | 进程没了，请求随之中断；供应商那边可能已经受理 · 可能已扣、无回执 | 再点是新的一次：新卡、新令牌，各扣各的 |
| 写库中 | 无 | 写库在渲染层：窗口没了就没写成 · 已扣 · 无回执 | 写库在本机，不受影响 | 同关窗 | 同上 |
| 完成 | 无 | 无影响 | 无影响 | 库里的条目还在 | 再点是新的一次 |

另外一种打断：发出中切换了项目。协调 10-27 定：结果照样存进提示词库（库是全局的，钱已经花了）。弹卡之前（读模板设置、抓图 / 截图）切项目仍整次取消，那时一分钱没花；弹卡之后的 `stillCurrent` 判断删掉。没有别的项目绑定副作用要丢（见「第 2 轮定稿」）。

## 六、验收清单与反例（★9，动手前写全；验收线只核这份）

复现命令统一用 `pnpm exec vitest run <文件>`，按门岗规矩排锁。集成测试就是本单钉现状的那一份；落地时把它的期望翻过来，再补下面各格。

| # | 检查 | 反例（这一类会从哪回来） |
|---|---|---|
| 1 | **确认（原图）**：只弹一张卡。卡的 payload：`intent: 'prompt-extraction'`、`callCount: 1`、`legs` 是一条 vision；subject 解开后，来源页 = 浏览视图真实主机名，图片 = 原图地址。点确认 → 假上游恰好收到 1 次请求；`assertAndConsumeQuotedSpend` 核销一次，没有触发第二张卡；提示词库多 1 条，标题、提示词来自上游返回；标签页显示成功。 | 拿掉 `confirmSpendAndMintGrant`（没有令牌）→ 上游 0 次，这一格红 |
| 2 | **确认（截图）**：同第 1 格；卡上「图片」写页面截图（subject 的 image 为空）；`referenceImages` 是截图的 data URL。 | 截图这条路还走旧门 → 红 |
| 3 | **卡上取消**：上游 0 次；令牌 0 颗（`__spendGrantCountForTests() === 0`）；提示词库 0 条；标签页显示「已取消提取」；不记 `logRendererError`。 | 把 `{ confirmed: false }` 当成错误处理 → 弹错误提示 → 红 |
| 4 | **网页伪造**：用伪造的 console 行驱动真转发（第 2 轮定稿：转发抽成 `browserViewUtils.ts` 的 `promptCaptureEventFromConsole`，`browserViews.ts` 只调它）。转发出的事件 → 渲染层真映射 → 提取开跑 → 恰好弹一张卡；不确认 → 上游 0 次，提示词库 0 条。 | 换回 `askWhenCallsAbove: 1`（原第 2 条）→ 0 张卡、上游 1 次 → 红 |
| 5 | **来源页可信**：浏览视图在 `https://evil.example/x`，网页伪造 payload 里写 `pageUrl: 'https://nomi.app'` → 卡上来源页显示 `evil.example`。 | 转发照搬网页自报的 `pageUrl` → 红 |
| 6 | **不可信发送方**：分别从 (a) 浏览视图的 webContents、(b) 主窗口的子帧、(c) app-surface 窗口调用 `browser:prompt-extraction:run` → 全被 `assertTrustedSender` 拒；卡 0 张、令牌 0 颗、上游 0 次。`node scripts/check-ipc-sender-binding.mjs` 绿。 | 换成 `assertTrustedUiSender` → (c) 能过 → 红 |
| 7 | **卡开着时再点**：第 1 张卡挂着时发第 2 个请求 → 回 `{ outcome: 'busy' }`，记 1 行警告，卡仍是 1 张。第 1 张处理完以后，第 3 个请求正常弹新卡。 | 去掉守卫 → 出现 2 张卡 → 红；`finally` 里没放开 → 第 3 个请求也是 busy → 红 |
| 8 | **渲染层没了**：问人那一步抛 `RendererUnavailableError` → handler 报错；令牌 0 颗，上游 0 次；下一个请求不是 busy。 | 守卫没放开 → 红 |
| 9 | **报价身份**：目录里 brain 的 modelKey 是别名 → 报价那一行用 `findExecutableModel` 解出的正名 → 全程只有 1 张卡（闸上没有第二张）。 | 报价直接用别名 → 卡变 2 张 → 红 |
| 10 | **故障注入**（`spend-fault-injection`），用本机假上游的 `reset` / `http(401 / 500)` / `hangAfterHeaders` / `empty` 四种回法：提示词库 0 条；标签页文案是 `classifyGenerationError` 的 reason，不含 `NOMI_VENDOR_ERR_B64::`，也不含 `Error invoking remote method`；令牌只核销一次；结果未知时不说「没扣」。 | 把 `error.message` 原样印出来 → 断言里查到标记子串 → 红 |
| 11 | **旧路删净**：`git grep -n "runWorkbenchTaskByVendor" src/ui/browser` 为空；runner 里没有回退分支；`runWorkbenchTaskByVendor` 只剩 1 扇门（`catalogTaskActions.ts`）。 | 留着旧调用当兜底 → 红 |
| 12 | **普查**（登记表与纯判定在 `scripts/spend-token-doors.mjs`，测试在 `electron/spendTokenDoors.census.test.ts`）：全部门都已登记，绿。反例都在临时副本里跑，或者往普查的纯判定函数里注入门：(a) 加一个没登记的 `runTask(` 调用方 → 红；(b) 删掉提取模块里的铸令牌调用 → `mints` 行红；(c) 表里留一行代码里已经不存在的门 → 红；(d) 在基线 `6c05eebae` 上，runner 那扇门只能登记成 `known-gap`，证明这份清单会把缺口明摆出来。 | 普查只数门、不配对铸令牌 → (b) 不红 → 不算过 |
| 13 | **登记一致**：notes ③ 改好、`parity_test` 指向普查之后，`node scripts/check-concept-owners.mjs` 绿；`#7` 带上 entry.test、例外清单清空之后，`electron/ai/textTaskCallers.integration.test.ts` 绿。 | 例外清单里还留着 `#7` → 矩阵测试红 |
| 14 | **卡分流**：`capabilityApplyHandler.ts` 的 diff 只有一处——凭据验证那一行换成一次查表，加上 import 的变化。`src/workbench/capability/spendCardRouting.test.ts` 第一格（凭据验证）不改且绿；第二格（不认识的 intent 落进通用卡）翻成「提取走专用卡：`source: 'user'`，没有节点行和产物行」；`deconstructSpendCard.test.ts` 绿；handler 里没有新增 `intent ===` 比较（grep）。 | 再加一个 `if` → grep 能查到 → 红；第一格被改动 → 说明凭据验证的行为变了 → 红 |
| 15 | **文案**：中英 key 齐全；`pnpm run check:i18n` 绿（不出现钱的字眼）；中、英两张卡的真截图由实现线自己 Read 过。截不到图就照实记 `unverified` 并写原因。 | 标题写「AI 助手想生成…」 → 红 |
| 16 | **门岗**：ESLint、`node scripts/typecheck.mjs`、`node scripts/check-root-cause-contracts.mjs`（同提交带 `docs/fixes/2026-10-27-browser-extract-grant.root-cause.json`，contract v3）、`node scripts/check-concept-owners.mjs`、`pnpm run check:i18n`、`git diff --check`、推送前快检，每条记退出码；跟着登记的三处（生成入口登记表、自写登记的领域目录、文本矩阵）各自的门岗绿；fix 提交带 `Direction-Check: docs/engineering/direction-checks/2026-10-27-browser-extract-grant.md`。 | 缺 trailer → commit-msg 钩子红 |
| 17 | **真付费**：协调用 `_paidRun` 做一次提取，免费演练先过（`spend-paid-sample`）。本线记 unverified。脚本 `tests/ux/browser-extract-real.paid.mjs`，同一份步骤（`tests/ux/_browserExtractSteps.mjs`）的零花费演练 `tests/ux/browser-extract-real.rehearsal.walk.mjs`（10-28 补写）。 | — |
| 18 | **这一类还会从哪回来**：①另一个渲染层入口为付费种类调 `nomi:tasks:run`；②主进程新的附属付费口不铸令牌；③0.25 把触发点挪到原生右键菜单、改成一键之后，普查行和卡策略没跟着改；④模型别名漂移。 | ①渲染层新文件直调 `desktop.tasks.run`：ESLint 规则 `task-run-bridge` 拦（只许 `taskApi.ts`），经名字数得到的门由普查（没登记的门）拦；②主进程新门：普查（没登记的门 / `mints` 配对）和 `check-run-task-grant` 拦；③靠 0.25 的设计卡把普查行列进 ★9；④由第 9 格拦（10-28 改：①原写「普查拦」，普查按符号名数门，数不到成员调用，补了 ESLint 规则；普查与规则都看不到的口见根因合同 `residual_risks`） |
| 19 | **发出中切项目照存**（协调 10-27 定）：卡开着时切走项目（`stillCurrent` 变假）→ 点确认 → 上游 1 次，提示词库照样多 1 条，标签页报成功；弹卡之前切项目 → 不弹卡、上游 0 次。 | 把弹卡之后的 `stillCurrent` 判断放回去 → 库 0 条 → 红 |
| 20 | **实现线真做的三条反例**（派工书要求，做完还原）：①拿掉铸令牌那一步 → 第 1 格「上游恰好 1 次」红，普查 `mints` 行也红；②普查登记表里删掉一扇门的登记 → 普查红；③守卫换成 `assertTrustedUiSender` → 第 6 格 (c) 红（另跑一次：浏览视图发来的请求被拒、不铸令牌）。 | — |

## 七、用户能力变化（PR 正文同节照抄）

- **之前**：浏览器面板里的「提取提示词」——悬停图片出现的「提取」，和工具栏的「截图提取」——每次都失败，报「授权已过期…」，什么都没进库。
- **之后**：每次提取先弹一张确认卡，写明来源页、哪张图、用哪个读图模型。点「提取」才调用模型（一次），结果存进提示词库；点取消就什么都不发。
- **为什么多一张卡**：页内的「提取」按钮是我们注入到网页里的，网页自己就能冒充这一下点击；卡在 Nomi 自己的界面上，网页冒充不了。0.25 把「提取」挪到 Nomi 自己的面上以后，再恢复一键提取。

## 八、功能分类

```
### 功能分类
- [ ] 新界面 / 改交互
- [x] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能
```

「新界面 / 改交互」没勾（协调 10-27 定）。理由：卡复用现有对话框，不新画界面、不改布局，新文案用户 10-27 已拍板。卡是用户可见的，实现线交中、英各一张真截图，自己 Read 过。

## 九、残余风险与其它发现（本单不修）

**残余风险：**

- **页内触发点在 0.25 之前仍可伪造**：花不了钱（每次都有卡），但网页能反复弹卡骚扰用户。按页面限流需要新造概念，本单不做；根治见 0.25。
- **伪造请求在弹卡之前就让主进程抓了一次网页指定的图**：这是现状。走浏览视图自己的会话，不花钱，网页也没因此多拿到什么能力。
- **发出后没有取消入口**：关窗、重启时，结果没地方落，这一次已经花了，也没有回执。现状如此，修后多了「已花」这一层。
- ~~发出中切项目，已付费的结果被丢~~：协调 10-27 定照存，第 2 轮已改（弹卡之后不再判 `stillCurrent`）。
- **拆解的措辞仍内嵌在热点文件的通用分支里**：下次要改，先搬进查表。
- **登记例外的到期日**在概念 `spend.pending-identity` 的 `exception_deadlines`（`legacy-spend-ports`，main 定的日期）：本单不动它。

**其它发现：**

- **`electron/catalog/catalogCommit.ts` 的 `testModelCatalogMapping`**：`execute: true` 时直接 `executeProfileOperation`，不过付费闸。IPC 是 `nomi:model-catalog:mapping:test`，preload 在 `modelOnboardingBridge.ts:54`；渲染层 `src/api/desktopClient.ts` 的 `testModelCatalogMapping` 今天没有调用方。这扇门开着，但没人走。
- **ComfyUI 的几个入口照铸令牌**：闸对 ComfyUI 放行，所以铸了也不核。这是 `taskSpend.ts` 文件头写明的有意设计，记在这里，免得普查时误判。
