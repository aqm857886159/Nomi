# Issue #1586 · `S-D 样片模式` 与 `S-E 图层分解` 探索设计全量材料包（`marked: exploration`）

> **阶段声明**：本材料包严格遵循 `docs/engineering/design-pipeline.md` 第 0 步与第 1 步，属拍板前调研与探索包（所有 HTML 与 PNG 均显式标 `exploration`），**未改动 `src/` 或 `electron/` 任何生产代码**。供协调会话对照设计系统、在 Claude Design 画布生成高保真拍板稿并交用户拍板。

---

## 一、代码库与真机现状核查（Step 1 Codebase & Live App Fact Audit）

1. **`Seedance 2.5` 现状事实**：
   - `electron/shared/videoCapabilities/seedance25Apimart.ts` 与 `docs/models/capabilities/seedance-2-5-apimart.md:38-39`：已声明 `480p / 720p(默认) / 1080p`、`4–30s`；`draft: true`（3 天有效期）与 `draft_task_id`（样片转 1080p 正片）标为 `pending: 两步流程`。
   - `electron/shared/videoCapabilities/seedance25.ts:44`（KIE/Runway 共享档案）仅 `480p / 720p`，`seedanceVolcengine25.ts:50` 为 `480p / 720p / 1080p` —— **不同供应商是否有 `draft` 及有效期长短不同，必须在模型档案层动态声明（如 `draftSpec: { validityHours: 72, finalResolutions: ['1080p'] }`），绝不可在渲染层硬编码 `3 天` 或按 `480p` 硬猜**。
   - **关键既有拍板关联（`ModelSurfaces` Q9）**：`docs/design/boards/2026-11-07-model-surfaces/ModelSurfaces.board.json:112-115, 1213-1248` 已登记 `Q9: 草稿档单独一行`（元素 `picker.draft-row`：`Seedance 2.5 草稿 · 480P · 满意再出 1080P`）。
   - **版本与花费底座**：节点右上角版本栈 `NodeVersionCards.tsx`（`NodeVersionCountBadge`）与发送键约价胶囊 `ComposerSendButton.tsx`（`IconCoin` + 积分数，板 `ModelSurfaces/cost.send-pill`）均已现役可用。

2. **`Seedream 5.5` / `Seedream 5.0 Pro` 现状事实**：
   - `electron/shared/modelArchetypes/seedream55.ts:12` 与 `docs/models/capabilities/seedream-5-5.md:25-26`：单图输出（`n=1`），`layer_decomposition`（仅收 **1 张输入图**、不发 `background`）+ `layer_decomposition_options.max_images`（整数 `2–100`，默认 `30`，含修补底图）+ `text_recognition`（OCR 富文本布尔开关）标为 `pending`。
   - `electron/shared/modelArchetypes/seedream5Pro.ts:51` 与 `docs/models/capabilities/seedream-5-pro-apimart.md:25`：`layer_decomposition` 最多返回 **底图 + 15 张透明 PNG（合计 ≤16 层）**，无 `max_images=100` 与 `text_recognition`。
   - **真机界面核查（`current-app/` 16 张隔离真窗截图）**：
     - 画布图片节点的 `NodeGenerationComposer` 默认无「方式」下拉胶囊（0 图自动文生图、≥1 图自动改图）；选中已出图节点顶部浮出 `ImageQuickActionsToolbar`（`复制 | 多机位九宫格 ▾ | 抠图 | 改图 ▾ | 宫格 ▾ | 画板 | 全屏 | 下载 | 记录 | 加入时间轴`）。
     - `nodeAttachedPanel.ts` 的 `useNodeAttachedPanel(nodeId)` 已是「贴节点附着面板打开时自动卸载下方 600px 生成框」的唯一真相源；`@tanstack/react-virtual`（`3.14.2`）已装在仓库依赖中（P0 零自写虚拟滚动）。
     - `画板`（`NodeInlineWhiteboardHost`）工具条内现有手绘批注用的迷你 `图层` 弹层（`原图 / 图层 1 / 背景`），与 Seedream AI 拆出的最高 100 层 RGBA 结构化图像栈职责不同，需在数据层明确放在 `node.result.layers[]`，互不污染。

---

## 二、同类产品真截图与先例对标（★0 Prior Art · 全部来自 `peers.json` 准入名单与官方规范）

| 归属 | 先例来源（禁止引用 `notPeers`） | 真截图 SHA-256（`seenOn: 2026-11-24`） / 官方出处 | 它怎么做 | 对我们设计决定的影响 |
|---|---|---|---|---|
| **S-D 首项（同类同面）** | **LibTV**（`liblib.tv/feature-updates`） | `ebb12f829cab0134cc12c4cc98b3ecae4d4a5ae5d96965eda8109c334545acea`（另底栏胶囊：`3277cb75d501b64abace1464bb30cd4f6a0ffad828d9071ac6e00c0104dc57b6`） | 将低价快档 / 样片做成模型选择器里的独立项，底栏保持 `[模型 ▾ \| 比例·清晰度·时长 ▾]`，不把普通模型的 `480p` 偷偷变成会过期的草稿 | **确认选方案 B**（与 `ModelSurfaces` Q9 `picker.draft-row` 一致）；差异：我们增加跨家动态过期倒计时与二次升正片重复扣费拦截 |
| **S-D 第 2 项** | **TapNow**（`docs.tapnow.ai/.../generate-and-edit-video`） | `407663b900c5fde7cc49fe7b085115f29b24434b7fb117ada2541144bee42146` | 显式选 `Draft Mode` 出 `480p` 草稿（明说用于查动作与构图），结果卡标 `Draft` 并给 `Revise draft 480P` 与 `Generate Final Video`（1080p 显示预估 Tapies，保留原草稿） | **确认** 1 行画质预期提示 + 升正片显示全价积分且保留 480p 样片；**改了**：不另建新节点连线，改为写入本节点 `NodeVersionCards` 版本栈（右上角 `2`），防止多镜分镜组框膨胀 |
| **S-D 第 3 项** | **APIMart / Seedance 2.5 官方接口规范** | `https://docs.apimart.ai/en/api-reference/videos/seedance-2-5/generation` | `draft: true` 与 `draft_task_id` 互斥，两步独立计费；APIMart 样片号保留 3 天，过期作废；同一 `draft_task_id` 重发会再扣一次正片全价 | **确认**有效期由档案 `draftValidityHours` 驱动（APIMart 72h / 别家 24h）、`<2h` 琥珀色预警、过期置灰给「重拍样片」、二次升正片弹确认框 |
| **S-E 首项（同类同面）** | **LibTV**（`liblib.tv/feature-updates`） | `9755b18ffb9be3c5a703a32071951a8bd3e2117ef380e52a66859a027c1d4e4e` | 在单张图像节点上直接做图层分离与选框交互，不把所有层一次性炸成满屏独立节点 | **确认选方案 A**（留在单节点图层栈 + 悬停显示 `{x,y,w,h}` 选框）；差异：选框改用 Nomi §8 中性虚线（去蓝色描边），右侧挂虚拟化图层栈支持 100 层 |
| **S-E 第 2 项** | **TapNow**（`docs.tapnow.ai/.../generate-and-edit-images`） | `110aeb938e51e8a39d5a0de44a484ada999b3ae575ce85f901a8f5571e04d464` | 选中图片节点的 Toolbar 提供拆分动作，仅把创作者需要继续加工的子图拆成下游连接节点 | **确认**「图片浮条 `改图 ▾ → 图层分解` 一键就位（不直接扣费）+ 图层栈勾选 1–3 层点『拆出』才建下游节点」 |
| **S-E 第 3 项** | **Seedream 5.5 / 5.0 Pro 官方接口规范** | `https://docs.apimart.ai/en/api-reference/images/seedream-5-5/generation.md` | 仅收 1 张图；`5.5` 为 `2–100` 层（默认 `30`）+ `text_recognition` OCR，`5.0 Pro` 封顶 `16` 层；返回修补底图 + RGBA 层（带 `z_index` 与 `bounding_box`），按实际返回张数逐张计费 | **确认** 0 图禁用 / 多图仅取首图提醒、`5.5` vs `5.0 Pro` 层数上限自动钳制、发送键实时联动 `🪙 ≤上限积分`、生成记录展示「预计上限 vs 实扣张数」 |

---

## 三、`S-D 样片模式` 核心取舍与完整设计规格（`S-D-sample-mode/`）

### 3.1 核心权衡一句话点破（供用户拍板）
> **你在纠结什么**：是让创作者在普通 `Seedance 2.5` 里点 `480p` 就自动变成会过期的样片（少一行模型，但废掉了永久 `480p` 成片），还是像 `LibTV / TapNow` 与上次 `ModelSurfaces Q9` 定的那样，在模型菜单单独放一行**「Seedance 2.5 样片」**？

| 维度 | 方案 A：选 `480p` 自动走样片 | **方案 B（推荐）：模型菜单显式「Seedance 2.5 样片」行 + 版本栈升正片** |
|---|---|---|
| **创作者摩擦与预期** | 想省钱直出一条永久保留的 `480p` 成片时，3 天后样片号过期、无法从同号升正片且心智困惑 | 选「样片」即明确知道是 `480p` 试拍动作，满意再点「升 1080p 正片」；普通 `Seedance 2.5` 照常直出永久 `480p/720p/1080p` |
| **跨模型与既有拍板一致性** | 与其它选 `480p` 出永久成片的模型不一致；**推翻已拍板 `ModelSurfaces Q9`（`picker.draft-row`）** | **100% 继承 `ModelSurfaces Q9`**，模型下拉勾选 `✓` 恒在右侧（`14px --nomi-accent`） |
| **升正片产物归宿** | 易误做成覆盖原视频 | 点 `[升 1080p 正片 · 🪙 21.6]` 在**同一节点追加新版本**（右上角版本角标 `2`），`480p` 样片留在第 1 版随时对比，不覆盖、不炸新节点 |
| **按钮位置纪律（§1.5.3）** | 若压在视频角落会遮挡画面 | 放在视频框正下方的卡片动作条（零像素遮挡画面），且不在顶部浮条重复摆第二颗同功能主按钮（§1.5.2 一功能一个家） |

### 3.2 必覆领域事实与异常态（已在样张逐格画出）
1. **动态有效期（零硬编码）**：从模型目录声明读取 `draftValidityHours`（如 APIMart `72h` → `样片 · 剩 2 天`；某存量连接 `24h` → `样片 · 剩 21 小时`）。剩余 `<2h` 切换四阶语义警告色（`--nomi-warning-soft / -edge / -ink`：`样片 · 剩 48 分钟` + `不足 2 小时将失效，过期后需重拍样片`）；`≤0` 切中性灰 `样片 · 已过期`，禁用 `升 1080p 正片`（外包 `<span title>` 满足 C1/C4）并紧邻给出 `重拍样片` 出口。
2. **诚实计费与二次升正片拦截**：生成框提示 `样片独立计费`；升正片按钮印全价积分 `🪙 21.6`（复用 §6 已登记 `IconCoin`）；若该 `draft_task_id` 在本节点版本栈里**已有成功生成的 1080p 版本**，再次点击弹出 `confirmDialog`（`DecisionBar`：`取消` 在左、`再出正片 · 21.6` 在右），明确告知会再次按 1080p 全价扣费，并提示点右上角 `2` 切回已有正片免费。
3. **1 行画质预期提示**：`480p 仅供确认动作与构图，人脸与小字以正片为准`（英文：`480p for motion & framing; faces clear in 1080p`）。
4. **Agent 聊天边界（§1.0）**：家在视频节点与生成框；Agent 发起试拍或提议升正片时，聊天内只渲染紧凑 `NodePointer` + 单问花钱确认卡，不放分辨率或参数开关。

### 3.3 `S-D` 9 格设计卡摘要（★0–★9）
- **★0 先查别人**：见上表（LibTV 真截图 + TapNow Draft Mode 真截图 + APIMart 官方文档）。
- **★1 目标与老用户迁移**：让创作者用约 1/4 成本先验运镜与构图再出 1080p；老项目普通 `Seedance 2.5` `480p` 节点原样保持普通模式不受影响（量具：单测断言旧存档 `resolution:'480p'` 无 `draft:true` 时不渲染过期条）。
- **★2 全部家与单一主人**：模型项归 `electron/shared/videoCapabilities/seedance25Apimart.ts` 声明；两步关联字段 `draftTaskId / draftExpiresAt` 归 `node.result.provenance`；UI 只在 `BaseGenerationNode`（含列表详情复用）与 `NodeGenerationComposer` 投影。
- **★3 花钱边界**：样片与升正片是两次独立 `SpendConfirmRequest` 铸牌；同一 `draftTaskId` 二次升正片强制走确认框（即使单节点直点也不静默双扣）。
- **★4 长跑与找回（对齐 U-2）**：`draft_task_id` 与升正片新 `task_id` 在最早受理边界落盘，断连重启可按各自 `task_id` 找回，绝不自动重发 POST。
- **★5 可打断**：生成正片期间原 `480p` 样片仍可查看；取消或失败（如上游超时未扣费）不破坏第 1 版样片。
- **★6 界面与状态矩阵**：已覆盖 `empty / loading / ready(72h & 24h) / expiring(<2h) / expired / duplicate-confirm / error / 28-char / zh-en / light-dark / 1100×690`。
- **★7 性能预算**：倒计时按分钟级 `setInterval(60_000)` 惰性刷新（无过期样片时 `0` 定时器），画布 200 节点平移帧耗时增量 `0ms`（`docs/engineering/perf-scenarios.md`）。
- **★8 依赖生命周期**：零新依赖，100% 复用 `NodeVersionCards`、`ComposerSendButton`、`confirmDialog`、`DecisionBar`。
- **★9 验收正反例判据**：
  - 正例：① 选 `Seedance 2.5 样片` 发请求带 `draft:true` 且不带 `draft_task_id`；② 点 `升 1080p 正片` 带原样片 `draft_task_id` 且不带 `draft:true`，成功后 `resultHistory` 增至 2 版且第 1 版仍为 480p；③ 注入 `validityHours: 24` 显示 `剩 23 小时`，注入剩余 `48m` 渲染 warning token，注入 `-1m` 按钮 `disabled` 且带原因。
  - 反例（变异必红）：① 硬编码 `3 天` 忽略档案 `validityHours` → 单测红；② 对已有正片版本的同一 `draftTaskId` 再点直接发请求未弹确认 → 单测红；③ 普通 `Seedance 2.5` 选 `480p` 误发 `draft:true` → 协议契约测试红。

---

## 四、`S-E 图层分解` 四问解答与完整设计规格（`S-E-layer-decompose/`）

### 4.1 必答四问与取舍对比表（供用户拍板）
> **你在纠结什么**：一张图最多能拆出 **100 层**且**按张收钱**——拆出来的层要是全铺在画布上会瞬间把分镜淹没，层数设太高又会多花冤枉钱。核心是**「平时收在一个节点里看全貌，要改哪两层才拆哪两层出来；层数和上限价绑在一起实时跳动」**。

| 必答问题 | 方案 A（推荐） | 方案 B（备选 / 不推荐） | 推荐理由与创作者体验 |
|---|---|---|---|
| **Q1. 拆出的图层住哪？** | **留在单节点「合成预览 + 右侧附着图层栈面板（`useNodeAttachedPanel`）」，勾选需要的 1–3 层点 `[拆出选中 N 层]`（或 Alt 拖出）才生成下游独立图片节点** | 直接在画布生成最多 100 个独立图片节点 + 100 条连线 | 100 张 360px 节点占地约 `4200×3000px`，会彻底淹没相邻分镜并逼创作者手删 97 个无用层；留在单节点既保住上下叠放整体感，又能按需拆出前景人物/标题字去连 `Seedance 2.5` 做分层运镜 |
| **Q2. 100 层怎么摆、怎么算钱？** | 附着面板定高 `380px`，复用仓库已装 `@tanstack/react-virtual`（`30px` 行高）虚拟滚动 + 顶部 `DesignSearchInput` 搜层名/OCR 文字 + 底部固定 `底图(z=0)`；发送键实时算**上限价**（`30 层 → 🪙 ≤10.5`，`100 层 → 🪙 ≤35` 配琥珀色高价预警），`ProvenancePanel` 记「预计上限 vs 实扣张数」 | 平铺全部 DOM 行；只印固定单图价不随层数变 | 100 个高清 PNG 同时解码上屏会卡顿，虚拟列表 + 22px 缩略图 60fps 丝滑；按张计费若不随层数跳动，创作者拉到 100 层会遭遇 30 倍账单惊吓 |
| **Q3. 叠放顺序（z-order）在哪看、能不能改？** | 右侧图层栈按行业标准**从上到下 `#N 前景 … #1 → 底图(z=0 锁定)`** 排列；支持拖 `⠿` 把手或 `Alt+↑/↓` 调整顺序（实时重排节点合成预览，支持 `showUndoToast` 撤销）；悬停任意行在节点画面画出中性虚线 `{x, y, w, h}` 位置框与坐标 | 只按网格平铺缩略图，不存或不可改 `zIndex` | 前景遮挡关系必须上下成栈才直观；保留 `{x, y, w, h}` 归一化与像素坐标，拆成下游节点或重拼时原位对齐不漂移 |
| **Q4. 层数谁定（创作者 vs Agent）？** | **家在节点生成框** `图层分解 · 30 层 ▾`（预设 `自动(30) / 8 / 16 / 30` + 自定义 `2–100`；切到 `Seedream 5.0 Pro` 自动钳到 `≤16` 并隐去 OCR 开关）；已有图片可从浮条 `改图 ▾ → 图层分解` 一键切入（不直接扣费）。**Agent 起草时**在节点设好推荐层数（如 30 层），聊天只发 `NodePointer` + 单问确认（`分解图层 · ≤10.5`），想改层数点卡片回节点改 | 在 Agent 聊天付费卡里塞层数滑块与 OCR 开关 | 严格遵守 §1.0「一个东西一个家 / Agent 只指路」（门岗 `chat-card-no-import-node-editor`）；改钱的参数留在生成框主面板（遵守 `ComposerParams D2`） |

### 4.2 `S-E` 9 格设计卡摘要（★0–★9）
- **★0 先查别人**：LibTV 图层分离真截图 + TapNow Toolbar 拆分真截图 + Seedream 5.5 / 5.0 Pro 官方规范。
- **★1 目标与老用户迁移**：让创作者把单张海报/场景拆成带修补底图的可动透明分层素材；旧单图节点无 `result.layers` 时零视觉变化。
- **★2 全部家与单一主人**：档案声明归 `seedream55.ts`（`maxLayers: 100, defaultLayers: 30, supportsTextRecognition: true`）与 `seedream5Pro.ts`（`maxLayers: 16, defaultLayers: 16, supportsTextRecognition: false`）；结果存储归 `node.result.layers[]`（每项含 `id, url, name, zIndex, bbox: {x,y,w,h}, ocrText?`）；附着面板互斥复用 `useNodeAttachedPanel(nodeId)`。
- **★3 花钱边界**：计费估算函数按 `unitPrice × maxImages` 返回 `basis: 'cap-estimate'`（显示 `≤X`），悬停与确认卡明写「底图与每层分别计费，按实际返回张数结算」；`maxImages ≥ 50` 在弹层出现语义警告条。
- **★4 长跑与找回**：多图回执数组连同 `z_index / bounding_box` 一次性原子落盘本地素材目录，避免外链过期丢层。
- **★5 可打断**：调整 `z-order` 或显隐纯本机重排 + `showUndoToast`；「拆出选中 N 层」纯本机建下游素材节点，零额外 API 扣费。
- **★6 界面与状态矩阵**：已覆盖 `0-image disabled / >1-image guard / 5.5(2–100) / 5.0 Pro(≤16 clamp) / running / ready(19 layers) / max-count(100 layers) / error / 28-char / zh-en / light-dark / 1100×690`。
- **★7 性能预算**：100 层列表使用 `@tanstack/react-virtual`（DOM 常驻 `≤14` 行），缩略图走 `DeferredNodeImage`，100 层滚动帧耗时 `<4ms`、打开面板 `<16ms`。
- **★8 依赖生命周期**：零新包引入（复用现成 `@tanstack/react-virtual`、`DesignSearchInput`、`useNodeAttachedPanel`）。
- **★9 验收正反例判据**：
  - 正例：① 0 张输入图时发送键 `disabled` 且悬停显示原因；放入 >1 张图切分解模式时只发第 1 张并显示黄条说明；② 改层数 `8 → 30 → 100` 时发送键 `🪙 ≤2.8 → ≤10.5 → ≤35` 同步跳变；③ 切到 `Seedream 5.0 Pro` 时层数上限 `>16` 自动钳回 `16` 且不发 `text_recognition`；④ 造 100 层假数据滚动到底，`#99` 至 `底图(z=0)` 无裁切且点「拆出 2 层」生成的节点带原始 `{x,y,w,h}` 元数据。
  - 反例（变异必红）：① 分解模式下仍向 API 发送 `background` 字段或 `>1` 张 `image_urls` → wire 契约单测红；② 100 层不用虚拟列表全量渲染 100 个大图节点 → 性能与 DOM 行数断言红；③ 聊天卡片 import 图层参数控件 → `check:boundaries` R-B6 红。

---

## 五、交付物清单与逐张视觉自检回执（Playwright 几何零溢出 + `read_file` 逐张亲眼核验）

所有文件位于同一工作目录 `mockups-sd-se/` 下：

1. **真机基线参考（`current-app/`，16 张 `origin/main` 零花费真窗截图）**：已亲眼核对现役 `Seedance 2.5` 与 `Seedream 5.5 / 5.0 Pro` 生成框、参数弹层、结果浮条与画板图层弹层。
2. **`S-D-sample-mode/`（样片模式）**：
   - `sd-options-compare-zh-light.html` / `.png`（`1440×900`，`zh-CN` Light）：方案 A vs 方案 B 并排对照 + 右侧勾选 `✓` 模型菜单 + 四格领域契约摘要（字号仅 `11/12/13/14px` 四档，溢出 `0`）。
   - `sd-states-zh-light.html` / `.png`（`1440×900`，`zh-CN` Light）：8 格全状态矩阵（空态+28字模型名、生成中、APIMart 3天就绪、24h跨家声明+`<2h`临期警告、已过期禁用+重拍、二次升正片防误扣确认框、失败态、§1.0 Agent 指向卡）。
   - `sd-states-en-dark.html` / `.png`（`1440×900`，`en` Dark）：英文 + 暗色全状态矩阵（四阶 `-soft/-edge/-ink` 语义色暗色对比度全部合规，原因文案零截断）。
   - `sd-narrow-1100x690.html` / `.png`（`1100×690`，`zh-CN` Light）：最窄桌面窗口整窗（顶栏 Nomi 入口 + 左栏 + 画布样片节点 + 600px 生成框 + 320px 右侧停靠 Agent 面板，零遮挡零溢出）。
   - `SampleMode.draft-board.json`：含 `priorArt`（首项 LibTV SHA-256）、`boundarySheet`、`functionCensus`、`priorDecisions`、`components`、`appearsIn`。
3. **`S-E-layer-decompose/`（图层分解）**：
   - `se-overview-zh-light.html` / `.png`（`1440×900`，`zh-CN` Light）：方案 A（单节点图层栈+按需拆出）vs 方案 B（100 节点爆炸反例）+ 生成框层数/OCR 弹层 + 实时价格档位 + §1.0 Agent 指向确认。
   - `se-max-100-layers-zh-light.html` / `.png`（`1440×900`，`zh-CN` Light）：真实 `max-count: 100` 虚拟滚动列表（`第 100 层` 至锁定 `底图`）+ 100 层高价预警 + `cost.provenance` 明细 + 6 种边界异常态（0 图禁用、多图拦截、`5.0 Pro ≤16` 钳制、进行中、失败未扣费、28 字长名与画板关系）。
   - `se-en-dark.html` / `.png`（`1440×900`，`en` Dark）：英文 + 暗色全套交互与回执。
   - `se-narrow-1100x690.html` / `.png`（`1100×690`，`zh-CN` Light）：最窄桌面窗口整窗（演示 `useNodeAttachedPanel` 在打开右侧 336px 图层栈时自动收起下方 600px 生成框，在 1100×690 内与停靠 Agent 面板零重叠并存）。
   - `LayerDecompose.draft-board.json`：含 `priorArt`（首项 LibTV SHA-256）、`boundarySheet`（覆盖 `max-count: 100` 与 `28` 字长名）、`functionCensus`、`priorDecisions`、`components`、`appearsIn`。
