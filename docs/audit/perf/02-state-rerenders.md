# Perf 审计 02 — 全局状态导致的重渲染风暴

> 范围：Zustand 两大 store（`workbenchStore` + `generationCanvasStore`）的订阅模式与高频写入路径。
> 只读审计，未改源码。量化数字由 grep 统计，机制由读源码确认。审计日 2026-06-22。

---

## 顶部结论

**好消息：这个 codebase 没有「裸订阅整个 store」的头号反模式。** 量化：

| 指标 | 数字 |
|---|---|
| `useWorkbenchStore` 调用点 | 293 |
| `useGenerationCanvasStore` 调用点 | 453 |
| **裸订阅 `useStore()`（无 selector）** | **0** ✅ |
| **内联对象 selector `s => ({a,b})`** | **0** ✅ |
| `useShallow` / `shallow` 使用 | **0** |

主流写法是**原子字段 selector**（`(s) => s.field`，一字段一行 hook）——这是 Zustand 的**正确**惯用法：每个 selector 返回原始值或稳定的 action 引用，`Object.is` 比对天然不变，不会假重渲染。所以 `useShallow=0` 在这里**不是缺陷**——原子 selector 根本不需要它（useShallow 是用来救「一个 selector 返回多字段对象」的，而本仓没这么写）。

**真正的系统性根因不是「订阅太宽」，而是另外两类：**

1. **整集合 selector + 该集合在高频手势中每帧换 identity** —— 订阅整个 `s.timeline` / `s.nodes` 的组件，在拖拽节点 / 播放预览时，因为集合对象每帧被替换而 ~60fps 重渲染，哪怕它们根本不画那段会变的数据。这是卡顿的主来源。
2. **瞬态 ref 性质的数据（播放 playhead）放进了会触发渲染的 store 对象** —— 画布视口（zoom/offset）已经被正确地搬进 local state 了（好榜样），但时间轴 playhead 没有，仍走全局 `timeline` 每帧重建。

换句话说：**架构骨架是对的（原子 selector + 节点级 React.memo + 视口 local state + 拖拽 rAF 节流都到位了），漏的是几个「整集合订阅」热点和一个「playhead 没下放 local」的不对称。修这几个点，不需要全仓重构。**

---

## 发现表

| # | 发现 | file:line | 机制 | 触发场景 | 受影响范围（谁重渲染） | 严重度 | 修复方向 |
|---|---|---|---|---|---|---|---|
| F1 | 时间轴 playhead 走全局 `timeline` 对象，播放每帧 `{...timeline}` 重建 | `timeline/timelineEdit.ts:476` `setTimelinePlayheadFrame` + `preview/PreviewWorkspace.tsx:57/61`（rAF tick 调 `setTimelinePlayhead`） | playhead 是瞬态播放游标，却存在可渲染的 `timeline` 对象里；推进时整对象换 identity | **预览播放**（rAF ~60fps 写一次） | 所有订阅 `s.timeline` 的：`TimelinePanel.tsx:79`、`PreviewWorkspace.tsx:17` 整树每帧重渲染 | **高** | playhead 拆出 `timeline`，单独存 `timelinePlayheadFrame` 字段（细粒度 selector）；或播放时走 local state / ref，停手再回写 store（仿画布视口 F5 的正解） |
| F2 | 整 `s.nodes` 数组被 7 处订阅；任一节点编辑/拖拽都换数组 identity | `sidebar/CategoryTree.tsx:41`、`nodes/NodeParameterControls.tsx:73`、`components/CanvasAssistantPanel.tsx:79`、`components/BatchPlanOverlay.tsx:17`、`assets/useAssetPool.ts:21`、`onboarding/OnboardingChecklist.tsx:53`、`components/GenerationCanvas.tsx:51` | immer 写 `node.position` 只换被拖节点 + 顶层 `nodes` 数组的 identity；订阅整数组的组件全部命中 | **拖拽任意节点**（rAF 节流后仍 ~60fps 换数组）、加/删/改节点 | 上述 7 组件。其中 `CanvasAssistantPanel`+`BatchPlanOverlay` 在画布旁**常驻挂载**、`CategoryTree` 侧栏**常驻**——拖一个节点，这几个不画节点位置的面板也跟着每帧重渲染 | **高** | 这些消费方多数只要「节点的某派生量」（数量、某节点字段、资产池）。改为订阅**派生过的细粒度 selector**（如 `s => s.nodes.length`、按 id 取单节点），或在 selector 里返回稳定的派生 + 配 `useShallow`/`createWithEqualityFn` |
| F3 | 画布 god-component 每个拖拽帧重算多个 `useMemo`（依赖 `nodes`） | `components/GenerationCanvas.tsx:59-102`（`nodes` filter / `visibleNodeIds` / `edges` / `groups` / `nodeById` Map / `selectedBounds` / `groupBoxes` / `selectedGroupIds`） | `nodes` 数组每拖拽帧换 identity → 这串 `useMemo` 依赖命中 → 全部重算（建 Set、建 Map、求包围盒、过滤边/组） | **拖拽任意节点 / 平移看不见（视口走 ref，OK）但节点拖拽走 store** | `GenerationCanvas` 自身每帧重渲染 + 上述派生全部重算（O(n) 建 Map/Set/bounds×每帧） | **中-高** | 拖拽过程把「单节点位置」从 store 写改为 local/ref 叠加（仅落定时回写 store，仿 F1/F5）；或把这些派生量从壳组件下沉到只在真正用到的子组件、缩小依赖 |
| F4 | `nodes` 同时被「全集合」与「filter by category」双重消费，每帧重过滤 | `components/GenerationCanvas.tsx:59-62`（`allNodes.filter`） | 同 F3：`allNodes` 每帧换 → category 过滤每帧重跑 O(n) | 拖拽 / 节点变更 | 画布壳 | **中** | 同 F3；或把「按 category 投影」做成 store 层 selector 缓存（一次过滤，identity 稳定） |
| F5（**已正确实现，作为正解参照**）| 画布视口 zoom/offset 在拖拽/平移中走 **local state + ref**，不写 store；仅切分类时回写 | `components/useCanvasViewport.ts:26-40,78-83` + `useCanvasPointerInteractions.ts:15-17`（`offsetRef`/`zoomRef`/`setViewport` local） | 平移/缩放是高频瞬态 → 用 local `useState` + `offsetRef` 承接，store 里的 `canvasViewports` 只在切分类时记一次 | 平移/缩放画布 | 只有画布壳 local 重渲染，**不波及任何 store 订阅者** | — | 无需修。**F1（playhead）应照搬这套** |
| F6 | 节点拖拽**已 rAF 节流**（作为缓解，作为正解参照） | `nodes/useNodeDragResize.ts:92-98`（`flushPendingMove` 包在 `requestAnimationFrame`） | pointermove 不每次写 store，攒到下一帧 flush 一次 `moveNode` | 拖节点 | — | — | 无需修。它把 store 写从「每 pointermove」降到「每帧一次」，但每帧那一次仍触发 F1-F4——节流缓解了量级，没消除整集合 identity 翻新这个根 |
| F7 | 节点级 `React.memo` 比对正确（作为缓解，作为正解参照） | `nodes/BaseGenerationNode.tsx:897-905`（`prev.node === next.node` 引用比对） | immer 保证未动的节点对象引用不变 → 拖 A 时 B/C/D 的 `node` prop 引用不变 → memo 跳过 | 拖节点 | — | — | 无需修。**正是它挡住了「拖一个节点重渲染所有节点子组件」**——子组件这层已经省了；省不掉的是 F2/F3 的**父壳 + 整集合订阅面板**那层 |

---

## 治本方案建议

整个 app 卡顿的状态层根因可以浓缩成一句：**「瞬态/高频数据被塞进了会触发渲染的 store 集合对象，且有面板订阅整集合」。** 三步治本，从高 ROI 到低：

### 1）把瞬态游标从可渲染 store 里拆出去（治 F1，最高 ROI）
- **playhead 学画布视口（F5）的做法**：播放推进走 local state / ref，停止时回写 store 一次。或最低成本版：把 `playheadFrame` 从 `timeline` 对象里提出来变成 store 顶层独立字段 `timelinePlayheadFrame`，让 `setTimelinePlayhead` 只换这一个字段、不 `{...timeline}`——这样订阅 `s.timeline` 的组件播放时不再每帧重渲染，只有真正订阅 `s.timelinePlayheadFrame` 的游标线组件动。
- 收益：预览播放从「整时间轴树 60fps 重渲染」降到「一根游标线 60fps 重渲染」。

### 2）整集合订阅 → 细粒度派生 selector（治 F2）
- 给 `useGenerationCanvasStore` 引入 `createWithEqualityFn` + `useShallow`（Zustand v4/v5 标准手段，本仓 0 处用），或为每个「整 nodes 订阅」点改成它真正要的派生量：
  - `CategoryTree` / `useAssetPool` / `OnboardingChecklist` / `BatchPlanOverlay` / `CanvasAssistantPanel`：多半只要「某 category 的节点」「节点数量」「有无某类节点」——用返回稳定派生的 selector + `useShallow`，节点拖拽时这些面板的 selector 输出不变 → 不重渲染。
- **规范建议（写进 engineering-rules，防再长出来）**：「订阅 store 集合（nodes/edges/timeline/messages）时，selector 必须收窄到组件真正消费的字段或派生量；返回新数组/对象的 selector 必须配 `useShallow`。」配一个 lint 思路或 review checklist 项。

### 3）god-component 派生下沉（治 F3/F4，长期）
- `GenerationCanvas.tsx` 在壳层建了一串依赖 `nodes` 的 Map/Set/bounds，每帧重算。结合方案 1 把节点拖拽也改成 local/ref 叠加（仅落定回写 store），这串 `useMemo` 的依赖在拖拽过程就不再每帧翻新。这条工作量较大（壳已顶 800 行红线），可在 F1/F2 见效后再做。

**不建议做的**：拆分 store（现有原子 selector + memo 骨架已经把多数重渲染挡住了，拆 store 收益低、迁移成本高、违反单一真相源习惯）；全仓引入 useShallow（没必要，只在「整集合订阅」那 7+2 个热点引入即可）。

---

## 建议真机实测项（R13 思路，量化前后）

1. **拖一个画布节点**：开 React DevTools Profiler（或临时挂 `why-did-you-render`），记录单次拖拽手势期间**哪些组件重渲染、各多少次**。预期当前会看到 `GenerationCanvas`、`CanvasAssistantPanel`、`BatchPlanOverlay`、`CategoryTree` 都随帧重渲染（F2/F3）；目标修复后只剩游标/被拖节点。
2. **预览播放 10 秒**：Profiler 记录 `TimelinePanel` / `PreviewWorkspace` 的重渲染次数。预期当前 ≈ 600 次（60fps×10s）；修复 F1 后应趋近 0（只游标线动）。
3. **大项目（>50 节点）拖拽帧率**：虚拟化阈值是 50（`useCanvasViewport.ts:12`），实测 50/100/200 节点下拖拽掉帧曲线，验证 F3 的 O(n) 派生在大图下的实际代价。
4. 对照组：拖拽时**只平移视口不拖节点**（走 F5 的 local 路径），确认它确实不触发 store 订阅者重渲染——用作「正解长这样」的基线。

---

## 关键文件索引（绝对路径）

- `/Users/aoqimin/Desktop/Nomi/src/workbench/workbenchStore.ts`（store 形状 + actions；`setTimelinePlayhead` 在 :649）
- `/Users/aoqimin/Desktop/Nomi/src/workbench/timeline/timelineEdit.ts:476`（`setTimelinePlayheadFrame` `{...timeline}` 重建 — F1 根）
- `/Users/aoqimin/Desktop/Nomi/src/workbench/preview/PreviewWorkspace.tsx:34-65`（播放 rAF 写 playhead — F1）
- `/Users/aoqimin/Desktop/Nomi/src/workbench/generationCanvas/store/generationCanvasStore.ts`（canvas store；viewport/playback 性质数据所在）
- `/Users/aoqimin/Desktop/Nomi/src/workbench/generationCanvas/store/canvasNodeActions.ts:124-160`（`moveNode`/`moveSelectedNodes` 写 position）
- `/Users/aoqimin/Desktop/Nomi/src/workbench/generationCanvas/components/GenerationCanvas.tsx:51-102`（整 nodes 订阅 + 每帧派生 — F2/F3/F4）
- `/Users/aoqimin/Desktop/Nomi/src/workbench/generationCanvas/components/useCanvasViewport.ts`（视口 local state 正解 — F5）
- `/Users/aoqimin/Desktop/Nomi/src/workbench/generationCanvas/nodes/useNodeDragResize.ts:92-98`（拖拽 rAF 节流 — F6）
- `/Users/aoqimin/Desktop/Nomi/src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:897-905`（节点级 memo — F7）
- 整 `s.nodes` 订阅 7 处：`CategoryTree.tsx:41`、`NodeParameterControls.tsx:73`、`CanvasAssistantPanel.tsx:79`、`BatchPlanOverlay.tsx:17`、`useAssetPool.ts:21`、`OnboardingChecklist.tsx:53`、`GenerationCanvas.tsx:51`
