# 剪辑节点 / 时间轴手势：按类修在共享边界（设计卡 + 走查结果）

> 来源：2026-10-09 用户原话「剪辑节点的操作和交互并不流畅，有很多卡点……拖动不灵，有时候拖不动，有时候没法用」。
> 事实底账：Codex 屏外真 Electron 实测的 8 个卡点（任务书 `brief-I-clipdrag.md` 引用 `R-clip-drag-report.md`）。
> 本卡先于代码写下；第二片（卡点 4 / 5 / 6）的设计也在这里，实现另提。

## 三问

1. **近 14 天修过几次**：`node scripts/fix-churn.mjs` 对 `ClipNodeTimeline.tsx / ClipNode.tsx / TimelineClip.tsx / TimelinePanel.tsx / TimelineTextTrack.tsx / workbenchStore.ts / canvasDraggingFlag.ts` 全部「未命中热点」。没有第 3 个 fix。
2. **是我们独有的吗**：片段几何、吸附、裁剪、「谁拥有一个像素」的层叠、帧↔像素换算是（时间轴领域）；「按住指针的手势生命周期（capture / cancel / blur / lostpointercapture / Esc）」不是，所以先评估现成库（见下「现成库评估」），并且**复用仓库已有的打断监听**（`canvasDraggingFlag.beginCanvasDragging` 租约），不另写第二套。
3. **补 / 换 / 删**：**换**。5 处手写的手势收尾（`ClipItem.beginDrag`、`ClipItem.beginResize`、`ClipNodeTimeline.beginScrub`、`TimelineClip.beginDrag / beginResize`，外加 `TimelinePanel.beginScrub`、`TimelineTextTrack` 两处）同一提交里换成一个会话入口，旧实现当场删掉，没有并行版、没有 fallback。

## 手势入口表（door-map 数门 + 全文检索 `setPointerCapture|addEventListener('pointer`）

| 入口 | 改前谁接管 | 改后谁接管 |
|---|---|---|
| 画布剪辑节点：片段身体 | `ClipItem.beginDrag`：自带 capture + 6 种监听；按下不选中（选中只在松手 click 里） | 按下经 `onAdmitGesture` 先选中节点与片段；`usePointerSession` 收尾 |
| 画布剪辑节点：裁剪手柄 | `ClipHandle` 只给**已选中**的片段渲染；宽 `clamp(12/zoom,16,28)` 设计像素（50% 缩放只剩 8–14 屏幕像素）；自带一套监听；click 被 stopPropagation（点手柄区不算点片段） | 常驻渲染，悬停片段 / 选中后显形（命中不依赖显形）；宽按屏幕像素定：未选中（悬停）8px，已选中最多 16px、窄片段最多占 34%，再除以 zoom；`usePointerSession`；点手柄区仍算点片段（click 冒泡，裁剪后的 click 与拖动共用 didDrag 抑制） |
| 画布剪辑节点：播放头 | 竖线 `pointer-events-none`，鼠标压在线上 = 命中下面的片段；scrub 主动排除片段 | 8 屏幕像素的抓取带，层叠在片段之上（z-45 > 拖动中片段 z-40），与空白轨道 / 标尺共用同一个 `beginScrub`（带抓取偏移，不跳变） |
| 画布剪辑节点：空白轨道 / 标尺 scrub | 监听挂在元素上，只认元素上的 pointercancel；blur / lostpointercapture / Esc 不处理 | `usePointerSession` |
| 画布剪辑节点：「添加素材」按钮 | 按钮自己 | 不变（`beginLaneScrub` 排除 button） |
| 剪辑节点标题栏 / 外壳（节点拖动） | `useNodeDragResize` / React Flow `nodrag`、`nopan`、`nowheel` | 不变。轴区域靠 `NODE_SCROLL_REGION_CLASS_NAME` 隔离，结构测试守着 |
| 全局时间轴：片段移动 / 裁剪（`TimelineClip`） | 只摘 `pointerup`；pointercancel / blur / 丢 capture 后卡在拖动态、监听泄漏 | `usePointerSession` + 打断回滚（`cancelTimelineGesture`） |
| 全局时间轴：播放头 scrub（`TimelinePanel`） | window pointerup + pointercancel | `usePointerSession`（多了 blur / lostpointercapture / Esc） |
| 全局时间轴：文字轨移动 / 裁剪 | 只摘 `pointerup` | `usePointerSession` + 回滚 |
| 面板高度分隔条（`TimelineResizeHandle`） | 元素上的 onPointerMove/Up/Cancel | 不变，结构测试里登记为例外（不走 window） |
| 素材节点「拖到时间轴」把手 / 素材库拖出 / 全局 `TimelineTrack` 接收 / 剪辑节点轴（无接收） | 原生 DnD；把手 hover 前 `pointer-events-none` | **第二片**（卡点 4 / 5） |
| 预览区 `OverlaySelectionBox`、`TimelinePreview` 文字拖动 | 各自 window 监听 | **未迁移，同类残留**（不在时间轴手势里，见「没做的」） |

门数：`door-map ClipNodeTimeline` 1 扇读入口（`ClipNode.tsx`）；手势收尾入口 5 个文件 8 处 → 1 个会话入口。

## 先查别人（现成库评估）

- 依赖里已有？`@use-gesture/react` 10.3.1 已在 lockfile（drei 的传递依赖）。`pointerDown` 把 capture 设在 `event.target`（node_modules/.pnpm/@use-gesture+core@10.3.1/node_modules/@use-gesture/core/dist/actions-fe213e88.esm.js:643），`pointerUp` 同时接 pointercancel（同文件 :714 起，`setupPointer` 把 'cancel' 绑到同一个 `pointerUp`）——取消和松手是同一条路径。
- 仓库里已有？画布已有打断租约：blur / pointercancel / lostpointercapture / visibilitychange 监听在 src/workbench/generationCanvas/components/canvasDraggingFlag.ts:185，复用；时间轴手势这边没有任何共享入口（5 个文件 8 处各写一份）。
- 生态里已有？use-gesture 的 `pointer.capture` / `filterTaps` / `cancel()` 选项文档 https://use-gesture.netlify.app/docs/options/ ，dnd-kit（MIT）https://github.com/clauderic/dnd-kit （第二片的跨容器拖放评估，倾向不接）。
- TikHub 自媒体：未查（本任务不涉及用户行为调研）。
- 结论：**复用租约 + 自写一个很薄的会话（提交 / 回滚语义）**，不接 use-gesture。


- **`@use-gesture/react` 10.3.1（MIT，pmndrs；仓库里已作为 drei 的传递依赖存在）**：读了 `actions-*.esm.js` 源码——`pointerUp` 把 `pointercancel` 当成普通松手处理（走同一条 `pointerUp` → emit，半截拖动会被当作提交），**不处理** `blur`、`lostpointercapture`、`Esc`；capture 设在 `event.target`（可能是片段里的缩略图 / 标签）而非绑定元素。时间轴编辑的语义是「松手才落盘、任何打断必须回到拖之前」，要用它就得在外面再包一层补齐这三格并把 cancel 与 release 分开，包装层不比 `timelineGesture.ts`（约 80 行）短，还多一个直接依赖。**不接，理由是领域语义（提交 / 回滚）而非实现偏好。**
- **`dnd-kit`（MIT）**：只用于第二片的跨容器拖放；评估结论放在第二片的设计里（现有原生 DnD + 一个统一接收方更小，倾向不接）。
- **复用而不是自写的部分**：打断监听（blur / pointercancel / lostpointercapture / visibilitychange）= `canvasDraggingFlag.beginCanvasDragging`（`active: false` 只借监听、不升「拖动中」旗，外观零变化）。
- **自写且登记（`docs/engineering/self-written.json`）**：`src/workbench/timeline/timelineGesture.ts`（会话：capture + move/up + Esc + 提交 / 回滚语义）、`src/workbench/generationCanvas/nodes/clipNodeGestureModel.ts`（屏幕像素↔节点内像素、命中宽度、准入）。理由只有领域约束：命中宽度与层叠规则服务片段 / 手柄 / 播放头这三种时间轴对象；提交 / 回滚对接时间轴撤销栈。

## ★ 五格

| 格 | 内容 |
|---|---|
| ★1 用户怎么用 | 当我在画布剪辑节点里排片段，我想**按住就拖、播放头压在哪都能拖、悬停就能拉手柄裁**，以便少点一下、少等一下。真实任务：①未选中的剪辑节点里把片段 C 往后拖；②把播放头压在片段 B 上拖着看画面；③画布缩到 50% 拉片段 C 的出点；④拖到一半切到别的窗口再回来，轴不卡在拖动里。不做：不改片段几何 / 吸附 / 裁剪的计算；第一片不碰素材拖进轴（卡点 4 / 5 / 6）；全局时间轴的手柄仍是「选中才显」（见下）。已知坑：窄片段（30 秒视窗里 4 秒的片段，50% 缩放只有 26 屏幕像素宽）手柄占两侧各 8px，身体剩 10px——第二片再给片段做屏幕像素下限。指标：8 卡点 × 缩放 50 / 100 / 150% 的走查全绿；基线 main 36 步红 23。 |
| ★2 谁说了算 | 「一次手势的生命周期」→ `timelineGesture.ts` 的 `beginPointerSession`（打断监听来自 `canvasDraggingFlag`）；「谁拥有一个像素」→ 层叠（播放头抓取带 > 手柄 > 片段身体 > 空白轨道），尺寸全在 `clipNodeGestureModel.ts`；「手势一开始节点与片段的选中」→ `ClipNode.admitGesture`（判据 `resolveClipGestureAdmission`）；「屏幕像素→节点内像素」→ `clipNodeGestureModel.screenPxToDesignPx / clientXToDesignPx` 一处（`clipNodeDragModel` 里已有的帧换算不动）。同一份事实 1 份。 |
| ★3 一致与复用 | 复用 `beginCanvasDragging`、`NODE_SCROLL_REGION_CLASS_NAME`、`canvasDragExceededThreshold`；全局时间轴的手柄按产品现状仍是选中才渲染（合同只点名画布剪辑节点的手柄；两处手柄的统一另案，已记「没做的」）。 |
| ★4 全状态 | 空轨道：不变。拖动中：片段 / 手柄 / 预览标签照旧。**被打断**（pointercancel、窗口失焦、丢 capture、Esc、页面隐藏、组件卸载）：回到拖之前（画布内 = 丢弃预览；全局时间轴 = 弹回撤销栈顶且不留 redo）。播放头 scrub 被打断：停在最后位置（非破坏性）。只读：`onAdmitGesture` 在 readOnly 下不传，行为同改前。能力不可用：不适用（无模型 / 外部资源）。 |
| ★9 验收与回滚 | 验收：`node tests/ux/clip-gesture-ownership.walk.mjs`（屏外真 Electron，零花费，50 / 100 / 150% 各一遍）；`pnpm exec vitest run src/workbench/timeline/timelineGesture* src/workbench/generationCanvas/nodes/clipNodeGestureModel.test.ts`。回滚：revert 修复提交（单一 PR）；没有数据迁移。独立验收线编号由协调会话指派。 |

### 功能分类
- [x] 新界面 / 改交互
- [ ] 花钱
- [x] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式

## 走查结果（`tests/ux/clip-gesture-ownership.walk.mjs`）

屏外真 Electron、真鼠标（CDP 输入）、零花费夹具；每个缩放档（50 / 100 / 150%）各跑一遍，P 编号对应任务书 8 个卡点，本片覆盖 P1 / P2 / P3 / P7 / P8（再加 3 步外观取证 V，不判对错）。
证据：`docs/evidence/2026-10-09-clip-gesture-ownership/`（main 基线日志、修后中文浅色 / 英文暗色日志、改前改后截图）。

main 基线（同一份走查，除后加的「手柄不透明度」断言与 V 取证起点外原样）：**36 步里 23 步红**；修后：中文浅色 36/36、英文暗色 36/36 全绿；另连跑两遍中文浅色全绿（排查过的一次 P8 抖动见下）。

| 卡点 | 步骤 | main（改前） | 本分支（改后） |
|---|---|---|---|
| P2 未选中也能拖，但选中态跟不上 | 取消选择 → 按下片段（不动）读选中态 → 再拖 | 红 ×3 档：按下时节点与片段都未选中 | 绿 ×3 |
| P3 手柄要先选中；缩放后命中区域对不上 | 悬停未选中片段 → 找手柄、读不透明度与屏幕宽 → 拖出点 | 红 ×3：手柄不存在 | 绿 ×3：悬停即显出（不透明度 1）、屏幕宽 8px |
| P1 播放头压在片段上拖不动 | 点 B 让播放头落在 B 上 → 按住播放头线拖 60px | 红 ×3：拖成片段移动，播放头 0px | 绿 ×3：播放头跟手 60px，片段不动 |
| P7 画布内被打断（pointercancel / blur / lostpointercapture） | 拖片段到一半派发打断，再动一次鼠标 | 片段拖动三种打断都绿（原代码本来就处理）；拖播放头被 pointercancel 打断后仍跟随鼠标：100 / 150% 红 | 全绿 |
| P7 全局时间轴被打断 | 拖片段到一半派发三种打断，再动鼠标 | 红 ×9：三种打断后都卡在拖动态，松手后落在拖到的位置 | 绿 ×9：回到拖之前 |
| P8 所有权 | 片段身体 / 空白轨道 / 标题栏各按一次；别的节点选着时按住片段 | 红 ×3：别的节点选着时按住片段，选中权不交给剪辑节点 | 绿 ×3：节点位置、画布视口各归其主 |

说明：
- 真实系统打断（切窗口、弹框）用同类 DOM 事件复现（`pointercancel` 派发到 window、`blur` 事件、`releasePointerCapture`）；Chromium 把 lostpointercapture 推迟到下一个指针事件，所以每次打断后补一次真实 1px 移动再判。
- 走查里「别的节点选着」一步曾因为被选中素材节点的参数浮板盖在剪辑节点上而偶发红（浮板是产品里本来的行为）：夹具把素材节点放到剪辑节点下方，浮板落在更下面，之后连跑不再抖动。
- 既有走查 `clip-node-editing.walk.mjs`：main 原样 67 项全真；本分支改后同样 67 项全真。它原来按「片段左缘 5px」按下去拖片段，那一点现在是裁剪手柄（原本靠「裁左缘也让 x 右移」碰巧过），改成按片段正中。

## 第二片设计（本片不做）

- **卡点 4（拖进剪辑节点不追加）**：现有全局 `TimelineTrack` 的 `onDragOver / onDrop` 已能读 `TIMELINE_GENERATION_NODE_DRAG_MIME` 与 `ASSET_LIBRARY_DRAG_MIME`。倾向抽一个「时间轴接收口」纯函数（MIME → 可落的素材 / 节点 + 落点帧 + 轨道匹配）给全局轨道与剪辑节点轴共用，剪辑节点轴接上同一个接收口，落点用现有 `appendClipNodeSource` 追加，落点处画插入指示。不接 dnd-kit：来源是原生 `draggable`，接收只有这两处，dnd-kit 要把两端都改成它的传感器。
- **卡点 5（把手要悬停才出现）**：命中与显形分开——把手始终可命中（去掉 `pointer-events-none`），悬停只管透明度。
- **卡点 6（缩小后片段点不中 / 放大后跑出屏幕）**：片段点击宽度按屏幕像素加下限（外壳元素承担命中，视觉不变）；拖到轴边缘自动滚动。放大超出屏幕是画布缩放范围（0.2–3）与节点自适应的问题，先实测再定。
