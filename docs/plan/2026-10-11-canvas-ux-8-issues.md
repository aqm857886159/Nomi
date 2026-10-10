# 方案卡：画布体验 8 条走查问题的根因与修法

改动名：canvas-ux-8　　线：画布交互　　类别：[修 bug][交互重做][待拍板]　　日期：2026-10-11
来源：用户 2026-10-11 01:57 走查（对照 TapNow 画布文档 https://docs.tapnow.ai/zh/docs/canvas/generate-and-edit-video ）

一句话：8 条里 **6 条已定位到确定根因**（4 条是几行~几十行的确定性修复，2 条是交互重做）；1 条是既有设计决定（左栏左置），1 条是版本误会。**本分支只出方案，用户拍板后才动生产代码。**

---

## 0. 版本事实（先澄清第 8 条的疑问）

- GitHub `main` 当前头 = **4e1eecd**（PR #1128 `feat/generation-list-view`，2026-10-10 合入），`git ls-remote origin refs/heads/main` 亲自确认。
- 用户看到的「4e1eecd」= **就是最新 main**，不是旧版。
- 昨晚给用户起的实例是 `3f76dba40`（当时 main），**落后 1 个合并**；本次所有根因均已在 4e1eecd 上复核（下方 file:line 全部指向 4e1eecd）。
- 结论：这 7 条 UI 问题与「版本不够新」无关；第 8 条另有原因（见 §7）。

---

## 1. 拆解表拆不出「画面 / 景别」，且无法选择模型

**现象**：拆解出的表里画面、景别等列是空的 / 全失败；找不到换模型的地方；日志里成片 `deconstruct.model-failed … AI_RetryError: Failed after 3 attempts. Last error: You've reached the API rate limit for free users`（`apihub.agnes-ai.com` 的 `agnes-2.0-flash`）。

**根因（三条，按影响排序）**
1. **默认视觉脑是免费限流的 Agnes，且用户无处可换**。它由 `textBrainResolver.ts:239` 自动挑「已启用 + 有凭据 + 能读图」的文本模型里目录序第一个；Agnes 种子 `agnesTexts.ts:29-33` 声明 `supportsImageInput: true`、`seedBuiltins.ts:483` 默认 `enabled: true`。用户只连了 Agnes → 必然选中它 → 逐镜 3 次重试全撞 429。
2. **失败原因被吞**。整镜 VLM 调用失败在 `deconstructVideo.ts:467-475` 被 catch 成 `parsed = null` → `visionFailed`，原话只写日志 `:473`；而 `shotTableFacts.ts:33-45` **丢掉了 per-shot 的 `failureReason`**（顶层只留音频腿的失败）。所以用户看到的是「没读出来」，看不到「429 限流」。
3. **没有模型选择入口**。`DeconstructVideoPayload`（`deconstructVideo.ts:68-89`）里压根没有视觉模型字段，主进程自选（`:390`）；节点 footer 只有重试 / 取消 / 生成（`ShotTableNode.tsx:99-113`）。
   - 注意同一份 payload 的**音频腿已经有模型选择**（`transcribe?: {vendorKey, modelKey}`，解析在 `:326-330`）——**要补的是把视觉腿做成和音频腿一样的形状**，不是发明新机制。
   - 设计留痕（用户说「以前设计过」是真的）：`docs/audit/2026-09-17-post-804-walkthrough.md:378,393` 把「拆解用的视觉模型不可选」记为待办；`docs/research/2026-09-12-deconstruct-all-fail/README.md:176` 也建议过。**设计了但没接。**

**方案**
- a. 拆解默认视觉脑改为复用用户的文本大脑偏好（读 `generation-model-defaults`），并对「免费/限流」模型降权；有明确偏好时以偏好为准。
- b. `streamTextTask.ts:140-147` 显式给 `maxRetries`，**429 不重试**（限流重试只会放大失败与耗时）。
- c. 失败原因落到表：`shotTableFacts` 保留 per-shot `failureReason` 并在表头/行内显示原文（用户能看到「429 限流」）。
- d. 视觉模型可选：payload 加 `vision?: {vendorKey, modelKey}`（与音频腿同形），节点 footer 加模型选择控件（复用现成模型选择器）。

**验收**：拿用户那条限流视频复跑 → 表里 `画面/景别` 有值；把视觉脑切到另一个可用模型 → 值随之变化；把 Agnes 限流再触发 → 表内显示 429 原文而不是空白。

---

## 2. 截帧：交互差 + 功能不对

**现状**：入口是「当前帧 / 首帧 / 尾帧」三选一（`NodeVideoFrameToolbar.tsx:71-83`），**没有时间点选择**。

**根因**：「当前帧」读的是 DOM `video.currentTime`（`nodeVideoPlayback.ts:100-104`），但节点**默认不挂 `<video>`**——只有悬停才挂、离开即复位（`NodeVideoPlaybackGuard.tsx:23-28,98` + `nodeVideoPlayback.ts:68-82`）。所以「当前帧」实际约等于首帧 / 黑帧。这正是 10-09 设计卡里写的前提「先在卡里把播放头停在想要的画面」**在实现里从没做到**（`docs/plan/2026-10-09-video-node-next.md:37`）。

**方案**：把播放头变成**持久状态**（选中节点即保留 `<video>` 与 `currentTime`，或把 currentTime 写进节点 store），「当前帧」读该状态；截帧入口给一个可停的播放头 + 精确时间输入（TapNow 的原话就是「**先把视频播放到需要的位置，再截取当前画面**」）。

**验收**：拖到 3.2s 停住 → 截帧 → 图片节点内容 = 那一刻的画面（不是首帧）；首/尾帧仍可用。

---

## 3. 剪辑：不要「再套一个框」，交互要能看懂 + 剪辑节点拖不动

**现状**：点视频节点浮条的「剪辑」，弹出 `NodeVideoClipPanel`——一个 `absolute` + `scale(1/zoom)` 的自绘盒子（`:111-122`，`role=dialog`、带边框阴影），里面塞了**自己的一份 `<video>`**（`:129`）+ 时间轴（`:149`）+ 确认栏（`:170-176`）。入 / 出点复用 `ClipNodeTimeline` 的手柄（`:149-168`）。确认 → `trimVideoToNode.ts:52-103` 新建一张 `video-trim` 卡，原视频保留（这点符合预期）。

**根因**：这不是 bug，是 **2026-10-09 你已拍板的设计**（`docs/plan/2026-10-09-video-node-next.md:5,30`：③「点剪辑后贴着节点弹出一个比节点大一号的面板」）。**你这次要推翻它**——所以这一条必须同步改掉那份设计卡，否则下一个人还会照它做回来。

**方案（照 TapNow gif 定稿，2026-10-11 03:02 拍板）**

用户给的参考 gif（`~/Downloads/a16bf8f0-95ea-4363-a1f7-d4d41728c5a2.gif`，8.83s / 1328×770 / 12fps）逐帧读出来的目标交互（参考帧见 `docs/evidence/2026-10-11-tapnow-clip-reference/`）：

1. 点视频节点浮条上的剪刀 → **视频节点正下方紧贴出现一条胶片时间轴**；不弹模态、**不产生第二个 `<video>`**，节点里那个视频就是唯一预览。
2. 胶片形态 = **缩略图长条 + 蓝色高亮选区 + 两枚白色手柄**，选区上方标出选中时长（参考帧里是 `2.00s`）。
3. 确认 / 取消 = **贴在胶片两端的圆形按钮**（左 ✕ 右 ✓），不是底部一排 `DecisionBar`。
4. 胶片下方一行键盘提示 `Arrow Left / Arrow Right  Move selection`（带 ⌘ 组合）→ **方向键微调选区**。
5. 胶片右侧一颗 **`✦ Smart clip`**：**这批不接线**（可留位）；它是新能力（画面变化检测 → 自动切分镜），另议。
6. 节点自身底边的播放控件保留（播放键 + `1.0s / 5.1s` 读数 + 全屏），剪辑条在**节点之外的下方**，不动节点内部布局。

实现落点：删掉 `NodeVideoClipPanel` 的自绘外壳与它自带的 `<video>`（`:111-122`、`:129`），`ClipNodeTimeline` 改成胶片形态并贴到节点下方；两端圆钮；键盘提示行。**同 commit 改掉 `docs/plan/2026-10-09-video-node-next.md` 的③**（那份写着「贴着节点弹出比节点大一号的面板」，正是本条现状的来源，不改会被下一个人照做回来）。

**剪辑节点拖不动（第 7 条）**：`ClipNode.tsx:588` 唯一可拖区就是那颗 `h-8`（32px）header，且被动作钮 / 导出钮占满；节点主体是 `ClipNodeTimeline`，整块带 `nowheel nodrag`（`ClipNodeTimeline.tsx:547`，类名来自 `nodeScrollRegionClassName.ts:28`）。
**方案**：给 clip 卡一个明确的可拖空白区（加高 header / 留出无钮区），并确保常驻浮层不覆盖 header；不要放开时间轴的 `nodrag`（那是拖动入出点用的）。

**验收**：剪辑条出现位置不遮节点、不产生第二块视频；拖入出点 → 预览跟着走；确认后新卡出现在原卡旁边且**能被拖走**。

---

## 4. 点图片 / 视频节点：先闪「没有模型」再跳到有模型，很卡

**根因（两件事）**
- **闪烁**：模型芯片是「选中才挂载」的异步状态。`BaseGenerationNode.tsx:216-217` 只在选中时挂 `NodeGenerationComposer`（`:497` 才渲染）；`useModelOptions.ts:55-61` 一挂载就 `setOptions([]) + setLoading(true)`，`:70-108` 才去 `preloadModelOptions`（**命中缓存也仍是 Promise，必晚一帧**）；而 `InlineParameterBar.tsx:347-368` 把 `modelOptions.length === 0`（**含 loading**）画成「无模型·配置模型」大按钮 → 先画空态，再跳真实芯片。
- **卡**：每次选中都要重挂整套 composer（3 份 `NodeParameterControls`，各自 `useModelOptionsState` / `useNodeModelAutoSelect`，后者还会 `loadGenerationModelDefaults` 并写回模型），`useDeferredValue` 再补一次提交；同时 `GenerationCanvasReactFlow.tsx:126` 订阅 `selectedNodeIds` 导致整层重渲 + 边投影重算。

**方案**：① loading 不等于空态——`InlineParameterBar` 用骨架 / 保持上一次值，只在「确认无可用模型」时才画配置入口；② 模型清单上提到画布级缓存，选中时**同步**给首值（避免每次归零重取）；③ composer 的挂载成本按「有数据才挂」处理（或做最小化 memo）。

**验收**：连续点选 10 个节点，不出现「无模型」闪现；点击到芯片出现的体感在同一帧级别（走查录屏人眼判断）。

---

## 5. 九宫格切图：不是整图等分 + 确认/取消遮挡

**根因**
- **默认取景框内缩 4%**：`ImageCropGridOverlay.tsx:74` 默认 `{x:0.04, y:0.04, w:0.92, h:0.92}`（`cropOnly` 时是 `0.1/0.8`）。九格只切这个内框，外侧 4% 被丢掉，框外还压暗 → 看起来「切图不完整、外侧还有另外的空间」。
- **与设计文档矛盾**：`docs/plan/2026-06-16-adjustable-grid-crop.md:4` 明确「默认不动确认 = 旧的等分效果」；默认框这行是 `d942abe7ba5`（2026-10-05）改的 → 是实现偏离设计。
- **按钮遮挡**：确认 / 取消是 `absolute right-2 top-2` 落在图片**内部**（`:255-267`），压住右上格。
- 次因：取景框按 `object-fill` 算（`:188`，注释还写着「无 letterbox」），而卡片实际是 `object-contain`（`BaseGenerationNode.tsx:437`）→ 框与图片真实显示区不一致。
- **测试没拦住**：`cropGridGeometry.test.ts:4` 只用 `FULL={0,0,1,1}` 测纯几何；`tests/ux/image-grid-split-freeze.walk.mjs:260-263` 只验「等大/3×3/零重叠」，**没有「九格能拼回原图」的不变量**。

**方案**：① 切图模式默认框改整图 `{0,0,1,1}`（内缩只用于「裁剪」语义）；② 确认 / 取消移出图片区（卡外或下方）；③ 取景框按图片真实显示矩形（`object-contain` 后的 box）计算；④ 补一条「九格拼回原图」的不变量单测。

**验收**：打开九宫格 → 九格正好覆盖整图（拼回 = 原图，逐像素或容差比对）；按钮不压任何一格。

---

## 6. 拖组：框动了、里面的东西留在原地（确定 bug，值得先修）

> **状态：已在 PR #1170 落地**（分支 `fix/canvas-group-drag-follow`，提交 `f73fe2bc23`）：选择器改 `data-id` + 把手柄纳入平移 + 拖动中隐藏源侧把手与组工具条；夹具改成真库属性名、走查补「拖动进行中成员必须已跟随」断言。下面保留根因记录。

**根因（一句话）**：拖动预览用的选择器写错了属性名。

```ts
// useCanvasSelectionDrag.ts:88 与 :116（全仓仅这两处）
`.react-flow__node[data-node-id="${CSS.escape(id)}"] .generation-canvas-react-flow__node-shell`
```

而 React Flow **12.11.5** 给节点包裹层打的属性是 **`data-id`**（`node_modules/@xyflow/react/dist/esm/index.js:2366`：`"data-id": id, "data-testid": rf__node-${id}`），它自己内部也只用 `.react-flow__node[data-id=…]`（同文件 `:3913`）；`data-node-id` **是 Nomi 自己节点根的属性**（`.generation-canvas-v2-node[data-node-id]`，见 `useGenerationCanvasReactFlowMenus.ts:291`）。选择器永远选不中 → 拖动期间成员壳不打 `translate` → **框（`GroupFrame`，独立绝对定位 DOM）动了，成员壳不动**；松手时才在 `canvasGroupMoveActions.ts:23-77` 一次性写回位置。

**为什么一直没被发现**：夹具**伪造了这个属性**——`tests/ux/fixtures/selection-drag-lifecycle-harness.tsx:68` 手写了 `data-node-id`，走查 `tests/ux/grouping-optimization.walk.mjs:105-121` 又只在**松手后**量几何 → 测试锁住了错的实现。

**方案**：`data-node-id` → `data-id`（或改选我们自己的节点根再取 shell），**同 commit 修夹具与走查**（改用真实 React Flow DOM / 断言拖动中途成员壳已有 `translate`）。这是 P2「修根因不修症状」要求的最小共享边界。

**关于「很卡」**：已确认**不是**每帧写 store（`handleMove` 只累计 delta，rAF + DOM translate，`:186-213`；store 只在 pointerdown 与 settle 各写一次）。可量化前不宣称根因；现存可疑点是每帧 `querySelectorAll`（`:106`）与 settle 的整层投影重建；60 节点拖组性能在 `docs/plan/2026-10-05-grouping-optimization.md:62` 本就标为 unverified。

**关于「点颜色只变框、不变内容」**：这是**现设计**——`group.colorToken` 只被边框（`GroupFrame.tsx:102/111`）与圆点（`GroupFrameHeader.tsx:161`）消费，没有填充字段（`model/groupColor.ts:1-7`；`groupVisualContract.ts` 里框固定 `bg-nomi-paper/[0.32]`）。另外选中态 `border-nomi-accent`（`GroupFrame.tsx:118`）经 twMerge 会盖过颜色边框，看起来像「点了没反应」。**要不要让内容也跟着变色是产品决定**（需新增填充字段 + 过设计 token 门岗）。

**验收**：框选一组 → 拖动过程中成员卡跟着走（截图逐帧）；松手后位置一次写回、撤销可用。夹具改成真实 DOM 后，故意回归 `data-id` → 测试必须红。

---

## 7. 左栏位置（第 8 条的真实原因）

- 左栏是 `ShellRail`（`ui/app-shell/shell/ShellRail.tsx:170-253`：文档 / 目录 / 素材 / 流程 | Skill / 提示词），渲染进 `AppShell.Navbar`（`ShellFrame.tsx:57-64`）。
- **没有底部实现、也没有开关**：`ShellFrame` 只有 header / navbar / main，无 Footer；`shellLayoutStore.ts:13-19` 只有 `railCollapsed` / `drawerWidth`。
- **左置是刻意设计**：`docs/plan/2026-10-08-shell-redesign.md:1,66` 拍板 60px 左栏；近期 `f59b38d80f`、`dd6ec9a175` 都是左置。
- 所以「依然在左侧」不是版本问题，是**你要改一个已拍板的设计**。要改得走 §1.5 控件层级规则 + 先出样张（用户拍板后再接线）。

**验收**（若拍板改）：先出样张（左栏 vs 底栏对照），本轮不动生产代码。

---

## 8. 用户已拍板

- **范围：8 条一个 PR**（含拆解）；左栏只在**样张**层面出对照，本轮不动生产代码。
- **剪辑形态：照 TapNow gif 定稿**（详见 §3）——删外壳 + 去第二个 `<video>` + 节点下方胶片条 + 两端圆钮 + 方向键提示；**Smart clip 这批不接线**；同 commit 改 `docs/plan/2026-10-09-video-node-next.md` 的③。
- **拆解：这批一起修**（视觉模型可选 + 失败原因可见 + 429 不重试 + 选脑复用偏好）。
- **左栏：本轮不动**，先出「左栏 vs 底栏」样张。

### 施工状态

| 条 | 状态 |
|---|---|
| §6 拖组 | ✅ 已落地（PR #1170，提交 `f73fe2bc23`） |
| §5 九宫格 | 🟡 已实现（默认整图框 + 抓点内缩 + 确认条移出图片区），待补「九格拼回原图」不变量单测与截图走查 |
| §4 模型闪烁 / §2 截帧 / §3 剪辑条 / §7 clip 可拖 / §1 拆解 | ⬜ 未开始 |

## 9. 施工顺序（按风险从低到高，每步自带验收）

1. ~~§6 拖组选择器 + 夹具/走查~~（✅ PR #1170）。
2. §5 九宫格默认整图框 + 按钮移出图片区 + 取景框按真实显示矩形 + 不变量单测。
3. §4 模型清单：loading 不当空态 + 选中时同步给首值。
4. §2 截帧：播放头持久化（选中即保持 `<video>` 与 `currentTime`），「当前帧」读它。
5. §3 剪辑条（照 gif：删外壳 + 胶片 + 两端圆钮 + 方向键提示）+ §7 clip 卡可拖区。
6. §1 拆解：payload 加视觉腿（照音频腿形状）+ footer 模型选择 + failureReason 落表 + 429 不重试 + 选脑复用偏好。
7. 全量验收：`pnpm run gates`、按 §验收 逐条截图（构建版 + CDP 截图）。

## 10. 本卡不做

- 不改智能剪辑（新能力）；不引入任何新依赖（媒体处理继续走本机 ffmpeg）；不动正式版 `/Applications/Nomi.app`；左栏位置只出样张。
