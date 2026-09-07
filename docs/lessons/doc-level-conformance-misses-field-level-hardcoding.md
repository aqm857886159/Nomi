# 文档级对照拦不住代码级硬写：字段裁决要机器化、要框架无关

> 📎 教训 · 首次记录 2026-09-07 · 状态：✅ 已固化（由 `check:framework-surface` 接管）
> **触发场景**：刚交了一份框架调研 / 四列表 / 参考实现逐层对照，准备说「这个框架接好了」；或者要引入、升级任何框架 SDK 的新一层。

**结论**：框架研究的交付物必须下沉到**字段**这一级，而且必须机器化。文档级的对照（四列表按能力走、逐层对照按层走）最小单位都是「一块能力」，**它们结构性地看不见一个被硬写的字段**。接框架的第三份必交物是 `framework-surface` 逐字段裁决，门岗 `pnpm run check:framework-surface`。

**为什么会踩**：

2026-09-07 早上刚交了 pi 的参考实现逐层对照（`docs/research/2026-09-07-pi-reference-implementation-conformance.md`），九层四列都填满了、`没想到` 清零。同一天用户随口问了一句「工具的执行模式是怎么定的」，才发现：

- `electron/agentLane/laneTools.mts:175` 给**所有** lane 工具硬写 `executionMode: 'sequential'`；
- 而 pi 的 `AgentHarnessTool.executionMode` 是**逐工具可选**的（`node_modules/@earendil-works/pi-agent-core/dist/types.d.ts:351-359`，omit 时才落到全局默认）；
- 更刺眼的是：隔 5 行的 `replay` 已经改成从 `effects.mutates` 派生了（`laneTools.mts:180`）。**做对的和做错的写在相邻两行**。

两份文档级交付物一个字都没拦住，因为它们的粒度不对：「工具」这一层，我们**确实**接了 pi 的工具协议——层是对的，字段是错的。而没有任何机器判据在看字段。

同族的第二条是门岗自己扫出来的：`<ReactFlow>` 没设 `minZoom`/`maxZoom`，而 `GenerationCanvasReactFlow.tsx:353` 手写 `Math.min(3, Math.max(0.2, …))` 钳缩放。结果是**按钮缩放能到 0.2、滚轮缩放只到 0.5**——同一条上下限两个值（R14.1），本地手感上几乎察觉不到。

**怎么用**：

- 接任何框架 / SDK / 运行时，或用它一个此前没用过的层：除四列表、逐层对照外，**必须在 `docs/engineering/framework-boundaries.json` 的 `surface` 一格登记要对照的类型**，并对抽出来的每个字段下一条裁决（`derived` / `constant` / `unused` / `upstream-default` / `debt`）。没有这张表 → `check:framework-surface` 直接红。
- **别把门岗写成绑某个框架的。** 2026-09-07 用户原话：「我希望这个事要成为通用的流程和规则，我们之后可能不是 pi，那之后是其他怎么办？」判据与抽取器里不许出现任何一个框架的符号，要对照谁全部来自登记表。首批两条登记（pi + `@xyflow/react`）就是这条约束的验证。
- **字段清单必须机器抽，不许人列。** 人列的清单只包含已知的东西，而这道门要抓的正是「上游加了一格我们没看见」。抽取走 TypeScript 编译器 API 读 `.d.ts`（`Omit` / 交叉类型 / 基接口继承都要解开——`AgentHarnessTool` 是 `Omit<AgentTool<…>, "execute"> & {…}`，正则抓 `interface` 会漏掉一大半，而**漏掉的字段在门岗里长得和「这个字段不存在」一模一样**）。
- **裁不出来就登记 `debt` 带 `due` + `owner`**，别静默留白，也别为了让它绿而编一句领域理由——`constant` 的理由命中「更简单 / 当时就这么写 / 风格」这类偏好套话会直接红（R29：偏好不是理由）。

**出处**：PR「新增 check:framework-surface 门岗」（分支 `chore/check-framework-surface-20260907`）；规则详解见 [`../engineering-rules.md`](../engineering-rules.md) R29「第三份必交物」；起因 `electron/agentLane/laneTools.mts:175`；被拦住的另两条见该 PR 正文的「没想到」清单。
