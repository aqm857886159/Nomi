# PR #454 分镜表 / 右侧 Agent 审计

> 审计日期：2026-09-04
> PR：[#454](https://github.com/aqm857886159/Nomi/pull/454)
> head：`feb392525b8bbd75205890e8099ba1aff72cbba7`
> base：`main`
> 当前结论：**部分完成；不能按整体合入；设计必须重做；右侧 Agent 真实闭环未证实**

## 结论先行

PR #454 不是“什么都没做”，它完成了一个有价值的分镜表功能切片：分镜页三栏骨架、分镜行的引用/选择解耦、`patch_shots` 语义操作的契约和执行方向、确认卡文案、模型身份 vendor 修复，以及一批真实分镜表走查。

但它也不是“分镜表 + Agent 已经完成”。其中的锚行/参数条样章已经在交接文档中记录为用户明确否定，不能作为最终设计直接实现；而右侧 Agent 是否真的能沿生产模型目录调用 `nomi_canvas_plan`，再以 `operation: patch_shots` 修改分镜、显示行内预览、确认、落盘并重启恢复，当前没有真实闭环证据。现有实现按 `toolName === patch_shots` 做关键判断，但生产模型目录的 canonical tool name 是 `nomi_canvas_plan`，因此必须先建立红测确认并修正/证明这条别名边界。

## 已完成或基本完成的部分

| 能力 | 证据 | 当前判断 |
|---|---|---|
| 分镜页三栏工作区 | `src/workbench/creation/storyboard/StoryboardWorkspace.tsx`；目录｜分镜表｜Agent dock；`StoryboardWorkspace` 专属 Agent 挂点 | 代码已完成；仍需在真实 Electron 做视觉和折叠/窄屏走查 |
| Agent 挂到分镜页右侧 | `src/workbench/WorkbenchShell.tsx` 将 `ProjectAgentResidentShell` portal 到 storyboard dock；storyboard 模式注入 `toolProfile: storyboard` | **视觉挂点已做**；不等于工具执行闭环已做 |
| 分镜行点击与批量勾选解耦 | PR commit `ee99ee7c`；`tests/ux/storyboard-table-exec.walk.mjs` 覆盖点击引用、checkbox 选择、全选/清空 | 已有较强真实走查证据 |
| `patch_shots` 结构化编辑 | `electron/shared/agentCapabilities/canvasWrite.ts` 的 discriminated union；`canvasWriteTarget.ts` 的 `operation === patch_shots` 分支；输出含 changed indexes/fields | **执行内核基本存在**；仍需 canonical model path 验证 |
| 确认卡/工具投影文案 | `residentToolDisplay.ts`、PR commit `24fa5b42` 等；说明作用镜头和改动字段 | 直接调用名为 `patch_shots` 的投影已覆盖；canonical alias 未覆盖证明 |
| 选中分镜作为 Agent 参考 | `residentReferences.ts` 的 storyboard selector；`ProjectAgentResidentShell.tsx` 在 tool call 前注入选择 | 逻辑存在；判断条件疑似只识别旧工具名，需真实路径红测 |
| 模型身份含 vendor | PR body、`check:model-identity` 相关变更 | 作为独立功能可纳入重基线；需在合并前按当前 main 重跑 |
| 分镜表主流程 | `tests/ux/storyboard-table-exec.walk.mjs` 覆盖状态、锚点、单镜/批量生成、重跑、过滤、结果接收、首帧、插镜、键盘和选择工具栏 | 主流程证据较充分，但不覆盖 Agent canonical patch 闭环 |

## 明确未完成或不能认定完成的部分

### 1. 锚行/参数条视觉方案必须推翻重做

`docs/plan/2026-09-03-storyboard-anchor-mockup-handoff.md` 明确记录了样张经过 7 轮返工后被用户否定，且说明样张没有进入真实组件。`docs/design/mockups/2026-09-03-storyboard-anchor-row-and-param-rail.html` 及其契约只能保留为失败证据，不能作为新实现的设计真源。

下一次设计不能只修 CSS 或继续第 8 轮静态 HTML。需要先重新确定锚与镜头的空间组织、信息层级和“什么叫可用”，然后在真实 Electron 的隔离原型/真实组件中走查。`anchor.description`、参考槽、模型/模式/参数、生成入口、错误和空状态必须作为真实字段清单，不得在样张中遗漏。

**状态：等待新设计方向；不是功能完成；不得以静态样张测试全绿升级为视觉通过。**

### 2. 右侧 Agent 的生产闭环没有被证明

当前生产目录链是：

```text
modelToolSurfaceManifest.canvas
  -> nomi_canvas_plan
  -> canvasWriteSemanticInputSchema
  -> operation: patch_shots
```

但 #454 中的关键 UI 判断是：

```text
isStoryboardPatchTool(toolName)
  -> toolName.toLowerCase() === 'patch_shots'
```

相同的旧名判断还出现在 storyboard selection 注入和工具投影路径。现有 `tests/ux/patchshots-card.walk.mjs` 直接喂 `patch_shots`，`patchshots-width-check.walk.mjs` 通过 `window.__nomiStoryboardPatchPreview` 测试探针发布预览；它们不能证明模型真实发出 `nomi_canvas_plan` 时仍然会触发这些行为。

因此要新增一条生产形状的测试，不能只把测试输入继续写成 `patch_shots`：

1. 分镜页右侧 Agent 的工具目录确实包含 `nomi_canvas_plan`，并且 storyboard profile 可用 `patch_shots` operation。
2. 传入真实模型调用形状：`toolName: nomi_canvas_plan`、`args.operation: patch_shots`、当前项目/session/revision 和选中行引用。
3. 选中行被注入 selector；未点名的字段保持逐字不变。
4. 右侧 Agent 出现可读的确认卡和分镜行内 diff 预览；预览说明镜头范围和字段变化，而不是只显示“查看细节”。
5. 用户批准走既有 proposal/receipt/approval 管线，拒绝不落盘；批准后表格、画布投影和 Agent 状态一致。
6. 重启后修改仍存在；过期 revision、非法 model/vendor、重复确认和取消都能被阻断或幂等处理。

**状态：部分实现；真实 canonical path 未证明，可能存在别名漏接。**

### 3. `patch_shots` 预览字段覆盖不完整

`storyboardPatchPreview.ts` 当前只从 patch 中派生 `prompt` / `promptAppend` 的行内文本预览。PR 声称支持镜头类型、时长、画幅、模型等字段，但这些字段是否在预览中清楚呈现、是否只改用户点名字段，仍需功能和视觉走查。确认卡可以描述字段，不代表分镜表内的 diff 已经覆盖字段。

**状态：部分完成；需要字段级红绿断言。**

### 4. 不能把 #454 当作整个 Agent epic 的完成

`docs/plan/2026-09-03-agent-interaction-epic.md` 仍将完整 Agent 交互 epic 记为计划：断言器 app 模式、21 种状态、17 个 P0 异常态、R16 真实创作闭环和最终开闸仍需独立验收。#454 只覆盖 storyboard 入口和一个工具切片，不能替代 Agent 全量状态、MCP、恢复、打包和真实创作验收。

**状态：独立于 #454，仍按总方案 S4/S5/S6 重基线。**

## Merge / rebaseline 决策

当前只看到 PR #454 的 `Workers Builds: nomi` 为 SUCCESS；这不足以证明全量合同、单元、系统、真实 Electron 和视觉门。加上样章明确被否定、Agent canonical path 未证实，**不把 #454 作为一个整体直接合入 main**。

处理顺序：

1. 将 #454 登记为 `部分完成 / needs-design-decision / agent-path-unproven`。
2. 对当前 main 建立 canonical `nomi_canvas_plan + operation=patch_shots` 红测；若当前 main 已经通过，则把该项归为已吸收/重复，不制造假缺口。
3. 将功能代码、模型身份修复、测试、被否定样张和设计交接拆成可审计的最小集合；不把失败样张当作视觉实现一起合入。
4. 新设计先出方向和真实组件原型，等待用户视觉确认；确认后再走“红 → 实现 → 绿 → Electron 截图走查”。
5. 功能绿门必须同时覆盖 Agent、MCP canonical tool path、Storyboard Table、receipt/persistence/restart；任一缺失都只能写“部分完成”。

## 本审计收据

```text
base: main
head: feb392525b8bbd75205890e8099ba1aff72cbba7
pr: https://github.com/aqm857886159/Nomi/pull/454
observed-pr-scope: 50 commits / 91 files / 4783 additions / 310 deletions
observed-check: Workers Builds: nomi = SUCCESS
visual-evidence: storyboard-anchor-mockup-handoff records explicit user rejection; no approved replacement yet
red-proof-needed: canonical nomi_canvas_plan(operation=patch_shots) through real resident Agent path
green-proof-needed: preview + approval/deny + receipt + persistence/restart + positive control
```
