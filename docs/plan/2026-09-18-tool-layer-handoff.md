# 工具层 · 交接文档（2026-09-18）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> **给下一个会话/下一个人的。** 读完这份，你应该能回答三件事：
> 我们的工具层到底哪里错了、已经修到哪一步了、下一刀该切哪里。
>
> **正本关系**：本文件是**入口**。两份底稿是
> `docs/plan/2026-09-18-tool-layer-findings-inventory.md`（14 条发现 + 我们自己的判断）和
> `docs/plan/2026-09-18-tool-layer-prior-art-verdict.md`（对照六家之后的裁决）。
> 有冲突以裁决那份为准——它推翻过清单里的一部分。

---

## 先查别人

这份交接文档不提新方案，它转述的裁决来自一份真做过的检索报告：
`docs/plan/2026-09-18-tool-layer-prior-art-verdict.md`（六个面：MCP 规范 + TS SDK、Claude Agent SDK、
Messages API、OpenAI function calling / Agents SDK / Codex、pi、ChatCut）。本文 §4 是它的结论摘要。

- **依赖里已有？** pi 的 `AgentHarnessTool<TContext, TParameters>` 一份 typebox 两用——`node_modules/@earendil-works/pi-agent-core/dist/index.d.ts` 本人直接读，逐条记在 `docs/plan/2026-09-18-tool-layer-prior-art-verdict.md:98`（§2.5）。
- **仓库里已有？** 我们对外 MCP 面已经是投影：`electron/capabilityCore/mcpGenerationToolCatalog.ts:22`；同文件 `:33-54` 是要删的第三份手抄（本文 §5）。
- **生态里已有？** Claude Agent SDK 一份 zod 派生模型面 + 执行前校验（https://code.claude.com/docs/en/agent-sdk/custom-tools ）；OpenAI「Avoid JSON schema divergence」（https://developers.openai.com/api/docs/guides/structured-outputs ）；Vercel AI SDK `inputSchema` *"dual purpose"*（https://ai-sdk.dev/docs/reference/ai-sdk-core/tool ）。
- **反方证据？** 唯一的「两份手写」先例 Codex **已被量到漂移**（`timeout_ms` 宿主收、模型不知道），见 `docs/plan/2026-09-18-tool-layer-prior-art-verdict.md:90`——它是反例，不是支持。

## 0. 三十秒版

一个能力从模型嘴里说出来、到宿主真的去执行，中间被**手写重述了四到五遍**。
四遍之间没有任何东西比对，所以某一遍写错了，**没有任何地方会红**——值就那么无声地丢了。

09-18 这一天挖出来的所有工具层缺陷，14 条里有 11 条是这个形状的不同长相。

已经修完的是**具体的那几处**和**几道门岗**（让同类不再无声）。
**没修的是形状本身**：正确的结构是「一份 schema、两个用途」，我们现在是「两份手写 schema + 一张人维护的对照表」。

---

## 1. 这件事是怎么被发现的（真实起点，不是审计发现的）

用户做一件很普通的事：**把剧本给 Agent，让它出一张分镜表。**

它失败了。查下去发现不是「有个 bug」，是**每一层各断一次**：

1. 模型压根不调工具（技能正文里有一句为上一代工具写的性质描述，压过了注册表真相）
2. 调了，参数被翻译层静默丢掉
3. 参数没丢的，落不到画布
4. 落到画布的，分镜表里看不见

**真实模型实测的数字**（不是单测，是跑真模型的轮次）：

| | main（5 轮） | 修完（23 轮） |
|---|---|---|
| 调到 `draft_shots` | 1/5 | 18/23 |
| 落到画布 | 0/5 | 14/23 |
| 画布节点标题是模型写的 | 0 | **126/126** |
| **分镜表里可见** | 0/5 | **0/23** ← 仍然是 0 |

23 轮里剩下的 27 次失败**已全部定位并归零**：参考图 11 次、只有形象参考 11 次、静帧时长 5 次。

**最后一行还是 0**，因为那是另一个问题（分镜表和画布是两套账本），
`fix/storyboard-single-ledger-20260918` 那条 lane 在修，不在工具层范围内。

---

## 2. 「是工具设计错了，还是模型调错了？」——这个问题的答案

用户问过这句。答案是**绝大多数是我们设计错了**，而且可以按「模型有没有可能做对」机械地分组。
这个分组方式本身比结论更有用，后面遇到新缺陷照着分：

| 组 | 判据 | 这次有几条 |
|---|---|---|
| **A** | 宿主要一个模型**不可能拿到**的值（没有任何读工具返回它） | 2 |
| **B** | 模型给对了，我们在中间**丢掉或拒掉**了 | 4 |
| **C** | 我们**凭空造出**一个要求，然后指责模型没满足 | 3 |
| **D** | 我们自己两处**互相打架**（技能说一套、工具说另一套） | 2 |
| **E** | 结构性的（死代码、两份实现、一份更窄） | 3 |

**A 类的判据一句话**：宿主每个必填字段，都要说得出「模型是从哪拿到它的」。
说不出 = 设计错了，不是模型的问题。
反例很有欺骗性：有人把 `contentHash` 直接加进动词声明，于是「告诉过模型」立刻成立了——
可**没有任何读动词返回 contentHash**，模型还是拿不到。工具照样 100% 不可用，而且没有任何东西会红。

这条判据现在已经机器化了（`verbFieldMap.ts` 的 `from:` 四档来源，`from-read:<verb>.<field>` 那一档**会真的去核**那个动词的输出 schema 里有没有这个字段）。

---

## 3. 结构根因：为什么同一件事要写四遍

一次工具调用要经过：

```
动词声明（模型看到的那一面）
   ↓  翻译层  verbTransportRoutes.ts / laneVerbTransport.ts
契约 schema（宿主准入那一面）
   ↓
handler 及下游各处投影
```

**头两遍是应该有的**——模型要的是对它友好的名字（`modelKey`、`durationSec`），
宿主要的是内部名（`modelId`、`parameters.duration`），而且宿主那道校验是**花钱闸**，必须独立存在。

**第三遍不该手写。** 它承载的全部信息就是前两套词之间的对应关系。

**手写它的代价，09-18 当天量到两种**：
- `durationSec` 被翻译成一个宿主根本没有的顶层字段 → **整条拒收**（至少还报错）
- `modelKey` 和逐镜的 `candidate.providerId/modelId` 在解构里**根本没被列出来** → **静默丢掉**。
  模型点名「用 apimart 的 image-1」，宿主照用户默认模型去花钱。**这个连错都不报。**

**它为什么能一直活着**：`electron/shared/agentCapabilities/transportContracts.ts:22-26` 的 `RuntimeToolCall.args: unknown`
把类型抹平了。类型一旦抹平，两份手写 schema 就**永远不可能在编译期对上账**。
这是整个问题的物理原因——不解决它，加再多门岗都是在外面补。

---

## 4. 对照外面之后的裁决（可能推翻上一节）

查了六个面：MCP 2026-07-28 规范 + TS SDK、Claude Agent SDK、Messages API、pi、Codex、ChatCut。

**裁决：我们「该有两遍，不该有四遍」的判断，对了一半，错了关键的一半。**

- **对的那半**：两道运行时动作（准入校验 + 审批）必须存在，审批归宿主。
  但我当时给的理由（「因为跨进程」）**不是真正的理由**——别人不跨进程也这么做。
- **错的那半**：我们把它做成了**两份手写 schema + 一张对照表**。
  别人的做法是**一份 schema 两个用途**：宿主契约 schema 是唯一真相，
  模型看到的那一面是它的**投影**（`hide` + 描述覆写），宿主自己补的值写成显式 `fill`，
  **而且补完要重过同一份 schema**（Claude Code 的原话）。最后这条我们没有。

唯一「两份手写」的先例是 Codex——**而它已经被量到漂移了**（`timeout_ms` 宿主收、模型不知道）。

**我们那张对照表上 9 条 rename，7 条的理由是命名偏好**，按我们自己的 R5.5
（偏差理由只许领域约束、不许偏好）**这 7 条不合法**。逐条：

| 动词字段 | → 宿主字段 | 理由是什么 | 合法？ |
|---|---|---|---|
| `durationSec` | `parameters.duration` | 改嵌套层级 | ✅ 结构 |
| `candidate.providerId` | `providerId` | 拍平嵌套 | ✅ 结构 |
| `candidate.modelId` | `modelId` | 拍平嵌套 | ✅ 结构 |
| `modelKey` | `modelId` | 「模型面叫 modelKey，宿主面叫 modelId」 | ❌ 偏好 |
| `draftId` | `operationId` | 「草稿 id 在宿主面是 operationId」 | ❌ 偏好 |
| `jobId` | `operationId` | 「生成域的同一件东西叫 operationId」 | ❌ 偏好 |
| `changeId` | `undoToken` | 见下，**这条还自相矛盾** | ❌ 偏好 |
| `revision` | `baseRevision` | 偏好 | ❌ 偏好 |

`changeId → undoToken` 要单独说：**模型看到的那一面自己就不自洽**——
`edit_timeline` 返回给模型的字段叫 `undoToken`，而 `undo` 收的字段叫 `changeId`。
模型拿到 A、必须填 B，中间没有任何提示。这条不是「翻译层的问题」，是**模型面自己的 bug**。

---

## 5. 清单 14 条都没覆盖的那一条（已独立核实）

**外部 MCP 面上，同一个重命名存在第三份手写实现。**

`electron/capabilityCore/mcpGenerationToolCatalog.ts:33-54` 的 `buildOperationCreateParams` 是一份逐字段手抄
（22 行，字段一个个列出来），里面带着**第三份** `modelKey → modelId` / `vendor → providerId` 翻译。
注释自己写着「字段拷贝」。

`check-mcp-operation-constructible` 只核「可不可**构造**」，**不核「可不可**填**」——
所以 A 类（宿主要了模型拿不到的东西）在外部面以另一种形式**仍然存在**，没被任何门岗覆盖。

所以「重复表述四遍」这句话**说少了**。

---

## 6. 已经落地的（事实，不是提案）

| 做了什么 | 落在哪 |
|---|---|
| 多镜与单镜共用同一台候选合成器（删掉 N=1 / N≥2 的不对称） | `mcpGenerationMultiShot.ts` `draftShotFromPlan` |
| 镜头信封单一真相源 + **编译期**穷尽性断言 | `electron/shared/generationShotEnvelope.ts` |
| 翻译层改成从声明的对应关系**派生**，含「模型从哪拿到这个值」四档来源 | `verbs/verbFieldMap.ts` + `verbTransportRoutes.ts` |
| 参考图身份改成**宿主自己解析**，不问模型 | `resolveProjectAssetReferenceIdentity` |
| 跨字段约束搬到动词面 | `writeVerbs.ts` superRefine（**但见 §7 第 4 条，这条只做了一半**）|
| 失败形状两个出口收敛到一处 | `electron/shared/agentLane/laneFailureFromDecision.ts` |
| 删掉每回合 24 次模型请求的上限 | `laneHost.mts:95` `LANE_MAX_MODEL_REQUESTS = undefined` |
| 技能正文不许复述注册表事实（五类） | `check:skill-tool-binding` |
| 动词↔宿主字段级一致性 | `check:verb-host-conformance` |
| 969 个声明过的 owner 第一次有人核（814 在位） | `check:boundary-owners` |

三道门岗**都做过变异验证**（先证明它会红，才算数）。

---

## 7. 已经知道做错/做偏的（别重复踩）

1. **一致性门岗 R1–R3 是「为一条本可消掉的缝造的尺子」。**
   如果走投影路线，那条缝根本不存在，尺子也就不需要。R4/R5 留着（它们核的是别的东西）。

2. **翻译派生化是第二好解，不是最好解。** 它让手写的那一遍变成声明的，但**缝还在**。
   最好解是投影：根本没有第二份 schema。
   **方向冻结**——让它落地，但下一刀做**减法**不是加法。

3. **`defaults` 那两条与宿主的 `inherited` 重复**，是同一件事的两份。

4. **「把跨字段约束搬到动词面 = 模型提前知道」这句是错的。**
   `superRefine` **不进 published JSON Schema**，模型在发出调用**之前看不见它**，
   只有撞上去被拒时才读到。这条没做到它声称的事——只是拒绝信息好了一些。
   真要让模型提前知道，得进 JSON Schema 本身（`oneOf` / `dependentRequired`）或写进描述。

5. **我们模型面的 schema 沿内部路被校验了 3–4 次**，而两份文件头**互相矛盾**：
   - `laneToolSchema.mts:17-18` 写着「校验只发生一次：pi 的 ajv 那次。宿主不再用 zod 复验」
   - `laneTools.mts:237` 就在做 `descriptor.schema.safeParse(params)`（一次 zod 复验）

   两句话不可能同时为真。**动这块之前先把这件事查清楚**，别信任何一份文件头。

---

## 8. 下一刀（建议顺序，未拍板）

> **2026-09-18 晚更新：1-6 全部做完**（分支 `feat/tool-projection-rollout-20260918`，详见
> `docs/plan/2026-09-18-tool-projection-rollout.md`）。逐条对账：
> 1 ✅ 七条偏好 rename 在上一刀改成同名｜2 ✅ `changeId → undoToken` 同上｜3 ✅ `defaults` 随对照表一起删｜
> 4 ✅ 整张表换成投影（`verbFieldMap.ts` 316 行 + `verbTransportRoutes.ts` 280 行删光）｜
> 5 ✅ 先在 `cancel_job` 做了原型再铺开｜6 ✅ 外部 MCP 面那 22 行手抄删掉，门岗升级成「可填」。
> **§9「不许当前提」里那条「投影化之后可以删掉 verbFieldMap.ts 是设计推断，没做原型」现在有答案了**：
> 能删，但它身上有一条轴不是对应关系（`from:` 来源），那条留下来搬进了 `verbs/verbFieldProvenance.ts`。
> §7.1「R1–R3 不需要了」**只对纯投影的那 12 个动词成立**，另外 7 个仍是构造，所以 R1–R3 留着（理由写在门岗文件头）。

**方向是减法，不是加法。**

1. **把 7 条偏好 rename 改回同名。** 代价是改宿主内部字段名或模型面字段名（要选一边）。
   收益是对照表从 9 条缩到 2 条。
2. **顺手修 `changeId → undoToken`**——这条是模型面自己的 bug，无论走不走投影都该修。
3. **删掉 `defaults`**（与宿主 `inherited` 重复）。
4. 当表缩到只剩 `references`（有损那档）+ `absentOn` 时，**整张表换成「投影」**：
   宿主 schema 是唯一真相，模型面 = `.omit().extend()`，宿主补的值写成显式 `fill` 且**补完重过同一份 schema**。
5. **先在一个小动词上做原型再铺开**（比如 `cancel_job`，只有一个字段）。不要一次性全改。
6. 外部 MCP 面的第三份手写（§5）一并收进来——它已经是投影形状了（`mcpGenerationToolCatalog.ts:22` 用的就是 `.omit().extend()`），
   但 `buildOperationCreateParams` 那 22 行手抄要删。

**物理前提**：不解决 `RuntimeToolCall.args: unknown`（`electron/shared/agentCapabilities/transportContracts.ts:22-26`），
上面 1–6 做完了编译器**依然**不会帮你对账。这个要先想清楚。

**三条在跑的 lane（A/B 位置实验、技能加载迁 pi、分镜账本合一）都不受影响，不用停。**

---

## 9. 不许当前提的（未证实）

- Codex 的部分行号来自二手报告，**未逐行复核**。
- Claude Code 对第三方 server 的 `_meta` 是否强制弹窗，**未真机验证**。
- 「投影化之后可以删掉 `verbFieldMap.ts`」是**设计推断，没做原型**。
- §8 第 1 条「改回同名的代价可接受」**没量过**——真要做，先数一遍受影响的调用点。

---

## 10. 接手第一件事

**先跑一遍这个，确认你站在哪棵树上：**

```bash
git log --oneline origin/main..HEAD | head -5
pnpm run check:verb-host-conformance && pnpm run check:skill-tool-binding
```

然后读 §4 的裁决表和 §7 的五条「做偏了」。
**§7 第 4 条和第 5 条尤其重要**——那是两个「我以为做到了、其实没有」的地方，
不知道的话你会在错误的前提上继续加固。
