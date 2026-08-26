# 火山方舟接入整修 + 模型扩容（Seedream 5.0 pro / Seedance 2.5）

**日期**：2026-08-26
**触发**：用户报「火山引擎的接入有问题，然后没有图生图」，并要求把 Seedance 2.0/2.5 与最新图片模型接进来。
**范围拍板**（2026-08-26 用户选）：修根因 + 接模型**本体**；2.5 的「编辑视频/延长视频」、5.0 pro 的「图层拆分/交互编辑」**下轮**（全新交互形态，需先出样张走 R8）。

---

## 一、事实来源（R5：官方文档实查，非记忆）

两份契约报告由子 agent 用真浏览器抓 `docs.volcengine.com` 的 SPA 内容接口
（`/api/doc/getDocDetail?LibraryID=82379&DocumentID=<id>`）取官方原始正文得到，非二手文章。

- 图片：doc 1541523（图片生成 API，页脚更新 2026.08.12）、1330310（模型列表）、2582774（5.0 pro 教程）、1350667（模型下线公告）、1299023（错误码）
- 视频：doc 1520757（创建任务）、1521309（查询任务）、1330310（模型列表，更新 2026.08.24）、2607688（Seedance 2.5 教程）

**已知未核实项**（诚实标注，D4）：各模型官方发布日期文档未公布，只能从 id 日期后缀推断；参考音频的完整 cURL 示例官方未给，形状由字段定义拼出。

---

## 二、两个确诊根因（file:line 实证）

### 根因 ① `hostRootBase` 只剥一层 `/vN`，原生端点地址被拼成 `/api/api/v3/...`

- 预设地址 `https://ark.cn-beijing.volces.com/api/v3`（`src/ui/onboarding/providerPresets.ts:49`）
- `hostRootBase` 做 `.replace(/\/v\d+$/i,"")` → `https://ark.cn-beijing.volces.com/api`，**`/api` 残留**（`electron/ai/requestPipeline.ts:180-182`）
- 原生 profile 的 probePath / op.path 本身以 `/api/v3` 开头（`electron/catalog/nativeWireProfiles.ts:44,51,71,76`）
- 拼接结果 `https://ark.cn-beijing.volces.com/api/api/v3/images/generations` → 必 404
- `probeNativeEndpoint` 拿它和同深度哨兵比，两者签名完全一致 → `same===true` → `exists:false`（`electron/catalog/nativeEndpointProbe.ts:85-93`）

**后果链**：`onboardingIpc.ts:113-122` 的 `nativeArchetypeIdFor` 返回 undefined → `catalogCommit.ts:503` 拿到 `nativeProfile=null`
→ `draftShapeForKind` 跳过原生图像分支（`catalogCommit.ts:387-400`）→ 落进通用分支（`:401-405`）
→ 改图 op = `NEWAPI_IMAGE_EDIT_OP` = **`POST /v1/chat/completions` + `chat_image_parts`**（`electron/catalog/newapiTransport.ts:75-90`）。
Seedream 不是聊天模型 ⇒ **这就是「没有图生图 / 改图不按原图」的机制**。
附带损失：`catalogCommit.ts:216-218` 仅在 `wireProfileId` 存在时写 `meta.archetypeId` ⇒ 向导接入的 Seedream **拿不到 archetypeId**。

**这是一族病不是一个点（P2）**：`pathFrom:"host-root"` 同时被 Seedance 视频 profile 使用
（`nativeWireProfiles.ts:44,51`）⇒ 火山**图生视频**经向导接入同样掉进兜底。

### 根因 ② 一个火山被拆成两个供应商，向导那半个一条内置 mapping 都拿不到

- `deriveVendorKeyFromBaseUrl` 只取 `u.hostname`（`electron/catalog/catalogCommit.ts:289-303`）
  → `https://ark.cn-beijing.volces.com/api/v3` 得 **`ark-cn-beijing-volces-com`**
- 内置种子的 vendorKey 是 **`volcengine`**（`electron/catalog/volcengineVendor.ts:9`）
- 实测：`ark-cn-beijing-volces-com` 名下 mapping 数 = **0**。全部 6 条已真机验证的 Seedream 原生 mapping 拿不到。
- 走 `KNOWN_VENDORS`「火山方舟」卡片（`src/config/knownVendors.ts:126` → `VendorOnboardCard.tsx:127`）的用户不受影响。

### 已排除（读码 + 实跑证伪，不是根因）

- **种子/reconcile 正常**：`seedBuiltins.ts:213-218` 无 taskKind 过滤；模拟老装机剥掉 `image_edit` 行后重跑
  `applyBuiltinSeeds`，3 条 `seed-volcengine-*-image_edit` 全部重新插入。
- **UI 模式面板无 mapping 过滤**：`archetypeMeta.ts:128-134` 原样返回全部 modes，改图 chip 一直在。
  ⇒ 用户**看得到**「改图」，是**点下去发错地方**。
- **`imageRouteFallback.ts:22,52`** 只对 `/v1/images/*` 生效，种子路径 `/api/v3/*` 不会误落 chat。

---

## 三、缺口（现状 vs 官方现役）

| 类别 | 我们有 | 官方现役 | 缺 |
|---|---|---|---|
| 图片 | 5.0 lite `doubao-seedream-5-0-260128`、4.5 `-4-5-251128`、4.0 `-4-0-250828` | + **5.0 pro `doubao-seedream-5-0-pro-260628`** | 旗舰未接 |
| 视频 | 2.0 `doubao-seedance-2-0-260128` + fast/mini 变体 | + **2.5 `doubao-seedance-2-5-260628`** | 2.5 未接 |

**参数与官方对不上的点**：

1. `size` 全模型共用一份写死清单（`seedreamVolcengine.ts:11-18`）。官方像素域**按模型分档**：
   5.0 pro `[921600, 4624220]`；5.0 lite / 4.5 `[3686400, 16777216]`；4.0 `[921600, 16777216]`。
   现清单恰好落在三者交集内（未爆），但 **5.0 pro 接进来后 4K 档会 400**，且 lite/4.5/4.0 的 4K 卖点没暴露。
2. `seed`：`electron/shared/videoCapabilities/seedanceVolcengine.ts:11` 的注释称「官方字段表有 seed，唯独火山这份漏了」——
   **查下来是反的**：官方 doc 1520757 参数表标注 `seed` 仅 1.5 pro / 1.0 pro / 1.0 pro fast 支持，**2.5 / 2.0 系列不支持**。
3. 字段名 `camera_fixed`（下划线），且同样仅 1.5/1.0 系列支持。
4. `watermark` 官方图片默认 **true**（我们已显式发 false，正确）；视频默认 false。
5. 未接：`response_format` / `output_format` / `background`(透明) / `sequential_image_generation`(组图) / `priority` / `service_tier`。

---

## 四、改动计划

### A. 修根因 ①（最高杠杆，一改修好整族）

把「剥版本段」升级为 **base 尾部 ↔ path 头部的重叠折叠**——这正是 `joinUrl` 已半实现的规则
（`requestPipeline.ts:192,198-200`），提成单一真相源共用：

| baseUrl | op.path (host-root) | 期望 |
|---|---|---|
| `https://ark.cn-beijing.volces.com` | `/api/v3/images/generations` | `.../api/v3/images/generations` |
| `https://ark.cn-beijing.volces.com/api/v3` | `/api/v3/images/generations` | `.../api/v3/images/generations` |
| `https://relay.example.com/v1` | `/api/v3/images/generations` | `https://relay.example.com/api/v3/...` |
| `https://relay.example.com/codex/v1` | `/api/v3/images/generations` | `https://relay.example.com/codex/api/v3/...` |

同时修 send 路径（`requestPipeline.ts:277`）与 probe（`nativeEndpointProbe.ts:81`）——两者共用同一 helper。

### B. 修根因 ②（供应商去重）

- `deriveVendorKeyFromBaseUrl` 先查「已知 host → 种子 vendorKey」映射，命中则复用种子 key（通用做法，不是给火山打补丁：kie/apimart/modelscope 同理）。
- 种子 `volcengine` 的 `baseUrl` 与预设统一为 `https://ark.cn-beijing.volces.com/api/v3`
  （官方文档口径；A 落地后原生 `/api/v3/*` 路径经重叠折叠仍正确，文本 `/v1/chat/completions` 经 `joinUrl` 折叠也正确）。

### C. 防复发（P2 结构保证，非自觉）

新增单测矩阵：**每个** `pathFrom:"host-root"` 的 profile × 每种 baseUrl 形态（裸 / 带 `/v1` / 带 `/api/v3` / 带子路径 `/codex/v1`）
→ 断言解析出的 URL 恰等于期望。新增 profile 不进矩阵即红。

### D. 接 Seedream 5.0 pro

- 新档案 `volcengine-seedream-5-pro`（**独立档案**，沿用 `seedream5Pro.ts` 与 `seedreamVolcengine.ts` 已确立的
  vendor-scoped 惯例）：参数域与 lite 真不同（像素上限 462 万 vs 1677 万、不支持组图、独有 `background:transparent`）。
- 精确 `identifierPatterns: ["doubao-seedream-5-0-pro-260628"]`（匹配是**严格相等**，前缀形匹配不到——
  现存 `seedream5Pro.ts:24` 的 `"doubao-seedream-5-0-pro"` 就命中不了真实 key，是同类坑）。
- wire：同端点 `/api/v3/images/generations`，共用已验证的 create/edit op 形状。

### E. 接 Seedance 2.5

- 新档案 `volcengine-seedance-2-5`：`duration [4,30]`、`resolution 480p/720p/1080p`（**无 4k**，4k 是 2.0 独有）、
  `output_format mp4/mov`、参考素材上限 **30 图 / 10 视频 / 10 音频**（2.0 是 9/3/3）、
  音频**可单独输入**（2.0 不可，`requiresAnyOf` 需按模型放开）。
- wire：同端点 `/api/v3/contents/generations/tasks`，`role` 字段区分首帧/尾帧/参考图/参考视频/参考音频（与现有 2.0 一致）。

### F. 参数对账

- 2.0 / 2.5 **移除 `seed`**（官方不支持；按 P1 删而非留 fallback）。
- Seedream 各模型 `size` 按官方像素域分档给选项。
- 视频 2.5 首帧/首尾帧任务官方强制 `ratio=adaptive` ⇒ 按模式收窄比例选项，别让用户选了才异步报错（额度已排队）。

## 五、不动项

- 2.5 的 `omni_reference_task_type=edit/extend`（编辑/延长视频）、5.0 pro 的 `layer_decomposition` / 交互编辑 —— **下轮**，需先出样张。
- 已 EOS 的 `doubao-seededit-3-0-i2i-250628`、`doubao-seedream-3-0-t2i-250415` 不接。
- 即将下线的 `doubao-seedance-1-5-pro-251215` 与遗留 1.0 系列不接（D4 狠的极简）。
- 「元素拆解」现走 Replicate 的路径不动（5.0 pro 图层拆分与之重叠，属产品取舍，另议）。

## 六、回滚

改动集中在 `electron/ai/requestPipeline.ts`（A）、`electron/catalog/catalogCommit.ts` + `volcengineVendor.ts`（B）、
新增档案与 catalog 行（D/E）。回滚 = revert 本分支；catalog 侧新增行按 seed id 前缀可精确摘除
（同 `RETIRED_*_MODEL_KEYS` 既有做法）。

## 七、验收结果（2026-08-26 实跑，非计划）

1. ✅ 单测矩阵 C 全绿，且**过阳性对照**：把 `hostRootJoin` 退回旧行为 → 矩阵 6 红，复现 `/api/api/v3` 指纹。
2. ✅ `pnpm run gates` 全过（750 文件 / 6625 测试）。
3. ✅ **真机走查（R13，用户真实资料库 `isolate:false`）**：Seedream 改图模式**在**、可发现、可连参考图、
   生成按钮可用；与多渠道 Seedream 4.5 的参考区 DOM **逐字节相同**（无渠道差异）。
4. ✅ **付费验收（真 key 实发）**：
   - Seedream 5.0 lite 改图 → `POST …/api/v3/images/generations` **HTTP 200**，输出保留输入图主体只换背景（真改图非重画）。
   - Seedream 5.0 pro 文生图 → HTTP 429 `SetLimitExceeded`（**账号侧**「安全体验模式」额度未开，报文形状正确）。
   - Seedance 2.5 文生视频 → HTTP 404 `ModelNotOpen`（**账号侧**未开通，报文正确且已确认不含 `seed`）。

### ⚠️ 验收中挖到并已修的**新引入** bug（P3 的活证据：全绿 ≠ 完成）

把种子 baseUrl 改成 `/api/v3`（§四 B）后，**种子 mapping 的 create/query op 没声明 `pathFrom:"host-root"`**
（`pathFrom` 此前只由 `nativeWireProfiles` 在向导路径上统一盖章，进不了种子路径）→ 走 `joinUrl` 而非
`hostRootJoin` → 拼出 `https://ark…/api/v3/api/v3/images/generations`，**新装用户 Seedream/Seedance 全线 404**。
老装机因 `seedVendor` 存在即跳过、vendor 行仍是裸 host，所以完全看不出来——**只有真发才暴露**。

- 修：`volcengineImages.ts` / `volcengineVideos.ts` 的 create op 与 `VOLCENGINE_SEEDANCE_QUERY_OP` 补 `pathFrom:"host-root"`。
- 防复发：新增 `electron/catalog/seededMappingUrls.test.ts`——遍历**全部种子 mapping**，按生产同一套规则算出 URL，
  断言无重复段序列，且「path 首段与 baseUrl 路径段相同却没声明 pathFrom」当场报红。过阳性对照（撤修 → 3 组红）。
  这块此前是盲区：`nativeWireHostRoot.test.ts` 只覆盖**向导路径**的 profiles，两条路发同一批端点却由两套代码组装。
- 复验：隔离新 profile + 真 key 实发 → `POST https://ark.cn-beijing.volces.com/api/v3/images/generations` **HTTP 200**，
  出真图；`/api/v3/api/v3/` 调用数 0。用户真实 catalog 前后逐字节未变。

## 八、诚实结论：用户报的「没有图生图」**未能复现**

在用户**真实资料库**上，`volcengine` 三个 Seedream 的 `image_edit` mapping 齐全且 enabled、archetypeId 正确，
UI 里「改图」模式在、可用，真发也 200 出图。**本文修的两个根因都只打向导接入路径**
（`ark-cn-beijing-volces-com` 那半个供应商），而用户走的是「火山方舟」卡片路径，不受影响。

即：**bug 是真的、修得对，但很可能不是用户遇到的那个**。待用户澄清具体现象（在哪个界面、点了什么、
是找不到还是报错），别把这次修复当成已解决他的问题（R19：验证通过且进远端目标分支才算「已解决」）。
最弱的可发现性点（走查实测）：「改图」是模型选中后才出现的小号分段控件，且未附图时参考槽只有一个
无文字标签的虚线 `+`（`aria-label="加参考"`）——若用户从未注意到第二个 chip，就会报「没有图生图」。
