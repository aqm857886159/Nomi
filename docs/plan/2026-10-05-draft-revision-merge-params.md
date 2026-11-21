# 改草稿只改被点名的参数 · 设计卡（★5 格）+ 方向检查

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：resolvePlanPatch 的参数从「整份替换」改成「按键合并，null 显式清掉」
线/负责人：L-aspect（Opus）        类别：[其他]（不新增花钱语义，只让「改了什么」更准；不新增界面）
规则来源：协调会话 2026-10-05 拍板（改草稿 = 只改被点名的参数，其余不动）
前置：#1023（语义比例，docs/plan/2026-10-05-agent-aspect-ratio-semantic.md）
```

## 0. 一句话

Agent 改草稿时 `parameters` 是整份替换：只改比例，清晰度掉回档案默认（验收线 V-1023r 实测 4K → 1K）；只写 `{resolution: "4K"}`，比例被清掉。现在点名的键合并进这一镜原有的参数，其余不动；要清掉一个键必须显式写 `null`；回给 Agent 的结果里列出这一次实际改了哪几个键（改前 → 改后）。

## ★1 用户怎么用

当我在 Agent 对话里说「把第 2 镜改成竖屏」，我想只有比例变，清晰度、时长、格式都照旧，付费卡上印的就是这一份。步骤：①用户说改一项 ②Agent 调 `draft_shots`（`operationId + shotId`，只带要改的那一项）③宿主把点名的键并进这一镜原有参数（语义比例先翻成真实键），换模型时原有参数里新模型不认的清掉并上报 ④回给 Agent 的 `changeset.changedParameters` 列出改前 → 改后 ⑤卡上与请求体是合并后的那一份。**不做**：文稿方案改一镜（`patchStoryboardAuthoring`，方案正本在渲染层、替换语义住在 `storyboardSubjectAdapter`，见 #1023 设计卡 §5 的后续）；夹取（宿主今天对越界值是拒、不是夹，下面「已知坑」）。**已知坑**：①外部 MCP 调用方以前可以靠「整份重写参数」去掉一个键，现在要写 `null`——行为变了，在 PR 里写明；②`draft_shots` 说明书原来写着「the host clamps … and reports every clamp」，宿主其实从不夹取、越界一律拒，这句不实，这次删了（同时腾出 schema 预算给 `null`）。真实任务：(a) Nano Banana 2 4K 三镜，「第 2 镜改竖屏」；(b) 同一镜「清晰度改回 1K」比例不动；(c) Veo 3.1（Runway 像素档）原来 1920:1080，「改竖屏」留在 1080 档 → 1080:1920。 | 真 App 本线 `unverified`，交协调会话

## ★2 谁说了算

概念「一份补丁怎么并进这一镜的候选」唯一 owner = `electron/capabilityCore/generationPlanPatch.ts` `resolvePlanPatch`（`docs/engineering/concept-owners.json` 已登记，写接口另一个是付费卡的 `normalizePatch`，它就是调这个函数）。这一刀只改它内部「参数怎么并」那一段，不新增写口。语义比例翻译仍走 `normalizeAuthoredCandidate`（#1023），只多一个参数：原有参数当「同一档」的参照，不参与冲突判断。证据：`node scripts/door-map.mjs resolvePlanPatch` —— 写入口 = Agent / 外部 MCP 的 `plan` 分支（`mcpGenerationTools.ts`）与付费卡改参数（`appIntegration.ts` 装的 `normalizePatch`）。

## ★3 一致与复用

- 付费卡：读 `src/workbench/ai/v4/spendCardDraft.ts` `candidatePatchFromNode` 确认——卡每次发的 `parameters` = 这一镜全部参数键 ∪ 参数条控件键，没动的取候选原值。所以对卡来说合并 = 替换，行为不变（`generationPlanPatchMerge.test.ts` 最后一条钉住）。
- 换模型时的残留清理复用 `stripParametersNotAccepted`（读盘归一同一个函数）；以前只在「没写参数」时清，现在原有参数总要并进来，所以总是按新身份先清一遍，清掉的照旧进 `changeset.clearedParameters`。
- 「改了什么」的回报沿用现有的 `changeset`（以前只在换模型 / 模式时出），加一格 `changedParameters: [{ key, before?, after? }]`；`before` / `after` 缺省 = 那一侧没有这个键。被拒的值仍是结构化错误（`ParameterRejection`，带合法值），不是部分成功。
- 宿主面 `parameters` 的取值本来就收 `null`（`generationJsonValueSchema`）；模型面 `draft_shots` 的参数取值并集加一个 `null`。

## ★4 全状态

不新增界面、不改文案。卡上：合并后的参数（例：比例 9:16、清晰度 4K）。Agent 收到：`changeset.changedParameters`（与 `clearedParameters` / `modelChanged` 同一个对象）。拒绝：越界值 / 比例两处冲突 → 结构化错误，草稿不动。

## ★9 验收与回滚

验收：另一条线按 ★1 三条任务在真 App 上看卡上与请求体的参数；单测 `electron/capabilityCore/generationPlanPatchMerge.test.ts`（10 条）、`agentAspectRatioCard.e2e.test.ts`（改比例后清晰度 4K 留着、卡上同一份）。变异：改回整份替换 → 9 条红；`null` 不清 → 1 条红；不拿原值当同档参照 → 1 条红。回滚：revert 本 PR 的提交（数据无迁移；模型面基线随提交回滚）。

## 模型面与预算（上限一个没动）

模型面变化：`shots[].parameters` 的取值多一个 `null`；说明改成「Profile values but length/ratio; revisions change named keys only, null deletes.」；`aspectRatio` 的说明压成「e.g. 16:9 or auto.」；工具说明里那句不实的「The host clamps values … reports every clamp.」删掉。

| 预算 | 上限 | #1023 | 本刀 |
|---|---|---|---|
| P5 · draft_shots core | 785 | 777 | 777 |
| P5 · draft_shots 全量 | 1706 | 1705 | 1705 |
| lane 全部组常驻（3D-BOX 开） | 10000 | 9992 | 9992 |

## 方向检查（RW）

`generationPlanPatch.ts` 所在概念「一份补丁怎么并进这一镜的候选」近 14 天第 10 个 fix。根因复盘：这个概念反复出 bug，是因为补丁的语义从来没写明是「替换」还是「合并」——模式、变体、参数各自按调用点的方便处理（模式跟着模型走、变体清掉、参数整份替换），每加一个调用方就踩一次不同的坑。这一刀把参数那一格定成「按键合并 + null 清除」，并让「改了什么」回到调用方眼前。

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | JSON Merge Patch（RFC 7396：对象按键合并，`null` 删键）——本刀的规则就是它在 `parameters` 这一层的子集；不引库：一层对象的合并就是一个展开 | 无 | 无 | **是（照标准语义）** |
| 补 | 只在 Agent 那条路把原有参数抄进补丁 | 外部 MCP 照旧整份替换，两条路语义不同 | 同一件事两份规则 | 否 |
| 重写 | 整份补丁语义统一成 Merge Patch（模式、变体、参考也按它） | 碰付费卡与读盘归一 | 范围大 | 后续评估 |

用户要权衡的核心：参数这一格按标准合并后，模式 / 变体 / 参考那几格要不要也统一成同一个语义（今天它们各有道理：换模型时变体必须清掉）。

## 先查别人

- 标准：JSON Merge Patch，RFC 7396 https://www.rfc-editor.org/rfc/rfc7396 （对象成员按键合并，值为 null 即删除该成员）。
- 生态：Kubernetes strategic merge patch 的「只改提到的字段」语义 https://kubernetes.io/docs/tasks/manage-kubernetes-objects/update-api-object-kubectl-patch/ 。
- 仓库里：付费卡补丁的构造 src/workbench/ai/v4/spendCardDraft.ts:135（`candidatePatchFromNode`，完整参数集）；补丁落盘 `electron/capabilityCore/executionContract.ts`（`applyPlanCandidatePatch`，参数整份替换——合并在它之前做完，落盘的就是合并后的完整一份）。
