# Plan：模型档案层（Model Archetype）+ 模式原语 —— 接入 Seedance 2.0 / HappyHorse（kie.ai）

> 触发：用户要接 Seedance 2.0、HappyHorse（经 kie.ai），现有 UI 承接不了「生成方式/参考模式/多参考图」。
> 用户已拍板三个方向（2026-06-05）：
> 1. schema 来源 = **混合**：内置 curated 档案优先，长尾模型回退 onboarding 解析。
> 2. 模式建模 = **档案内 `modes[]`**，一个模型条目内多模式（Seedance 同 model 变 input；HappyHorse 4 端点合 1）。
> 3. 本地文件/项目改造 **分开做**，本轮先把模型接入跑通。
>
> 关联：`docs/audit/2026-06-05-multidimensional-audit.md`（P0-3 catalog 类型单一真相源）、
> `docs/onboarding-trials/m5-install-kling3…/final-mapping.json`（同契约已验证）。
> 规则：本文是 Rule 4 执行文档；UI 走 Rule 8 样张（见 `docs/design/mockups/`）+ Rule 7 六角色评审（见文末）。

---

## 决策锁定（2026-06-05，评审后用户拍板）

1. **第一刀 = 薄垂直片**：Seedance 2.0 / 首帧 / 一次真实生成（采纳 S1）。
2. **模式名保留 vendor 原词**（首帧 / 首尾帧 / 全能参考）——**不改成意图词**（用户拍板，覆盖 U1 的「意图词」建议）。
   - 但 U1 暴露的真实痛点仍要缓解，**不靠改名而靠辅助提示**：保留每模式下方一行 what/when 说明；在 prompt 框旁给 character→prompt 词链接提示（U2）；避免「全能参考」入口被埋（放在与首尾帧同级、清晰可见）。
3. **P0-1 typecheck 门 = 硬前置**（C0 先做），P0-9/P0-2 并行可插队不阻塞。
4. U2/U3 的样张实 bug（重复徽标、`--nomi-line-soft`、划掉的 `—`、enum 泄露、omni 分组）照修。

## UI 定稿（2026-06-05，样张 v3 + 设计/用户 Agent 多轮评审后）

样张：`docs/design/mockups/2026-06-05-model-composer-v3.html`（交互可点，含 Seedance/HappyHorse/未识别三态）。
经设计 Agent + 真实用户 Agent 多轮评审，用户逐项拍板，最终结构定稿如下：

1. **输出与参数框分离**：上面「要被生成的图片/视频」是独立节点（空态用斜纹占位 + 「等待生成」）；下面「参数框」把 **参考 + 描述 + 设置合一** 成一张卡。
2. **生成方式常驻参数卡顶**（作参考区的头），**不进弹层** —— 切模式时正下方的参考槽当场变化、全程可见（解决遮挡 + 模式↔参考脱节）。
3. **设置弹层只放标量参数**（比例/清晰度/时长/音频），**往下弹**不盖内容；底部芯片摘要只显示标量（模式已在卡顶，不重复）。
4. **参考输入合并**：每组一个「+ 添加」，加了才出缩略图 chip；角色图按序标 ①②③ = prompt 里 `character1/2/3`，组下一条共享说明 + prompt 旁提示。
5. **统一意图词 + vendor 副标签**（拍板）：生成方式按钮用跨模型统一的意图词（`角色参考 / 单图首帧 / 首尾帧 / 文生视频 / 视频编辑`），各模型自己的叫法做小副标签（「该模型称『全能参考』/『reference-to-video』」）。
   - 意图 taxonomy：`text / single / firstlast / character / edit`；每个模型的模式 map 到其中之一。
6. **切模型保留参考图 + 落到同意图模式**（拍板）：切模型时不清空已放的角色图，自动落到目标模型里「同意图」的模式（找不到则落到 character 模式），照片不消失。
7. **识别 / 通用回退**：模型芯片上常驻 `模板`(已识别) / `通用`(未识别) 标记；未识别走通用模式，按接入文档原样展示、不替用户合并、不藏能力。

**实现期 token 清理（记下，UI 实现时做，非样张定稿项）**：native `<select>` → `DesignSelect`；segmented → `DesignSegmentedControl`；卡片圆角用 panel 级（10）而非 modal（16）；浮层 chevron 写死色 → token；空的 参考视频/参考音频 组在未用时可进一步收成灰「+」；生成后输出节点替换占位。

> 注：上述是 UI 定稿；**接入的工程实现仍按本文 §8 重排后的 chunk 走**（C0 typecheck 门 → C1 Seedance 首帧薄垂直片 + 真实生成 → …）。UI 在 C2/C3 落地时以此样张为准。

## 0. 一句话结论

后端传输层**基本已经能跑**这 6 个模型（都是 kie 的 `createTask` + 轮询契约，和已验证的 Kling 3.0 试装同形）。
真正承接不了的是两层：**①「生成方式」模式原语**（含互斥/条件可见）、**② 多参考输入**。
解法：新增一层**内置「模型档案」**，curated 声明 `modes[] → 每模式的 typed 输入槽 + 标量参数 + 传输路由`；
现有 Mapping 层只管 baseUrl/auth/端点形状；onboarding 解析降级为长尾回退。

---

## 1. 范围

**做（本轮）：**
- 新增内置档案注册表（`src/config/modelArchetypes/`）：先覆盖 `seedance-2`、`seedance-2-fast`、`happyhorse`（4 模式合一）。
- schema 层（`modelCatalogMeta.ts`）支持「档案优先，无档案回退现有 flat 解析」。
- 生成节点 UI（`NodeGenerationComposer` / `NodeParameterControls`）支持：模式分段切换、切换后输入槽随之增减、多参考槽（数组，带 min/max）、互斥（只渲染当前模式的输入）。
- 运行时（`runtime.ts` `taskTemplateParams` + kie 的 Mapping）支持：模式决定的 `model` enum 覆盖、`input.*` 数组键、轮询端点。
- kie vendor + 6 个 model 条目 + mapping 入 catalog（内置 seed，而非靠用户逐个 onboarding）。

**不做（本轮明确不碰）：**
- 本地文件 vs 项目的解耦（用户拍板分开做，另起文档）。
- `@素材` 内联标签引用系统（先用命名 typed 槽，标签留作后续增量；见 §4 决策 D3）。
- 参考视频/参考音频的**录制/裁剪**等编辑能力（本轮只做「指定一个已有素材 URL/asset」）。
- video-edit 的源视频上传 UI 细节超出本轮（happyhorse/video-edit 先做档案声明，UI 槽位复用 source_video，但不在首批样张重点验证）。
- 不动 Scene3D、时间轴、导出。

---

## 2. 6 模型真实参数面（调研定稿，含坑）

所有模型：`POST https://api.kie.ai/api/v1/jobs/createTask`，body `{ model, callBackUrl?, input:{…} }`，返回 `{ code, msg, data:{ taskId } }`，轮询取结果。

| 模型 (model enum) | 模式 | 参考输入（input key） | resolution | aspect_ratio | duration | 其它 input |
|---|---|---|---|---|---|---|
| `bytedance/seedance-2` | 首帧 / 首尾帧 / 全能参考（3 互斥） | `first_frame_url`、`last_frame_url`；`reference_image_urls`[≤9]、`reference_video_urls `[≤3]、`reference_audio_urls`[≤3] | 480/720/1080 (def 720) | 1:1/4:3/3:4/16:9/9:16/21:9/adaptive (def 16:9) | 4–15 (def 5) | `generate_audio`(def true)、`web_search`、`nsfw_checker` |
| `bytedance/seedance-2-fast` | 同上 | 同上 | 480/720（**无 1080**） | 同上 | 4–15 | 同上 |
| `happyhorse/text-to-video` | 纯文 | 无 | 720/1080 (def 1080) | 16:9/9:16/1:1/4:3/3:4 | 3–15 | `seed` |
| `happyhorse/image-to-video` | 单图首帧 | `image_urls `[**正好 1**，仅首帧] | 720/1080 | **无 aspect_ratio** | 3–15 | `seed` |
| `happyhorse/reference-to-video` | 角色参考 | `reference_image`[1–9，按序=character1..9] | 720/1080 | 16:9/9:16/1:1/4:3/3:4 | 3–15 | `seed` |
| `happyhorse/video-edit` | 视频编辑 | `video_url`[1] + `reference_image `[0–5] | 720/1080 | — | — | `audio_setting`(auto/origin)、`seed` |

**两个必须照搬的坑：**
1. **尾随空格 key**：`reference_video_urls `、`image_urls `、`reference_image ` 文档里 key 带尾随空格。映射模板/档案的 `inputKey` 必须**逐字符照抄**（含空格），否则上游 422。→ 档案里用显式字符串字段记录，加测试断言。
2. **Seedance 三模式互斥**：首帧 / 首尾帧 / 全能参考 三类不可混用；文档示例里混了所有字段是错误示范。UI 只能让用户处于一个模式，发请求只带该模式的 input key。

**待运行时核对的一点**：轮询端点。Kling 3.0 试装用的是 `GET /api/v1/jobs/recordInfo?taskId=`，而这 6 个 market 模型文档写的是 `/market/common/get-task-detail`。落地时先用真实 taskId 核对 query 端点路径（写进 mapping 的 `query.path`）。

---

## 3. 架构：三层 + 数据流

```
┌─ 内置 Model Archetype（新，curated，src/config/modelArchetypes/）
│   档案 = { id, family, label, kind, modes[], defaultModeId, transport }
│   mode = { id, label, modelEnum, slots[], params[], prompt:{required} }
│   slot = { kind, label, min, max, inputKey, asArray, accept[] }
│   param= { key, binding, label, control, options[], default, min, max }
│        ▼ Model.meta.archetypeId 引用
├─ Model Catalog（现有，electron/runtime.ts）
│   Vendor(kie) + Model(6 条，meta.archetypeId 指向档案) + Mapping(kie createTask+poll)
│        ▼ IPC
├─ 渲染层 schema 解析（现有 modelCatalogMeta.ts，加档案优先分支）
│   有 archetypeId → resolveArchetype()，产出带 modes 的富配置
│   无 archetypeId → 现有 flat 解析（长尾回退，不动）
│        ▼
└─ 生成节点 UI（NodeGenerationComposer / NodeParameterControls）
    模式分段切换 → 当前模式的 slots+params 渲染 → 写入 node.meta
```

**数据流（生成一次）：**
1. 用户在节点选模型 → 解析档案 → 默认模式的输入槽/参数渲染。
2. 用户切模式 → 重渲染输入槽（互斥：只显示当前模式的）。
3. 填参考素材（数组槽 1..max）+ 标量参数 + prompt → 写 `node.meta`：
   `{ archetypeId, modeId, refs:{ [slotKind]: string[] }, params:{ [key]: value } }`。
4. 运行：`catalogTaskActions` 把上面打包成 `TaskRequestDto.extras`，**额外带 `modelEnum`（来自当前模式）**。
5. `runtime.ts`：`taskTemplateParams` 根据档案/extras 构建 `input` 对象（数组键照抄含空格的 key），`model` 字段用 `modelEnum` 覆盖 catalog modelKey。
6. mapping `create` 发 `createTask`；异步 → 缓存 taskId；`query` 走 get-task-detail 轮询；结果 URL 落地到项目 assets。

---

## 4. 关键决策（Rule 3 对比，已拍板项标注）

**D1 模式建模（已拍板：档案内 modes[]）**

| 方案 | 用户看到 | 代价 |
|---|---|---|
| ✅ 档案 modes[] | Seedance 1 条、HappyHorse 1 条；进去切模式 | schema 加 mode/条件可见/互斥三概念 |
| 每模式独立模型条目 | HappyHorse 列表里 4 个近同名条目 | Seedance 3 模式同 model 无法这样拆；违反统一 UI |

**D2 schema 来源（已拍板：混合）**：内置档案优先 + onboarding 回退。

**D3 参考输入 UI（本轮取 A，标签留增量）**

| 方案 | 用户看到 | 代价 | 本轮 |
|---|---|---|---|
| A 命名 typed 槽 | 首帧/尾帧/角色1..9 槽位，清楚谁是谁 | 要把数组顺序映射成可见标签 | ✅ 先做 |
| B `@素材` 内联标签 | prompt 里 @图片1，角色映射内联可见（即梦/Krea 式） | @ 唤起面板 + 内联 tag 渲染，工作量大 | 后续增量 |

理由：A 成本低、已能满足「9 图按序=character1..9」并把顺序显性化（槽位号即 characterN）；B 是体验更佳的增量，单独走样张+评审。

**D4 互斥的呈现**：参考 Pika/Kling——**只渲染当前模式的输入**（hide 而非 disable），切模式即换整组。Seedance 切到「全能参考」时首/尾帧槽消失，换成 9 图/3 视频/3 音频槽。

**D5 HappyHorse 的 model enum 覆盖**：HappyHorse 一个 catalog Model，4 模式各自 `modelEnum` 不同。请求时用「当前模式的 modelEnum」覆盖 catalog 的 modelKey。需要 runtime 支持 `params.model` 注入（见 §5）。

---

## 5. 改动点清单（按层，含文件）

**新增（内置档案）**
- `src/config/modelArchetypes/types.ts` —— 档案/模式/槽/参数类型（< 200 行）。
- `src/config/modelArchetypes/seedance.ts`、`happyhorse.ts` —— curated 档案数据（各 < 200 行）。
- `src/config/modelArchetypes/index.ts` —— `resolveArchetype(id)` 注册表 + 查询。
- 测试：`*.test.ts` 断言 6 模型档案的 inputKey（含尾随空格）、enum、min/max、模式互斥集。

**schema 解析（渲染层）**
- `src/config/modelCatalogMeta.ts` —— 加「`meta.archetypeId` 存在 → 走档案解析」分支；档案产出的富配置类型新增 `modes`、typed `slots`。**无 archetypeId 的旧路径完全不动**（长尾回退）。

**UI**
- `src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx` —— 顶部加模式分段切换（仅当档案有 >1 模式时显示）；面板宽度按当前模式控件数算。
- `src/workbench/generationCanvas/nodes/NodeParameterControls.tsx` —— 按当前模式渲染 typed 槽（多图数组、视频、音频）+ 标量参数；写回 `node.meta.refs/params/modeId`。**注意 Rule 12：该文件已 1097 行**，新增逻辑须抽子模块（如 `modeControls.tsx`、`referenceSlots.tsx`），不得把本文件喂大。

**运行时 / 传输**
- `electron/runtime.ts` `taskTemplateParams`(L1972)/`firstReferenceImage`(L1960) —— 支持数组参考键（照抄含空格 key）、`model` enum 覆盖、`input.*` 嵌套构建。
- kie vendor 的 Mapping —— `create` body 模板 `{ model:{{params.model}}, callBackUrl:"", input:{…} }`；`query` 走 get-task-detail（核对路径）；`statusMapping` 归一上游状态。
- `src/workbench/api/taskApi.ts` `TaskRequestDto` —— extras 带 `modelEnum`、`modeId`、refs/params（或扩字段，避免全塞 extras）。

**catalog seed（内置 6 模型，不靠用户 onboarding）**
- 一个内置 seed：首次启动若无 kie vendor + 这 6 个 model，则写入 catalog（vendor 留空 apiKey，用户只需填 key）。位置：`electron/runtime.ts` catalog 初始化/迁移处（version 3→4 迁移加 seed）。

**类型单一真相源（顺带还 P0-3）**
- 档案类型放渲染层 `src/config`，但 `BillingModelKind`/`Vendor`/`Model`/`Mapping` 的单一真相源问题（audit P0-3）若挡路，抽 `electron/catalog/types.ts` 复用——否则本轮不强求。

---

## 6. 回滚策略

- 档案层是**纯新增 + 旁路**：`meta.archetypeId` 不存在时走旧 flat 路径，旧模型零影响。
- catalog seed 用 migration version 门控；回滚 = 删 seed 的 6 条 + 不写 archetypeId。
- UI 改动集中在 composer/控件，档案解析失败要 graceful 回退到 flat（不白屏）。
- 每个 chunk 独立 commit（Rule 11）：①档案类型+数据+测试 → ②schema 解析分支 → ③UI 模式切换+槽 → ④运行时数组键+enum 覆盖 → ⑤catalog seed + mapping。build 绿 + vitest 不回归才提交。

---

## 7. 验收门

- **单测**：6 模型档案断言（inputKey 逐字符含空格、enum、min/max、模式互斥集）；taskTemplateParams 构建 `input` 的快照测试（含数组键、model 覆盖）。
- **构建**：`pnpm build`（vite + electron tsc）绿；`npx vitest run` 不回归；`pnpm run check:filesize` 不红（NodeParameterControls 不得变大）。
- **穿透走查（Rule 13）**：Playwright `_electron` 起真实 app，对 Seedance 走「选模型→切首尾帧/全能参考→看槽位增减→填参考→看请求 body」逐步截图；**真实外呼花额度的生成步骤先问用户**，默认 stub。
- **样张（Rule 8）**：模式切换交互的 HTML 样张 + 设计师/真实用户 Agent 过审 + 用户本人确认后才进 UI 实现。

---

## 8. 六角色评审（Rule 7）—— 已执行，结论回填

6 个角色并行评审。**多维独立命中 = 最强信号**，按命中维度排序：

### 🔴 必改（多角色命中）

**M1 单一真相源：传输塑形知识必须只写一处（CTO+后端+前端）。**
档案里的 `inputKey`（含尾随空格）/`modelEnum`/`asArray` 既被渲染层用、又被 `runtime.ts taskTemplateParams` 用。若渲染层拥有档案、runtime 再从 extras 重新推导，就是 audit P0-3 的「双真相源」下沉一层。
→ 把档案的**传输塑形那一半**放进 `electron/catalog/`（两端 `import` 同一份），并顺带做掉 P0-3（抽 `electron/catalog/types.ts` + 统一 `BillingModelKind`）。这是 chunk 0 前置，不是「挡路才做」。

**M2 别再 `extras:{...meta}` 整包灌（前端+CTO+后端，最高危）。**
现状：切模式时 `removePreviousControlParams` 只删当前渲染的控件键，omni 模式的 `reference_image_urls` 等键留在 `node.meta`；`catalogTaskActions.ts:318` 的 `extras:{...meta}` + `runtime.ts:1979` 的 `...extras` 把**上一个模式的残留键**原样发上游 → 正是 §2 坑2 的「三模式互斥」被我们自己的状态管线破坏，Seedance 422。
→ ① `node.meta.archetype` 命名空间化：`{ archetypeId, modeId, refsByMode:{[modeId]:{[slotKind]:string[]}}, paramsByMode:{...} }`，切模式即整组 swap、切回还原（顺带解决真实用户 F4「怕丢上传」）。② 构建请求时**只投影当前模式声明的 inputKey**（逐字符含空格），不走 `...meta`。③ `taskTemplateParams` 直接按档案构建完整 `input` 对象，kie mapping 的 `create.body` 退化成 `{ model, input }` 透传。④ 删掉那套「一值写 6 个别名键」的霰弹（档案声明精确键，无需别名）。

**M3 `model` enum 覆盖路径现在是断的（后端+CTO）。**
plan 原写的 `{{params.model}}` 在模板引擎里**解析不到**——`buildTemplateContext` 只暴露 `request.params.<key>` 和 `model.modelKey`（来自 catalog 行）。HappyHorse 4 模式合 1 行靠的就是 per-mode enum 覆盖。
→ `taskTemplateParams` 增发 `model`（取自 `extras.modelEnum`），mapping body 用 `"model":"{{request.params.model}}"`（注意是 `request.params.model`）。配快照测试断言 enum 覆盖 + 尾随空格键。

**M4 轮询端点未验证 + joinUrl 双前缀坑（后端+产品）。**
Kling 试装用 `GET /api/v1/jobs/recordInfo`（**已端到端验证**），market 文档写 `/market/common/get-task-detail`。且 `joinUrl` 对 `/api/v1/...` 开头 + baseUrl 已含 `/api/v1` 会拼成 `/api/v1/api/v1/...`。
→ seed mapping 先用已验证的 `recordInfo`，并用一次**真实生成**核对；统一用相对 `/jobs/recordInfo`（baseUrl=`…/api/v1`）并加 final-URL 断言测试。

**M5 文件不许长大（前端+CTO，Rule 12）。**
`NodeParameterControls.tsx` 1097 行、`runtime.ts` 2725 白名单巨壳——本方案不得喂大。
→ 具体拆分：`nodes/controls/parameterControlModel.ts`（搬出现有纯 helper ~300 行，立即让本文件缩到 800 以下）、`modeControls.tsx`（模式切换，用**已存在**的 `DesignSegmentedControl` src/design/forms.tsx:90，别手搓）、`referenceSlots.tsx`（typed 槽：image/video/audio/source 复用同一 picker 壳）、`archetypeMeta.ts`（meta 读写/投影）。input-builder 放新 `electron/catalog/` 模块，不进 runtime.ts。**验收门加一行：`check:filesize` 必须显示 NodeParameterControls 净减。**

**M6 边模型 vs N 数组槽不匹配（前端，最大未述实现风险）。**
`GenerationCanvasEdgeMode` 只有 3 个值，表达不了 9 个有序 character 槽。
→ 决策：omni/character 的多参考存为 **meta-only 数组**（不走画布边），首/尾帧仍可走边。建 UI 前先定。

### 🟡 范围/排序（产品+CTO 命中）

**S1 第一刀太大，切薄垂直片（产品，其余附议）。**
六模型 + 档案层 + 模式 UI + 多参考槽 + 运行时 + seed migration 一次全上，且都没跑过一次真实生成。
→ **第一片 = Seedance 2.0 / 首帧 / 一次真实生成**。它打穿每个架构风险（档案→catalog、schema 分支、runtime 建 `input.first_frame_url`、enum 路径、createTask+poll 对真实响应——顺带验掉 M4），但**故意不含**最难的模式切换 UI 和多参考数组槽。绿了再加：第二模式（验互斥 hide）→ 数组槽（验 character1..9）→ HappyHorse（验 enum-per-mode）。每片独立可发。

**S2 P0 前置（产品+CTO）。**
- **P0-1（渲染层从未 tsc）= 硬前置**：本方案加大量渲染层 TS，没 typecheck 门=新类型错静默合并、"build 绿"是假绿。先落 `tsconfig.app.json`+typecheck 门，让本功能成为第一个在真类型安全下写的东西。
- **P0-9/P0-2（信任命门/导出死锁）**：纯文案级 + 一行修复，比「接新模型」更便宜、对 1.0 第一印象更要命，建议插队（不阻塞本方案，但更该先做）。

### 🟢 体验（设计师+真实用户 高度一致）—— 走查/样张要落实

**U1 模式名是「模型黑话」，要按用户意图说话（真实用户最痛 + 设计师）。**
「全能参考」吓人、用户真要的「放人物照片」埋在第 3 个 tab。Seedance（首帧/首尾帧/全能参考）vs HappyHorse（文生/图生/角色参考/视频编辑）**同概念两套词、两个深度**，让用户不信这是同一种工具。
→ **跨模型统一意图词**：以「用我的人物照片」「首+尾帧过渡」这类意图为主标签，vendor 原词作副标签；同一意图（角色参考）在两个模型里同名同位。

**U2 character 标签：`ch1`≠`character1`，且当前样张渲染了两次（设计师 bug + 真实用户）。**
→ 每槽只留一个**数字徽标 1..9**（accent pill）+ 组下方**一条**共享说明「角色参考 · 顺序对应 prompt 的 character1…9」；并在 **prompt 框旁**提示「在描述里用 character1、character2 指代这两张图」，把槽→prompt 词的链接放在用户打字的地方。顺序要显性（character1 = 哪张缩略图）。

**U3 设计 rule-2 噪音（设计师）**：i2v/edit 无比例时**直接隐藏**「比例」而非划掉的 `—`；底部 `→ happyhorse/image-to-video` 原始 enum 泄露工程语（真实用户也嫌），收起；omni 的 9 图/3 视频/3 音频要**分组带小标题**，不要一条 flex 混排；空槽用 1px dashed（1.5px 留给选中态）；segment 用 `shadow-sm`；补 `--nomi-line-soft` 或干脆去掉页脚边框（spacing 优先于 border）。

### 综合结论
方案**方向成立、抽象正确**（6/6 未推翻档案层），但 **GO-WITH-CHANGES**：先做 M1/M2/M3 的单一真相源 + 投影 + enum 路径（否则互斥在线上不成立），按 S1 切薄第一片并用真实生成验 M4，UI 按 U1/U2 重做标签后再进实现。已据此重排 §6 chunk（见下）。

### 重排后的 chunk（取代 §6 原节奏）—— 执行回填
- **C0（前置）✅**：P0-1 typecheck 门 + 抽 `electron/catalog/types.ts` 统一 `BillingModelKind`（P0-3）。
- **C1（薄垂直片）✅**：Seedance 首帧档案 + schema 分支 + runtime + kie mapping（recordInfo）+ 内置 seed + 完整 Playwright e2e（含 M4 端点核对、尾随空格断言）。
- **C2a ✅**：首尾帧传输 + M2 互斥投影（空帧不进 body）。
- **C2b ✅**：模式分段切换（统一意图词 + vendor 副标签）+ 命名空间 meta + 首尾帧 UI（验 M2 互斥 hide）。`NodeParameterControls` 1097→605 出巨壳白名单。
- **C3 ✅**：全能参考多参考数组槽（character1..9 meta-only，验 M6）+ U2/U3；`electron/catalog/archetypeInput.ts` input-builder（M5）。
- **C4 ✅**：HappyHorse 4 模式合 1（验 M3 per-mode enum 覆盖）+ 内置 seed（幂等 exists-or-skip，非版本迁移）。
- 各 chunk：CI 五门绿（filesize/lint:ci/typecheck/vitest/build）+ Rule 13 零额度走查（`tests/ux/archetype-modebar.e2e.mjs`，14 断言）。

**架构演进（回填，比原 §3 更准）**：
- 传输塑形最终落在 **renderer 的 `buildArchetypeInputParams`**（archetypeMeta）：据当前模式把参考值打成完整
  snake `input` 参数（含 per-mode `model` enum），放进 `extras.archetypeInput`，runtime 的 `referenceInputParams`
  原样采用（单一来源 M1，互斥 M2 在此发生，§2 坑2 不再可能）。slot 增 `inputKey`/`asArray`（模型契约键，
  供应商无关）；mode 增 `modelEnum`（M3）。供应商的尾随空格 quirk（§2 坑1）只在各 kie mapping body 照抄一次。
- HappyHorse 4 模式统一走 `(kie, text_to_video)` 一条 mapping（kie 按 model enum 自分流），避开和 Seedance
  的 `(kie, image_to_video)` 撞车；`resolveTaskKind` 对「有 modelEnum 的档案模式」归一到 text_to_video。

**待用户额度验证（真实外呼，未跑）**：Seedance `tests/ux/seedance.e2e.mjs` + HappyHorse `tests/ux/happyhorse.e2e.mjs`
（均 `KIE_API_KEY` 门控）—— 真实生成验上游接受 per-mode enum + 尾随空格 input 键。离线传输测试已全覆盖契约形状。
