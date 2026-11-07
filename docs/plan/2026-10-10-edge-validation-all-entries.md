# 所有建边入口统一走同一道校验（I-edgecheck）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 来源：Codex 对 #1137 的复审 2（`R-review-1137-re.md` 末尾「复审 2」）：MCP / headless 写画布能写出 视频 / 声音 → 文本；粘贴、拖动复制原样搬运非法边。main 上的老问题（以前 图片 → 文本 也一样）。
> 方向检查：`docs/engineering/direction-checks/2026-10-10-edge-validation-all-entries.md`。

## 设计卡（★5 格）

```
改动名：所有建边入口统一过连线总闸        线/负责人：I-edgecheck        类别：[其他]（碰画布整写，不花钱、不长跑）
```

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我（或我的 Agent / 外部 MCP 客户端）往画布里加连线，我想要「目标这一类卡不收的输入，哪条路都连不上，并且被告知为什么」，以便画面上的线都是真起作用的线。步骤：手动拖线 / 拉环建节点 / Agent 工具 / MCP 连边 / 粘贴 / Cmd+D / 拖动复制 / 复制为变体 / 模板落画布，各试一条 视频→文本。不做：旧项目里已有的非法边不删（加载保留）；不做界面提示（待拍板）。已知坑：出处边（派生输出：剪辑导出 / 事实表 / 全景截图）种类上过不了总闸，走 `addDerivedOutput` 的规则表，不在此列。真实任务：①MCP 连 video→text 被拒并带原因；②粘贴含旧非法边的两张卡，节点照常、少 1 条线并说一句。 | `src/workbench/generationCanvas/store/canvasEdgeAdmission.test.ts`、`electron/capabilityCore/canvasGraph.test.ts` |
| ★2 谁说了算 | 概念「连线总闸」→ 唯一 owner `electron/shared/canvas/edgeAdmission.ts`（规则 + `connects` 表；渲染层 `referenceEdgeCapability` 只 re-export）。整条边追加的唯一落点 `store/canvasEdgeWrite.ts appendAdmittedEdges`；单条连线 `writeCanvasEdge`；headless `canvasGraph.connectNodes`；外部整图写回 `mergeExternalCanvasWrite`（渲染层 store 与盘上写共用）。同一份事实存 1 份（`connects` 表原来散在注册表 17 处，现在一张表，注册表引用它）。没有靠状态猜意图。 | `node scripts/door-map.mjs validateReferenceEdge connectNodes`；`pnpm run check:canvas-edge-writers` |
| ★3 一致与复用 | 规则原来住渲染层（主进程 import 不了），主进程 headless 又没有，所以是「搬 + 引用」不是再写一份：`validateReferenceEdge` 及其依赖整体搬进 shared，渲染层 re-export。无第二份定义。判据读 `NODE_KIND_CONNECTS`。三方库：无（领域判据，P0 登记不适用）。 | `git grep validateReferenceEdge`；`check:self-written` |
| ★4 全状态 | 空 / 加载 / 成功：不变。部分成功：粘贴 / 复制 / 模板 / 外部写回有被拒的边 → 节点照常放下，一句话「节点已照常放下，有 N 条连线没带过来（目标节点不接收这种输入）」（zh/en，`generationCommon.canvas.edgesSkippedOnPaste`）。MCP / Agent：skipped 带原因码（`target_takes_no_input: video -> text`）。失败：撤销 / 重做 / 放回不过闸（恢复的是原来就有的边，有测试）。取消中 / 过期 / 能力不可用：不适用（纯同步写入）。 | 测试 + `check:i18n` |
| ★9 验收与回滚 | 验收：另一条线跑 `pnpm exec vitest run src/workbench/generationCanvas/store/canvasEdgeAdmission.test.ts electron/capabilityCore/canvasGraph.test.ts electron/shared/canvas`；门岗 `pnpm run check:canvas-edge-writers`。回滚：revert 本分支的合并提交（无数据迁移，无落盘格式变化）。 | 命令 |

## 入口清单（door-map 数出来的，过 / 不过 → 改后）

| 入口 | 文件 | 以前 | 现在 |
|---|---|---|---|
| 手动拖线 / 点选 / 拉环建节点连线 | `canvasGraphActions.connectToNode` / `quickActions/nodeInputActions` | 过 | 过（不变） |
| store.connectNodes（@、自动引用、导演台站位、深度图等调用方） | `canvasGraphActions.connectNodes` → `writeCanvasEdge` | 过 | 过（不变） |
| 组连线（成员物化 / 组输出） | `canvasConnectionMaterialization` → `resolveCanvasReferenceConnection` | 过 | 过（不变） |
| Agent 工具 connect_nodes | `agent/generationCanvasTools` | 过（预校验 + store 再校验） | 过（不变） |
| addDerivedOutput（出处边） | `canvasGraphActions` | 不过总闸（走派生规则表） | 不变：规则表按种类 + 产物类型放行，有测试 |
| MCP / headless 连边 | `electron/capabilityCore/canvasGraph.connectNodes` | **不过** | 过：skipped 带原因 |
| MCP / headless 整图写回（渲染层 applyExternalGraph / 盘上） | `shared/canvas/externalCanvasWrite` | **不过** | 过：外部新增边过闸，旧边不动 |
| 粘贴 / Cmd+D / 拖动复制 | `generationCanvasStore.pasteNodes` | **不过** | 过：`appendAdmittedEdges` |
| 组复制（拖动） | `canvasGroupMoveActions.duplicateGroupForDrag` | **不过** | 过 |
| 复制为变体 | `canvasNodeActions.duplicateNodeForRegeneration` | **不过** | 过 |
| 工作流模板落画布 | `canvasNodeActions.instantiateWorkflowTemplateSnapshot` | **不过** | 过 |
| MCP 删除后撤销（undo_canvas_delete） | 借道外部写回，恢复边被当新边过闸而丢失 | 明确的放回写：gateway.apply 带 restoredEdgeIds，磁盘与渲染层一致，旧非法边原样回来 |
| 撤销 / 重做 / 放回被删节点 | `canvasDocumentCommit` rewind / put-back | 不过 | 不过（有意）：恢复原来就有的边；测试钉住含旧非法边也原样回来 |
| 项目加载 / 迁移 | `canvasDocumentCommit` load、`projectV51ToV60Migration` | 不过 | 不过（有意）：旧边不删；执行侧忽略（见下） |
| 事件重放 | `canvasEventReducer` | 不过 | 不过（有意）：重放的是已记录的事实 |
| 制作流程落节点 | 经 applyCanvasToolCall / store.connectNodes / addDerivedOutput | 过 | 过（不变） |

## 旧非法边

加载保留；`resolveGenerationReferences` 执行时忽略（用 `validateEdgeKinds`，只看种类、不解析模型档案，便宜；出处边不在此列）。界面怎么提示：待协调拍板。
