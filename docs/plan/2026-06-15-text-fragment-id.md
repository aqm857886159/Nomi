# 文本三真相源 · 片段 ID 绑定（交接任务② · 方案待拍板）

> 状态：**方案 / 待用户拍板方向**（交接明确：本任务到「plan + 拍板」为止，不改实现）。
> 出处：`docs/plan/2026-06-14-handoff-tails-popover-textsource.md` 任务②。
> 前置已拍板：`docs/plan/2026-06-13-storyboard-plan-document-flow.md`（分镜方案 = 结构化字段视图、字段直绑 `StoryboardPlan`、**拒绝「文字→结构」重解析**）。

---

## 1. 问题

**通俗讲**：同一段「源文本」在产品里被抄了三份，互相不认识——
- A｜**创作区文档**（用户写的剧本，`workbenchDocument`，Tiptap JSON）
- B｜**AI 拆出来的分镜方案**（`storyboardPlan`，结构化卡片，可改）
- C｜**画布上的镜头节点提示词**（`node.prompt`）

用户改了 A 里某句，B 和 C 不会动；改了 B 的某镜，C 不会动；改了 C，B/A 更不知道。越改越对不上，没人知道哪份是「最新真相」。

**技术讲**：每次派生都是「读 trim 字符串 → 写进新对象」，复制即断联。系统里**没有「这是同一段文本」的概念**。

## 2. 现状数据流 + 三个断联点（真机摸底，file:line）

| # | From → To | 断联点 | 抄了什么 | 有无 id/锚 |
|---|---|---|---|---|
| 1 | 选区文本 → `node.prompt` | `createNodeFromSelection.ts:23,27` | `selectedText.trim()` | 无（Tiptap from/to 仅用于弹层定位后即弃，`SelectionGeneratePopover.tsx:43`）|
| 2 | 文档文本 → `storyboardPlan` 镜头 prompt | LLM 重写，存于 `applyCanvasToolCall.ts:103` | 重新创作的 prompt | 无（`PlanAnchor.id`/`PlanShot.index` 是方案内 id，不回指文档）|
| 3 | 方案镜头 prompt → `node.prompt` | `storyboardPlan.ts:241,262`（经 `StoryboardPlanEditor.tsx:81,88`）| `buildShotPrompt`/`buildAnchorSheetPrompt` 输出 | 仅 `clientId`=anchor.id/`shot-N`，不回指方案/文档 |

**关键事实**（摸底确认）：
- 全仓**无任何文本片段联系原语**（grep `textSource/fragmentId/sourceRange/docAnchor`… 零命中）。必须新引入。
- `derivedFrom`（`generationCanvasTypes.ts:148`）是**节点↔节点**血缘（跨分类副本），**只读不双向同步**——团队既有哲学。
- `connection-reference-capability-model.md` 的 provenance 是 **node↔node / edge↔slot**，`sourceNodeId` 是画布节点 id，**不是文档文本跨度**。两者都帮不上文本→节点。
- `storyboardPlan` **现已持久化**（P0-6 已修：`projectRecordSchema.ts:83` + `projectNormalize.ts:163` + `workbenchProjectSession.ts:29`）——方案 B 是真·持久真相源，不再是临时态。
- `workbenchDocument.contentJson` 是 Tiptap JSON，normalizer（`workbenchTypes.ts:8`）**只白名单 bold/italic/strike/code**——naive 加自定义锚 mark 会被它**剥掉**，必须显式白名单。

## 3. 根因（P2）

系统缺一个跨 A/B/C 的**「文本片段身份」（fragment id）**：每段源文本一个稳定 id，派生物携带它 + 当时的内容指纹。没有它，三份拷贝就是三个孤岛，改一处无从知会另两处。

## 4. 设计选项（R3 对比表）

核心岔路有二：**(甲) 片段 id 的载体与真相源**、**(乙) 同步语义**。

### 乙｜同步语义（先定这条，它决定整体复杂度与风险）

| 方案 | 用户看到什么 | 代价/风险 |
|---|---|---|
| **乙1 实时双向同步** | 改 A 自动改 B/C，反之亦然，永远一致 | Tiptap 区间锚随编辑分裂/合并极脆；双向同步=环路与冲突地狱；与既有「`derivedFrom` 只读、不双向」哲学相悖 |
| **乙2 单向派生 + 漂移检测 + 显式再同步（推荐）** | 改了源 → 派生物上出现「源已更新，要同步吗」提示；点一下才同步（或「让 AI 重拆这段」）；不改就保持现状 | 需一处「源已变」徽标 + 再同步动作；不自动改用户已手调的下游（尊重手动编辑）|
| **乙3 仅溯源、不检测** | 镜头卡能「跳回它来自剧本的哪一段」，但不提示漂移 | 最轻；但解决不了「越改越对不上」的核心痛（只加了导航）|

> **推荐乙2**：与团队既有 provenance/对账「让 AI 修」哲学（`reconcile-edge-drop-and-card-redesign`、`derivedFrom` 只读）一致，也与「分镜方案拒绝脆弱重解析」的前置拍板一致——**检测分歧 + 用户掌控同步**，不玩自动双向魔法。

### 甲｜片段 id 载体（在乙2 前提下）

| 方案 | 机制 | 代价/风险 |
|---|---|---|
| **甲1 文档侧 Tiptap mark 锚** | 在 A 的源区间打自定义 mark 存 fragmentId | Tiptap mark 随编辑分裂/迁移、normalizer 要白名单、区间漂移难维护——**最脆**，建议不作为一期 |
| **甲2 片段注册表 + 内容指纹（推荐一期）** | 派生时给该段文本分配 `fragmentId` + 存 `sourceHash`（源文本规范化后的哈希）；B 的 `PlanShot`/`PlanAnchor`、C 的 `node` 都带 `sourceFragmentId` + `sourceHash`。源变 → 重算 hash 不匹配 → 标「漂移」。源文本身份按「方案锚/镜头」粒度（不强求精确到文档字符区间）| 不追字符级区间（够用：用户感知是「这镜来自这段意思」）；需在三处 schema 加可选字段 |
| **甲3 文档侧块级 id（blockId）** | 给 Tiptap 段落块加稳定 blockId，fragment 指向 blockId | 比 mark 稳（块比区间稳），但仍需 normalizer 支持 + 块拆分合并语义；可作二期增强甲2 的精度 |

> **推荐甲2**：内容指纹做漂移检测、`sourceFragmentId` 做溯源/再同步锚点，**不碰脆弱的 Tiptap 区间**。精确到「方案锚/镜头」粒度即可满足「改一处知会另处」。二期可加甲3 提升文档侧精度。

## 5. 推荐方案（乙2 + 甲2）一句话

给每段被派生的源文本一个 **`fragmentId` + `sourceHash`**，B/C 的对象都带上；当源（A 或 B）变化导致 hash 失配，下游出**「源已更新」徽标 + 一键再同步 / 让 AI 重拆这段**；**绝不自动覆盖用户已手调的下游**。三份从「孤岛拷贝」变成「带溯源与漂移可见性的派生链」。

## 6. R7 六角色评审（要点）

- **CTO**：乙2/甲2 与既有 `derivedFrom` 只读 + 对账哲学同构，不引入双向同步这类高债结构；新原语是三处可选字段 + 一个 hash util，扩展面可控。✅ 注意别让 fragmentId 成第四份真相源——它是**指针**不是内容。
- **设计师**：「源已更新」提示要轻（徽标 + 悬浮说明 + 单一动作），别又是双层 border/长文案（R2）；复用既有对账卡视觉语言。
- **产品**：真痛点是「越改越对不上」。乙3 只给导航不够；乙1 过度且脆。乙2 命中且可控。范围别一期就追字符级区间（甲1/甲3 押后）。
- **前端**：Tiptap mark 锚（甲1）是已知的脆点，一期排除是对的；hash 漂移检测是纯函数，易测；徽标走节点卡既有 meta 区。
- **后端**：三处 schema 加可选字段（`PlanShot`/`PlanAnchor`/`GenerationCanvasNode`）需迁移幂等（默认 undefined，不触发 revision 漂移——复用 `migratedRecordNeedsPersist` 语义相等）。
- **真实用户**：希望「我改了剧本，镜头能跟上」——乙2 给「提示 + 一键同步」比静默改更可控（不怕被自动改乱手调过的镜头）。

**最大张力**：用户可能期望「改剧本镜头自动变」（乙1 直觉）。需向用户讲清乙1 的脆性与「自动改会覆盖你手调的镜头」的坏处，确认乙2 的「提示 + 你点同步」可接受。→ 列入拍板问题。

## 7. 范围 / 不动 / 回滚 / 验收（供拍板后实现）

- **范围**：① hash/fragment util（纯函数，新模块）；② `PlanShot`/`PlanAnchor` 加 `sourceFragmentId?`+`sourceHash?`；③ `GenerationCanvasNode` 加 `sourceFragmentId?`+`sourceHash?`（或挂 `meta`）；④ 派生三点（createNodeFromSelection / storyboardPlan 生成 / plan→nodes）写入 fragment；⑤ 漂移检测 + 节点卡/方案卡「源已更新」徽标 + 再同步动作（UI 走 R8 样张）。
- **不动**：不引入双向同步；不动 Tiptap normalizer（一期不加 mark 锚）；不改「分镜方案=结构化字段」前置拍板。
- **回滚**：字段全可选，删检测/徽标即退回现状（拷贝照旧，只是没漂移提示）。
- **验收**：纯函数单测（hash 稳定性/漂移判定）；迁移幂等（加字段不触发 re-save）；R8 样张「源已更新」徽标 + R13 真机走查（改剧本→镜头出提示→点同步生效；手调过的镜头不被静默覆盖）。

## 8. 待用户拍板

1. **同步语义**：乙2（提示+一键同步，推荐）／乙1（实时双向）／乙3（仅溯源导航）？
2. **粒度**：一期到「方案锚/镜头」粒度（推荐）够吗，还是必须字符级区间（要冒 Tiptap 锚的脆性）？
3. **再同步动作形态**：「机械重灌源文本」vs「让 AI 重拆这段」——哪个作默认（可两者都给）？
