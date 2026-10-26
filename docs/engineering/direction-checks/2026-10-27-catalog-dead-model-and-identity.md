# 方向检查：目录退役模型与 headless 身份（B + C）

> **用户 10-27 拍板：三件都照推荐修；雷达 0.24 不加付费探针。**（实现：`docs/plan/2026-10-27-catalog-dead-model-and-identity.md`）

本线只做类根因复盘和现状特征测试，不改 `src/` / `electron/` 产品实现；结构性改法交协调和用户拍板。

## B：目录仍列 deepseek-v3.2，404 `model_not_found` 落未知

### 0. 一句话根因

目录把“被播种”当成可选，把“仍在 `/v1/models` 列表里”当成存活线索；Agent lane 又没有把未带 Nomi 结构标记的上游 `model_not_found` 身份交给统一分类器，所以模型已不可调用仍能被选，失败只剩“没见过的错误”。

### 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 09-07 退役模型复盘、`deepseek-v3.2-think` 现状迁移 | 只在 `RETIRED_APIMART_TEXT_MODEL_KEYS` 标记已知退役项；没有“列出但调用 400/404”的自动证据，也没有覆盖所有文本种子 | 目录种子生命周期与供应商 liveness 脱钩 |
| 本次 `deepseek-v3.2` | `APIMART_TEXT_MODELS` 仍被 `APIMART_CURATED_MODELS` 播种；缺少相应退役/探测收据 | 同上 |
| 本次 404 `model_not_found` | `providerFailureText` → `classifyGenerationError` 收到原始 JSON 时没有 `NOMI_VENDOR_ERR_B64`，`parseVendorErrorFromMessage` 不读普通 JSON；分类码和上游身份在 lane 边界丢失 | 上游错误身份未在最早共享边界结构化保留 |

### 2. 为什么会一直出现

`APIMART_TEXT_MODELS` 是手写 curated 源（`electron/catalog/seedBuiltins.ts:193` 读入），`applyBuiltinSeeds` 经 `electron/catalog/catalogStore.ts:155` 在启动时落目录。`src/devlab/designLab/catalogLiveness/states/01-listing.tsx:19` 还直接读同一源做展示。它们没有共享的“可调用”事实；`GET /v1/models` 只能说明被列出，不能说明 chat 调用成功。上一次合同已明确留下这个缺口：雷达只做列表 diff，不能发现“仍列出但调用失败”的模型。

404 失败进入 `src/workbench/ai/v4/useAgentPanelV4Data.ts:242` / `src/devlab/designLab/v4/agentPanelV4LabKit.tsx:102` 的 `providerFailureText`，再经 `classifyGenerationError` 的 8 个调用门。带 Nomi 结构标记的生成路径已有 `model_not_found → model-unavailable-upstream`，但 Agent lane 的原始 JSON 没有走同一载荷合同，于是落 `unknown`。

这违反 ⑪「能选到」：档案/目录的可选项没有从可验证的能力事实生成；也违反 ⑫「点了=以为的」：用户点的是可用大脑，实际是确定性 404，却得到未知错误。

### 3. 不改结构的可验证预测

| 预测 | 验证 |
|---|---|
| 仍有其他“列表在、调用死”的文本模型会继续进入目录 | 对每个 `APIMART_TEXT_MODELS` 做两次最小 chat 调用；这会花额度，当前不执行 |
| 只有 Agent lane 的裸 JSON 会落未知，带 `NOMI_VENDOR_ERR_B64` 的生成路径会正确分类 | `pnpm exec vitest run src/workbench/ai/lane/laneCommandFailure.test.ts --pool=threads --maxWorkers=1` 与现有 `classifyGenerationError.test.ts` 对照 |
| 只删种子不处理存量，旧安装会保留该行；只写 retired 清单不删种子，启动会重新播回 | 用存量 `CatalogState` 跑 `applyBuiltinSeeds` 的迁移测试；当前已有 `deepseek-v3.2-think` 的旁注测试，未覆盖 `deepseek-v3.2` |

### 4. 靶子独立性检查

现状测试分别调用真实目录种子函数和 Agent lane 的纯分类/文案函数，oracle 不复用实现内部的预期分支。历史上 09-07 合同把“列表不等于 liveness”写成残余风险，说明靶子本身没有把列表当成功标准。此次不接真实供应商、不重测已记录的 10-18 / 10-25 证据。

### 5. P0：自写与现成方案

目录种子、退役迁移和错误分类是 Nomi 的领域边界；HTTP 错误码解析、OpenAI 兼容 JSON 解析、定时探针属于通用能力。仓库已有统一分类器和上游错误载荷合同，不能再为 APIMart 写供应商分支。模型雷达按 `docs/plan/2026-08-27-vendor-model-radar.md` 只做确定性发现、零额度；推理探针不属于发现层。

### 6. 接入 / 补 / 重写 / 删对比

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 让 Agent lane 复用统一 `VendorErrorStructuredLite`/`classifyGenerationError`；目录继续由 `APIMART_TEXT_MODELS + RETIRED_*` 单一边界管理 | 需补齐 lane 的上游 JSON 结构化传递 | 改动 IPC/错误载荷契约，需全调用门回归 | **B 的错误分类推荐** |
| 补 | 在 `APIMART_TEXT_MODELS` 旁加更多手写退役分支，并在 lane 里加 `model_not_found` 字符串特例 | 少量文件，继续累积热点 | 新供应商/新错误形状再漏；第三个特例分支 | 不推荐 |
| 重写（限一个模块） | 把雷达改成带付费 chat liveness probe | 供应商额度、凭据、重试和误报收口都要新建 | 发现层烧额度，违反零额度雷达规则 | 不推荐 |
| 删 | 删除全部 APIMart 文本种子，改为用户自行接入 | 目录选择和默认大脑消失 | 破坏现有用户路径，不能解决其他供应商 | 不推荐 |

**雷达探针结论：不在 `nomi-model-radar` 发现层加调用探针。** `/v1/models` GET 不花生成额度但测不到本案；chat 推理探针会花额度（即使最小 prompt 也可能计费），不符合“发现层不烧额度”。若要做，应另立 opt-in、预算明确的认证/付费 canary，不能把它伪装成每日雷达。

**推荐**：保留零额度列表发现；在统一错误载荷边界补上裸 JSON 的 `model_not_found` 身份；目录退役仍采用“删 curated 行 + 同提交加 retired + 存量迁移”的成对规则。两者分别解决“用户点到死模型”和“点完只得到未知”两个事实缺口。

### 7. 用户要权衡的核心

要不要用可控的付费 liveness 预算换更早发现死模型；零额度发现便宜但只能发现“消失出列表”，付费探针才覆盖“仍列出但不可调用”。

### 特征测试

- `electron/catalog/seedBuiltins.test.ts`：`现状：deepseek-v3.2 仍在可选目录里（上游 404 前没有目录级拦截）`，绿；记录当前种子仍返回 enabled 文本模型。
- `src/workbench/ai/lane/laneCommandFailure.test.ts`：`现状：HTTP 404 的 model_not_found 原始 JSON 落进「服务商返回了一个没见过的错误」`，绿；记录当前 Agent lane 的 unknown/unclassified 行为。

## C：自写能力合同上限没有进入第一道 headless 闸

### 0. 一句话根因

模型的完整身份（尤其 `meta.customCapabilityContract`）没有沿 headless 参数链传递；`applyHeadlessParamDefaults` 只收 `archetypeId`，于是 `referenceKeyCapacityDeclarationFor` 退回通用键形状，拿不到自写合同的 `max`，N+1 张参考可以投影进 body。

### 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 10-25 `90bae3472` | headless 参考投影首次集中到 `taskParams.ts`，但只按通用键/内置档案声明取容量 | 参考身份没有和参数投影共用完整模型身份 |
| 10-25 `d68b3cc38` | 增加派生载体和拒发规则，仍没有把自写合同元数据带进第一闸 | 同上 |
| 10-25 `e0c085b79` | 已把容量收窄到模型声明，但 runtime 传给 `applyHeadlessParamDefaults` 的仍只有 `archetypeId` | 同上，第三闸和第一闸身份不一致 |

### 2. 为什么会一直出现

门表如下：

- `applyHeadlessParamDefaults`：`electron/capabilityCore/apimartGenerationProvider.ts:269`、`electron/runtime.ts:314` 两个调用门；当前两者都只交 `archetypeId`/`modelKey`。
- `projectReferencesOntoBodyKeys`：`electron/catalog/taskParams.ts:156`；它的三个容量读取门在 `taskParams.ts:627/652/671`。
- `referenceKeyCapacityDeclarationFor`：`electron/catalog/referenceReachability.ts:151` 与 `electron/catalog/taskParams.ts` 的投影调用；完整档案由 `resolveArchetypeForModel` → `customCapabilityArchetypeForModel`（`electron/shared/modelArchetypes/index.ts:209`）解析。
- 第三闸：`modelReferenceSelection` 在 `electron/catalog/modelCatalogListing.ts:180`、`electron/runtime.ts:319`；`modelModeBodies` 在 `electron/runtime.ts:319`。这里拿的是完整 `meta`，所以不受第一闸现状影响。

`modelReferenceSelection` 与第三闸已经共享完整身份，第一闸却在参数层缩成 `{ archetypeId }`。同一个模型由不同调用口得到不同容量事实，违反 ⑩「说的=摆的」：合同写 max=N，发送前第一道检查没有验证到 N；也违反 ⑪「能选到」：自写档案的声明没有覆盖 headless 入口。

### 3. 不改结构的可验证预测

| 预测 | 验证 |
|---|---|
| 任何自写合同的有上限图片/视频/音频槽都能在第一闸放过 N+1 | 参数测试把 `max: 8` 换成各族、各 body 别名，现状都不抛 |
| 内置档案同样输入会在第一闸抛出容量错误 | 用已有 `referenceKeyCapacityDeclarationFor`/容量测试对比带 `archetypeId` 的完整上下文 |
| APIMart provider 与 runtime 两个 headless 入口会保持同样的丢字段行为 | 对两个调用门各做 loopback 参数投影，断言结果不含合同上限收据 |

### 4. 靶子独立性检查

现状特征测试直接调用纯 `applyHeadlessParamDefaults`，只验证投影结果有 9 张，不调用真实供应商、不依赖修复后的 helper。第三闸已有独立完整身份收据，能作为反例对照；本线不把第三闸的绿灯当第一闸完成。

### 5. P0：自写与现成方案

自写合同是 Nomi 必须保留的领域约束；容量解析、模型身份解析和 headless 投影是通用结构，仓库已经有现成单一真相：`customCapabilityArchetypeForModel`、`resolveArchetypeForModel`、`referenceKeyCapacityDeclarationFor`。不应在 `taskParams.ts` 再写一套 custom contract 解析或按模型 key 特判。

### 6. 接入 / 补 / 重写 / 删对比

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | `applyHeadlessParamDefaults` 改收 `modelReferenceSelection(...)` 产生的完整身份/上下文；两个调用门与第三闸共用 | 调整纯函数签名、两处调用和类型测试 | 需更新所有调用者；可由类型和门表守住 | **推荐** |
| 补 | 在 `taskParams.ts` 单独读取 `customCapabilityContract` 并补容量分支 | 少改调用口 | 与 `resolveArchetypeForModel` 分叉，下一种合同/槽形继续漏 | 不推荐 |
| 重写（限一个模块） | 重写整个参考投影/容量系统 | 文件多、回归面大 | 丢掉已过的投影/别名兼容性 | 不推荐 |
| 删 | 删除自写合同容量限制或只保留第三闸 | 眼前少一处异常 | 请求已投供应商才暴露，可能白花钱 | 禁止 |

**推荐**：把 `modelReferenceSelection(...)` 的完整上下文作为 `applyHeadlessParamDefaults` 的唯一身份输入，删掉只传 `archetypeId` 的缩减对象；让第一闸、第三闸和目录清单共用同一个解析结果。第一闸仍在发出前拒绝，不能只依赖第三闸。

### 7. 用户要权衡的核心

是继续容忍 headless 与第三闸的身份分叉，还是现在改签名让一次完整身份贯穿三道闸；前者少动代码但保留白花钱窗口，后者会触及两个热点调用口。

### 特征测试

- `electron/catalog/taskParams.test.ts`：`现状：带上限 8 的自写合同，headless 给 9 张参考时第一闸不拒`，绿；当前结果把 9 张投影到 `image_urls`。

## 结构性结论

B 和 C 都是 recurring，不是一次性数据错。B 需用户拍板“零额度雷达 + 统一错误载荷”与“另立付费 liveness canary”的边界；C 推荐直接换成完整 `modelReferenceSelection` 身份输入。两项都应删掉现有缩减/猜测路径，而不是继续添加供应商或模型特例。
