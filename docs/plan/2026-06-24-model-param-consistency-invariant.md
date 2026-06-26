# 模型参数一致性铁律：能力层 / 翻译层 / 不变量

> 2026-06-24 · 用户拍板方向：「**模型身份决定参数，与接入渠道无关**。同一个模型，不管从 apimart / kie / 自建中转接进来，用户看到、能调的参数完全一致；各家中转字段名不同是纯实现细节，不许漏到用户面前。」

## 0. 这是什么问题（根因，先讲清「为什么」）

Nomi 里「同名同参」靠**档案系统（archetype）**：模型身份 → 命中档案 → 出参数，**供应商无关**。这层是通的。

**但**档案里参数把**两件本该分开的事**搅在了一起：
- **能力**（这个模型有「分辨率」这个可调项）—— 应该全站一致。
- **线缆字段名**（apimart 管它叫 `size`，kie 叫 `aspect_ratio`，OpenAI 兼容站叫 `size` 但值是像素）—— 是各家私事。

现状用 `mode.vendorParams['apimart']` 给 apimart 焊一套字段名，基础层默认用 kie 的字段名。后果：

- **gpt-image-2 × 自建 new-api 中转（xcode-hk）**：档案基础层产 `aspect_ratio`（[gptImage2.ts:11](../../src/config/modelArchetypes/gptImage2.ts)），new-api codec body 读 `{{request.params.size}}`（[newapiTransport.ts:39](../../electron/catalog/newapiTransport.ts)）→ **永远对不上**：用户选的比例发不出去、分辨率根本没声明 → 中转拿到光请求 → 默认尺寸 / 报错。这就是「分辨率、比例很容易报错」的确切机制。
- 这不是孤例：**4 个 vendorParams 档案 × 任意非 kie/非 apimart 站**全中招（≥5 处确诊错位，见 §1）。
- **没有任何不变量**在守「档案产的 key 一定被 codec body 读到」——全人肉，错了静默丢字段不报错。

## 1. 现状盘点（规模）

- 档案 20 个；用 `vendorParams` 的 4 个（gpt-image-2 / seedream / nano-banana / kling，**全部只覆盖 apimart**）。
- codec 12 个（kie×6 / apimart×3 / modelscope / volcengine / new-api 通用）。
- 确诊错位 ≥5 处：
  1. gpt-image-2 × new-api：`aspect_ratio` vs `size`（用户点名的）
  2. 4 个 vendorParams 档案 × 任意 new-api 站：基础层(kie key) vs new-api body(`size`/`quality`)
  3. nano-banana × apimart：apimart 覆盖丢了 `output_format` 能力
  4. kling × apimart：`sound`(kie) vs `audio`(apimart) 同义不同名；`negative_prompt` 只 apimart 有
  5. [taskParams.ts:35](../../electron/catalog/taskParams.ts) 的 `size = firstString(extras.size, extras.aspectRatio)` 半吊子兼容层，部分掩盖错位、值得清理
- **强制对齐不变量：0 个。**

## 2. 目标架构（LiteLLM + Vercel AI SDK 双验证的两层结构）

### 2.1 能力层（Capability）— 统一、面向用户、一处声明

每个档案的每个 mode，**只声明一套规范化参数**（canonical key + canonical 值域），供应商无关。这就是用户在 UI 看到的——**处处一致**。

**Canonical 取值约定（关键决策，见 §5）：用 Nomi 中性、面向创作者的名**（如图像：`aspect_ratio` = `16:9` 比例 + `resolution` = `1K/2K/4K` 档位），**不绑任何单一供应商的字段名/格式**。理由：创作者「比例16:9 + 清晰度4K」比「size=3840x2160」直观得多；且真正做到 P4 与任何供应商解耦。

### 2.2 翻译层（Translation）— 按供应商，从能力层派生

每个 codec 声明一张**翻译表**：`canonical key → { 线缆字段名, 值转换 }`。支持三种翻译：
- **改名**：`aspect_ratio` →(apimart) `size`
- **值转换**：`{aspect_ratio:"16:9", resolution:"4K"}` →(OpenAI兼容) `size:"3840x2160"`（比例×档位查表→像素，4K 约束已 web 核实：长边≤3840、边为16倍数、比≤3:1）
- **丢弃**：该站不支持的 canonical 参数 → 显式标记「不支持」，渲染时不出该控件（仿 LiteLLM `drop_params` / `get_supported_openai_params`）

翻译层**不再平行声明一套参数**（删掉 `vendorParams` 那种 base/override 双 key 维护，P1）——能力只在能力层声明一次，codec 只负责翻译。

### 2.3 不变量（Invariant）— 把人肉对齐变成机器守护

新增一条**结构保证**（P2「这类不再复发」的核心）：

> 对每个 (档案, 有 codec 的供应商) 组合：档案能力层暴露的每个 canonical 参数，**要么被该 codec 翻译表覆盖、要么被显式标 unsupported**；二者必居其一，否则测试**红**。

这条测试现在就会把 §1 的 5 处错位全照红，且以后任何模型接新站、改字段都跑不掉。这是本次改造**最高价值**的产出——LiteLLM 的 `get_supported_openai_params` 形式化的正是这件事。

## 2.4 具体机制（定稿 · 受「op 持久化进 catalog JSON」约束）

**硬约束**：codec 的 `HttpOperation` 会被 seed 进 model-catalog.json（持久化），故翻译层**必须可序列化**——只能是数据 + 命名转换（transform 用字符串 id 引用 code 侧注册表），不能放函数。

**新增 `electron/catalog/paramTranslate.ts`（纯函数 + 可单测）**：
```
type ParamMapRule =
  | { wire: string; from: string }                       // 改名：wire <- canonical
  | { wire: string; fromMany: string[]; transform: string } // 值转换：wire <- T(canonical...)
  | { wire: string; const: string }                      // 常量
type ParamMap = { drops?: string[]; rules: ParamMapRule[] }
PARAM_TRANSFORMS: Record<string, (vals)=>string|undefined>  // 命名转换 code 注册表（如 ratio+res→openai 像素）
applyParamMap(map, params): params'         // 注入 wire 键（runtime 渲染 body 前调用）
consumedCanonicalKeys(map): string[]        // = 所有 from/fromMany 并集（给不变量）
bodyReferencedParamKeys(body): string[]     // 扫 body JSON 里的 {{request.params.X}} 令牌（给不变量）
```

**类型**：`electron/catalog/types.ts` 的 `HttpOperation` 加可选 `paramMap?: ParamMap`（纯数据，序列化安全）。

**插入点**：`electron/runtime.ts` 在 `buildTemplateContext` 之前 `params = applyParamMap(create.paramMap, params)`。body 模板不动（继续读 wire 键），wire 键由翻译注入。**改名/identity 透传不需写 paramMap**（canonical 键 = body 读的键时，值经 `...extras` 直达）；只在 wire≠canonical 或要算值时写 rule。

**不变量（`electron/catalog/paramConsistency.test.ts`）**：对每个内置档案 × 处理它的 vendor codec：
> `档案各模式 canonical 参数键 ⊆ bodyReferencedParamKeys(create.body) ∪ consumedCanonicalKeys(create.paramMap) ∪ create.paramMap.drops`
否则红。通用 new-api op 另测：图像/视频 canonical 词表被其覆盖或显式 drop。

**存量 catalog 迁移**：用户已接入的自建中转（xcode-hk）其 mapping 是**持久化的旧 op**（无 paramMap），seedBuiltins 只增不改→不会自动修。需加一条 `migrateCatalogForward` 幂等迁移：识别通用 relay 图像/视频 op 形状 → 补上 paramMap。否则架构改完用户那条旧 relay 仍不生效。

## 3. 落地顺序（一次性全量，内部按此序）

**Phase 0 — 不变量先行（红）**：先写「档案能力 ↔ codec 翻译覆盖」对照测试，让它把当前 5 处错位全照红。这步即「问题的可执行证明」+ 防回归地基。

**Phase 1 — 建翻译层机制**：在 `types.ts` 加 codec 翻译表类型（canonical key → wire field / transform / unsupported）；数据流（[archetypeMeta.ts](../../src/workbench/generationCanvas/nodes/controls/archetypeMeta.ts) / [archetypeInput.ts](../../electron/catalog/archetypeInput.ts) / [taskParams.ts](../../electron/catalog/taskParams.ts)）改成「canonical params → 翻译表 → body」。

**Phase 2 — pilot：gpt-image-2 收口**（用户真实痛点，证明模式）：
- 能力层声明 `aspect_ratio`(16档) + `resolution`(1K/2K/4K)，含约束（1:1 不可 4K、auto 仅 1K、5:4/4:5 仅 1K——已核 kie 官方文档）。
- 翻译表：kie(`aspect_ratio`+`resolution`)、apimart(`size`+`resolution`)、new-api/OpenAI(比例×档位→`size`像素 + `quality`)。
- 删 gpt-image-2 的 `vendorParams`（P1）。不变量对 gpt-image-2 转绿。
- **验收**：自建 new-api 中转上 gpt-image-2 出现分辨率控件且发送正确（真机/真生成走查）。

**Phase 3 — 滚平其余 3 个 vendorParams 档案 + 全档案过不变量**：seedream / nano-banana / kling 同法迁移并删 `vendorParams`；其余 16 档补齐翻译表 or 标 unsupported，直到不变量全绿。`vendorParams` 机制连同 [index.ts:103](../../src/config/modelArchetypes/index.ts) 的 `specializeArchetypeForVendor` 删除（P1：无并行版）。

## 4. 不动项 / 回滚 / 验收门

- **不动**：模型身份解析（identifierPatterns/archetypeId）、参考槽(slots)系统、变体轴(variants)、UI 控件类型（复用 `ModelParameterControl`，不造新控件）。
- **回滚**：分期独立 commit；翻译层是叠加机制，Phase 1 可独立 revert。
- **验收门**：①不变量测试全绿；②五门(gates)全过；③gpt-image-2 在 ≥2 类站（kie + 自建 new-api）真机走查分辨率一致出现且发送正确；④R7 六角色评审过架构。

## 5. 用户已拍板（2026-06-24）

- **D-A（canonical 命名约定）= 中性创作者友好**：用 Nomi 自己的中性名（图像 `aspect_ratio` 比例 + `resolution` 1K/2K/4K 档位等），翻译层负责转各站字段（含 OpenAI 像素）。与任何供应商解耦（真 P4）。
- **D-B（分期范围）= 一次性全量**：20 档案 + 12 codec 全部迁移到位，不留 pilot 半成品。内部仍按「不变量先行(红) → 建机制 → 全量迁移 → 全绿」顺序推进，但作为一个完整交付。

## 6. 参考

- LiteLLM 参数归一：OpenAI 为通用接口 + per-provider `map_openai_params()` + `get_supported_openai_params` + `drop_params`（docs.litellm.ai/docs/completion/input、/provider_specific_params）
- Vercel AI SDK：specification layer（中性规范）+ `providerOptions`（escape hatch）+ Gateway 统一选项翻译（ai-sdk.dev、vercel.com/docs/ai-gateway/models-and-providers/provider-options）
- kie gpt-image-2 契约：`aspect_ratio`(16档) + `resolution`(1K/2K/4K) + 约束（docs.kie.ai/market/gpt/gpt-image-2-text-to-image）
- OpenAI gpt-image-2：`size`(像素含 4K `3840x2160`) + `quality`，4K 约束（长边≤3840/边16倍数/比≤3:1）
