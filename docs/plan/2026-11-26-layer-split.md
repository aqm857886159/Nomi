# 设计卡：图层分离（S-E，PR1）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：图层分离（改图 ▾ → 图层分离 → 一次花钱拿回可编辑图层）   线/负责人：I-SE-layer-split（协调派）   类别：[花钱][新界面]
```

- 拍板稿：Claude Design 画布 S-E（https://claude.ai/artifact/BD3qvonT9rkWCqWsycKLfL 第 13 版），用户 11-26 拍板，决策 D-1126-sdse-libtv；冲突裁定 D-1126-se-rulings（C-E1～C-E10）。
- 拆两个 PR（D-1126-se-split-prs）：**本卡覆盖 PR1**——能力声明、请求与返回、改图入口与派生、生成框分离格与约价、落地成图层、画板里删层后还能画、缺模型指路。画板图层面板的位置 / 默认开 / 多选 / 调前后 / 虚拟列表 / 新画板不预建「图层 1」留 **PR2**（PR1 合入后另起任务书）；拆出成节点（extract）、Agent 指路、没拆成的整句提示留 **I-SE 后续**。下面凡是 PR2 / 后续的格都写明，不当本 PR 的承诺。

## ★0 先查别人

- LibTV 图片节点改图菜单（拍板画布 https://claude.ai/artifact/BD3qvonT9rkWCqWsycKLfL 的 LibTV 裁图，清单 `priorArt` 记 sha256 5cb9410d…，2026-11-26 看）· 「图层分离」在改图菜单里，点了在旁边派生一个新节点，生成框里选层数，出结果后在画板里按层编辑 · **确认了**入口位置（「生成新图」组第一项）、名字「图层分离」、派生而不是原地改、结果进画板编辑。
- APIMart Seedream 5.5 生成文档（https://docs.apimart.ai/en/api-reference/images/seedream-5-5/generation.md ，本地摘录 docs/models/capabilities/seedream-5-5.md:25）· `layer_decomposition: true` + `layer_decomposition_options { max_images 2–100（默认 30，含底图，是上限）, text_recognition }`，返回 `layers[i] { z_index, name, bounding_box }`，「resize each layer to the box's w × h and place it at (x, y)」，按输出张数计费 · **确认了**层数范围与默认 30、识别文字是一个开关、约价按「层数上限 × 单张价 + 输入图费」；**改了**落位：文档没写死每层是裁好的小图还是整幅透明图，所以两种都要落对（★6）。
- APIMart Seedream 5.0 Pro 文档（https://docs.apimart.ai/en/api-reference/images/seedream-5-0-pro/generation.md ，本地 docs/models/capabilities/seedream-5-pro-apimart.md:25）· 只有开关，固定「底图 + 最多 16 张透明层」，不能选层数、不识别文字 · **改了**：5.0 Pro 的分离格写死「最多 17 层」、不印约价（价目算不出）、标未验证。
- Leafer 编辑器控制点（https://www.leaferjs.com/ui/plugin/in/editor/config/control.html ，类型 node_modules/@leafer-in/editor/types/index.d.ts:269 `readonly lockRatio: boolean`）· 选中元素自带四角手柄，`lockRatio` 锁等比 · **确认了**不自写手柄（C-E1）：今天 whiteboardSceneRender.ts:275、WhiteboardLeaferCanvas.tsx:331 已开 `lockRatio`，真窗口拍到小图层选中有四角、拖角等比（runB/C02、C03）；自写的 whiteboardCanvasGeometry.ts:336 `isPointNearSingleAssetResizeHandle` 只管「角点附近不起框选」，不是第二份手柄，保留。
- tapnow 画布改图（https://docs.tapnow.ai/en/docs/canvas/generate-and-edit-video）· 改图类动作都派生新节点、原节点不动 · **确认了**派生节点只建好、连好、不自动扣费（设计卡「一键 / 快捷默认只做准备」）。
- 出口：docs/engineering/design-card.md:26（能力不可用要给一步可走的路，只灰掉说原因不算）· 别人缺能力时给「去接入」的路而不是灰掉 · **改变了**我们的缺模型入口：不灰，第二行点名去接哪一家（按内置目录算出），点了打开它的接入页（D-1126-se-missing-model-guide）；发送口那道「线缆拆不了就不发」的拒绝（taskParams.ts `layerSplitWireMissing`）给的出路是「换成能拆图层的模型」。

## ★1 用户怎么用

当我手上有一张满意的图、只想挪一下标题字或去掉一个人时，我想把它拆成一层一层，以便只改那一层、不重画整张。

1. 选中有结果的图片节点 → 浮条「改图 ▾」→「生成新图」组第一项「图层分离」（叠层图标）。
2. 右边派生一个新图片节点、一条连线，参考是原图，提示词空；这一步 0 次请求、不花钱。
3. 生成框那一格是「图层分离 · 30 层 · 自动」；可以点开改层数（8 / 16 / 30 / 自定义 2–100）、清晰度、识别文字。发送键印约价。
4. 点发送 → 走现成的通用付费确认 → 花一次钱。
5. 回来后节点画面是各层叠好的合成图，下方一行「N 层」；浮条「画板」的悬停提示变成「在画板中编辑图层」。
6. 打开画板：图层面板里是「背景」「底图」和每一层（名字取接口给的 name / 识别出的字）；能显示 / 隐藏、删、选中拖角等比缩放；删了层以后画笔照样能画（每一笔自成一层）。
7. 「完成」→ 本节点多一版新图（今天的行为）。

不做什么：不在原节点上原地拆；不自动扣费；派生不预先问价目以外的东西；不把拆出的层自动变成节点（后续）；Agent 发起的图层分离 PR1 不做专门指路（后续）。已知坑：①文档没写死返回形状（★6）；②层数是上限，可能拆得更少；③「自动」清晰度按高档计价，约价偏保守。

真实任务（2–3 条）：
- 海报图（标题字 + 人物 + 背景）拆层后挪标题——替身走查 `tests/ux/layer-split.walk.mjs`（替身回底图 + 2 层、一层带字），真素材未跑。
- 分镜帧拆层、删掉一层后补一笔、完成出新版——同上走查 LS07 / LS08。
- 仓库真 AI 镜头帧（`video-ai-shot-640x360` 第 2 秒）2 层 1K 真拆一次——`tests/ux/layer-split-real.paid.mjs`，只跑了免费演练；真付费由协调跑。

指标（目标 → 信号 → 指标 → 量具）：
- 主：创作者一次花钱就拿到能编辑的图层 → 图层分离任务落地成带 `raw.layerSplit` 的结果 → 落地成功 / 发送次数 → **未验证：缺量具**（intake:radar 只分 image / image-edit，不分方式；PR1 不加遥测）。基线无，目标不设数。
- 质量：每层落在接口说的位置 → 两种返回形状都落对 → 单测比例 100% → `layerSplitBoard.test.ts`、`landTaskResults.test.ts`；真形状由付费走查 `docs/evidence/2026-11-26-layer-split/paid-shape/report.json`（协调跑后才有）。
- 护栏 1：派生不花钱 → 派生时请求数 → 0 → `deriveFromNode.run.test.ts`「★9-1」+ 走查 `vendor-requests.json`。
- 护栏 2：普通改图报文一字节不变 → `apimartDocsBatch1Wire.test.ts`「普通改图的报文一个字节不变」、`officialWire.bodies.snapshot.json`。
- 护栏 3：100 层画板打开 ≤ 1 s → perf 场景 `inline-whiteboard-split-100-open`。
- 新界面一句话 brief：「一张图拆成能单独改的层，像 PS 的图层，但只要点一下」。新手：不知道层数是上限，默认 30 直接发，看到「层数多就贵」提醒才意识到花费；老手：先调层数控钱、开识别文字给文字层起名。每步「预期 → 实际」记在走查日志（`client.log` + 每步截图）。

### ★1b 连带界面

- 节点下方状态行：「N 层」/「Layers N · incl. base」，读屏「已拆成 N 层（含底图）」。
- 浮条「画板」悬停提示：拆过的节点是「在画板中编辑图层」，其余照旧。
- 发送口拒绝（线缆拆不了）：「这次没有发出：当前接入的这一家拆不了图层，发出去只会是一次普通改图。请换成能拆图层的模型（如 APIMart 的 Seedream 5.5）。」
- 落地失败：「图层已经拆好，但没能存进项目，可以重新取回」（走现成的取回）。
- 任务中心 / 通知：和普通图片任务同一套，不新增文案。
- Agent 确认卡：Agent 发起的图层分离，确认卡上**不显示约价**——确认卡对所有模型都不印金额（已知差异，写进 PR）。

### ★1c 老用户

- 老项目画板里已有的空「图层 1」原样保留，不迁移、不删；删别的层后当前层仍回到它（`fallbackActiveLayerId`，单测「老项目的『图层 1』原样保留」）。
- 老画板数据一字节不改：读画板只多了「结果带 `raw.layerSplit` 标记且这一版没有草稿时读结果自带的白板」一支，老结果没有这个标记，走原路（`readWhiteboardEditingState`）。
- 普通画板唯一的行为变化：画笔**总能落笔**（每一笔本来就自成一层）。今天当前层被删 / 锁住时画笔会落不下去，这是缺陷（真窗口 runB/C04）；橡皮擦仍要当前层在且没锁。
- 新开画板仍预建「图层 1」：不预建留 PR2，本 PR 不动。
- 退回上一版：新结果只多了 `raw.layerSplit` / `raw.whiteboardState`，上一版不认这两个键，节点按普通图片打开（画面是合成图），不坏。
- upgrade-path（节点 / 方式这一半）：真实 0.24.1 旧数据 `tests/fixtures/old-user-data/canvas/v0.24.1-mode-nodes`（25 个真节点）过 `canvasModeOldUser.{requestBody,target,rollback}.test.ts`（73 条全过，本分支）——5.5 / 5.0 Pro 档案多了图层分离方式后，老节点的方式、请求体、回退都不变。
- 画板这一半：**未验证**——`tests/fixtures/old-user-data/` 里没有带画板的旧项目；本 PR 不改存量画板数据的形状，只读，旧形状由 `whiteboardStateOps.test.ts` 的老「图层 1」用例覆盖（手写形状，按规则不算真实旧数据，照实标未验证，写进 PR 已知差异）。

## ★2 谁说了算

| 概念 | 唯一 owner | 消费者 |
|---|---|---|
| 「图层分离」这件能力（方式、层数 / 清晰度 / 识别文字键、线缆发不发得出） | electron/shared/modelArchetypes/modeForInputs.ts 的图层分离段（`LAYER_SPLIT_MODE_ID`、`layerSplitWireReady`、`requestedLayerCount`；一层的形状 `TaskResultLayer` 在 electron/shared/contracts/taskResultLayer.ts）；声明在 seedream55.ts / seedream5Pro.ts 的 `layerSplit` 方式 | 入口可用判断（deriveFromNode）、生成框（composerHeadlineSummary / ParameterControlBody）、发送口拒绝（taskParams.ts）、约价（vendorPriceRequest.ts） |
| 请求翻译（层数、识别文字进选项） | electron/catalog/paramTranslate.ts `layerDecompositionOptions` | apimartImages.ts 线缆 op |
| 「这笔结果是一组图层」的读法 | electron/tasks/taskLayerReading.ts `readTaskLayers` / `layersForLandedResult`（runtime.ts:257 唯一调用） | TaskResult.assets 按下标平行送到渲染层，渲染层只认 `TaskResultLayer` |
| 图层落成白板 | layerSplitBoard.ts `buildLayerSplitBoard`（landTaskResults.ts 唯一调用） | landTaskResults ← catalogTaskActions.ts、recoverTaskActions.ts（发送与找回同一条落地） |
| 结果上的图层标记 | whiteboardState.ts `readLayerSplitMark` / `LAYER_SPLIT_RAW_KEY` | 「N 层」状态行、画板悬停提示、打开画板读哪份白板 |
| 约价键 | concept-owners `spend.price-estimate-keys` → vendorPriceRequest.ts `classifyPriceKey`（本次改动经协调 #1687 消息授权） | 发送键约价 |
| 约数的口径（「≤」「≈」） | 价格合同 electron/shared/contracts/vendorPricePreview.ts `VendorPriceBasis`（主进程算价时打上：图层分离一支打 `upper-bound`）；印法只在 sendCostFormat.ts `sendCostPillText` / `sendCostDescription` | 发送键（键上「≤」、悬停「最多约…按层数上限估」、单位切换读屏）；「层数多就贵」那句取同一出口的裸数（layerSplitComposerState.ts `layerSplitReminderAmount`） |
| 缺模型指路 | concept-owners `canvas.capability-unavailable-guide` → capabilityGuide.ts | 改图菜单那一行 |
| 画板当前层回退 / 落笔 | whiteboardStateOps.ts `fallbackActiveLayerId` / `canDrawOnLayer` / `commitStrokeToState` | WhiteboardDrawingTool、WhiteboardLeaferCanvas |

- 「1」靠什么保持：别处拿不到原料——渲染层拿不到供应商原始响应，只拿 `TaskResultLayer`；发送口与入口问同一句 `layerSplitWireReady`，「入口说能拆、发出去却是普通改图」从结构上做不出来。
- 门表（`node scripts/door-map.mjs`，本分支）：deriveFromNode ← useQuickActionHost.ts:93；composerYieldPick ← InlineParameterBar.tsx:362；WhiteboardDrawingTool ← InlineWhiteboard.tsx:354；useWhiteboardBoxSelection ← WhiteboardLeaferCanvas.tsx:599；buildLayerSplitBoard ← landTaskResults.ts:52；landTaskResults ← catalogTaskActions.ts:685、recoverTaskActions.ts:171；layersForLandedResult ← runtime.ts:257；commitStrokeToState ← WhiteboardDrawingTool.tsx:219。
- 到点以后：图层分离就是一个普通 Run，任务状态归主进程；重启 / 断连按 main 现有找回路径（#1642）走，不另写恢复。
- 不靠「东西不见了」猜意图：派生是显式点击，发送是显式点击。

共享组件影响面（S-E-table「共享组件影响面」逐处，写改后会怎样）：

| 组件 | 本 PR 改了什么 | 改后别处会怎样 |
|---|---|---|
| 画板图层面板（WhiteboardDrawingTool 内联分支，单条挂载链 InlineWhiteboard ← NodeInlineWhiteboardHost ← BaseGenerationNode） | 只把落笔改成调 `commitStrokeToState`（行为同今天）；面板位置 / 多选 / 行名取法没改（PR2） | 所有画板：面板位置不变；删层后画笔能画（修了今天的落不下笔）；老「图层 1」照旧 |
| WhiteboardEditingToolbar / ToolbarActionPanel | 未改 | 无影响；同文件 `ToolbarActionMenu` 未碰 |
| WhiteboardLeaferCanvas / whiteboardSceneRender / geometry（卡片预览经 whiteboardStatePreview.ts:39） | 落笔判断换成 `canDrawOnLayer`；`renderWhiteboardStatePreview` 多一个可选 `pixelRatio`（只有落地合成图传） | 卡片预览不传参数 = 今天的像素比，不变；编辑器手柄 / lockRatio 未改 |
| whiteboardState.ts / types | 加图层标记读法；`readWhiteboardEditingState` 多一支（只对带标记的结果） | 老结果无标记 → 原路；新画板仍预建「图层 1」 |
| ImageQuickActionsToolbar / quickActionCatalog（+ devlab 两处） | 「生成新图」组加一项、`QuickActionRequirement` 加 `layer-split` | 其它快动作不变；devlab 用同一份目录，自动多一项 |
| deriveFromNode（useQuickActionHost、isDerivedPromptReady、DerivedReadyBadge、sameCapabilityAlternative） | 新增一种派生（分离方式 + 空提示词） | 空提示词的分离节点仍算「已备好」（只对分离方式放开）；其它派生行为不变（`deriveFromNode.run.test.ts` 原有用例全过） |
| InlineParameterBar / composerBarYield / composerHeadlineSummary（NodeParameterControls、StoryboardComposerParams、devlab） | 分离格与让位档（C-E5：先退「自动」、再退层数、最后只剩图标） | 分镜行与参考卡不出现分离方式，零影响（`composerBarYield.layerSplit.test.ts` 守）；原有让位走查 composer-bar-yield-goals / fit-goals 本机重跑 |
| 发送键约价格式（sendCostFormat.ts；调用方：useSendCost.ts → NodeGenerationComposer 的 ComposerSendButton、SendCostUnitMenuButton） | 价格合同 `basis` 多一个值 `upper-bound`：键上三种单位都印「≤」，悬停换成上限那一句（中英各 3 条，进 check-i18n-no-cost-claims 逐字登记） | 只有带 `upper-bound` 的约价变样（今天只有图层分离）；别的模型的约价没有这个口径，键上、悬停、单位菜单一字不变（`sendCostFormat.test.ts` 原有用例全过） |
| GroupFrame | 未改 | 无影响 |
| 版本栈 | 未改（「完成」出新版沿用今天） | 无影响；版本角标仍是 ≥2 版才出 |

## ★3 一致与复用

- 以前定过的：D-1126-sdse-libtv（照 LibTV 的交互 / 名字 / 图标，逻辑基于我们的中转站）；D-1126-se-rulings；D-1126-se-split-prs；D-1126-se-missing-model-guide；D-1126-se-default-open-B（PR2 用）；「一键 / 快捷默认只做准备，不自动扣费」（design-card.md 两道额外问）；界面里约价可以印、算不出不印、不印 0（money-in-ui 11-15）。都还算数。
- 三条路：①沿原方向——在现有改图派生、现有方式 / 参数体系、现有通用付费确认、现有画板上加「图层分离」方式；②换做法——另起一个「图层编辑器」面板 / 专用节点类型；③删掉——不做。选 ①：拍板稿就是这个形状，另起编辑器会出现第二个家（违反 §1.0），删掉违背用户拍板。
- 复用：派生用 `deriveFromNode`；方式与参数用档案 `ArchetypeMode` + `effectiveModeParams`；请求翻译用 `PARAM_TRANSFORMS` 注册表；返回解析用 `responseParsing` 的 `mappingCandidates` / `pathValues`；落地用 `landTaskResults`（发送与找回同一条）；合成图用画板自己的 `renderWhiteboardStatePreview`；手柄与等比用 Leafer editor `lockRatio`；缺模型指路用 `capabilityGuide`；付费确认用现成通用确认。自写的只有领域胶水（层 → 白板摆放、图层标记），在画布 / 素材领域目录内。

## ★4 全状态

| 状态 | 用户看到什么 |
|---|---|
| 空（刚派生） | 提示词占位「描述希望拆分的图层，留空将自动识别并拆分」；提示词可空，发送键亮、印「≤ 约价」（悬停「最多约 X 积分…按层数上限估，实际按拆出的层数结算」）；格子「图层分离 · 30 层 · 自动」 |
| 0 张图（参考被拿掉） | 发送键灰，悬停「先放一张要拆的图」 |
| 2 张图 | 发送前一句「图层分离一次只拆 1 张：拆第 1 张，第 2 张这次不用。」（单测覆盖，真窗口难造） |
| 层数 ≥ 50 | 「层数多就贵：最多按 N 张图扣，约 X。」只提醒，不拦 |
| 加载 | 今天的等待面和状态条，不画假进度；拆完才出「N 层」 |
| 成功 | 合成图 + 「N 层」；画板里底图 + 各层 |
| 部分成功 | 拆得比上限少是正常（上限语义），照实显示 N |
| 失败 | 今天通用的失败面（板上「没拆成：…」整句是后续，不在本 PR） |
| 落地失败 | 「图层已经拆好，但没能存进项目，可以重新取回」 |
| 取消中 | 普通 Run 的取消，同今天 |
| 过期 | 上游链接过期导致下载不到 → 落地失败那一句 + 现成取回 |
| 能力不可用（没有能拆图层的模型） | 菜单项**不灰**，第二行「还没有能拆图层的模型 · 接入 APIMart 即可用」（厂商名按内置目录算出；算不出 →「点这里去添加」），点了打开 APIMart 接入页 |
| 能力不可用（线缆拆不了） | 发送口拒，出那句「这次没有发出…请换成能拆图层的模型」 |
| 约价算不出（5.0 Pro / 价目缺） | 发送键不印数字、不印 0 |
| 最大值 / 最长文字 | 100 层：「Layers 100 · incl. base」；层名过长截断（面板行，PR2 再核）；1100×690 窄窗：格子按 C-E5 让位 |

文案全部走 i18n（zh / en）；不写免费 / 不计费类断言（`check:i18n` 过，`creditsAmount` 进精确白名单）。

## 5 中途表

| 状态 \ 打断 | 停 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 派生后、未发送 | 无可停 · 不扣 · — | 节点随项目保存 · 不扣 · 画布 | 无影响 · 不扣 · — | 节点在 · 不扣 · 画布 | 每点一次多一个派生节点 · 都不扣 · ⌘Z 一次撤一个 |
| 发送确认中 | 取消确认 = 不发 · 不扣 · — | 不发 · 不扣 · — | 确认后发送失败按普通 Run · 不扣（没发出） · 任务中心 | 不发 · 不扣 · — | 现成通用确认（同普通生成） · 确认一次扣一次 · 任务中心 |
| 拆图中（上游在跑） | 普通 Run 取消 · 扣不扣看上游（同今天） · 任务中心 | 重开按现成找回取结果 · 已扣不重扣 · 任务中心 | 现成取回重试 · 已扣不重扣 · 任务中心 | 同关窗（#1642 找回路径） · 已扣不重扣 · 任务中心 | 同普通生成的发送键行为（未针对图层分离单跑，unverified） · 每发一次扣一次 · 任务中心 |
| 落地中（下载各层、拼合成图） | 不可停（秒级） · 已扣 · — | 找回路径重新落地（recoverTaskActions 走同一条 landTaskResults） · 不重扣 · 任务中心 | 下载失败 →「图层已经拆好…可以重新取回」 · 不重扣 · 节点 | 同关窗 · 不重扣 · 任务中心 | — |
| 画板编辑中 | 关画板 = 今天的草稿行为 · 不扣 · 节点 meta | 草稿按结果身份存（今天行为） · 不扣 · 节点 | 无影响 · 不扣 · — | 草稿在 · 不扣 · 节点 | 「完成」连点 = 今天行为 · 不扣 · 版本栈 |

证据：派生 / 发送 / 关窗冷重启找回 / 落地 / 完成走查 `tests/ux/layer-split.walk.mjs`（重启找回 +0 POST）；后台结案、重启找回与首次落地失败后点「重新取回」三种路径由 `electron/capabilityCore/layerSplitRecovery.test.ts` 覆盖。

## 6 外部数据与失败

| 外部来源 | 规范 | 我们的偏差 | 失败时用户看到什么 |
|---|---|---|---|
| APIMart Seedream 5.5 请求 | https://docs.apimart.ai/en/api-reference/images/seedream-5-5/generation.md | 清晰度用 `size` 档（auto / 1K / 1.5K / 2K），和普通改图的比例 `size` 分开存（`layer_size` 键）；不发 background / resolution / 比例 | — |
| APIMart Seedream 5.0 Pro 请求 | https://docs.apimart.ai/en/api-reference/images/seedream-5-0-pro/generation.md | 只发开关，不发选项 / size（Pro 收哪些 size 档没查到，**unverified**） | — |
| 返回 `layers[i]` | 同上文档 | z_index 越大越在上（文档没写方向，**unverified**）；每层是裁好的小图还是整幅透明图没写死 → **两种都落对**：和底图一样大 = 铺满，其余按 bounding_box 缩进框，读不到尺寸按框（**unverified**，等协调真付费那一跑定案） | 层描述与图数对不上 → 挂取回解析阶段（可找回），不当普通多张落 |
| 计费 | 同上文档 Billing | 约价 = 层数上限 × 高档单张价（自动按高档）+ 一次输入图费；5.0 Pro 不印；按输出张数实扣（**unverified**） | 算不出不印数、不印 0 |
| 当前接入的渠道线缆 / 自定义请求脚本 | 内置目录与模型自定义脚本 | 线缆 body 不读 `layer_decomposition` 或该方式被自定义请求脚本接管（脚本返回拿不到图层描述）= 拆不了 | 入口按不可拆处理并写明原因；发送口与自定义脚本派发口在扣费前拒发并说明 |
| 底图读不出尺寸 | — | — | 落地失败那一句，可重新取回 |

未知失败不甩给用户的 key：除上表外的失败走普通 Run 的错误面。

## ★7 性能

1. 新增操作：浮条菜单多一项（点开菜单）；派生（点一次）；生成框分离格（点开参数面板）；打开拆过的画板（最多 100 层）。
2. 最坏规模：API 上限 max_images 100（含底图）→ 底图 + 99 层，面板 101 行。
3. 预算：打开到能操作 ≤ 1 s（同 `inline-whiteboard-open`）；交互期间 >50 ms 长任务 0 个；菜单 / 派生 / 参数面板沿用现有组件，不新增重绘路径。
4. 场景 `inline-whiteboard-split-100-open`（tests/perf/scenarios/inline-whiteboard-split-100-open.json，探针 tests/ux/whiteboard-perf.probe.mjs `--scene split-board-open --repo-media`）：openToInteractive 中位数 370.3 ms / p95 372.7 ms / 预算 1000 ms；图层面板列出 101 行 response 中位数 30.5 ms / p95 38.1 ms（只打印）；长任务 0；5 次，Apple M5 / 24GB，commit f280a1bcd（工作树干净），原始结果 docs/evidence/2026-11-26-layer-split/perf-inline-whiteboard-split-100-open.json。基线 364.8 / 366.3 在 e6203b5b2 上量（noisy）。
5. 留 PR2：面板滚动、多选 20 层拖动两个场景随虚拟列表与多选一起登记（本 PR 面板未改、无多选）。

## 8 真实条件

- [x] 英文界面 + 暗色 + 1100×690：`layer-split.walk.mjs --locale en --theme dark --size 1100x690`（walk11-en，构建 f280a1bcd）。
- [x] 中文浅色默认窗：walk11-zh（构建 f280a1bcd）。
- [ ] 停靠 Agent 的 1100×690：**unverified**（走查没开 Agent 停靠）。
- [ ] 1440×900：**unverified**。
- [ ] 节点在画布右边缘时面板翻左：PR2（面板位置）。
- [ ] Windows：**unverified**。
- [ ] 真规模：100 层只在 perf 场景里量过打开，真界面截图只到替身的 3 层。
- [ ] 真付费：**unverified**——免费演练过，真付费由协调跑（C-E10）。
- [ ] 键盘全程：**unverified**。
- [ ] 干净安装：**unverified**。

## 拍板图清单：链接

docs/design/boards/2026-11-26-layer-split/LayerSplit.board.json（`pnpm run check:board-parity`）。元素状态：本 PR 做的标 in-progress（owner 本 PR 号），PR2 的五格（whiteboard-panel、panel-reorder、panel-multiselect、panel-virtual、base-row）和后续四格（failed、extract-button、extract-result、agent-pointer）标 missing 并写明 owner。只有不写实现的线能标 implemented。

## ★9 验收与回滚

判据要能失败：「什么都不做」（今天的 main：改图菜单没有图层分离，5.5 档案没有 layer_decomposition）→ 第 1、3 条红；「全部拦下」（入口一律禁用或发送一律拦）→ 第 3 条红。

| # | 检查项 | PR1 / PR2 | 证据 |
|---|---|---|---|
| 1 | 有结果的图片节点，「改图 ▾」「生成新图」组第一项「图层分离」（IconStack2）；点它右侧派生 1 节点 1 边，请求 0 次 | PR1 | `deriveFromNode.run.test.ts`「★9-1」；走查 LS01、LS02 + `vendor-requests.json` |
| 2 | 生成框「图层分离 · 30 层 · 自动」；窄了按 C-E5 先退「自动」、再退层数、最后只剩图标 | PR1 | `composerBarYield.layerSplit.test.ts`；走查 LS02（zh）、walk11-en 1100×690 |
| 3 | 发送：替身只收到 1 次 POST，请求体带层数和 text_recognition；回来的图层按 z_index 落进画板，行名取 layers[i].name，底图标「底图」 | PR1 | 金丝雀 `vendor-requests.json` / `layer-split-request.json`；`apimartDocsBatch1Wire.test.ts`；`layerSplitBoard.test.ts`；走查 LS04、LS05 |
| 4 | 面板贴节点右边 / 翻左 / 落下；有可编辑层时第一次默认开（D-1126-se-default-open-B），之后记住 | **PR2** | — |
| 5 | 多选与框选同一选中集、调前后（PR2）；每个能删的层有垃圾桶、背景不可删（今天已成立） | 部分 PR1 | 走查 LS05（垃圾桶）、LS07（删层） |
| 6 | 选中图片层出 editor 自带四角手柄，等比缩放 | PR1（今天已成立，C-E1） | 走查 LS06；runB/C02、C03 |
| 7 | 反例：老项目的「图层 1」还在（PR1）；普通节点新画板不预建「图层 1」（PR2） | 部分 PR1 | `whiteboardStateOps.test.ts`「老项目的『图层 1』原样保留」 |
| 8 | 反例：没有可用图层分离模型时不灰、第二行点名去接、点了打开接入页（D-1126-se-missing-model-guide，取代原「禁用 + 原因」）；算不出价时发送键不印数字 | PR1 | `capabilityGuide.test.ts`、`deriveFromNode.run.test.ts`「★9-8」；走查 LS09、LS10；`vendorPricePreview.test.ts` |
| 9 | 中英双轨、浅暗、1100×690、长文字、20 / 100 层，和拍板稿逐项对账 | 部分 PR1 | 并排图索引 docs/evidence/2026-11-26-layer-split/side-by-side/INDEX.md；100 层见 ★7；停靠 Agent / 1440×900 unverified |

补充检查（本 PR 自己加的）：删层后画笔能落笔（`whiteboardStateOps.test.ts` 三条）；换模型时「拆图层」这件事跟着走（`archetypeMeta.layerSplitCarry.test.ts`）；整幅透明图不被压扁（`layerSplitBoard.test.ts`、`landTaskResults.test.ts`）。

反例 → 结果 → 证据（改坏 → 红、还原 → 绿，日志在仓库外临时证据目录，PR 正文贴摘要）：

| 反例 | 改坏后 | 还原后 |
|---|---|---|
| 什么都不做：图层分离方式认不出（`isLayerSplitMode` 恒 false） | 红 | 绿 |
| 全部拦下：线缆一律算拆不了（`layerSplitWireReady` 恒 false） | 红 | 绿 |
| 算不出价也印数 | 红 | 绿 |
| 缺模型时不点名厂商 | 红 | 绿 |
| 删层后画笔落不下（还原成今天的判断） | 红 | 绿 |
| 换模型丢掉「拆图层」 | 红 | 绿 |
| 整幅透明图也缩进框 | 红 | 绿 |
| 约价不标上限（图层分离一支不打 `upper-bound`，键上就没有「≤」） | 红 | 绿 |

上表 8 条都实跑过（每条先改坏跑红、再还原跑绿）。

这一类还会从哪回来：另一家供应商接入图层分离（线缆不读开关键 → 入口当没有、发送口拒，结构上挡）；另一个调用者落结果（找回路径与发送走同一个 `landTaskResults`）；返回形状变（两种都落对，描述数对不上挂取回解析）；旧数据（无标记 → 原路）。

付费走查：`tests/ux/layer-split-real.paid.mjs`（2 层、1K、1 张源图），免费演练 `NOMI_PAID_REHEARSAL=no-key`，产物标记字面量 `layer_decomposition_options`、`在画板中编辑图层`（构建产物里必须有），专用工作树里由协调跑真付费。

验收：另一条线（协调派，编号不同于 I-SE-layer-split）按本格逐条核，先跑「什么都不做 / 全部拦下」两种都红。独立验收报告链接：待协调派线后补进 PR 正文 `## 独立验收`。

回滚：revert 本 PR 的合并提交。新结果上的 `raw.layerSplit` / `raw.whiteboardState` 在回滚后不被读，节点按普通图片显示合成图，不坏数据。

### 功能分类
- [x] 新界面 / 改交互
- [x] 花钱
- [x] 长跑 / 可打断
- [ ] Agent 行为
- [x] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [x] 数据格式
- [x] 新增功能 / 性能

## 留给 PR2 的定案

- D-1126-se-default-open-B：底图 / 原图不算，上面至少叠 1 层才默认打开面板；判定写成一个函数，单测三种（只有原图；原图 + 1 层；拆出 30 层）。
- C-E1 结论：手柄与等比用 editor 自带的；`isPointNearSingleAssetResizeHandle` 是「角点附近不起框选」，不删。
- C-E2 / C-E3：面板位置与一套面板所有画板共用，PR2 做；画板走查（whiteboard-refactor 等）在 PR2 全部重跑。
