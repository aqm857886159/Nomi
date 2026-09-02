# click-select（S6①）返工要点 — 编排者亲核 diff 后的拒收理由

> 分支 `perf/canvas-click-select-20260903` @ 9d36eb23（已 push，工作未丢）。**暂停，不开 PR**，等低负载窗口 + 额度池恢复后按本文件返工。
> 拒收人：编排会话（2026-09-03）。依据：亲读 diff，非报告转述。

## 一句话
这版**没达成设计目标**（选中态仍然写业务 store），并额外引入了四路 OR 兜底与双写路径，且与 S4 的投影同步机制存在覆盖冲突——很可能就是那条「连线源端后段几何断言失败」的成因。性能收益从未测出（机器 load 20–108，基准never跑成）。

## 逐条问题

### P1 违反 · 双写路径（阻断级）
`GenerationCanvasReactFlowNodes.tsx` 的 `handleNodeClick` 里：
```
selectNodes(nextSelection)              // ← 仍然写业务 Zustand store
syncCanvasNodeSelection(flowStore, ...)  // ← 又写一次 RF 内部 store
```
原方案要求「选中态若只用于渲染表现，就别进业务 store」。现在是**两边都写**，等于在旧路径之上叠了新路径 = 并行版。旧路径没删，收益自然也没兑现。

### 真相源不清 · 四路 OR 兜底（阻断级）
```
const isSelected =
  useStore((s) => Boolean(s.nodeLookup.get(node.id)?.selected))   // RF 内部
  || selected                                                     // RF 传入 prop
  || data.primarySelection                                        // 投影字段
  || selectedInBusiness                                           // 业务 store
```
四个来源 OR 在一起 = 「不确定谁是真相源就全都兜上」。而且 `selectedInBusiness` 让**每个节点组件都订阅业务选中集**——正是本项要消除的那类订阅。必须选定唯一真相源（RF 交互态），其余删掉。

### 与 S4 投影同步的覆盖冲突（疑似真回归成因）
- adapter 里 `selected`/`primarySelection` 被**硬编码为 `false`**（字段留着但恒假 = 死字段，误导后人；要么彻底移出投影类型，要么由真相源 derive）。
- 投影 memo 已移除 `selectedSet` 依赖，但 `nodes` 一变就整份重建（selected=false / primarySelection=false）→ S4 的 `CanvasNodeProjectionSync` 把投影推进 RF store → **把 `syncCanvasNodeSelection` 刚写进去的 selected/primarySelection 覆盖回 false**。
- 连线过程中节点数据会变（pendingConnection / handle 状态），恰好触发上述覆盖 ⇒ 与走查里「点选/框选/29px 把手通过、**连线源端后段几何断言失败**」的现象吻合。返工时**先复现并证伪/证实这条链**，别绕开它。

### 自建 onClick 选择逻辑与 RF 原生选择并存
新加的 `onClick`（含 shift 加选分支）与 React Flow 自身的选择机制同时在跑，属于第二套交互路径。要么完全接管（并关掉 RF 的），要么完全交给 RF（用 `onSelectionChange` 读结果），不要并存。

## 返工的设计约束（下一班照这个做）
1. **唯一真相源 = React Flow 交互态**。业务侧只保留一个从 RF 派生的 `selectedIds` 只读投影，供工具条/批量操作/Agent 作用域消费；域投影（`toGenerationFlowNodes`）**不再携带** selected/primarySelection 字段（从类型里删干净，不留恒 false 的死字段）。
2. **不新增点击处理器**：选择走 RF 原生（`onSelectionChange` / `onNodesChange` 的 select 变更），我们只在其回调里更新那份派生投影。
3. **先处理与 S4 投影同步的交互**：明确「投影同步不得回写选中相关字段」（既然字段已从投影删除，这条自然成立——这正是删字段而非置 false 的原因）。
4. **验证顺序**（缺一不可，且必须在 `pgrep -f canvas-performance-benchmark` 空 且 load1<8 的窗口做）：
   - 结构测试红→绿（点选期间业务 store 写入次数 / 投影重建次数的不变量）
   - `click-select` 锚：32.8ms → ≤25ms（打不到如实报差距，**禁移靶**）
   - 拖动守卫：node-drag-image 不比 10.3ms 恶化 >15%
   - 完整走查绿，**特别是连线源端后段几何那条**
   - canvas 域 vitest + gates 全绿
5. 交互等价逐条自证：选中高亮 / 29px 磁吸把手 / 框选 / Shift 加选 / 点空白取消 / 工具条位置 / NodeResizer 显隐 / lightweight LOD 的 selected 判定。

## 为什么暂停而不是立刻返工
- 机器 load 108（另一会话 45 个重进程在跑测试），**基准与走查此刻跑出来的数字都是垃圾**，改完也验不了，容易连着盲改两轮。
- 该项收益是 32.8ms → ≤25ms（预算 33ms），属锦上添花，非救火；卫生批（PR #393）价值更实，先合它。
- 额度池：fable 已耗尽（9/7 重置）、opus 侧子 agent 起不来，仅 sonnet 可用——不适合做这种需要精细判断的返工。
