# Runway 模型↔档案身份工作流：一个模型一个档案主人

> ✅ 已交付
>
> 日期：2026-09-02 · 分支：`claude/dazzling-leavitt-f6c690` · 基线：`origin/main` @ `d6da41f3`（PR #310 二期档案归一之后）
>
> 本任务是 **PR #310 显式挂起的「单独立项裁决」**：#310 的根因合同 `docs/fixes/2026-09-02-archetype-video-registry-derivation.root-cause.json` 在 `residual_risks` 里写明「`veo3.1` 裸串两侧分裂是存量问题，修它属行为变更须单独立项」。这就是那一项。
>
> 用户已拍板（2026-09-02）：**方案 A（一模型一档案 + 补齐供应商收窄）**，范围 **全部同类一次修完**（含探针扫出的 fal 两处）。

---

## 0. 勘探收据（动手前先证明现状，不引用二手描述）

探针 `tmp-probe/identitySplit.probe.ts`（只读，交付前删）：263 条身份语料 × 两套解析器，53 个已种子化 video 模型 × 全模式 × 真实 mapping。

**收据 1 —— 任务书的前提要修正：两套解析器在真实目录模型上零分歧。**
53 个 video 模型**全部**携带显式 `meta.archetypeId`；两器都直接取显式 id，**分歧 0**。任务书说的「两器对同一模型可给不同答案（实测 veo3.1）」只在**裸身份串**（无显式 id，即用户自建中转接入同名模型）路径上成立。

**收据 2 —— 裸串分歧共 8 条，两族：**

| 身份串 | renderer | registry | 性质 |
|---|---|---|---|
| `veo3.1` | `runway-video` | `veo-3.1` | 已记档的存量分裂（#310 pin 住） |
| `bytedance/seedance-2.5` | `seedance-2.5` ✅ | `seedance-2` ❌ | **未记档的 registry 打分 bug** |
| `seedance2.0` / `2.0_vip` / `2.0fast` / `2.0fast_vip` / `2.0mini` / `seedance2_5` | `null` | `seedance-2` | registry 子串档独有 |

`bytedance/seedance-2.5` 那条是真缺陷：registry 的**子串档（10k）+ 模式长度加权**让 pattern `bytedance/seedance-2`（长 20）压过 `seedance-2.5`（长 12）——**低版本档案吃掉高版本 key**。渲染层无子串档，反而对。

**收据 3 —— `runway-video-t2v` 是死档案。** 无任何模型行指向它；它唯一参与的平局（`happyhorse_1_0`，双方同为 30014）按数组序永远输给 `runway-video`。

**收据 4 —— 假绿一族比任务书说的宽（这是同类扫描的收获）：**

| 三元组 | 症状 |
|---|---|
| `runway/happyhorse_1_0/reference` | 声明 max=10 多图，实际只过得去 1 张（借用 `i2v` 专属线缆） |
| `fal/bytedance/seedance-2.5/omni` | 声明 max=30/10/10，实际只过得去 1 张 |
| `fal/bytedance/seedance-2.5/first`、`/firstlast` | 借用 `modeId=i2v` 的专属线缆 |
| `fal/google/gemini-omni-flash/v1.1/firstlast` | 借用 `modeId=reference` 的专属线缆 |

**收据 5 —— 一个被推翻的假设。** 我原以为「档案声明了某模式、但该供应商发不出」时 UI 会自动收窄。**不会。** `archetypeModeChoices()`（`src/workbench/generationCanvas/nodes/controls/archetypeMeta.ts:128`）原样返回全部模式，`NodeParameterControls.tsx:463` 不过滤；可达性只驱动**槽**徽标与**生成时**拒发（`electron/runtime.ts:363`）。槽已收窄、模式没收窄——这正是 `referenceReachability.ts` 头注释自己描述却没做完的那半件事。

---

## 1. 类根因

> `runway-video` 是一个**平台形状**的档案，蹲在 **10 个不同模型的身份**上；而它下面的 wire 层（`runwayVideoCreate` 的 `fields` 分支）**早就是按模型分叉的**。
>
> 能力面与 wire 有**两个作者**，于是必然漂移。

三个后果，一一对应任务书的三个目标：

1. **能力面撒谎**：Runway 的 veo3.1 在 UI 上显示「多图参考」模式和 `1280:720 / 1–30 秒 / 生成音频` 这套 Runway 通用值；官方 union 说 veo 只有 4/6/8 秒、且没有 reference。用户切过去、连好图、点生成，才被第三闸拒。
2. **身份撞车**：`runway-video` 的 10 个 `identifierPatterns` 对目录路径**完全无用**（10 行全带显式 `archetypeId`），却在裸串路径上与真模型档案抢串——`veo3.1` 分裂就是这么来的。
3. **模式借线缆**：模式集与 mapping 集不对齐时，`selectTaskMapping` 的单候选回落会把**另一个模式的专属线缆**递给你（收据 4）。

---

## 2. 目标形状

**档案 = 模型身份（供应商无关）；供应商差异由「供应商特化」三条轴吸收。**

| 轴 | 管什么 | 现状 |
|---|---|---|
| `mode.vendorParams[vendor]` | 参数**取值**（比例枚举、时长范围） | ✅ 已存在（2026-06-07 拍板） |
| `mode.vendorTransportTaskKind[vendor]` | 该模式走**哪个 mapping 桶** | ❌ 本次新增（仅 2 处用到） |
| 模式**可见性** | 这个供应商到底有没有这个模式 | ❌ 本次新增（按可达性 derive，不声明） |

第三条轴**不新增声明字段**——用已有的共用判据（`referenceReachability`）derive。这是有意的：声明式可见性会变成第四份要维护的真相，而 derive 出来的可见性天然跟着 mapping 走。

---

## 3. 十个 Runway 模型的归属裁决

| Runway modelKey | 目标档案 | transport 是否对齐 | 备注 |
|---|---|---|---|
| `seedance2` / `_fast` / `_mini` | `seedance-2`（三个变体已在档案里） | ✅ | 变体 modelKey 需加 Runway 侧键 |
| `wan3` | `wan-3.0` | ✅ | |
| `grok_imagine_1_5` | `grok-imagine-1.5-video` | ✅ | |
| `hailuo3` | `minimax-h3` | ❌ 档案 i2v/ref 声明 `text_to_video`（kie 单端点契约） | 需 `vendorTransportTaskKind.runway = image_to_video` |
| `veo3.1` / `veo3.1_fast` | `veo-3.1`（`fast` 变体已在） | ✅ | 见 §3.1 |
| `happyhorse_1_0` | `happyhorse` | ❌ 同 hailuo3 | 需 vendor transport 覆盖 |
| `gemini_omni_flash` | `gemini-omni-1.1` | ✅ | 见 §3.1 |

`runway-video` 与 `runway-video-t2v` **同 commit 删除**（P1 加新必删旧）。存量画布节点持久化的是 `meta.archetype.id = "runway-video"`——用**已有的** `legacyIds` 迁移机制承接：接收方档案各加 `legacyIds: ["runway-video"]`，`resolveBaseArchetype` 的迁移分支按「声明了该 legacyId **且模型身份匹配**」选人（`src/config/modelArchetypes/index.ts:210`），正是为「共享档案按版本分裂」设计的那条路。

### 3.1 veo / gemini 的 reference：本轮**不开**，且这是保守的正确默认

任务书提到「2026-09-02 实测参考图上传 wire 校验通过 → 当晚已按实测优先开图参考键」。

**wire 校验通过 ≠ 参考真的生效。** 请求没被 schema 拒，不能证明模型采纳了参考图；付费封印（产物检查）因 Runway 余额不足**未做**。Runway OpenAPI 的 veo/gemini union 里没有 reference 字段。

方案 A 下这件事**自动得到正确处置、无需专门决策**：`veo-3.1` 的 `reference` 模式声明 `image_ref[1-3] → image_urls`；Runway 的 veo mapping body 里没有 `image_urls` 也没有 `reference_image_urls`，只有 `promptImage`（单图聚合位）→ 该模式在 Runway 上按 §4.2 判据**自动隐藏**，而在 apimart 上（body 有 `image_urls`）**照常显示**。同一个档案，两家各自诚实。

若日后拿到产物级证据证明 Runway 的 veo 确实吃参考图，只要给 mapping 补上真正的数组键，模式自动重新出现——不需要改档案。

---

## 4. 改动单元

### U1 · `selectTaskMapping` 停止借用别的模式的专属线缆（类级，1 行 + 测试）

`electron/catalog/types.ts:520` 现为：
```ts
return exactMode.length === 0 && candidates.length === 1 ? candidates[0] : null;
```
注释写的意图是「**老的无 modeId 行**可以用一条共享线缆服务多个模式」。但代码没检查 modeId 是否为空，于是**带着明确且不同 modeId** 的行也会被递出去。收紧为：单候选只有在其 `modeId` 为空时才回落，否则 fail-closed 返回 null。

探针证明影响面 = 收据 4 的 5 个三元组，全部是本轮要修的缺陷；无良性用例受损。

### U2 · 新增供应商 transport 轴

`ArchetypeMode` 加 `vendorTransportTaskKind?: Record<string, ArchetypeTransportTaskKind>`（`electron/shared/videoCapabilities/types.ts` 与 `src/config/modelArchetypes/types.ts` 两份类型同步——它们本就是同一形状的两份声明）。仅 `minimax-h3` 与 `happyhorse` 的图模式各加 `{ runway: "image_to_video" }`。

**所有取 transport 的读取点必须走同一个 helper**（`modeTransportFor(mode, archetype, vendorKey)`），否则又是一处双真相源。读取点普查见 §5 验收。

### U3 · Runway 十行改挂真模型档案 + 删两个平台档案

`electron/catalog/runwayOfficial.ts` 的 `RUNWAY_VIDEO_SPECS` 每行 `archetypeId` 按 §3 表改；`modes` 列表按各自档案的真实模式集给。删 `RUNWAY_VIDEO_ARCHETYPE` / `RUNWAY_VIDEO_T2V_ARCHETYPE`、registry 登记、barrel 导出、四个 `.generated.ts` 重生成。接收方档案加 Runway 侧 `identifierPatterns`（`veo3.1_fast`、`happyhorse_1_0`、`gemini_omni_flash`、`seedance2_fast`…）与 `legacyIds`。

### U4 · 模式栏按可达性收窄（补齐第三条轴）

`NodeParameterControls.tsx` 现在只为**当前模式**取 body（`useChannelCreateBody` 吃单个 taskKind）。改为按档案模式集需要的 taskKind 集合（至多 2 个）取 body，再用共用判据过滤 `modeChoices`。

**判据（比槽级更严，因为模式名本身是承诺）**：模式被隐藏当且仅当
- (a) 该 (vendor, model, mode) 取不到 mapping（U1 之后不再借线缆，取不到就是真取不到）；或
- (b) 声明了参考槽且**全部** reach = `none`；或
- (c) 声明了**多图**槽（`max > 1`）却只拿到单图聚合位（reach = `single`）——「多图参考」只能放 1 张就是撒谎，且此时它与 `i2v` 模式重复。

无槽的纯文生模式 `modeIsUsable` 恒真，永不隐藏。**拿不到 body 一律不收窄**（fail-open），沿用槽级收窄已确立的纪律：绝不因为查不到就藏用户的东西。

判据 (c) 与探针的「承载力缩水」检测器**是同一个谓词**，全仓命中恰好 2 条（收据 4 的两条 max>1 项）——收窄的爆炸半径是量过的，不是估的。

### U5 · fal 两处同类假绿

`fal/bytedance/seedance-2.5` 的 `first`/`firstlast`/`omni` 与 `fal/google/gemini-omni-flash/v1.1` 的 `firstlast`：U1 之后会 fail-closed 暴露为「无 mapping」。按 fal 官方 `reference-to-video` / `image-to-video` 合同补齐各模式自己的 mapping（依据已存 `docs/research/2026-09-02-docaudit-fal-runway-etc.md` §2.2，不新编字段）。

### U6 · registry 打分 bug

`modelProfileMatchScore` 的子串档以 **pattern 长度**加权，导致低版本 pattern 吃掉高版本 key。改为子串档按**匹配覆盖率**或直接要求边界对齐（`seedance-2` 不得子串命中 `seedance-2.5`）。锁在结构测试里：全语料两器赢家除已登记例外外必须一致。

### U7 · 结构测试 + 合同 + 走查

- `curatedVideoSharedContracts.test.ts` 升级为断言三件事（不再只断「至少一个槽可达」）：模式有**自己的** mapping（非借用）、多图槽不得塌成单图、`KNOWN_LEGACY_GAPS` **不存在**。这样 PR #342 若先落地，它那条豁免在本分支被删掉且**回不来**；若本分支先落地，#342 根本不需要加。
- 两器一致性结构测试：全语料裸串赢家逐条锁死（扩 `resolutionOrder.test.ts`），并删掉 `LEGACY_RESOLUTION_ORDER_PINS`——`veo3.1` 撞串在 U3 之后**不存在了**（`runway-video` 已删），pin 变 no-op，按 #310 合同 `residual_risks` 第三条的指示「连同测试锁一起清理」。
- R21 schema-v3 合同：`docs/fixes/2026-09-02-runway-model-identity.root-cause.json`，`classification = recurring`（同类可从任何新接入的平台型供应商再来），共享边界 = U1 + U4 判据 + U7 门岗。
- R13 真机走查：composer 模式栏截图，逐一亲眼验 Runway veo3.1 / happyhorse_1_0 / hailuo3 与 apimart veo3.1 的模式栏差异。探针手法沿用隔离 profile + 真 catalog 拷贝（`/tmp/runway-modes-probe.mjs` 已验证的姿势）。

---

## 5. 不动项 / 回滚 / 验收门

**不动项**：不碰任何供应商 API 端点、鉴权、参数取值（U5 补 mapping 除外，且只依据已抓取的官方文档）；不碰 image/audio/3D 档案；不碰 `runwayRatio.ts`（PR #342 领地）。

**回滚**：U3 是唯一有持久化影响的单元，回滚 = 恢复两个档案 + 十行 `archetypeId`；`legacyIds` 迁移是幂等读时映射，不写库，回滚无残留。

**验收门（缺一不算完成）**
1. 探针重跑：裸串两器分歧 **0**（除显式登记的例外）；模式借线缆 **0**；多图塌单图 **0**。
2. `pnpm run gates` 全链绿；`check:vocabularies` / `check:heavy-path` / `check:boundaries` 棘轮不升。
3. `KNOWN_LEGACY_GAPS` 在全仓**不存在**（grep 断言进测试）。
4. R13 走查截图**我自己 Read 过**，模式栏与 §3 表逐项对账（眼见链四问）。
5. R16：带真实任务在 Runway veo3.1 上跑通一次创作闭环，把过程中冒出的体验问题修掉。

## 6. 与 PR #342 的关系

#342（`audit/vendor-docs-fal-runway-etc-20260902-r2`，OPEN，6 绿 3 跳过）重写了 `runwayOfficial.ts` 99 行并新增 `seedance25Runway` 档案与 `runwayRatio.ts`。**冲突面就是 `runwayOfficial.ts`。**

不擅自合并他人 PR。本分支从 `main` 出发；U7 让契约测试**结构上拒绝**该豁免存在，因此无论两者谁先落地，`KNOWN_LEGACY_GAPS` 都活不下来。合并时逐 hunk 裁，禁整文件 ours/theirs（#310 已立此规矩）。
