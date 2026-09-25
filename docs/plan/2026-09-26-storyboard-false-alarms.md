# 分镜两处误报：执行计划检查失败 · 开了首帧的图生视频镜判「缺参考」

> 状态：🚧 实施完，待合入（v0.22.1）· 分支 `claude/storyboard-false-alarms`（从 origin/main 切出）
> 根因合同：[`docs/fixes/2026-09-26-storyboard-resolve-vendor-rejected.root-cause.json`](../fixes/2026-09-26-storyboard-resolve-vendor-rejected.root-cause.json)、
> [`docs/fixes/2026-09-26-storyboard-planned-first-frame-slot.root-cause.json`](../fixes/2026-09-26-storyboard-planned-first-frame-slot.root-cause.json)；
> 症状簇结构评审：[`docs/audit/2026-09-26-storyboard-false-alarms-structure-review.md`](../audit/2026-09-26-storyboard-false-alarms-structure-review.md)。
> 这是纯 bug 修复（根因明确、不改产品行为的意图），按 P5 不走 grill 轮；本文只写范围、不动项、回滚与验收门，满足 R4/R5②。

## 用户看到的

- 给分镜视频镜选了带供应商的模型（如 APIMart Seedance 2.0）→ 表格上方「执行计划检查失败，稍后再试」；超过模型上限的镜头没有行内警示，点生成也不拦。
- 开了首帧的图生视频镜（APIMart Seedance 2.0「图生视频」只有一个 image_ref 槽）→ 画面格「缺参考图参考」、参考列红格、批量「生成剩余」灰掉；生成完那一格照样红。
- 两者都在 v0.22.0 里（origin/main 上用真机走查复现：`tests/ux/storyboard-first-frame-false-alarms.walk.mjs` 在旧构建上红在第一步，截图见 PR）。

## 范围

1. resolve 输入 schema 收 `modelVendor`；schema 与 `PlanShotInput` 双向逐键守卫（编译期）；删 seam 里的未校验强转。
2. 计划首帧记在生成时真正填的那一格：问已有 owner `referenceSlots.assignEdgeToSlot`（新导出 `firstFrameEdgeSlot`），`missingRequiredSlotsOf` 成唯一判据。
3. 参考列红格只读 `exec.missingSlots`（锚行用同一个 owner、无额外来源）；计划首帧画进那一格。
4. 回归：真实投影 × 真实主进程核心、全视频档案类级对账、行渲染、批量分桶；真机走查 zh/en（loopback 零额度）。
5. 顺带：`tests/ux/_encryptFixtureKey.cjs` 在 Windows 上没把 safeStorage 密钥落盘（走查跑不起来的直接原因）。

## 不动项

- 时长闸遇错放行（`strategyGate.resolveGeneratableGate` 的 fail-open）——是有意设计，本次去掉的是那个永久报错的来源；要不要对 `generation_input_invalid` 改成拦截，留给协调会话定。
- 分镜行按方案字段解析模式、行状态按画布节点覆盖解析模式的双口径；开了首帧时锚边连在首帧图上、image_ref 锚记账仍按视频算——两处都记进合同 `residual_risks`，本次不改。
- 画布「镜头表」节点（`ShotTableGrid`）的参考胶囊：它不画红态，不产生误报。

## 先查别人

- 依赖里已有：zod 3.25.76 `node_modules/zod/v3/types.d.ts:537`（`strict(message?)` → `ZodObject<T, "strict">`）；官方文档 <https://v3.zod.dev/?id=strict>（2026-09-26 经 Context7 `/websites/v3_zod_dev` 取回）：`.strict()` 遇未知键抛 ZodError，默认 strip 则静默丢——所以「类型有、schema 没有」在 strict 下是整份拒收，在 strip 下是静默丢键，两种都得靠编译期对账挡住。
- 依赖里已有：<https://v3.zod.dev/?id=type-inference>（`z.infer<typeof schema>`）——单一字段表的标准做法；resolve 的类型住在纯引擎层（`electron/shared/videoCapabilities/planResolver.ts:32`），不宜反过来依赖契约层，所以选「两份 + 双向逐键守卫」。
- 仓库里已有：`electron/shared/storyboard/storyboardPlanSchema.ts:109`（#832 给 `storyboardPlanSchema` 加的 `MissingSchemaKeys` 逐键守卫）——同一种手法，本次照搬到 resolve schema。
- 仓库里已有：`src/workbench/generationCanvas/runner/referenceSlots.ts:47`（`assignEdgeToSlot`：首帧边 → 首帧槽，没有就 image_ref[0]）与 `src/workbench/generationCanvas/runner/generationReferenceResolver.ts:188`（首帧边同时进 `firstFrameUrl` 与 `referenceImages`）——「首帧落哪个槽」画布侧早有 owner，分镜侧不该再写一份。

**结论：用已有。** schema 守卫照搬仓库已有写法；槽位判据复用画布 owner，并用类级测试拿真实发送路径对账全部视频档案。

## 回滚

修复提交彼此独立，可单独 revert：回滚 resolve 那笔 = 误报与「时长闸遇错放行」一起回来；回滚首帧那笔 = 红格与批量跳过回来。两者都不改已提交的生成请求、不动持久化数据。走查与夹具修复可单独保留。

## 验收门

- 旧代码红、新代码绿：`strategyGate.mainResolve.test.ts`（3/3）、`shotRowModel.plannedFirstFrame.test.ts`（16 个模式）、`shotReferenceSlots.test.ts`、`storyboardExec.test.ts`、`StoryboardShotRow.plannedFirstFrame.test.ts`。
- 变异验红：从 schema 删 `modelVendor` / 多加一个键 → `tsc -p electron/tsconfig.json` TS2344。
- 真机走查 zh/en 通过；旧构建上同一条走查红（「执行计划检查失败」+ 两行红格 + 批量灰）。
- contracts 门岗（root-cause-contracts / door-map / symptom-cluster / i18n / boundaries / filesize / test-types / walkthroughs / test-waits / lint 棘轮）与 typecheck 全绿。
