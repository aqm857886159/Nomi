# 剪辑节点第二片：拖放接收 / 窄片段命中 / 边缘滚动 / 同类入口（设计卡 + 走查结果）

> 第一片（#1145）的设计与手势入口表：`docs/plan/2026-10-09-clip-gesture-ownership.md`。本片落地其中「第二片设计」，并收第一片留下的同类入口。
> 方向检查（同一条线、同一类根因，沿用第一片结论）：`docs/engineering/direction-checks/2026-10-09-clip-drop-zoom.md`。

## 三问

1. 近 14 天修过几次：`ClipNodeTimeline.tsx` 5 个、`ClipNode.tsx` 6 个 fix——绝大多数是第一片自己的提交（同一线）。已写方向检查并带 `Direction-Check:` trailer；这不是「补丁摞补丁」：本片把接收口 / 命中 / 滚动各收成一处，不在 8 个地方各打补丁。
2. 是不是独有的：落点语义（吸最近边、只在重叠时后推）、窄片段命中垫、轴边缘滚动是时间轴领域；拖放传输本身是通用能力，评估了 dnd-kit（https://github.com/clauderic/dnd-kit ）：来源是原生 `draggable`、接收只有全局轨道与剪辑轴两处，接它要两端换传感器，且它不懂帧 / 插入位置 / 撤销栈，不接（理由是领域约束）。
3. 补 / 换 / 删：**换**。预览区两处手写监听换进第一片的会话入口（旧的同提交删除）；全局手柄的「isSelected 才渲染」删掉。接收口是新增（全局 `TimelineTrack` 的同一对 MIME，规矩对齐，不另起一套载荷）。

## 手势入口表（本片变化）

| 入口 | 改前谁接管 | 改后谁接管 |
|---|---|---|
| 剪辑节点轴：素材拖放接收 | 无（dragover / drop 冒泡到画布舞台，被当成新建素材节点） | `ClipNodeTimeline` 一组 dragenter / over / leave / drop，轴自己接（stopPropagation）；载荷经 `clipNodeDrop.readClipDropPayload`，写入经 `ClipNode.dropMedia` → `clipNodeSequence.insertClipNodeSourceAt` |
| 素材节点「拖到时间轴」把手 | `pointer-events-none` 到 group-hover 才开 | 一直可命中，悬停只管显出来 |
| 窄片段命中 | 命中宽 = 视觉宽 | 窄于 24 屏幕像素的片段两侧补看不见的命中垫（`clipHitPadWidth`，垫在片段之下，邻居的手柄不被盖） |
| 拖片段 / 裁剪 / 拖播放头到轴边缘 | 不滚 | `clipNodeEdgeScroll.startEdgeAutoScroll`：每帧按 `edgeScrollStep` 滚，落点 = 指针位移 + 轴滚过的距离 |
| 全局时间轴裁剪手柄（`TimelineClip`） | `isSelected` 才渲染 | 常驻，悬停片段 / 选中后显形（剪刀模式不抢点击）；与剪辑节点同规矩 |
| 预览取景拖动（`TimelinePreview`） | 元素级 move / up / cancel，cancel 当松手提交 | `usePointerSession`，被打断恢复取景偏移 |
| 预览叠加层拖动 / 缩放（`OverlaySelectionBox`） | window pointerup 监听，无打断处理 | `usePointerSession`，被打断回到拖之前 |

## 同类迁移结论

- 全局时间轴手柄：已统一（悬停即用）。
- `OverlaySelectionBox` / `TimelinePreview`：已迁（成本小：两个文件各一段手势，语义映射为「cancel = 把值写回按下时的值」）。结构测试 `timelineGesture.structure.test.ts` 的扫描范围已扩到这两处，再手写 capture / pointerup 监听会当场红。
- `TimelineResizeHandle`（面板高度分隔条）：元素级 move / up / cancel 且随 capture 走，没有 window 监听，维持例外。
- 其余未迁：无。

## ★ 五格

| 格 | 内容 |
|---|---|
| ★1 用户怎么用 | 当我把画布上的图 / 视频或素材库里的素材拖进剪辑节点，我想在落点看到插入位置、松手就插在那儿，以便不用先加进来再拖片段；画布缩小时窄片段照样点得中；拖片段到轴边缘轴自己滚。真实任务：①从素材节点把手拖到片段 B 左半，B 之前出现插入线，松手插在 B 前、B 与后面的片段整体后推；②拖到最后一个片段之后，追加在末尾不重叠；③素材库里的图拖进来同样；④50% 缩放下抓住 1 秒窄片段外侧 1px 拖动它；⑤把片段拖到轴右边缘，轴滚动、片段跟着走远。不做：不改片段几何 / 吸附 / 裁剪计算；不改拖动时的红色时长小牌（`--nomi-snap-tag`，等用户拍板）。已知坑：命中垫只在有空档处生效（相邻紧挨时垫在邻居之下）；素材节点正选着时它的参数浮板会盖住下面的剪辑节点（产品里本来的行为）。指标：6 个步骤 × 缩放 50 / 100 / 150% 走查全绿；基线 main 27 步红 24。 |
| ★2 谁说了算 | 「轴上素材落点」→ `clipNodeDrop.readClipDropPayload` + `clipNodeSequence.insertClipNodeSourceAt`（概念 `canvas.clip-axis-drop`）；落点帧 = `clipNodeGestureModel.resolveClipNodeDropFrame`，指示与松手同一个返回值；命中垫 / 边缘滚动 / 手柄宽度 = `clipNodeGestureModel`（概念 `canvas.clip-gesture-geometry`）；手势生命周期 = 第一片的 `timelineGesture`（概念 `canvas.gesture-lifetime`）。同一份事实 1 份。 |
| ★3 一致与复用 | 载荷 MIME 与全局 `TimelineTrack` 同一对；别的项目的素材先过 `materializeAssetLibraryItems`（唯一关口）；视频时长用 `readVideoDurationSeconds`；插入指示沿用全局轨道的 caret 样式（accent、2px 竖线）；手柄悬停 / 选中同一套 accent 底色（token）。 |
| ★4 全状态 | 拖入中：插入线跟着光标；离开轴：线消失；松手：片段插入并选中；载荷不是图片 / 视频（音频等）：行内提示 `generationCommon.clipNode.dropUnsupported`；素材复制失败：沿用 `uploadFailed`；只读节点：不接收。被打断（pointercancel / 失焦等）的手势一律回到拖之前。能力不可用：不适用。文案 zh / en 都有。 |
| ★9 验收与回滚 | 验收：`pnpm run build && node tests/ux/clip-drop-zoom.walk.mjs`；`pnpm exec vitest run src/workbench/generationCanvas/nodes src/workbench/timeline/timelineGesture*`。回滚：revert 本片的 fix 提交；没有数据迁移（片段仍写 `timelineStartFrame` / `timelineEndFrame`）。独立验收线由协调会话指派。 |

### 功能分类
- [x] 新界面 / 改交互
- [ ] 花钱
- [x] 长跑 / 可打断
- [ ] Agent 行为
- [x] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式

## 走查结果（`tests/ux/clip-drop-zoom.walk.mjs`）

main 基线 27 步红 24（V 外观取证 3 步不判对错）；修后中文浅色 27/27、英文暗色 27/27。第一片走查 `clip-gesture-ownership.walk.mjs` 36/36、`clip-node-editing.walk.mjs` 67 项全真（回归）。证据：`docs/evidence/2026-10-09-clip-drop-zoom/`。

| 步骤 | main（改前） | 本分支（改后） |
|---|---|---|
| P5 把手不靠悬停 | 红 ×3：鼠标在别处时那一点最顶层是下面的预览层 | 绿 ×3 |
| P4 画布素材拖进轴（插入 / 追加 / 再次入轴） | 红 ×9：无指示、不插入 | 绿 ×9：指示在 B 左缘，插入帧 = B 原起点，B 与后面整体后推 |
| P4 素材库载荷 | 红 ×3：轴无反应（dragover 被画布舞台接走） | 绿 ×3 |
| P6A 窄片段命中 | 红 ×3：外侧 1px 按下拖的是播放头 | 绿 ×3（屏幕宽 7 / 14 / 21px 的片段） |
| P6B 边缘自动滚动 | 红 ×3：轴不滚 | 绿 ×3 |
| G1 全局手柄悬停即用 | 红 ×3：手柄不存在 | 绿 ×3 |
| O1 预览取景被打断 | 红 ×3：pointercancel 后取景留在拖到的位置 | 绿 ×3：恢复原偏移 |

拖放驱动方式（诚实说明）：Electron 里 Playwright 的鼠标只能触发到 dragstart。「拖出」一半是真鼠标，载荷由把手自己的 dragstart 处理函数写出；「落下」一半用同一份载荷在真实屏幕坐标上派发 dragenter / dragover / drop（按最顶层元素收）。走查还因此发现并避开了一个产品里的既有现象：相邻节点的连接把手命中区会盖到别的节点上，被盖处收不到落下（夹具把素材节点放在剪辑节点上方避开）。

## 外观变化

只有剪辑节点手柄的可见度：悬停与选中现在用同一套 accent 底色（`bg-nomi-accent/25`，手柄自身悬停 `/45`），浅色下不再发白。中 / 英、浅 / 暗改前改后截图见证据目录。

## 补丁：拖放期间画布浮层不吃命中（V-1149 反向检查）

**问题**：素材节点正选着时，它的参数浮板就在节点下方、盖住剪辑节点；拖它的把手去剪辑片段，落点最顶层是浮板里的文字，dragover 到不了剪辑轴，片段不插入，素材库载荷同样落不下。
**类**：拖放进行中，画布上的浮层（参数浮板、连接把手命中区、节点浮条等）仍在吃命中，挡住真正的接收目标。
**共享边界**：`components/canvasDropActiveFlag.ts`——带着可接收载荷的 `dragstart` 升 stage 的 `data-drop-active`；`dragend` / `drop` / Esc / 窗口失焦 / 页面隐藏摘旗；旗在期间清单里的浮层整体 `pointer-events:none`（视觉不变，事件穿过去落在下面的接收目标上），样式只经 stage 上一条 className（`CANVAS_DROP_ACTIVE_CLASS_NAME`），不新增全局 CSS、不造新样式。
**door-map 数浮层（统一走一个开关，清单只在 `CANVAS_DROP_PASS_THROUGH_SELECTORS` 一处）**：参数浮板 / 生成框（`.generation-canvas-v2-node__composer`）、节点浮条（`[data-node-floating-toolbar]`）、版本卡动作条与版本卡（`[data-version-card-bar]` / `[data-version-card]`）、连接把手命中区（`.generation-canvas-react-flow__handle-hit`，会伸到相邻节点上）、多选浮条、组框工具条，共 7 个选择器。右键菜单 / 更多菜单是用户主动打开的菜单，拖放开始时不在其中，未列入。
**走查 D1**（缩放 50 / 100 / 150%，中英光暗各一轮）：选中素材节点（浮板展开，先断言落点确实被浮板盖着）→ 拖放开始 → 旗升起、落点最顶层是剪辑轴 → 落下插在片段 B 之前 → 旗摘掉、浮板恢复可点；另测 dragend / Esc 取消后旗摘掉。补丁前 3 档全红、补丁后全绿。截图：`docs/evidence/2026-10-09-clip-drop-zoom/d1-*-during-drag.png`（我已逐张查看：拖放期间浮板仍在原处，外观不变）。
**驱动方式（诚实说明）**：真鼠标在把手上接着拖会让 React Flow 同时开始拖节点，松手时按旧快照回写、冲掉落下的片段，那是走查驱动方式的副作用（真实原生拖放没有 mouseup）；D1 用对把手派发的 `dragstart` 起拖，真鼠标拖出一半由 P5 覆盖。
