# 自建中转（relay / 中转站）模型的能力全链路审计

日期：2026-09-02 · 分支 `claude/runway-image-audio-identity` · 调查在先、修复在后

**要回答的问题**：用户把模型接在自己的中转上，从接入 → 目录 → 合成器显示 → 真正发送，
**任何一层**会不会把这个模型真实拥有的能力静默砍掉、收窄或拦死？

**结论摘要**

| 段 | 结论 |
|---|---|
| A 接入→目录 | 写 mapping（带 `modelKey`）、**从不写 `modeId`**；archetype 靠身份 pattern 匹配，非显式 |
| B 显示判据 | 档案声明模式，渠道 mapping 收窄；空桶/查不到一律 fail-open |
| C **发送是否被 #351 打断** | **没有。所有真实中转 mapping 形状都不回归**（下有逐形状表） |
| D 无 mapping 兜底 | **真实存在的 P1 静默退化**：纯文生两个 kind 带参考也放行，参考被丢弃仍扣费 → 已修 |
| E L3 闸 | 不误伤合法中转请求；`createBody===undefined` 时 fail-open |
| F 其它收窄面 | 均 fail-open 或如实报空，未发现隐藏能力 |

---

## A. 接入 → 目录：中转模型身上到底写了什么

两条接入路径，落库形状一致。

**A1 手工/AI 接入（`commitOnboardedModelsToCatalog`）**
`electron/catalog/catalogCommit.ts:517-539` 按 kind 取通用中转模板 `newapiTransportFor`
（`electron/catalog/newapiTransport.ts:290`），再由 `applyModel` 注册 mapping：

- 图像 `catalogCommit.ts:296-334`：`text_to_image`（`modelKey` 精确）+ `image_edit`（`modelKey` 精确）
- 视频 `catalogCommit.ts:305-320`：`text_to_video` + `image_to_video`（同一条 wire，两条 mapping）
- 配音 `catalogCommit.ts:536-538`：`text_to_audio` 单条
- 3D / text：**不建 mapping**（`catalogCommit.ts:541-544`，3D 是「没有通用端点」，text 走 AI SDK）

**A2 Provider Adapter 认证发布（`serviceCatalog.ts:397-420`）**
按 `candidate.modes` 逐 `taskKind` upsert mapping，同时写 `meta.adapter.publicationModes`
（`electron/shared/modelPublication.ts:34,69-77`）。

**关键事实（对 C 段决定性）**：

1. **没有任何中转写入路径设置 `mapping.modeId`。**
   `catalogCommit.ts` / `modelRetype.ts` / `relayNativeWireUpgrade.ts` / `relayVideoI2vMigration.ts` /
   `relayImageEditMigration.ts` / `serviceCatalog.ts` / `rendererCatalogMutation.ts` 全文 grep `modeId` → 零命中。
   `modeId` 只属于**内置 seed**（`runwayOfficial.ts:391`、`falOfficial.ts:68`、`kieSunoAudio.ts:122-124`）。
2. **每个 `(vendorKey, taskKind, modelKey)` 桶里至多一条 mapping。**
   `applyMappingUpsert`（`electron/catalog/catalogStore.ts:601,616-620`）按
   `(vendorKey, taskKind, modelKey, modeId)` 去重 upsert；`modeId` 恒 `undefined` ⇒ 同桶重复 upsert
   覆盖而非堆积。**「同桶两条」在中转侧结构上不可达。**
3. `meta.archetypeId` 只在命中原生 wire 时写（`catalogCommit.ts:231`）；通用中转模型**不带** `archetypeId`，
   靠 `identifierPatterns` 匹配（`src/config/modelArchetypes/index.ts:186-196`）——
   所以用户在自己中转上接 `nano-banana`，**照样命中档案**，节点 meta 因此带上 `archetype.modeId`。

> 第 3 条正是 C 段风险的来源：**节点会传一个非空 `modeId`，而 mapping 永远没有 `modeId`。**

---

## B. 决定合成器显示什么

`resolveArchetypeForModel`（`src/config/modelArchetypes/index.ts:169-205`）四级：
自定义能力合同 → 显式 `archetypeId` → 身份 pattern（三趟：原样大小写 / 整串 / 末段）→ `null`。
`null` 时渲染层走「通用」回退，按接入文档原样展示，**不藏能力**（同文件注释 161-163 行）。

模式栏收窄的唯一判据在 `src/workbench/generationCanvas/nodes/controls/channelModeReach.ts:55-62`，
数据由 `readModeChannelBody`（`useChannelCreateBody.ts:27-58`）提供，三态：

| 返回 | 含义 | 处置 |
|---|---|---|
| `undefined` | 查不到（无 bridge / 老 preload / **空 mapping 桶**）| **fail-open 不收窄** |
| `null` | 桶已知、该模式无自己的线缆 | 隐藏（判据 a）|
| `{body, wireParamKeys}` | 有线缆 | 按槽可达性判（判据 b）|

`useChannelCreateBody.ts:44` 的空列表 → `undefined` 就是 CI 抓到的那次回归的修复点：
**空桶 = 无证据 ≠ 不支持**，正好保护自建中转这批用户。

---

## C. 高风险项：#351 收紧 `selectTaskMapping` 有没有打断发送

**结论：没有。中转用户的发送路径不回归。**

收紧点在 `electron/catalog/types.ts:515-529`：给定非空 `modeId` 时，
若无 modeId 完全匹配的候选，**只有当唯一候选是「无 modeId」时**才借用（`onlyCandidateIsModeless`），
候选带**不同的非空 modeId** 则返回 `null`。

中转 mapping 的 `modeId` 恒为 `undefined`（A 段事实 1），且同桶至多一条（事实 2），
因此永远落在 `onlyCandidateIsModeless === true` 这条豁免上。

### 逐形状表（探针实测输出，vendorKey=`my-relay`，modelKey=`nano-banana`）

| 形状（真实来源） | 桶内 | 请求 modeId | #351 前 | #351 后 | 回归？ |
|---|---|---|---|---|---|
| S0 零 mapping（text/3D/adapter-only）| 0 条 | 任意 | `null` | `null` | 否（本就无） |
| S1 图像 `catalogCommit`（`modelKey`，无 modeId）| 1/桶 | `""`/`t2i`/`i2i`/`reference`/`i2v` | exact | **exact** | **否** |
| S2 视频 `catalogCommit`（`modelKey`，无 modeId）| 1/桶 | 同上 | exact | **exact** | **否** |
| S3 老 generic（无 `modelKey` 无 modeId）| 1/桶 | 同上 | generic | **generic** | **否** |
| S4 混合 generic t2i + 精确 image_edit（`relayImageEditMigration`）| 1/桶 | 同上 | generic/exact | **generic/exact** | **否** |
| S5 同桶两条精确行、均无 modeId | 2/桶 | 任意 | 第一条 | `null` | 会变，但 **`applyMappingUpsert` 去重使其不可达** |

唯一会因收紧而变的 S5，被 `catalogStore.ts:616-620` 的去重键结构性排除。
S1–S4 每一格 `#351 前 == #351 后`。

发送侧调用点：`electron/runtime.ts:225`（`findTaskMapping`）、`runtime.ts:359`（`runTask` 取 mapping）。

---

## D. 无 mapping 兜底路 —— **发现真实缺陷（已修）**

`electron/runtime.ts:449-483`：没有 mapping 时 POST `/v1/images/generations`
或 `/v1/videos/generations`，body 写死
`{model, prompt, size, seed, n, response_format, extras}`。**不含任何参考族的位置。**

### 可达吗？可达。

`derivePublishedExecution`（`electron/shared/modelPublication.ts:140-160`）在
**adapter 已认证**时按 `adapter.modes[].state==="verified"` 发布模式，**完全不看 mapping**。
探针实测：

```
C adapter-certified relay, publicationModes=[t2i] only, ZERO mappings
   published=true modes=[text_to_image]  mappings=0
D adapter-certified relay, verified t2i+image_edit, ZERO mappings
   published=true modes=[text_to_image, image_edit]  mappings=0
```

于是形成完整的静默退化链：模型**发布** → 合成器因空桶 **fail-open 显示全部模式与参考槽**
（`useChannelCreateBody.ts:44`）→ 用户连上参考图 → 发送时 `findTaskMapping` 返回 `null`
→ 落进兜底 → **参考被丢弃，请求照发、费照扣、结果与参考无关**。

### 修复前后（探针实测）

L3 闸原实现只在 `createBody !== undefined` 时跑第三闸；无 mapping 时 `createBody` 就是 `undefined`：

```
image_edit,     no mapping, refs -> BLOCKED（下方 !hasMapping 分支拦住）
image_to_video, no mapping, refs -> BLOCKED（同上）
text_to_image,  no mapping, refs -> ALLOWED  ← 洞
text_to_video,  no mapping, refs -> ALLOWED  ← 洞
```

即：`image_edit` / `image_to_video` 早被 `taskParams.ts:642-647` 的 `!hasMapping` 分支拦下，
**洞只在纯文生两个 kind 上现形**——而带参考的纯文生正是「参考图 + 文生图模型」这种常见连法。

### 类根因与修法

根因不是「少判了两个 kind」，而是：**`createBody === undefined` 被当成「查不到」，
但「没有 mapping」其实是「确知会走兜底、且兜底确知发不出参考」——是证据，不是无证据。**

修在 `electron/catalog/taskParams.ts:645-668`：区分两种 `undefined` 成因

- `hasMapping === true` + 无 body（customCall 走脚本）→ 真·无证据 → **保持 fail-open**
- `hasMapping === false` → 用 `NO_MAPPING_FALLBACK_BODY` 作判据 body，跑同一套
  `unreachableReferenceLabels`，**所有 kind 一口径**
- 例外（话语权，不是判据）：`image_edit` / `image_to_video` 无 mapping 时保持走下方那条
  「没有『图生图（改图）』通道」——两条路都拒发且零扣费，但那条点名了缺哪条通道、该怎么办，
  更会说话。补兜底 body 只补下方没管的 kind，不抢答（`taskParams.test.ts` 有专门用例锁住）。

`NO_MAPPING_FALLBACK_BODY`（`taskParams.ts:610-626`）声明兜底 wire 的形状，与
`runtime.ts:474-486` 实际发出的键一一对应，测试钉死防漂移。判据仍全 derive、不 hardcode 参考键名。

**未误伤**（探针实测）：不带参考的纯文生、`text_to_audio`（同步 TTS 也是无 mapping 形状）、
以及有 mapping 但没传 body 的 customCall 渠道，全部照常放行。

---

## E. L3 闸能否拒掉中转用户的合法请求

`imageEditGuardError`（`electron/catalog/taskParams.ts:636`，调用点 `electron/runtime.ts:363`）三闸。
对通用中转模板实测：

| 中转 create body | 携带 1 张参考图 | 判定 |
|---|---|---|
| `NEWAPI_IMAGE_CREATE_OP`（纯文生，无参考位）| → `["参考图"]` | 拒发**正确**（这条 wire 真发不出）|
| `NEWAPI_IMAGE_EDIT_OP`（chat 多模态）| → `[]` | 放行 |
| `NEWAPI_VIDEO_CREATE_OP`（带 `image` 首帧位）| → `[]` | 放行 |

第一行不是误伤：用户此时该切「图生图」模式（`image_edit` mapping 接入时就已注册，
`catalogCommit.ts:321-334`），闸门还会附 `reachableModeSuggestion` 点名该走哪个模式
（`taskParams.ts:651-653`）。未发现能拒掉合法中转请求的形状。

---

## F. 其它收窄面 × 三种中转形状

| 面 | 零 mapping | 无 modeId 的 mapping | 只有部分模式有 mapping |
|---|---|---|---|
| `readModeChannelBody`（`useChannelCreateBody.ts:44`）| `undefined` → **fail-open 全显** | 命中（modeless 豁免）→ 正常显示 | 有的显示，无的判据 (a) 隐藏（诚实）|
| `archetypeModeIsVisible`（`channelModeReach.ts:55`）| 同上 fail-open | 按槽可达性 | 同上 |
| `archetypeVariantAxisIsLive`（`channelModeReach.ts:80-83`）| `!bodyResult` → **fail-open** | 看 `wireParamKeys` 含不含 `model` | 同 |
| `projectModelCapability`（`modelCapabilityProjection.ts:170-186`）| `source:'transport-only'`、`modes:[]`，**不隐藏模型** | 档案模式照出 | 照出 |
| `derivePublishedExecution`（`modelPublication.ts:140`）| adapter 已认证仍 `published=true`（D 段风险源）| 按 enabled mapping 发布 | 只发布有 mapping 的模式 |
| MCP `nomi_list_models`（`modelCatalogListing.ts:194`）| `references` 全 false（如实报空，不假称支持）| 按 mapping body derive | 同 |
| `mappingsForModel`（`modelCatalogListing.ts:67-74`）| 空数组 | 精确 + generic 都收进来 | — |

除 D 段那一处外，各面要么 fail-open，要么如实报空，未见「因查不到就藏能力」。

---

## 附：探针输出（`tmp-probe/`，跑完已删）

### C 段矩阵（节选 S1/S5）

```
### S1 catalogCommit image: t2i+image_edit, modelKey, NO modeId
  send  text_to_image   (none):exact  t2i:exact  i2i:exact  reference:exact  i2v:exact
  ui    text_to_image   SHOW (has wire)
  send  image_edit      (none):exact  t2i:exact  i2i:exact  reference:exact  i2v:exact
  ui    image_edit      SHOW (has wire)
  send  text_to_video   (none):NULL   ...        ui: HIDE (criterion a)

### S5 UNREACHABLE-BY-CONSTRUCTION: 2 exact rows, same taskKind, no modeId
  send  text_to_image   (none):NULL  t2i:NULL  i2i:NULL  reference:NULL  i2v:NULL
```

### D 段兜底 body 承载力

```
referenceImages (image_ref)        unreachable via fallback body = ["参考图"]
firstFrameUrl (i2v first frame)    unreachable via fallback body = ["首帧"]
archetypeInput.image_urls          unreachable via fallback body = ["参考图"]
no references at all               unreachable via fallback body = []
```

### 修复后闸门行为

```
t2i, NO mapping, refs carried        (D bug)         -> BLOCKED: …发不出：参考图…
t2v, NO mapping, refs carried        (D bug)         -> BLOCKED: …发不出：参考图…
t2i, NO mapping, NO refs             (must pass)     -> ALLOWED
t2i, HAS mapping, body undefined (customCall)        -> ALLOWED
text_to_audio, NO mapping, no refs   (TTS must pass)  -> ALLOWED
image_edit, NO mapping, refs         (already blocked)-> BLOCKED
```

## 回归测试

`electron/catalog/taskParams.test.ts` 新增 `describe("无 mapping 兜底：参考素材不得静默丢弃")`：
6 条断言含「兜底 body 形状与 runtime 一致」防漂移。
按 R17 先验红：去掉修复后 3 条失败，装回后 84/84 通过。
