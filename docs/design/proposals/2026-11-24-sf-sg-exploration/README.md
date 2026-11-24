# S-F & S-G 探索设计包总览（`marked: exploration`）

> 对应议题：Issue `#1586`（`#7102165974` A4c / D4-17 与 `#7124988403` 第二半探索稿）  
> 状态：**Step 1 探索稿（`data-mark="exploration"`）**，待用户拍板后转正式清单入 `docs/design/boards/` 并进入生产组件实现。  
> 视觉与几何自检：6 张画板全部通过 Playwright 渲染审计（`overflowCount = 0`，全板严格限 4 档字号 `11 / 12 / 13 / 14px`，下拉勾选 `✓` 全部居右，语义色统一使用 `-soft / -edge / -ink` 四件套，引用按钮名全部整词防拆行）。

---

## 一页拍板速览（给用户的核心权衡与推荐项）

| 议题 | 用户真正纠结的核心 | 推荐拍板项 | 不选另一条路的理由 |
|---|---|---|---|
| **S-F（A4c）参考素材第一次发给新的第三方前问一次** | 既不想每次点生成都被隐私弹窗打断、或者因默认关着公共图床直接报错卡死；又不想在不知情时把人物定妆照静默传上匿名公网图床或跨家借用通道。 | **推荐方案 C：按「实际字节接收主体 `recipientId`」记名，第一次发前问 1 次，记入主进程 `automation-policy.json`，点允许当场继续生成；本机 `127.0.0.1` 免问；在「设置 › AI 策略」原位列表一键撤回。** | 只按模型 `vendorKey` 记会漏掉「模型走 APIMart、视频参考却借道 KIE 或落到匿名图床 `litterbox.catbox.moe`」；只按原始子域名 `host` 记会让同平台官方推理与上传子域连弹两次。 |
| **S-G（D4-17）「自动」写明模型真名 + 默认模型 4 行收 2 行** | 界面到处写「自动选择 / 默认模型 / 选择模型」，点生成前不知道到底花谁的积分、分镜行连画幅和时长都被藏起；同时设置页拆成「文生图 / 图片编辑 / 文生视频 / 图生视频」4 行逼人重复设两遍。 | **推荐方案 G1：设置页 4 行收成「图片 / 视频」2 行（老用户若曾分设不同模型原样保留不覆盖）；全站 7 处盲「自动 / 默认」统一写成 `自动 · <实际解析模型名>`（如 `自动 · GPT Image 2.6 Flare`、`自动 · Seedance 2.5`、`自动 · DeepSeek V4 Flash`）。** | 目录底层 `KIND_OF_TASK` 本来就只分 `image` 与 `video` 两个池子，现代多模态模型挂参考图即自动切改图/首帧模式；保留 4 行纯属双倍配置且与 Agent 面板长期分裂。 |

---

## 第一部分：S-F（A4c）参考素材第一次发给新的第三方前问一次

### 1. 现状与历史脉络核查（只读实查）

1. **已删的错层（PR `#1496` `3c0e2022c`，2026-11-13）**：删掉了按本机 DNS 解析地址拦截出网的整层（解决代理 `198.18.*` 与局域网误拦），留下两条密钥绑定规则；用户同日明确原则：**「只拦三种：肯定白花钱、肯定丢活、第一次交给新第三方（只问一次）」**。
2. **防自授边界（PR `#1556` `c83694a96`，2026-11-17）**：删掉了渲染层可自行塞 `allow` 的按次托管字段，改为只读主进程 `automation-policy.json` 的 `anonymousAssetHosting: 'ask' | 'allow'`。
3. **今天真机剩下的两处真实摩擦**（见 `current-app/current-settings-upload-guidance.1440x900.zh-CN.light.png` 与 `electron/catalog/assetLocalization.ts:577-595, 660-733`）：
   - **摩擦 ①（`ask` 名叫询问、实则直接报错中断）**：默认 `anonymousAssetHosting = "ask"` 时，创作者给视频节点挂上本地参考片点「生成」，若当前供应商只收图片（如 APIMart `/uploads/images`），上传链走到匿名公共图床直接抛 `AnonymousAssetConsentRequiredError` 失败停机——创作者被迫停下手里的镜头，去翻「设置 › AI 策略」打开永久全局开关再回来重试。
   - **摩擦 ②（跨家借道与新接收方无感知）**：`resolveAssetIngestionWithFallback` 在目标供应商不收某类媒体时，会自动借道其他已配供应商（如跑 APIMart 模型但把参考片传往 KIE `kieai.redpandaai.co`）或自定义 Relay；创作者以为素材只发给了当前模型所属平台，实际字节去了另一家第三方，且设置页看不到已允许过谁、没法单独撤回某一家。

### 2. 三个必答设计问题与方案对比

#### 问题 ①：谁算「新的第三方」？

| 方案 | 记名粒度 | 优点 | 致命缺陷 / 摩擦 | 结论 |
|---|---|---|---|---|
| 方案 A | 仅按目标模型供应商 `vendorKey` | 实现最简 | **漏报真实接收方**：模型选 `apimart` 时，视频参考可能借道 `kie` 或落到公共图床 `litterbox.catbox.moe`；只记 `apimart` 等于把人物参考片静默传上公网临时图床。自定义供应商改 `baseUrl` 换域名也会漏问。 | 不选 |
| 方案 B | 仅按原始请求 `url.host` 子域名 | 域名绝对精确 | **同主体重复打断**：同一平台推理 `api.apimart.ai` 与官方上传 `upload.apimart.ai` 分属两个子域时连弹两次确认，违背「同一第三方只问一次」。 | 不选 |
| **方案 C（推荐）** | **按「实际字节接收主体 `recipientId`」** | **隐私诚实且不重问** | 需一张 20 行纯函数映射表：内置供应商自有上传与推理归同一 `vendor:<builtinKey>`；跨家借用（`borrowed: true`）单独记 `vendor:<borrowedKey>`；自定义中转/自建接口按 `origin:<protocol+host>` 记（换域名自动重问）；公共临时图床按具体站点 `anon:<host>` 记；本机 `127.0.0.1` / `localhost` / `[::1]` / `comfyui-upload` 恒免问。 | **推荐** |

#### 问题 ②：点「允许」后记在哪？老用户怎么过？

- **唯一真相源（严守 `2026-11-17` 防自授边界）**：住在主进程 `electron/settings/automationPolicyContract.ts`（落盘 `automation-policy.json`），新增字典：
  `trustedAssetRecipients: Record<string, { approvedAt: string; label: string; host: string; visibility: 'provider-private' | 'public-provider' | 'public-anonymous' }>`。
- **零调用方自授口**：渲染层发出的生成请求体**不携带任何 `allow` 布尔或一次性令牌**。主进程 `localizeAssetsForVendor` 在读盘准备发字节前核对 `trustedAssetRecipients`；若命中未授权 `recipientId`，由主进程挂起确认门（与付费确认共用单一主进程门控），只有用户在真实确认界面点击「允许并继续」才经主进程设置写口落盘并继续当前上传；点「取消」则 `0` 字节发出。
- **老用户无损迁移**：升级时若旧盘 `anonymousAssetHosting === "allow"`，归一化层自动将内置公共临时图床（`litterbox.catbox.moe` / `tmpfiles.org`）预填入 `trustedAssetRecipients`，熟手工作流零打断；原默认 `"ask"` 用户升级后从「直接报错」变成「首次遇到时当场问一次、点允许立即继续」。

#### 问题 ③：事后反悔怎么撤回？常驻 Agent 发起时怎么问？

- **撤回家园（0 新页面 / 0 新弹窗）**：原位挂在 `设置 › AI 策略 › 素材上传通道`（`src/workbench/settings/AiModelsSection.tsx`）底部，展示**「已允许接收参考素材的第三方」**列表（含名称、域名、通道性质徽标「平台自有接口 / 跨家借用 / 公开链接 · 1h 失效」、允许时间及单行 **「撤回」** 按钮）。点「撤回」立即删掉该 `recipientId`，下次向它发参考素材前重新询问。
- **画布 / 分镜发起时**：复用现有 `SpendConfirmDialog`（`kind: 'reference'`，`DesignModal` + `DecisionBar` 左「取消」右「允许并继续生成」）。公共临时图床使用 `--nomi-warning-soft / -edge / -ink` 醒目提示「公开临时链接 · 1 小时自动失效」；常规平台或私有中转使用中性表面色。
- **常驻 Agent 发起时（严守设计系统 `§1.0`）**：聊天流里**绝不放中转配置表单或开关列表**，只渲染 `NodePointer`（指向画布目标镜头卡）+ 单问题确认槽（写明哪张参考图将首次发往哪个接收方域名，左「不发送」右「允许发给 <接收方>」）。

### 3. S-F 全仓门岗（Door-Map）盘点

| 门类 | 仓库相对路径 | 现状职责 | S-F 改动动作 |
|---|---|---|---|
| 读/拦（主进程唯一执行点） | `electron/catalog/assetLocalization.ts` | `anonymousHostingEnabled()` 仅判公共图床开关并直接抛错 | 改为按候选通道实际 `recipientId` 查 `trustedAssetRecipients`，未授权则走主进程确认门，批准后原位继续上传 |
| 契约与归一化（唯一存储家） | `electron/settings/automationPolicyContract.ts` + `automationPolicySettings.ts` | 存 `anonymousAssetHosting: 'ask' \| 'allow'` | 收口为 `trustedAssetRecipients` 字典 + 旧 `"allow"` 无损迁移，删除二元死开关 |
| 设置界面（唯一管理与撤回家） | `src/workbench/settings/AiModelsSection.tsx` | 底部渲染 `允许第三方公共临时托管` 盲开关 | 替换为「已允许接收参考素材的第三方」列表 + 单行「撤回」按钮 |
| 画布确认壳 | `src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx` | 已有 `pending.kind === 'reference'` 分支 | 承接首次接收方单问题确认展示 |
| 常驻 Agent 确认槽 | `src/workbench/ai/ProjectAgentResidentShell.tsx` | 已有单问题干预槽 | 渲染 `NodePointer` + 单问题首次接收方确认 |

### 4. S-F 九宫格设计卡（`★0`–`★9`）

- **★0 先查别人（≥3 条）**：
  1. `LibTV`（同表面 `same-surface`，`https://www.liblib.tv/`，截图 SHA-256 `3277cb75d501b64abace1464bb30cd4f6a0ffad828d9071ac6e00c0104dc57b6`，核验日 `2026-11-24`）：底部生成框挂参考图后对平台自身存储直接发送、不在日常生成流每次弹窗 → 影响决定：已允许过的接收主体绝不二次弹窗。
  2. `Runway`（同行，`https://help.runwayml.com/`，核验日 `2026-11-24`）：资产隐私与外部共享集中在账户设置一处管理，不在画布拆零碎权限开关 → 影响决定：撤回入口统一放在已有的 `设置 › AI 策略` 上传区。
  3. `Apple HIG Privacy Prompts / macOS TCC`（跨品类隐私授权标杆，核验日 `2026-11-24`）：首次向新主体交付敏感数据时弹单问题确认（给谁 + 为什么 + 左取消右允许），系统级持久化并在设置页单行撤回 → 影响决定：采用主进程 `trustedAssetRecipients` + 单行撤回。
- **★1 目标与可证伪量具**：
  - 同一接收主体第 2 次及以后发送参考素材弹窗次数 = `0`（量具：`assetLocalization` 单测与真窗连续两次生成计数）；
  - 本机 `127.0.0.1` ComfyUI 上传弹窗次数 = `0`（量具：ComfyUI 回环上传测试）；
  - 未授权新接收方在用户点「取消」或伪造渲染层字段时实际发出字节数 = `0`（量具：本地回环接收端字节计数断言 `receivedBytes === 0`）。
- **★1c 老用户怎么过**：旧 `anonymousAssetHosting: "allow"` 自动迁移为内置公共临时图床已授权；旧 `"ask"` 用户不再报错卡死，改为首次发送时原位弹一次确认，点允许当场继续。
- **★2 唯一主人（P0/P1）**：权限真相唯一归 `electron/settings/automationPolicyContract.ts`；拦截唯一归 `electron/catalog/assetLocalization.ts`；UI 确认唯一复用 `SpendConfirmDialog` / Agent 确认槽，零新弹窗组件，同时删掉旧 `AnonymousAssetConsentRequiredError` 死胡同报错链。
- **★3 触发与长跑/打断语义**：仅当本次请求实际包含需外发的本地素材（`nomi-local://` 或 `data:`，且经 `minimizeUploads` 裁剪后仍需上传）且命中未记录的外部 `recipientId` 时，在**扣费提交之前**询问一次；确认卡不设空闲自动超时（未点允许绝不发字节、绝不扣费）。
- **★4 数据与长文本边界**：模型名 32+ 字符、自定义中转域名 38+ 字符均单行省略不撑破 400px 确认卡；已允许列表在窄高视口内自然排布或限高滚动，不遮挡底部操作。
- **★5 失败与恢复**：若首选已授权通道返回 `HTTP 413`（体积超限）需降级到未授权的公共临时图床时，在切换发往该新图床前诚实弹一次该图床的确认（写明因体积超限改走临时直链），绝不趁 fallback 静默偷发。
- **★6 钱与隐私边界**：确认发生在模型推理扣费请求发出之前；拒绝发送时上传 `0` 字节、推理 `0` 扣费。
- **★7 性能预算**：`trustedAssetRecipients` 为内存已加载快照的 `O(1)` 哈希查找，无额外磁盘 I/O 或布局抖动。
- **★8 可观测性**：记录结构化事件（接收主体类型、允许/拒绝/撤回动作，不含本地文件路径与提示词正文）。
- **★9 动手前验收清单与反例**：
  - 正例 1：首次发参考图给 APIMart → 问 1 次 → 允许后当场完成生成 → 第二张卡再发给 APIMart `0` 弹窗；
  - 正例 2：设置 › AI 策略点击「撤回」Litterbox → 下次视频参考需走 Litterbox 时重新弹黄色醒目确认；
  - 反例 1（防自授）：渲染层或 MCP 调用方伪造任意 `extras.allowHosting = true` 调未授权接收方 → 仍被主进程拦住待真人确认，未确认前接收端收到 `0` 字节；
  - 反例 2（本机免打断）：ComfyUI `http://127.0.0.1:8188/upload/image` 首次上传图片或视频 → `0` 弹窗直接上传；
  - 反例 3（纯文生不误拦）：节点无任何本地参考素材（纯文字生图/生视频），即使刚接新供应商 → `0` 素材上传隐私弹窗。

---

## 第二部分：S-G（D4-17）「自动」写明模型真名 + 默认模型 4 行收 2 行

### 1. 全仓 8 处「自动 / 默认模型 / 选择模型」实查普查表

通过全仓检索与真机截图（见 `current-app/` 下 4 张展开态真窗图）核实，当前同一个「没手动钉死模型时按推荐/默认选谁」的概念，在全仓散落成 **5 种不同叫法** 且全部隐去了真实模型名：

| # | 界面与代码位置 | 当前显示文案（真窗实拍） | 创作者当下的真实卡点 | S-G 收口后统一表现 |
|---|---|---|---|---|
| 1 | **设置 › AI 策略 › 新建卡片默认模型**<br>`src/workbench/settings/DefaultGenerationModelsSection.tsx:29-95` | 4 行（`文生图 / 图片编辑 / 文生视频 / 图生视频`），均显示 **`自动选择 ▾`** | ① 不知道「自动选择」到底选了谁；② 底层 `defaultGenerationModelOptions.ts:20` 明明只分 `image` 和 `video` 两池，却让用户配 4 行。 | 收成 **`图片`** 与 **`视频`** 2 行；未固定时直接显示 **`自动 · GPT Image 2.6 Flare ▾`** / **`自动 · Seedance 2.5 ▾`**（菜单首行右侧带 `✓`）。 |
| 2 | **创作 › 分镜表行 & 锚点卡底栏**<br>`src/workbench/creation/storyboard/shotRow/StoryboardComposerParams.tsx:143-163` | 闭合胶囊写 **`默认模型 ▾`**（展开菜单第 2 行小字才有 `跟随设置里的默认 · 现在是 ...`）；顶部写 **`按模型默认 ▾`** | 不点开菜单就看不出这镜跑什么模型，且因未绑定具体档案，**画幅比例与时长胶囊整排消失**，逼人手动重选模型。 | 闭合胶囊直接写 **`自动 · Seedance 2.5 ▾`**，并立即按该模型档案渲染方式、画幅（`16:9`）与时长（`5s`）胶囊。 |
| 3 | **生成画布 › 图片/视频节点底栏与菜单**<br>`src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts:167-195` & `nodeModelArchetype.ts:25-53` | 新卡出生即把 `chooseDefaultModelOption` 挑出的模型直接钉进 `meta`，下拉菜单里没有「自动」首行，且未优先读目录推荐声明 | ① 目录首项若非主力推荐模型容易挑偏；② 一旦手改过就回不到「跟随默认」。 | 优先读目录显式推荐（图片 `GPT Image 2.6 Flare`、视频 `Seedance 2.5`）+ 健康避让；菜单首行统一提供 **`自动 · <推荐模型>`** + 右侧 `✓`。 |
| 4 | **常驻 Agent 面板底栏模型钮**<br>`src/workbench/ai/v4/useAgentPanelV4Data.ts:221` | 未手动挑过时显示 **`选择模型 ▾`**（`Choose a model`） | 让创作者误以为还没连好大脑不能发消息，多点一次菜单确认。 | 未手选时直接显示默认大脑真名 **`自动 · DeepSeek V4 Flash ▾`**（对齐 `ModelSurfaces M5-brain`）。 |
| 5 | **常驻 Agent 弹层 `V4ModelPopover`**<br>`src/workbench/ai/v4/agentPanelV4ModelRows.ts:93-118` | 弹层内嵌 `图片默认 [自动选 ▾]` / `视频默认 [自动选 ▾]` | 与设置页形成第二个编辑家（词还少一个字叫「自动选」），且当时只写 `text_to_image` / `text_to_video` 导致改图默认不同步。 | 对齐 `ModelSurfaces M5-brain` `brain.policy-pointer`：删掉弹层内重复下拉，页脚一行只读摘要指路 **`出图：自动 · GPT Image 2.6 Flare · 视频：自动 · Seedance 2.5 → 设置 › AI 策略 ↗`**。 |
| 6 | **画布拉片分镜表 `ShotTable` 拆解栏**<br>`src/workbench/generationCanvas/nodes/shotTable/deconstructLegChoice.ts:38` | `读图 [自动选择 ▾]` · `转写 [自动选择 ▾]` | 开拆前不知道读图会调哪个多模态大模型。 | 直接写明 **`自动 · Gemini 3.5 Flash ▾`** / **`自动 · 本机 Whisper ▾`**。 |
| 7 | **Agent 提案卡与付费确认模型兜底行**<br>`src/workbench/ai/resident/residentToolDisplay.ts:515` & `spendCardModelLine.ts:16` | `按默认模型` / `默认模型` | 让创作者对一个没写名字的「默认模型」点确认花钱。 | 解析为当时实际生效的模型名 **`自动 · Seedance 2.5`**。 |
| 8 | *（明确划出范围外）* **接入向导高级协议探测**<br>`src/ui/onboarding/OnboardingWizardAdvancedFields.tsx:123` | `使用自动选择`（探测 OpenAI / Anthropic / Gemini 接口协议格式） | 属于 HTTP 报文协议自动识别，**不是模型选择**。 | **保持不动**（或仅把词条文案微调为更准确的「自动识别协议」），不混入默认模型逻辑。 |

### 2. 与既有拍板清单 `ModelSurfaces.board.json` 的对齐说明

- **完全一致继承 `M5-brain`（`ModelSurfaces.board.json:1611-1713`）**：未手选对话大脑默认走 `DeepSeek V4 Flash`，且 `V4ModelPopover` 页脚改为只读指向 `设置 › AI 策略`（彻底遵守 `§1.0` 一个东西一个家）。
- **明确升级替换 `M6-ai-policy` 中的 `policy.defaults`（`ModelSurfaces.board.json:1715-1754`）**：`11-07` 清单当时暂画了 4 行（`文字出图 / 改图 / 文字出视频 / 图片出视频` + `跟上次一样 · 某模型`）；随后用户在 `11-16`（`D4-17`）与 `11-24`（`#7124988403`）要求探索**「4 行收 2 行 + 自动写明推荐模型」**。用户拍板本稿 `G1` 后，实现同提交更新 `ModelSurfaces.board.json` 的 `policy.defaults` 条目，确保 `check:board-parity` 零冲突。

### 3. 老用户 4 行配置无损兼容真值表（零静默覆盖）

底层存储契约 `electron/shared/contracts/generationModelDefaultsContract.ts` 继续保留 `byTaskKind` 四键读取能力，升级**绝不抹除或静默篡改**老用户已存偏好：

| 老用户升级前盘上 `byTaskKind` 状态 | 升级后「设置 › AI 策略」显示 | 升级后实际生效行为 | 用户在 UI 新选一项后怎么写盘 |
|---|---|---|---|
| 空对象 `{}`（从未改过默认） | `图片`：`自动 · GPT Image 2.6 Flare`<br>`视频`：`自动 · Seedance 2.5` | 图/视频全部走目录推荐 + 健康避让 | 选具体模型 → 同时写 `text_to_image` + `image_edit`（或视频双键）；选「自动」→ 删双键 |
| 同类双键一致，或只设过 `text_to_image`（如经旧 Agent 弹层设过） | 直接显示该已设模型 `Seedream 5.5 · APIMart` | 文生与带参考生成统一使用该模型 | 同上，双键保持同步 |
| **老用户曾把 `text_to_image` 与 `image_edit` 手动设成两个不同模型** | 行内诚实显示：**`已分别指定：文生图 GPT Image 2.6 Flare · 改图 Seedream 5.5 [统一 ▾]`** | **用户不碰它就 100% 原样保留**：无参考图卡读 `text_to_image`，挂参考图卡读 `image_edit` | 只有当用户主动点开并选定一个模型（或「自动」）时，才将双键合并为该新选择 |
| 手动固定的模型已被禁用或供应商已断开 | 下方显示 `--nomi-warning-ink` 提示：`原固定模型当前不可用，暂回退为 自动 · Seedance 2.5` | 新卡不卡死在灰按钮上，自动回退可用推荐；重连供应商后原固定偏好自动恢复 | 用户可保留等待重连，或手动重选 |

### 4. S-G 九宫格设计卡（`★0`–`★9`）

- **★0 先查别人（≥3 条）**：
  1. `LibTV`（同表面 `same-surface`，`https://www.liblib.tv/`，截图 SHA-256 `3277cb75d501b64abace1464bb30cd4f6a0ffad828d9071ac6e00c0104dc57b6`，核验日 `2026-11-24`）：生成栏直接亮出具体模型名 `SD 2.5` 与 `16:9 · 1080P · 15s`，不用「默认模型」遮住型号与参数 → 影响决定：分镜行与画布节点未固定模型时直接写明 `自动 · <推荐模型>` 并展开参数胶囊。
  2. `TapNow`（同行，`https://docs.tapnow.ai/`，截图 SHA-256 `407663b900c5fde7cc49fe7b085115f29b24434b7fb117ada2541144bee42146`，核验日 `2026-11-24`）：按图片/视频两类管理默认模型，挂入首帧或参考图时自动切换输入模式 → 影响决定：默认模型设置从 4 行收成 `图片 / 视频` 2 行。
  3. `Runway`（同行，`https://app.runwayml.com/`，核验日 `2026-11-24`）：新会话直接落到当前推荐主力模型并标明真名与积分单价 → 影响决定：付费确认卡与提案卡禁止出现匿名「默认模型」。
- **★1 目标与可证伪量具**：
  - 全仓用户可见生成入口出现裸词 `自动选择 / 自动选 / 默认模型 / 选择模型`（不带解析模型真名）的次数 = `0`（量具：i18n 与渲染快照门岗断言）；
  - 设置页默认模型配置行数从 `4` 降为 `2`（减少 50% 配置项）；
  - 分镜表新建镜头调整画幅比例所需前置「先手选一次模型」点击数从 `2` 降为 `0`（量具：真窗分镜行直出画幅胶囊断言）。
- **★1c 老用户怎么过**：见上方无损兼容真值表，分设双值零静默覆盖。
- **★2 唯一主人（P0/P1）**：推荐模型解析收口为一个纯函数（读目录 `recommended` 声明 → 用户供应商偏好序 → `modelHealthMemory` 近 24h 连败避让 → 首个可用模型），设置页、分镜行、画布底栏、Agent 底栏、提案卡共用同一解析出口，删掉各处私自拼凑的 fallback 文案。
- **★3 同步加载与不乱跳**：严格保留 `generationModelDefaultsLoaded()` 同步门（偏好未从主进程装好前不提前钉错模型；已跑过或已手选过模型的卡片永不被后台默认变更改写）。
- **★4 数据与窄窗边界**：28–32 字符长模型名（如 `自动 · Doubao Seedance 2.5 Pro Preview`）在 `1100×690` 窄窗（分镜中栏 `536px`、Agent 停靠栏 `340px`）下仅模型胶囊内部单行省略，右侧画幅时长与「生成」主按钮 `flex-shrink: 0` 零挤压。
- **★7 性能预算**：复用启动后常驻内存的 `useComposerResidentData()`，点卡与开菜单 `0` 异步 IPC 等待。
- **★9 动手前验收清单与反例**：
  - 正例 1：连接 APIMart 后未改任何设置 → 设置页显示 `图片：自动 · GPT Image 2.6 Flare`、`视频：自动 · Seedance 2.5`；分镜新行直接显示 `自动 · Seedance 2.5 ▾` 与 `16:9 · 5s ▾`；Agent 底栏显示 `自动 · DeepSeek V4 Flash ▾`。
  - 正例 2：老配置盘里 `text_to_image = GPT Image 2.6 Flare` 且 `image_edit = Seedream 5.5` → 打开设置页显示「已分别指定」摘要，不打开设置直接新建空图卡与带参考图卡仍各自按原两键生效。
  - 反例 1（未连任何模型）：全新空配置未接任何供应商 → 绝不显示假「自动 · 某模型」，诚实显示 `未连模型 · 去接入`。
  - 反例 2（停用模型不静默吞没）：手动固定的模型被隐藏或供应商断开 → 设置页显示黄色回退提示，不静默抹掉用户的固定记录。

---

## 交付物清单（全部位于 `mockups-sf-sg/` 目录内）

1. **`00-SF-SG-SUMMARY.md`**：本总览文档（普查表、方案权衡表、老数据兼容表、双九宫格设计卡）。
2. **`current-app/`（11 张今日真机 Electron 隔离窗口实拍截图 + `README.md` SHA-256 校验表）**：
   - `current-settings-ai-top.1440x900.zh-CN.light.png` / `.en.dark.png`（现状 AI 策略顶部 4 行默认模型）
   - `current-settings-default-models-open.1440x900.zh-CN.light.png`（现状「自动选择」下拉展开）
   - `current-settings-upload-guidance.1440x900.zh-CN.light.png`（现状「素材上传通道」+ 自定义 Relay 展开 +「允许第三方公共临时托管」开关）
   - `current-agent-choose-model.1440x900.zh-CN.light.png` & `current-agent-model-popover.1440x900.zh-CN.light.png`（现状 Agent 底栏「选择模型」与弹层「自动选」两行）
   - `current-storyboard-default-model.1440x900.zh-CN.light.png` & `current-storyboard-model-menu.1440x900.zh-CN.light.png`（现状分镜表「默认模型 ▾」闭合藏参数态与展开态）
   - `current-canvas-image-model-menu.zh-CN.light.png`、`current-canvas-video-model-menu.zh-CN.light.png`、`current-canvas-unconfigured.1440x900.zh-CN.light.png`
3. **`S-F-new-third-party-ask/`**：
   - `sf-options-and-states-zh-light.html` + `.png`（`1440×900` 中文浅色：三方案对比 + 通道真值表 + 画布公共图床警告卡 & 常规长域名中转卡 + Agent §1.0 单问题槽 + 设置页授权列表与撤回态 + 本机回环免问态）
   - `sf-en-dark.html` + `.png`（`1440×900` 英文深色全状态）
   - `sf-narrow-1100x690.html` + `.png`（`1100×690` 窄窗工作台整屏验证）
   - `NewThirdPartyAsk.draft-board.json`（含 R10–R16 字段、`marked: "exploration"`）
4. **`S-G-auto-named-model/`**：
   - `sg-overview-and-states-zh-light.html` + `.png`（`1440×900` 中文浅色：方案对比 + 7 处盲自动收口表 + 设置 4→2 行展开菜单右侧 `✓` + 老用户双值无损保留/停用回退/未连空态 + 画布 28 字符长名压力态 + 分镜行前后对比 + Agent 底栏与只读指路页脚）
   - `sg-en-dark.html` + `.png`（`1440×900` 英文深色全状态）
   - `sg-narrow-1100x690.html` + `.png`（`1100×690` 窄窗分镜表 536px + 停靠 Agent 340px 整屏验证）
   - `AutoNamedModel.draft-board.json`（含 R10–R16 字段、`marked: "exploration"`）
