# 修复：character_ref 参考边对档案模型送不到 vendor（角色一致性线路 切片 1）

> 日期：2026-06-13　状态：方案，待实现
> 缘起：[记忆架构诊断](2026-06-13-memory-architecture.md) 挖出——「角色每镜一致」的真痛点不在记忆，
> 在生成管线：① character_ref 边对主流（档案）模型送不到 vendor ② 首帧接力未实现 ③ 无身份保持。
> 本切片只修 ①（最具体、最高价值：agent 连的角色参考边连了等于没连）。

## 根因（已核实，带 file:line）

**validation 与 delivery 裂开了**：
- **校验层（T8）** `referenceEdgeCapability.ts:57`：`character_ref` 边 → 要满足 `image_ref` 槽 → 校验**通过**（模型「能消费」）。storyboard planner 据此连 character_ref 边。
- **投递层** `archetypeMeta.ts:44-48`：`image_ref` 数组槽**只从 `meta.referenceImageUrls` 读**（手动拖入）；而边在生成时产出的是 `references.referenceImages`（`generationReferenceResolver.ts:142`，含所有 character/style/composition 边的图，已去重、已剔除接力视频）。`buildArchetypeInputParams`（`archetypeMeta.ts:249`）不读 `references.referenceImages`；`referenceInputParams`（`archetypeInput.ts:25-27`）对档案模型只用 `archetypeInput`、丢弃 `characterReferenceImages` 等 extra。
- **结果**：agent 连的 character_ref 边，对档案模型（15 档案中绝大多数）**图片根本不进 vendor**。只有手动拖进数组槽（写 `meta.referenceImageUrls`）才送得到。两套机制没打通。

## M6 张力与本方案的取舍（R3）

M6（`seedance.ts:62` 评审决定）：数组槽 meta-only 不走边，理由「edge 只 3 个值表达不了 9 个有序槽」。

| 方案 | 边的角色图能否送达 | 有序 9 槽精确指派 | 代价 |
|---|---|---|---|
| 现状 | ❌ 完全送不到 | 仅手动 meta | agent 连边等于没连（真 bug）|
| **A 边喂槽（推荐）** | ✅ 追加进槽、去重、capped slot.max | 仍靠手动 meta | 边表达不了「第几号」，但常见单角色场景能用 |
| B 校验拒边 | ❌（改为拒绝 character_ref→档案模型）| 仅手动 | agent 失去用边表达角色一致的能力，UX 倒退 |

**取舍**：选 **A**——投递对齐校验（边既然校验为「有效」、agent 又在连，就该送达）。M6 的「有序精确指派」需求由手动 meta 继续承担；边负责常见的「这个角色出现在这镜」。**若用户要 M6 保持纯粹（宁可拒边），可改 B**——本方案默认 A，实现里留清楚注释，可回退。

## 改动（2 文件 + 测试）

1. **`archetypeMeta.ts` `buildArchetypeInputParams`**：`references` 参数加可选 `referenceImages?: string[]`（边产出的超集）。对 `ARRAY_SLOT_ROUTE` 中 `accept==='image'` 的槽（即 image_ref），把 `readArchetypeArray(meta, metaKey)`（手动）+ `referenceImages`（边）**合并去重、截到 `slot.max`**，再写入 `out[inputKey]`。非 image 槽（video/audio）不受影响。
   - 顺带修一个隐患：现在数组槽**不 cap** `slot.max`，手动超额也能进 body → vendor 422；合并后统一 cap，更稳。
2. **`catalogTaskActions.ts` `buildReferenceExtras`**：调 `buildArchetypeInputParams` 时把 `referenceImages: references.referenceImages` 传进去（现在只传了 firstFrame/lastFrame）。
3. **测试**：`archetypeMeta` 的 buildArchetypeInputParams 单测加用例——边参考图合并进 image_ref 槽、与 meta 去重、超 max 截断、video/audio 槽不被污染、无档案/非 image 槽不变。

## 不动什么 / 回滚 / 验收门

- **不动**：M2 模式互斥（只处理 `mode.slots` 内的槽，残留键照旧不进 body）；首/尾帧 frame 槽逻辑；vendor mapping body；非档案模型路径（`referenceInputParams` 的 else 分支）。
- **回滚**：纯叠加，单 commit 可 revert；选 B 的话改 `referenceEdgeCapability` 的 EDGE_MODE_SLOTS 让 character_ref 不匹配 image_ref（另议）。
- **验收门**：typecheck + 单测（新用例 + 现有 archetype/reference 测试不回归）+ filesize + lint + build；真机验证留作后续（需额度：连 character_ref 边 → 生成 → 主进程埋点确认 reference_image_urls 进了 body）。

## 后续切片（本次不做）

- 切片 2：首帧接力 `relayFromVideoUrl` 抽帧 consumer（`generationReferenceResolver.ts:13-15` 承诺、runner 未实现）。
- 切片 3：身份保持/seed 跨镜锁绑定（按模型能力，需调研 vendor 支持）。
