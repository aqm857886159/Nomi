# S-G 「自动」处处写明实际模型名 + 默认模型设置收成图片 / 视频 2 行

- **线/负责人**：`impl-s-g-auto-model`
- **日期**：`2026-11-28`
- **拍板图**：`AutoModel`（`docs/design/boards/2026-11-27-auto-model/AutoModel.board.json`，用户 2026-11-27 按推荐定稿）
- **关联板核对**：`ModelSurfaces`（`docs/design/boards/2026-11-07-model-surfaces/ModelSurfaces.board.json` 中 `policy.defaults` 已标 `dropped` 并指向 `AutoModel`；`brain.policy-pointer` 归 S4 线不跨界修改）

### 功能分类

- 命中分类：`ui`（四类：改动设置页 AI 策略与画布节点生成框左下模型胶囊/下拉）、`scale`（模型目录 200+ 条目下的推荐解析与下拉打开）、`perf`（画布生成框模型菜单打开时延预算）

---

## ★0 先查别人

1. **同类产品同一处 · LibTV**（2026-11-14 真机截图对标，sha256 见 `AutoModel.board.json`）· LibTV 新建图片节点的生成框左下直接写出具体模型名，不留看不见底的「自动」字样；同一个模型名同时承接文字出图与上传参考图改图，也没有按子任务拆分的四行默认设置 · **决定影响**：Nomi 接多家目录且推荐模型随版本演进，保留「自动」档让新卡自动跟随当前最强模型，但照 LibTV 直接印出实际模型名（「自动 · 实际模型名」）；图片默认合并为一行同时覆盖文字出图与改图（`SG-1` 选项 A）。
2. **[Midjourney — Version](https://docs.midjourney.com/hc/en-us/articles/32199405667853-Version)** · 官方文档与设置面板直接点名当前默认版本号，用户修改默认后新建任务同步生效，单次任务仍可显式覆盖 · **决定影响**：确认设置 › AI 策略一处改默认、新建节点同步生效，同时画布单张卡仍可手选具体模型或切回「自动 · 实际模型名」（`SG-2`）。
3. **[Runway — Creating with Runway Agent](https://help.runwayml.com/hc/en-us/articles/51601639579667-Creating-with-Runway-Agent)** · 生成前确认面板明示本次实际执行的模型名，对话模型与媒体生成偏好分离 · **决定影响**：确认 `auto.name-is-what-runs`（界面印出的名字与发送执行的模型必须出自同一解析函数），且当用户手选了仅支持单一子能力的模型时，在行副标诚实写明另一子能力回退用谁（`edge.single-capability-pick`）。
4. **[Adobe Photoshop — Desktop Release Notes](https://helpx.adobe.com/photoshop/desktop/whats-new/photoshop-on-desktop-release-notes.html)** · 官方发版记录曾复盘升级后意外残留旧版默认模型而未切入新推荐默认的回归 · **决定影响**：确认老用户旧 `schemaVersion: 1`（4 行 `byTaskKind`）升级不迁移，统一自然回到「自动 · 实际模型名」（`SG-3`），杜绝静默残留旧默认。

- 出口：[Runway — Creating with Runway Agent](https://help.runwayml.com/hc/en-us/articles/51601639579667-Creating-with-Runway-Agent) · 当首选或手选模型不覆盖当前子任务时明示回退模型并允许单次切换继续，不锁死创作流 · 确认了 `edge.vendor-fallback`、`edge.single-capability-pick` 与 `edge.none-available`「去接入供应商」出口，任何状态下都不拦截或卡死创作者。

---

## ★1 给谁、解什么痛、成了怎么看

- **★1 目标创作者与痛点**：面向所有使用画布与设置页的创作者。此前存在三处摩擦：①「自动 / 跟上次一样」看不出这一刻到底会调用哪个模型，往往点出结果才发现不是想要的模型；②新建节点跟着上一张卡上次手选的模型变，单次试完小众模型后后续新卡全部被带偏；③设置 › AI 策略把图片/视频拆成 4 行（文字出图、改图、文字出视频、图片出视频），创作者需要配四遍且容易出现文生与改图默认互相打架。
  - **可观测判据与量具**：
    1. 设置页 AI 策略默认区只渲染「图片」「视频」2 行，胶囊与下拉首项均印出本机实际可运行的最强模型名 — 量具：`src/workbench/settings/DefaultGenerationModelsSection.test.tsx` + `tests/ux/default-generation-model.walk.mjs` + `pnpm run check:board-parity`。
    2. 画布新建图片/视频节点左下胶囊默认印「自动 · 实际模型名」，不随上一张卡手选变化；加参考图切改图时自动态模型名保持不变 — 量具：`src/config/autoGenerationModel.test.ts` + `src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.test.ts` + `tests/ux/default-generation-model.walk.mjs`。
    3. 「自动 · X」显示的模型身份与节点实际发送的模型身份 100% 同源（推荐梯队 + 本机可用连接 + 供应商排序 + 近期连败避让） — 量具：`src/config/autoGenerationModel.test.ts`。
- **★1b 频率证据**：每次在画布新建图片或视频节点均必经默认模型解析；本地无遥测占比统计，记「未知（每次新建生成节点必经；无遥测）」。
- **★1c 删掉旧实现与老用户过渡**：
  - 同提交删除 `lastGenerationChoice` / `rememberGenerationChoice`（「跟上次一样」本地记忆）以及旧 4 行 `DefaultGenerationModelsSection` 渲染分支，不留并行开关或 fallback。
  - 老用户过渡（`SG-3`）：磁盘上旧 `schemaVersion: 1`（`byTaskKind` 四键）读取时不报错、不迁移，归一为 `{ schemaVersion: 2, byKind: {} }`，升级后自然回到「自动 · 实际模型名」；已有项目画布上已经持久化的历史节点保留各自 `node.meta` 中已有的 `(modelVendor, modelKey)`，不被批量改写。

---

## ★2 全局盘点与门表

运行 `node scripts/door-map.mjs electron/shared/contracts/generationModelDefaultsContract.ts src/workbench/generationCanvas/model/generationModelDefaults.ts electron/capabilityCore/generationDefaultModelResolver.ts` 盘点全部读写门（共 69 扇门，详见 `docs/research/2026-11-26-auto-model-census.md`）：
- **持久化与主进程门**：`electron/shared/contracts/generationModelDefaultsContract.ts`、`electron/settings/generationModelDefaultsSettings.ts`、`electron/capabilityCore/generationDefaultModelResolver.ts`。
- **渲染层状态与写口**：`src/workbench/generationCanvas/model/generationModelDefaults.ts`、`src/workbench/settings/AiModelsSection.tsx` → `DefaultGenerationModelsSection.tsx`、`src/workbench/ai/v4/useAgentPanelV4Data.ts` → `agentPanelV4ModelRows.ts`。
- **渲染层消费口**：`src/workbench/generationCanvas/nodes/defaultNodeModelSelection.ts`、`useNodeModelAutoSelect.ts`、`buildNodeModelChangePatch.ts`、`NodeParameterControls.tsx`、`InlineParameterBar.tsx`、`src/workbench/generationCanvas/quickActions/deriveFromNode.ts`、`src/workbench/generationCanvas/agent/availableModels.ts`。

**三条路比较**：
1. 沿原 4 行 `byTaskKind` 修补并在 UI 层拼假名字：文生与改图两键冲突无法消解，UI 与执行易分叉，否决。
2. **选定方案（收口为一处真源 + 2 行偏好）**：合同升 `schemaVersion: 2`（`byKind: { image?, video? }`），新增唯一纯函数真源 `src/config/autoGenerationModel.ts`（统一承载推荐梯队、跨供应商 `CANONICAL_MODEL_IDS` 映射、`compareVendorLanding` 选家与 `isModelRecentlyAiling` 连败避让），设置页 2 行、下拉首项、画布节点胶囊、画布下拉首项与节点实际写入 `node.meta` 全部调用同一个 `resolveAutoGenerationModel`。
3. 彻底删除默认模型设置页：违反 `AutoModel` `functionCensus`（习惯固定用某款模型的创作者每建一卡都要重选），否决。

---

## ★3 谁说了算（唯一真相源）

1. **「自动」解析唯一主人**：`src/config/autoGenerationModel.ts` 的 `resolveAutoGenerationModel({ mediaKind, options, orderedVendorKeys, isAiling })`。
   - 图片推荐梯队首选 `gpt-image-2.6-sunburst`（`GPT Image 2.6 Sunburst`，同时覆盖文字出图与改图，`SG-1`），次选 `gpt-image-2.6-flare`、`gpt-image-2.5-sunburst`（如只接 Kie 无 2.6 时命中此项，`edge.vendor-fallback`）、`gemini-nano-banana-2.1` 等。
   - 视频推荐梯队首选 `doubao-seedance-2.5`（`Seedance 2.5`，跨供应商匹配 `CANONICAL_MODEL_IDS['seedance 2.5']`，排除 `*-sample` 样片行抢占首选），次选 `doubao-seedance-2.0`、`wan3.0-video`、`kling-v4`、`MiniMax-H3` 等。
   - 同梯队多家可用时按 `compareVendorLanding(a.vendor, b.vendor, orderedVendorKeys)` 选家；优先未处于 `isModelRecentlyAiling` 连败避让期的健康候选；本机 0 个可用模型时返回 `null`（绝不印不可用模型名，`auto.no-name-for-unusable`）。
2. **用户默认偏好唯一主人**：`electron/shared/contracts/generationModelDefaultsContract.ts`（`schemaVersion: 2`，`byKind: Partial<Record<'image' | 'video', { vendorKey, modelKey }>>`）。缺席代表「自动」；主进程 `createGenerationDefaultModelResolver` 按 `mediaKindForTaskKind(taskKind)` 读取同一份 `byKind` 并校验模式发布资格。
3. **节点自动态标记**：`node.meta.modelAuto === true` 表示该节点处于「自动 · 实际模型名」状态；空闲时随可用目录 / 供应商顺序 / 连败状态同步刷新 `node.meta` 的 `(modelVendor, modelKey)`，保证发送执行端读取的节点模型身份与胶囊印出的模型名恒等（`auto.name-is-what-runs`）。用户手选具体模型置 `modelAuto: false`；点节点下拉首项「自动 · 实际模型名」重新置 `modelAuto: true`。

---

## ★4 状态、边界表与能力不可用

### 状态全集（对齐 `AutoModel` 9 个元素）

| 元素 ID | 状态覆盖 | 视觉与行为 |
| --- | --- | --- |
| `policy.default-image-row` | 默认自动 / 手选多能力 / 深浅色 / 中英 / 长文案 | 左「图片」+ 副标「文字出图 · 改图」，右胶囊「自动 · GPT Image 2.6 Sunburst」（不截断，左侧副标自适应折行） |
| `policy.default-video-row` | 默认自动 / 手选 / 深浅色 / 中英 | 左「视频」+ 副标「文字出视频 · 图片出视频」，右胶囊「自动 · Seedance 2.5」 |
| `policy.auto-caption` | 深浅色 / 中英 | 两行下方说明：「「自动」用这件事现在最强的模型；写出来的就是实际会用的那个。」（英文对应直译） |
| `policy.picker-auto-option` | 选中打勾 / 悬停 / 中英 | 下拉带「搜模型」搜索框；首项「自动 · 实际模型名」+ 副标「这件事现在最强的」+ 右侧对勾 + 底部分隔线，下方接平铺可用模型列表 |
| `node.model-chip-auto` | 自动态 / 加参考图切改图 / 中英 / 窄容器换行 | 新卡默认「自动 · 实际模型名」，加参考图名字不变；不随上一张卡手选变化 |
| `node.picker-auto-option` | 选中打勾 / 悬停 / 中英 | 节点模型下拉首项「自动 · 实际模型名」+ 副标「按设置里的默认 · 这件事现在最强的」+ 底部分隔线 |
| `edge.vendor-fallback` | 首选模型本机未接（如仅接 Kie） | 印本机实际会跑的 `自动 · GPT Image 2.5 Sunburst`，不印本机不可用的 2.6 |
| `edge.none-available` | 本机 0 可用模型 | 两行胶囊灰显「自动 · 暂无可用模型」，下方出现蓝色动作链接「连接模型」（遵 §1.8 控件文案 ≤4 字契约与全仓统一入口词，直达设置 › 模型接入页） |
| `edge.single-capability-pick` | 手选仅支持单一子能力的模型（如 `Z-Image Turbo`） | 胶囊显示手选名 `Z-Image Turbo`，行副标变为「只能文字出图；改图时用自动（GPT Image 2.6 Sunburst）」（反向单能力及视频单能力对称覆盖） |

### 边界表（`boundarySheet`）

1. **设置页默认行右侧模型名胶囊**：最长「`自动 · GPT Image 2.6 Sunburst`」/「`Auto · GPT Image 2.6 Sunburst`」→ 胶囊 `shrink-0` 不设截断上限，左侧标题与副标 `min-w-0 flex-1` 让位折行。
2. **节点生成框左下模型名胶囊**：英文窄生成框「`Auto · GPT Image 2.6 Sunburst`」→ 自动态模型胶囊不设截断上限；当底栏一行放不下模型胶囊与最短参数胶囊时，参数胶囊自动换到下一行，模型名完整保留。
3. **单能力手选行副标**：最长「`只能文字出图；改图时用自动（GPT Image 2.6 Sunburst）`」→ 副标 `whitespace-normal break-words` 自然折行，不截断。

### 可点元素普查（`ui-click-census`）

| 界面位置 | 可点控件 | 点击动作与预期结果 |
| --- | --- | --- |
| 设置 › AI 策略 · 图片行胶囊 | `NomiSelect` 触发器 | 展开图片默认模型可搜索下拉，首项为 `policy.picker-auto-option`，下方为可用图片模型平铺列表 |
| 设置 › AI 策略 · 视频行胶囊 | `NomiSelect` 触发器 | 展开视频默认模型可搜索下拉，首项为 `policy.picker-auto-option`，下方为可用视频模型平铺列表 |
| 设置 › AI 策略 · 下拉首项「自动 · X」 | `Combobox.Option` (`value=""`) | 删除该媒介的固定默认并持久化 `byKind`，胶囊回到「自动 · X」 |
| 设置 › AI 策略 · 下拉具体模型项 | `Combobox.Option` | 将 `{ vendorKey, modelKey }` 写入 `byKind[mediaKind]` 并持久化；单能力模型同步切换行副标提示 |
| 设置 › AI 策略 · 空态「去接入供应商」 | 动作按钮（`edge.none-available`） | 触发 `openModelSettingsHome()` 切到「设置 › 模型」接入供应商，有去路不死胡同 |
| 画布节点生成框 · 左下模型胶囊 | `NomiSelect` 触发器（`node.model-chip-auto`） | 展开节点模型菜单，首项为 `node.picker-auto-option` + 分隔线 + 去重平铺模型列表 + 底部「隐藏模型」 |
| 画布节点生成框 · 下拉首项「自动 · X」 | `Combobox.Option` (`value=""`) | 将当前节点设为自动态（或跟随设置默认）并重铺该模型默认参数，不污染后续新卡 |
| 画布节点生成框 · 下拉具体模型项 | `Combobox.Option` | 仅将当前节点改为手选模型（`modelAuto: false`），后续新建节点仍默认「自动 · X」 |

---

## 5 中途表（中断、并发与撤销）

- **首次装载未完成**：`generationModelDefaultsLoaded()` 为 `false` 时，`useNodeModelAutoSelect` 按既有守卫等待加载完成后再落模型，绝不在 IPC 返回前抢写错误模型。
- **生成进行中目录或健康度变化**：仅在节点空闲（`status !== 'queued' && status !== 'running'`）时同步自动态模型，正在排队或运行中的任务绝不中途改写 `node.meta`。
- **关窗 / 重启**：设置页选择通过原子 JSON 落盘 `generation-model-defaults.json`（`schemaVersion: 2`）；节点自动态与解析出的 `(modelVendor, modelKey)` 随项目保存，重开一致。
- **撤销（⌘Z）**：系统初始化自动落模型走 `{ history: false }`（不污染新建节点撤销栈）；用户在节点下拉手动切换「自动 ↔ 具体模型」走正常节点写入历史，⌘Z 一步撤回。

---

## 6 外部数据与失败处理

- **旧版 `schemaVersion: 1` 设置文件**：`normalizeGenerationModelDefaults` 识别非 v2 数据直接返回 `{ schemaVersion: 2, byKind: {} }`，不抛错、不静默带入冲突四键（`SG-3`）。
- **损坏 JSON / 超长字段 / 缺半边身份**：沿用 `GENERATION_MODEL_KEY_MAX_LENGTH = 200` 与非空双段校验，脏条目丢弃回退「自动」。
- **已保存的固定默认模型被停用或供应商断开**：设置页胶囊诚实提示该默认当前不可用并允许重选；画布新卡与派生自动回退到 `resolveAutoGenerationModel` 算出的健康可用模型，绝不把新卡钉在死模型上。
- **近期连败模型（24h 内连败 ≥2）**：`resolveAutoGenerationModel` 传入 `isModelRecentlyAiling`，自动跳过连败候选并实时反映在「自动 · X」文案与执行身份上。

---

## ★7 性能预算与量具

- **关联性能场景**：`composer-open-model-menu-models-200`（200 个可用模型规模下打开生成框左下模型下拉，含本次新增首项 `node.picker-auto-option` 与 `resolveAutoGenerationModel` 计算）。
- **预算**：中位数 ≤ `100 ms`（见 `docs/engineering/perf-scenarios.md`）。
- **复杂度保证**：`resolveAutoGenerationModel` 为单遍线性扫描 + 常量级梯队表查表（$O(N \log N)$，$N$ 为当前媒介可用模型数，200 规模下耗时 < `0.5 ms`），无额外 IPC 或远程请求。
- **实测证据落点**：`docs/evidence/2026-11-28-auto-model-perf/composer-open-model-menu-models-200.json`（5 次实测：中位数 `65.2 ms` / p95 `65.4 ms` / 长任务 `0` 个，远低于预算 `100 ms`）。

---

## 8 真实条件与数据规模

- **目录规模**：覆盖 0 模型（未接任何供应商）、单供应商部分模型（仅 Kie，验证 2.6 → 2.5 Sunburst 降级）、完整多供应商目录（APIMart + Kie 等 40–200+ 模型，含单能力模型 `Z-Image Turbo` 与样片行 `doubao-seedance-2.5-sample`）。
- **双语双主题与多窗口尺寸**：覆盖 `zh-CN` / `en` × `light` / `dark`，以及标准宽窗 `1280×800` 与最小窄窗 `700×720`（含窄生成框自动换行不截断）。

---

## 拍板图清单

- `AutoModel`: `policy.default-image-row`, `policy.default-video-row`, `policy.auto-caption`, `policy.picker-auto-option`, `node.model-chip-auto`, `node.picker-auto-option`, `edge.vendor-fallback`, `edge.none-available`, `edge.single-capability-pick`

---

## ★9 验收清单与回滚

### 正例与反例验收表

| # | 类别 | 场景 / 断言 | 预期结果（含反例） | 验证方式 |
| --- | --- | --- | --- | --- |
| 1 | 正例 | 已接 APIMart 打开「设置 › AI 策略」 | 显示「图片（文字出图 · 改图）→ 自动 · GPT Image 2.6 Sunburst」与「视频（文字出视频 · 图片出视频）→ 自动 · Seedance 2.5」两行及下方说明（`policy.default-image-row` / `policy.default-video-row` / `policy.auto-caption`） | 单测 + 实窗走查截图 |
| 2 | 正例 | 点开设置默认行下拉 | 顶部带「搜模型」，首项为「自动 · 实际模型名」+ 副标「这件事现在最强的」+ 选中对勾 + 分隔线（`policy.picker-auto-option`） | 单测 + 实窗走查截图 |
| 3 | 反例 | 仅接 Kie（无 `gpt-image-2.6-sunburst`） | 图片行显示「自动 · GPT Image 2.5 Sunburst」，**不许**印本机用不了的 2.6（`edge.vendor-fallback`、`auto.no-name-for-unusable`） | 单测 + 实窗走查 |
| 4 | 反例 | 本机 0 个可用图片/视频模型 | 两行均灰显「自动 · 暂无可用模型」，下方渲染可点「去接入供应商」并跳往模型页（`edge.none-available`） | 单测 + 实窗走查截图 |
| 5 | 反例 | 手选仅文生图的 `Z-Image Turbo` | 图片胶囊显示 `Z-Image Turbo`，副标变为「只能文字出图；改图时用自动（GPT Image 2.6 Sunburst）」；改图场景自动落到 `GPT Image 2.6 Sunburst`（`edge.single-capability-pick`） | 单测 + 实窗走查截图 |
| 6 | 反例 | 首选推荐模型处于 `isModelRecentlyAiling` 连败期 | `resolveAutoGenerationModel` 避让连败模型，界面「自动 · X」与节点实际 `modelKey` 同步切到下一健康推荐模型（`auto.name-is-what-runs`） | 单测 |
| 7 | 反例 | 旧版 `schemaVersion: 1` 四键 JSON 升级读取 | 不崩溃、不残留旧默认，归一为 `{ schemaVersion: 2, byKind: {} }` 回到「自动」（`SG-3`） | 单测 |
| 8 | 正例 + 反例 | 画布新建第一张图片卡手选别的模型，再新建第二张图片卡 | 第一张保持手选模型；第二张默认仍是「自动 · GPT Image 2.6 Sunburst」，**不跟随**上一张卡变化（`SG-2`）；在自动态卡上加参考图切改图，名字仍为「自动 · GPT Image 2.6 Sunburst」（`node.model-chip-auto` / `node.picker-auto-option`） | 单测 + 实窗走查截图 |
| 9 | 反例 | 英文窄生成框（如 360px 宽）显示 `Auto · GPT Image 2.6 Sunburst` | 模型胶囊完整显示不出现省略号截断，参数摘要胶囊自动换到下一行（`boundarySheet`） | 实窗走查截图 |
| 10 | 门岗 | 画板一致性与性能预算 | `pnpm run check:board-parity` 0 错误；`composer-open-model-menu-models-200` 中位数 ≤ 100ms | CLI 门岗 |

### 回滚方案

本改动聚焦在独立单提交 / PR 内：若上线后需回滚，直接 `git revert` 该合并提交即可恢复 `schemaVersion: 1` 合同与旧组件；因 v2 仅写 `generation-model-defaults.json`，旧版 `normalizeGenerationModelDefaults` 对缺 `byTaskKind` 的对象亦安全归一为空默认，回滚零崩溃。
