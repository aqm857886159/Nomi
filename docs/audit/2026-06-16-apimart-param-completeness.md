# apimart 13 模型参数完整性对账（官方文档 vs 实现两层）

> 2026-06-16。R5 抓全官方 `generation.md` × 4 个并行对账 agent。两层 = archetype params（UI 控件）+ catalog body（请求体映射 `electron/catalog/apimart{Videos,Images}.ts`）。
> Seedance 2.0（4 变体）已在 5a110b1 做完，不在本轮。

## 决定性事实（约束方案）

- **Nomi 节点 = 单产出**（grep 无 `n`/batch/多图概念，`nodeContext.ts` resultUrls 实际单图）→ 官方 `n`（一次多张）**不适配，确定跳过**，不算漏。
- **`generation_type` 首尾帧有先例**：Seedance 用 `first_frame`/`last_frame` 槽 + `combineSlotsInto`（seedanceApimart.ts:53-56）→ Veo/Omni 首尾帧可复用同原语。
- **catalog body 是显式白名单转发**（imageCreateOp/videoCreateOp 只铺手列的键）→ 补任何参数**两层都要改**（archetype params + catalog body），漏一层静默丢。

## 用户拍板（2026-06-16）

**范围 = A + B + C + E + 只加 negative_prompt**（"全覆盖能力/模式/变体可达 + 不报 400"，可选开关只暴露高价值的 negative_prompt，其余 good-default 开关用默认值不暴露，保持参数条极简）。Tier D 其余开关、Tier F 大特性不做。

**机制新增**（通用，P4）：
- `ArchetypeMode.fixedParams`：模式级固定 body 字段（注入 `generation_type` 等不需用户选的常量）。
- `combineSlotsInto.flat`：产出有序扁平 `string[]`（Veo 首尾帧 `image_urls=[首,尾]`，区别于 Seedance 的 `[{url,role}]`）。

## 分级汇总

### A — 正确性修复（会 400 / 行为错，必修，无需决策）

| # | 模型 | 问题 | 位置 | 修法 |
|---|---|---|---|---|
| A1 | Sora 2 | duration 连续滑块 4-20，官方离散 **4/8/12/16/20** → 选 5/6/7 → 400 | sora2.ts:12 | 改 select 枚举 |
| A2 | Veo 3.1 | duration 4-8 滑块，官方**固定 8** → 选 4-7 → 400 | veo31.ts:12 | 锁死 8（隐藏或单选） |
| A3 | Hailuo 2.3 | duration number min6/max10 无 step → 滑出 7/8/9 → 400 | hailuo23.ts:11 | 改 select **6/10** |
| A4 | Sora 2 | base `sora-2` 只支持 720p，却暴露 1080p → 选 1080p → 400 | sora2.ts:11 | 720p 锁 base；1080p/1024p 归 pro 变体（见 B1） |
| A5 | Omni-Flash-Ext | i2v 3 图参考需 `generation_type:reference` 否则被拒；slot 还允许 2 图（官方报错） | omniFlashExt.ts:37 + apimartVideos.ts:124 | 按图数注入 generation_type；禁 2 图 |

### B — 变体补全（走变体轴，P4 通用落地；B1 顺带修 A4）

| # | 模型 | 缺的变体 | 官方依据 |
|---|---|---|---|
| B1 | Sora 2 | `sora-2-pro`（解锁 1024p/1080p） | model 枚举 sora-2 / sora-2-pro |
| B2 | Veo 3.1 | `veo3.1-quality` / `veo3.1-lite`（identifierPatterns 已列 veo31.ts:22） | model 枚举 fast/quality/lite |
| B3 | Hailuo 2.3 | `MiniMax-Hailuo-2.3-Fast` | model 枚举 标准/Fast |
| B4 | Qwen-Image | `qwen-image-2.0-pro` | model 枚举 2.0 / 2.0-pro |

### C — 模式补全（真能力，用 first_frame/last_frame 先例）

| # | 模型 | 缺的模式 | 修法 |
|---|---|---|---|
| C1 | Veo 3.1 | `generation_type`：frame(首尾帧 image_urls[0]首[1]尾) vs reference(参考图) | 加首尾帧模式（同 Seedance）+ body 发 generation_type |
| C2 | Omni-Flash-Ext | 同 A5（generation_type frame/reference） | 合并进 A5 |

### D — 可选开关（与 R2 极简冲突，需拍板）

good-default 的纯开关，暴露会让参数条变挤。逐项列出官方默认值（默认即期望行为 → 不暴露也对）：

| 参数 | 涉及模型 | 默认 | 暴露价值 |
|---|---|---|---|
| `negative_prompt` | Qwen / Wan / Kling | 无 | **高**（用户真要排除元素）|
| `seed` | Wan（Seedance 已有） | 无 | 中（复现用）|
| `watermark` | Kling/Wan/Hailuo | false | 低（默认就对）|
| `official_fallback` | Nano/GPT/Veo | false | 低 |
| `prompt_extend`/`prompt_optimizer` | Wan/Hailuo/Z-Image | true | 低（默认就对，开省钱关增费）|
| `fast_pretreatment` | Hailuo | false | 低 |
| `enable_gif` | Veo | false | 低 |

### E — 上限/枚举放宽（廉价正确性，无 UI 成本）

| # | 模型 | 现状 | 官方 | 位置 |
|---|---|---|---|---|
| E1 | Nano Banana | 参考图 max 10 | 14 | nanoBanana.ts:49 |
| E2 | GPT Image 2 | 参考图 max 4 | 16 | gptImage2.ts:56 |
| E3 | GPT Image 2 | size 缺 5:4/4:5/3:1/1:3 | 16 档 | gptImage2.ts:10 |

### F — 大特性（独立端点/复杂，本轮不做，记 backlog）

- Kling `multi_shot`/`element_list`（多镜头/@元素，kling.ts:6 已标 backlog）
- Veo `remix` 视频续写（独立 path /videos/{id}/remix）
- Wan `video_urls` 视频续写、Nano `mask_url` 局部重绘
- 这些需要新 taskKind / 新端点 / 新 UI，超出「参数补全」范围。

## 已完整（无需动）

- **Imagen 4**：官方仅 prompt+size，全接；n 固定 1、无 edit 是官方限制 ✓
- **Z-Image Turbo**：仅缺 prompt_extend（D 类，有意省略避增费）
- **Wan 2.7**：核心 size/resolution/duration/首尾帧规格全对（缺项全在 D/F）
- **Seedream 4.5**：核心 size/resolution/参考图全对（缺项 n[跳过]/组图/watermark 在 D/F）

## 实现结果（2026-06-16，五门绿）

**通用机制**（archetypeMeta + parameterControlModel）：
- `ArchetypeMode.fixedParams`：模式级固定 body 字段 → 注入 `generation_type`（Veo reference/frame、Omni reference）。
- `combineSlotsInto.flat`：有序扁平 `string[]` → Veo 首尾帧 `image_urls=[首,尾]`。
- `parseControlInput` select 按 option **声明类型**回类型：数值 option（duration）→ 发整数，**根治 select 发字符串被 400**；同时让「离散合法值 + 整数传输」两全（旧 number 控件能输非法值的问题一并解决）。

**已落地**：
- A1/A3 Sora·Hailuo·Omni duration → 数值 option select（离散合法 + 整数）；A2 Veo duration 固定 8 不发；A4 Sora base 锁 720p；A5/C2 Omni `generation_type:reference`。
- B1 Sora 标准/Pro；B2 Veo 快速/高质/轻量；B3 Hailuo 标准/Fast；B4 Qwen 标准/Pro（均走变体轴）。
- C1 Veo 参考图/首尾帧两模式 + generation_type。
- E3 GPT apimart size 补全 16 档（独立列，不碰 kie）。
- negative_prompt：Qwen / Wan / Kling（apimart 专属，文本输入加宽到 w-[140px]）。

**有意延后（带原因）**：
- **E1/E2**（Nano 10→14、GPT 4→16 参考图上限）：共享档案，slot max 取**更严 vendor**（kie）安全值，抬高会让 kie 用户超限 400（违"不报 400"）。需 per-vendor slot 配置才能给 apimart 单独放宽 → 延后。
- **Veo 变体×模式禁忌门控**（lite 仅文生、quality 不支持 reference）：变体轴只做 paramOverrides，不做模式门控。误选 vendor 明确报错（错误透传），不静默。完整门控需新增 `variant.unsupportedModeIds` → 延后。
- Tier D 其余开关、Tier F 大特性：按拍板不做。

## 跨模型机制根因

`n` 全军覆没是因为节点单产出（架构约束，非疏漏）。其余 vendor 专属布尔/嵌套参数缺通道，是因为 catalog body 工厂只为 size/resolution/image_urls 留了插槽——补 D 类要同时加 body 插槽常量 + archetype 控件。
