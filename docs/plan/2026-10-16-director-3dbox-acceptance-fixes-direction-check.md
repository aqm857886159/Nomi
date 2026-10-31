# 方向检查：V-3dbox 有条件通过的三项（2026-10-16 第五轮）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 触发：`fix-churn` 命中 `electron/capabilityCore/dispatcher.ts`（14 天第 8 个）、`model/directorPreviewState.ts`（第 7 个）。
> 来源：独立验收 V-3dbox 报告（协调目录）第 1、3 节：对外 MCP 两个操作实调不通；超过 10 秒不置灰；「出成片碰不到花钱入口」的结构测试漏掉真实回调。
> 协调 10-16：三项都修，验收线只复验这三项；「改设计不能丢功能」，删旧导演台不能让外部 Agent 少两个能力。

### 0. 一句话根因（三项同一类）

**判据或守卫挂在「替身」上，而不是用户 / 外部 Agent 真走的那一层。** MCP 只比工具面快照、单测直调渲染端执行体，真传输没人走；超长只在 Agent 写计划那一刻判一次、记在预演上，手改从来没人再问；花钱守卫只扫两个文件的关键字，真回调在第三个文件里。

### 1. 归类表

| 项 | 直接原因 | 类 | 修法 |
|---|---|---|---|
| 对外 MCP 摆位 / 运镜 | 主进程 `rpcServer.ts` 只把 `patch_shots` 一个操作送渲染端；其余渲染端拥有的操作落进无头 `dispatcher.ts`，回 `capability_unsupported`。main 上同样（本 PR 没改这两个文件；官方 SDK 测试在合入最新 main 之后的分支上先红） | 路由规则写死成特例；「上了对外面」和「接上传输」是两件没人对账的事 | 名单收成一份 `CANVAS_WRITE_LIVE_RENDERER_OPERATIONS` / `CANVAS_WRITE_HEADLESS_OPERATIONS`（`canvasWrite.ts`），路由、渲染端执行口、无头提示都读它；官方 SDK（Streamable HTTP）实调测试；门岗：对外面写着的操作必须有路由 |
| 超过 10 秒 | 「超长」只在 `applyDirectorWrite` 写计划时判、记成 `failed/too_long`；按钮 / 出成片 / 重渲只认记下的结论 | 判据不按当前工程算 | `directorProjectTooLong`（当前场景内容末尾）一处判，出成片、按钮、重渲写口、花钱闸都问它；写计划那一处改用同一条 `exceedsDirectorPreviewSeconds` |
| 花钱守卫漏回调 | 只扫 `directorProduce.ts` / `ProduceButton.tsx` 的关键字 | 守卫不盖真入口 | 从 `DirectorEditor.tsx` 交给按钮的 `produce` 回调出发做函数级静态可达（跟本文件顶层声明、相对导入的具名声明、`import * as` / 动态 import 里被取用的成员）；V-3dbox 两处变异都红 |

### 2. 为什么会一直出现

验收线是第一个走真传输、真拖时间轴、真改回调的人。实现线的测试都在「替身边界」上：快照、直调、两个文件。每加一个新能力（新 MCP 操作、新入口），同样的缝就再开一次。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 对外面上还挂着 4 个送不到的操作（`tidy_canvas`、`propose_storyboard_plan`、`arrange_storyboard_to_timeline`、`set_node_text`），外部 Agent 调了一样回 `capability_unsupported` | `electron/capabilityCore/mcpCanvasWriteRoutes.test.ts`：清单冻结、只许减；新操作上面没接路当场红 |
| 精修里拉长到 10 秒以上，出片照常、预演被压进 10 秒，按 ↑ 花钱用的是走样的参考 | `agent/directorPreviewTooLong.test.ts` |
| 有人在出片回调或它调用的函数里接上生成 | `agent/directorProduce.test.ts`「produce never reaches」，含守卫自检 |

### 4. 靶子独立性检查

不涉及评测分数。MCP 测试走官方 SDK 客户端、真 HTTP 端点、真协议层、真 RPC 与真租约校验，只替身项目会话权威与渲染端那一跳；渲染端那一跳另由 `src/workbench/capability/mcpDirectorReferenceOps.test.ts` 走真提议事务、真画布 store。

### 5. P0

花钱闸与导演节点是领域；MCP 传输用的是官方 SDK，没自写协议。静态可达用 TypeScript 自带的语法树（`typescript`），不另引库。

### 6. 补 / 换 / 删

| 选项 | 推荐 |
|---|---|
| 补（rpcServer 再加两个特例） | 否：第三、四个特例照样漏 |
| **换（名单收口 + 门岗）** | **是** |

### 7. 要协调拍板的（不在本刀做）

对外面上那 4 个送不到的操作，二选一：

| 选项 | 做什么 | 代价 |
|---|---|---|
| A 接上（推荐） | 加进 `CANVAS_WRITE_LIVE_RENDERER_OPERATIONS`（渲染端执行体 `executeCanvasWriteTarget` 四个都已支持），各补一条官方 SDK 实调 | 要逐个定是否先在客户端问人（`arrange_storyboard_to_timeline` 会改时间轴、`propose_storyboard_plan` 走方案审阅） |
| B 拿掉 | 从 `nomi_canvas_edit` 的对外面删掉这 4 个 | 外部 Agent 少 4 个能力；工具面基线要改 |

推荐 A：用户 10-16「改设计不能丢功能」，外部 Agent 已经能在说明书里看到它们。本刀不做，交协调定。
