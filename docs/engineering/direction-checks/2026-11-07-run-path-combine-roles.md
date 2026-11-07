# 方向检查：Run 路角色数组的线上角色词（协调代批 P1 例外）

日期：2026-11-07

## 命中了什么

提交「Run 路角色数组按槽声明翻线上角色词，角色表收进共享层」时，方向检查报了三处：

- 目录 `electron/shared/modelArchetypes/`：近 14 天已有 4 个 fix，这一刀算第 5 个。
- 目录 `src/workbench/generationCanvas/nodes/controls/`：近 14 天已有 6 个 fix，这一刀算第 7 个。
- 概念 `generation.reference-sent-in-use`（发给供应商的参考图只能是当前方式声明、界面在用的那些）：近 14 天已有 4 个 fix，这一刀算第 5 个。

## 命中的是目录 / 概念口径，不是文件本身

逐个查过 14 天的 fix 记录：

- `electron/shared/modelArchetypes/` 那 4 个 fix 改的是 `customCapabilityContract.ts`、`referenceKeys.ts`。本提交改的 `index.ts`（加导出）、`types.ts`（只改注释）在这 14 天里零 fix。
- `src/workbench/generationCanvas/nodes/controls/` 那 6 个 fix 改的是 `generationModePresentation.ts`、`referenceWrites.ts`、`parameterControlModel.ts`。本提交改的 `archetypeMeta.ts` 零 fix。
- 真正修复的两个文件：
  - `electron/capabilityCore/apimartGenerationProjection.ts`：14 天里 1 个 fix，这一刀是第 2 个，没到线；
  - `electron/shared/videoCapabilities/referenceChannels.ts`：零 fix。

## 改法是换 + 删

- **换**：Run 路（引擎 B；MCP stdio 与 ProductionRun 走它）原来把合同角色词（reference / character）直接当 image_with_roles 的线上 role 发。Wan 2.7 角色参考因此发出 `role: "reference"`，官方只收 `reference_image` / `first_frame`。现在改成按这一档模式的槽声明翻译，和画布路查同一张表。
- **删**：角色表（槽种 → 供应商角色词）原来只在渲染层 `archetypeMeta.ts` 有一份（`DEFAULT_ROLE_FOR_KIND`）。现在搬到 `electron/shared/videoCapabilities/referenceChannels.ts`，渲染层那份同一个提交删掉，不留两份。
- 类测试 `electron/parity/combineRolesParity.test.ts`：每个声明角色数组合并的 APIMart 内置模式，画布路与 Run 路发出的角色数组逐项相同。新接的模型自动进来。

## 两处新增，为什么不算特例

1. `combineSlotsInto.kinds`：通用可选字段，不是按供应商开的特例。声明了它，就只把这几种槽并进角色数组，其余槽留在自己的扁平键上。Wan 2.7 角色参考用它把参考视频留在 `video_urls`：官方 image_with_roles 的 role 没有 reference_video，画布路从 2026-07-31 起一直把参考视频也并进了角色数组。这一条协调已经批过。
2. Run 路的拒发分支：这一档的合并里没有收这种参考的槽时，以前带着合同角色词照发，现在明着拒。
   - 这在已批方向「没证据就可见拒绝」之内，不算特例（先例：10-31 中转协议线按同一口径代批）。
   - 拒发带机器码 `reference-not-in-use`，和主进程发送前的参考守（`electron/tasks/referenceResidueGuard.ts`）同一个码，错误卡认码，给「没发出去、服务商没被请求到」的人话，不会落进「未知错误 + 重试」。
   - `combineRolesParity.test.ts` 钉了一条：Wan 2.7 角色参考收到首帧 → 拒发、一条请求都没发，`classifyGenerationError` 判为 `reference-not-in-use`。

## 不在这一刀

Run 路的图片张数上限按模型取、不按模式，Seedance 2.5 / Wan 3.0 首尾帧放两张图会被拒。这件事记为计划 A4h，另派线修。类测试把这几格钉成「现在被拒」。

## 批准

协调 2026-11-07 依 P1 例外代批，事后报用户。理由：
- 要改的文件本身都没到线，命中的只是目录 / 概念口径，主体是换 + 删；
- ① `combineSlotsInto.kinds` 是通用可选字段，不是按供应商的特例，已批过；
- ② 拒发分支是把「带着合同角色词错发」改成「明着拒」，在已批方向「没证据就可见拒绝」之内，不算特例。拒发文案带 `reference-not-in-use` 码，错误卡认得出，测试里钉了一条。

设计卡：`docs/plan/2026-11-07-catalog-media-rest.md`「按官方文档对齐（2026-11-07 第二轮）」。
