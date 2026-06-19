# 画布「一键整理」（方案 A）实现规范

日期：2026-06-19
触发：R4（多文件改动先写文档）+ R8（用户可见，已出可体验样张拍板）
样张：`nomi_canvas_tidy_layout_A`（点整理→节点滑入归位+边变短→可撤销）已拍板。
拍板项：整理范围=**整个当前分类**；镜头网格每排=**随画布宽自适应**。

底座：自研画布。无第三方库（不引 dagre/ELK——通用 DAG 布局打散 storyboard 胶片直觉，自研 storyboard-aware 更贴；用户已选 A 不选 D）。

---

## 0. 范围 / 不动项 / 回滚 / 验收门

**范围**：新增「整理画布」按需动作——把当前分类节点重排成 storyboard 结构，不改任何既有落点/拖拽逻辑。

- 新增纯函数 `store/tidyCanvasLayout.ts`（+ 单测，TDD）
- 新增 store action `tidyCategory`（`canvasNodeActions.ts` + 类型 `canvasStoreTypes.ts`）
- UI：`GenerationCanvas.tsx` 缩放条旁加「整理画布」按钮 + 整理时的滑入过渡（临时 transition）

**不动项（零改动）**：单加螺旋避让（resolveInsertionPosition）、切片紧凑落点、agent 批量布局、拖拽、可重叠自由、边数据、对账、生成。**整理只是一个按需 action，不和用户较劲**（B 持续布局被否决的原因）。

**回滚**：整理前 `pushUndoSnapshot` → 全局撤销（⌘Z）一步还原；功能独立可单 revert。

**验收门**：五门全过 + `tidyCanvasLayout` 单测（不变量：无重叠/材料在上/镜头按 shotIndex/切片贴父）+ R13 真机走查（真实毛线球项目点整理，截图人眼判断）。

---

## 1. 布局算法（纯函数 tidyCanvasLayout）

输入：`nodes`（当前分类）、`edges`（其间）、`availableWidth`（视口宽，定每排镜数）。
输出：`Map<id, {x,y}>`。间距一律用 `getGenerationNodeFootprintSize`（与现有布局同口径，足迹自带安全余量即间距，不 hardcode）。

**分区（派生，不 hardcode 角色）**：
1. **子节点**（切片/裁剪/独立副本）：`meta.sourceNodeId` 或 `derivedFrom` 指向集内某节点 → 贴父成簇。父不在集内则降级为 main。
2. 其余里 **材料**（纯输入）：入边数=0 且出边数>0 → 顶部材料行。
3. **镜头/主节点**：剩下的（有入边、或孤立无边）→ 网格。

**排序**：
- 材料：按当前 x 升序（保留大致左右手感，稳定）。
- 镜头：按 `shotIndex` 升序（剧本序，缺则 +∞），同号按原阅读序（y 后 x）。

**摆放（size-aware 流式折行，非定宽网格——天然容纳异尺寸 + 切片簇）**：
- 原点 `{x:PAD, y:PAD}`。
- **材料行**：左→右按足迹宽累加，超 `availableWidth` 折行；行底 = 行内最高足迹。
- **镜头区**：材料区下方空 `LANE_GAP`。每个「单元」= 镜头(+其切片簇)：
  - 单元宽 = 镜头足迹宽 +（有切片？切片簇宽 + GAP）。
  - 切片簇 = 子节点紧凑网格（≈2 列）贴镜头右侧。
  - 单元左→右流式排，`x + 单元宽 > availableWidth` 则折行（y += 行内最高单元 + ROW_GAP）。
- 每排镜数随 `availableWidth` derive（流式折行自然实现「自适应」拍板项）。

不变量（单测锁）：① 同区任意两节点足迹不重叠 ② 材料 y < 镜头 y ③ 镜头按 shotIndex 单调（同排左→右）④ 切片紧邻其父（同单元）。

---

## 2. store action tidyCategory

```
tidyCategory(categoryId, availableWidth):
  读 currentState；筛 categoryId 的 nodes + 其间 edges
  positions = tidyCanvasLayout(nodes, edges, availableWidth)
  无变化（全部位置相同）→ return（不污染撤销栈）
  pushUndoSnapshot(currentState)
  set: 逐 node 写 positions[id]；bumpPersistRevision
  emitCanvasGesture(每个 moved 一条，共享 txn)
```
类型加进 `canvasStoreTypes.ts` 的 actions。

---

## 3. UI + 动画

- `GenerationCanvas.tsx` 缩放条那排加「整理画布」按钮（IconLayoutGrid + aria）；点击：
  - `setIsTidying(true)` → 容器加 `data-tidying` → CSS `[data-tidying] .generation-canvas-v2-node { transition: transform .55s cubic-bezier(.2,.7,.3,1) }` 让节点滑入；
  - 调 `tidyCategory(activeCategoryId, stageSize.width)`；
  - `setTimeout(600)` 去掉 `data-tidying`（**只在整理瞬间开过渡**，否则拖拽会迟滞跟手——transition 常驻=手感 bug）；
  - toast「已整理 · ⌘Z 撤销」。
- GenerationCanvas 余量仅 8 行：按钮 + isTidying state + handler 须 ≤8 行，超则抽 `useTidyCanvas` hook（防破 800，R12）。

---

## 4. 实现顺序

TDD 布局函数（先写不变量测试）→ store action → UI 按钮 + 动画 → 五门 → 真机走查（真实毛线球项目点整理对账）。

---

## 5. 实现回填（真机走查暴露的 3 个根因，算法从「贴父小簇」收敛到「扁平网格」）

初版「镜头 + 贴父切片簇」在真实毛线球项目（45 节点，**26 个是切片**）真机点整理后翻车，逐个挖根因：

1. **嵌套切片掉队（8 节点飞到负坐标）**：「切片的切片」其父也是切片（非 main），旧版只摆一层 children → 孙切片永不被放、留在老坐标 -1142。修：沿 sourceNodeId 链上溯到**根镜头祖先**，整条衍生链归根。
2. **根祖先是材料的切片也掉队**：被切片的「纯输入图」归类为材料，而材料循环不摆 children。修：材料和镜头**都摆 children**。
3. **切片是大图、不是小缩略图（撑成超高单列）**：贴父簇假设切片小，但真实切片常比镜头还宽（~360px）→ 限父宽变单列堆叠 → spanY 11528。**根本改法**：放弃「贴父小簇」，所有节点（含切片）统一当**扁平网格项**流式折行，切片在流里**紧跟其源镜头**（相邻不拉线），对任意尺寸鲁棒。

最终：材料网格（顶）→ 镜头网格（按 shotIndex、每镜紧跟切片，下方）。真机验证：毛线球 → 干净均匀网格、无交叉、无负坐标、无重叠。
单测锁 5 不变量（材料在上/无重叠/shotIndex 序/切片紧跟/嵌套与材料切片不掉队）。

**4 续：高瘦 → 按屏幕宽高比铺宽**（用户：「不要高瘦太长，要宽的适配电脑屏幕」）。
按视口宽折行时大节点只塞 3 个/排 → 高瘦长条（1072×5825）。改为 `targetAspect` = stage 宽/高，
`layoutWidth = √(总足迹面积 × 比例)` 反推折行宽 → 整块≈屏幕横向比例（实测 3200×2056，aspect 1.56 横向），
「适应视图」后铺满宽屏。aspect 夹 [0.8,4] 防异常测量；derive 自真实 stage 尺寸，不 hardcode 每排数。
