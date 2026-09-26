# 分镜两处误报的结构评审（症状簇触发，2026-09-26）

> 状态：已完成（2026-09-26）· 触发：`check:symptom-cluster` 在两份新合同加入后报了三个模块——
> `electron/capabilityCore`（2026-09-20 到 09-26，24 份根因合同）、`electron/shared`（同窗口 20 份）与 `src/workbench`（同窗口数十份）。
> 对应合同：`docs/fixes/2026-09-26-storyboard-resolve-vendor-rejected.root-cause.json`、`docs/fixes/2026-09-26-storyboard-planned-first-frame-slot.root-cause.json`。
> R21 的要求：同一层 7 天里第三份合同出现后，先回答「这一层的结构有没有问题」，再继续修。

## 两个缺陷是同一个形状

| 缺陷 | 同一件事的两份写法 | 谁跟谁不一致 |
|---|---|---|
| 「执行计划检查失败」（每个记了供应商的视频镜） | resolve 输入的字段表：引擎类型 `PlanShotInput`（渲染层投影、GUI 请求类型都按它写）与主进程 `generationResolveInputSchema`（`.strict()`） | #832 给类型加了 `modelVendor`，schema 没加 → 主进程整份拒收；渲染层测试用假 client，看不见 |
| 开了首帧的图生视频镜「缺参考图」、红格、进不了批量 | 「一条首帧边落哪个槽」：画布侧 `referenceSlots.assignEdgeToSlot`（首帧槽，没有就 image_ref[0]）与分镜侧 `missingRequiredSlots` 自带的「只认 first_frame 槽」；再加参考列自己的「必填 + 没绑定 = 红」 | 分镜侧两份都比发送路径窄——生成时首帧照样发进 image_ref |

**结论：这一簇里本次碰到的是「一个事实、两份手写」**——跨 IPC 的一对手写字段表，和渲染层里对画布判据的一份重抄。
这与 `2026-09-25-task-list-projection-structure-review.md`（同一事实多出口投影）、`2026-09-24-v022-feedback-structure-review.md`
（入口统一之后没人回头扫还有谁在判）是同一族，不是新的结构问题。

## electron/shared 与 electron/capabilityCore

- `electron/shared/agentCapabilities/*` 里其余能力的 schema 都用 `z.infer` 反推类型（一份字段表）；resolve 是唯一一个类型住在引擎
  （`electron/shared/videoCapabilities/planResolver.ts`）、schema 住在契约层的例外，原因是引擎是纯函数层、不想依赖契约层。
  本次保留这个分层，在 schema owner 旁边加了**双向逐键守卫**（与 #832 给 `storyboardPlanSchema` 加的同一种），多一个键就是 `tsc` 红；
  并删掉 `electron/capabilityCore/mcpGenerationTools.ts` 里把 schema 结果 `as PlanShotInput[]` 的未校验强转——那一行正是让编译器看不见漂移的地方。
- **给这一层的判据**：跨进程的同一份载荷，要么只有一份字段表（`z.infer`），要么两份之间有会红的逐键守卫；只靠注释写「一一对应」不算。
- 是否需要先做结构改造：不需要。已知的两对（`storyboardPlanSchema`、`generationResolveInputSchema`）都已上守卫；其余 IPC 载荷没有逐个审，
  记在合同 `residual_risks`。

## src/workbench（分镜行与画布参考槽）

- 画布侧的判据本来就只有一个 owner（`referenceSlots.ts`：显示、容量、@ 引用都经它）。分镜行是在节点还没落画布时就要回答「这一格生成时会不会有东西」，
  于是自己写了一份更窄的规则。本次把它改成问同一个 owner（新导出的 `firstFrameEdgeSlot` 就是 `assignEdgeToSlot` 的首帧分支），
  并用一条类级测试把它和真实发送路径（`resolveGenerationReferences` + `buildArchetypeInputParams`）按全部视频档案逐模式对账。
- 参考列（`ShotReferenceZone`）原先自己判红；现在红格只读 `missingRequiredSlotsOf` 的结果（镜头行 = `exec.missingSlots`），
  与画面格「缺X参考」、批量排除是同一份。
- **给这一层的判据**：渲染层要回答「生成时会发生什么」，就去问生成路径的 owner，或者写一条拿真实生成路径对账的测试；不许凭记忆重写一份规则。
- 是否需要先做结构改造：不需要。顺带看到但本次不改的两处写进了合同 `residual_risks`：分镜行按方案字段解析模式、而行状态按画布节点覆盖解析模式
  （节点改过模型时两边可能不是同一个模式）；开了首帧时锚的参考边连在首帧图上，image_ref 的锚记账仍按连在视频上算（min=2 的多帧模式会少报缺）。

## 结论

- `electron/shared`、`electron/capabilityCore`：同一事实两份字段表，已用编译期守卫收口；可以继续。
- `src/workbench`：分镜侧对画布判据的重抄已删、改为问 owner，参考列不再自判；可以继续。
