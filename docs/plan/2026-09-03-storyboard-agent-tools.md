# 分镜表的 Agent 工具面

状态：📋 **待拍板**（2026-09-03）

> ⚠️ 本文档是**方案**，不是现状。现状见 `docs/ARCHITECTURE-NOW.md`。

## 0. 为什么是现在

同日的三栏改造给分镜页接上了常驻 Agent 栏（`StoryboardWorkspace` 有了自己的 dock）。
**但那个 Agent 手里没有任何能碰分镜表的工具**——它的 `agentSurface` 是 `creation`，
拿到的是文稿读写 + 分镜规划，而分镜规划是「整份方案替换」。

装了对话框却不给手，比不装更糟：用户会对它说话，然后发现它只会聊天。

## 1. 先看现在工具是怎么做的（实查，2026-09-03）

- **真相源**：`electron/harness/tools/modelToolSurfaceManifest.ts`。全仓**只有 12 个**语义工具。
- **一个工具的定义**：`name`（`nomi_*`）+ `version` + `intent` + `capabilityRefs` +
  zod `inputSchema`/`outputSchema` + `sideEffect`(none/proposal/external) + `execution` +
  `risk`(read/project_write/paid_external) + `disclosure` + `availability.{phases,requiredScopes}`。
- **房子的范式是「工具少、operation 联合多」**：`nomi_canvas_plan` 一个工具下挂 8 个 operation
  （`create_canvas_nodes` / `propose_storyboard_plan` / `create_camera_move` …），
  schema 是 `canvasWrite.ts` 里的判别联合。**不是一个动作一个工具。**
- **投放**：`agentChatPolicy.ts` 按 capability + toolProfile 投影工具集；
  `availability.phases` 已经有 `"storyboard"` 这个相位，当前只有 3 个工具带它
  （`nomi_canvas_read` / `nomi_canvas_plan` / `nomi_document_read`）。
- **执行**：渲染层 `applyCanvasToolCall.ts` 按 `toolName`/`operation` 分派，真正改 Zustand。
- **审批**：`residentToolProjectionForCall(t, name, args, status)` —— **一次工具调用 → 一张确认卡**。
  这条决定了工具的粒度设计（见 §3）。

## 2. 用户在分镜表前会说什么（outside-in，D1）

| 类 | 典型说法 | 现在能做吗 |
|---|---|---|
| A 单镜微调 | 「第 3 镜改成近景」「第 7 镜时长 8 秒」「第 2 镜换成视频」 | ❌ |
| B **跨镜批量** | 「所有镜头加雨天」「1-4 白天、5-8 夜晚」「全改竖屏」「没生成的都换便宜模型」 | ❌ |
| C 结构调整 | 「3、4 镜之间插一个过渡」「删掉第 6 镜」「8 镜压到 5 镜」「2 和 5 调换」 | ❌ |
| D 一致性/参考 | 「主角在 3、5、7 镜是同一个人」「加个场景锚：雨夜地铁站」「第 4 镜参考换成刚出的那张」 | ❌ |
| E 询问诊断 | 「哪几镜没生成」「第 5 镜为什么失败」「这套分镜有什么问题」 | ✅ `nomi_canvas_read` |
| F 执行 | 「把没生成的都跑了」「重跑第 3 镜」 | ✅ 生成工具 |

**A–D 全部落空，而 B 恰恰是 Agent 相对手工操作优势最大的一类**——「所有镜头加雨天」手工要点 8 次。
D 类还踩在 Nomi 的护城河上（跨镜一致性），不该缺。

## 3. 核心取舍：工具的粒度（R3）

现在 Agent 想改分镜表只有一招：**重发整份方案**。而「只改用户点名要改的部分，其余原样保留」
是写在 `storyboardLauncher.ts:60` 的**提示词里求它**的，不是结构上拦着它的。

| 方案 | 用户看到 | 代价 |
|---|---|---|
| **甲 维持现状**（整份方案替换） | 改一镜也要等它重写整份；它顺手改坏别处时用户只能自己发现 | 零开发；但「别乱改」永远是软约束 |
| **乙 细粒度工具**（改一镜一个工具） | 「所有镜头加雨天」= 8 次调用 = **8 张确认卡 = 8 次撤销** | 工具面膨胀；批量体验灾难 |
| **丙 一个工具 + 作用域选择器**（推荐） | 一次调用改多镜 = **一张卡 = 一次撤销**；结构上改不到没点名的字段 | 新增一个工具面：契约 + 执行器 + 审批投影三处要维护 |

**推荐丙。** 理由是粒度必须对齐**审批与撤销的粒度**，而不是数据模型的粒度——
`residentToolProjectionForCall` 是一次调用一张卡，这是既有事实，不是我的偏好。
丙同时把「别乱改」从提示词软约束变成 schema 硬约束：**没在 patch 里点名的字段，它改不到。**

## 4. 做什么

新增 **一个**工具 `nomi_storyboard_edit`（`sideEffect: proposal`、`risk: project_write`、
`availability.phases: ["storyboard", "creation"]`），下挂三个 **按用户意图命名**的 operation：

| operation | 覆盖 | 形状 |
|---|---|---|
| `patch_shots` | A + B | `{ select: 镜头选择器, patch: 只含点名字段 }` |
| `restructure_shots` | C | `{ insert / remove / duplicate / reorder }` |
| `bind_anchor` | D | `{ anchorId 或新建锚, shotIndexes }` |

- **镜头选择器**是一等公民（不是「循环调 N 次单镜」）：支持 `all` / 显式序号集 / 按状态
  （未生成、失败）/ 按锚引用。跨镜批量因此是一次调用。
- **底层直接复用 `storyboardPlanEdits.ts` 已有的纯函数**（`updateShotAt` / `insertShotAt` /
  `duplicateShotAt` / `removeShotAt` / `addAnchor` / `updateAnchor` …）——不重写一套编辑语义（P1）。
- 执行器挂在渲染层既有分派处（`applyCanvasToolCall.ts` 同构），不新开一条落地路径。
- 审批投影补一个分支：卡上说清「改哪几镜、改了哪几个字段」，不是笼统「修改了分镜」。

## 5. 不动项 / 回滚 / 验收门

**不动**：`propose_storyboard_plan`（首次拆镜仍走它，它解决的是「从无到有」，与逐项修改是两件事）；
画布/时间轴/导出；`AssetReference` 内核；生成与花费闸。

**回滚**：新工具是纯增量——从 manifest 摘掉即回到现状，无数据迁移。

**验收门**：
1. 五门全绿；
2. **A–D 四类各挑一条真实说法，在真机上让 Agent 真的做到**（R16 真实任务，不是 fixture）；
3. 「所有镜头加雨天」必须是**一次调用、一张确认卡、一次 Cmd+Z 全撤**——这条是丙方案存在的理由，
   做不到就等于退化成乙；
4. 结构硬约束的红灯探针：构造一个只点名 `durationSec` 的 patch，断言其余字段逐字不变。

## 6. 待拍板

- 丙方案是否成立（对比表见 §3）；
- `patch_shots` 的选择器要不要支持「按状态」（未生成/失败）——它让「把没跑的都改了」成为可能，
  但也让工具需要读生成状态，多一层耦合。
