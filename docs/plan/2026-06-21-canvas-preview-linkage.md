# 画布 ↔ 预览 联动：两个桥动作（不加第二条轨）

> 日期：2026-06-21 · 状态：**实现中**。C0/C1/C2 已 push main(2e6b2b5/b170ac7/4acc04c);C3 真实缩略图待做。模型经 2 轮 5 画像用户测 + 6 角色评审收敛：**砍掉「画布第二条片轨」，只加两个桥动作 + 真实缩略图。** 决策史见 §7。
>
> **实现进度（2026-06-21）**：
> - ✅ C0 地基：in-place 重生成(`regenerateNodeInPlace`,不 duplicate)+ clip 回填闸(`reconcileTimelineForUpdatedNodes`)+ URL 口径(providerUrl 优先,保留本地 scheme)+ trim 越界夹取 + 防重叠。纯函数单测 12 例。五门绿。
> - ✅ C1 就地重生成 UI：时间轴选中单媒体 clip → 工具栏「重生成」(IconSparkles/accent)。
> - ✅ C2 一键拼片 UI：TimelinePanel 工具栏「AI 拼片」(IconWand)复用 `arrangeStoryboardToTimeline`(此前无 UI 入口)。
> - ✅ C3 真实帧缩略图(26b3968)：video clip 优先用真实 `<video>` 首帧、image clip 优先 url，绕开节点预览的「黑底合成标题卡」(审计 D3)；thumbnailUrl 仅 audio/兜底。
> - ⚠️ 真机 R13(部分通过)：新控制条在真 app 渲染**已肉眼确认**(逐帧/音量/全屏/AI拼片/三轨含文字轨，布局一行不溢出，screenshot pv_bar2)；**clip 相关行为(选中重生成/trim气泡/真实缩略图/scrub 延迟)无法在隔离实例验**——它无 key/无内容、且 studio 窗口在隔离环境 flaky 崩。待**正常 GPU + 有内容的实例**眼过 + 就地重生成端到端真生成验。
> 真相源：本文件（v3）。配套：`2026-06-21-preview-rough-cut-overhaul.md`（预览区内部手感，需按 §6 同步裁剪）。
> 关联记忆：`connection-reference-bugs`、`reconcile-edge-drop-and-card-redesign`、`agent-arrange-storyboard-to-timeline`、`url-priority-inconsistency-ref-lost`、`canvas-tidy-layout`。

---

## 0. 一页读懂

**用户测出来的真相（这是 v3 的根据）**：在「生成画布」里再加一条片轨，**多数用户排斥或无感**——
- 新手/批量（小红、芳姐）：看见两条就当两个东西，不信同步、怕弄坏，「排片只认预览那条」。「同一份数据两处」对他们是负担不是卖点。
- 老手（阿Ken、Leo）：听得懂「一条数据两视图」，但「懂架构 ≠ 想要画布里长条线性轨」；只在「可召唤+轻量+只粗排」时才勉强要。
- **只能留一条 → 5 个画像全留预览那条。**
- **全员真正点名想要的不是「第二条轨」，是桥的两个动作**：① 就地重生成（素材/参考/上下文都在画布，原地重出最值）；② 一键把料丢进预览时间轴（芳姐：「比给我两条同步的轨有用十倍」）。

**所以 v3 = 不加第二条轨，只加两个桥动作 + 真实缩略图**：
1. **就地重生成**：画布节点上、预览时间轴 clip 上，都能「这镜不行→原地重出、贴回原位、不跳/不搬家」；要改 prompt/参数才跳画布节点。
2. **一键拼片（料→预览轴）**：画布里一个按钮，把镜头按镜序排进**预览那条唯一的时间轴**（把已有 `arrange_storyboard_to_timeline` 露出来）。
3. **真实帧缩略图**：clip/节点缩略图换成真实画面，去掉「合成黑底卡」的假数据感。

**不动**：预览时间轴是**唯一**成片轨——轴、右边 trim 小钮、拖动排序、分割、scrub，**全部保留、一个不改**。排序/留空/复用/时长这些「自由排」继续在预览那条上做（多数已有）。

**为什么这样最对（D2）**：命中全员共识、避开新手最怕的「两条要同步」；且把劲使在被反复点名的真价值（两个动作）上，而不是造一个没人爱的第二条轨。单一真相源只锁**镜头内容**（节点→产物），**排列**始终是预览时间轴自己的事。

---

## 1. 现状地基（代码实证，file:line）

**预览时间轴已经全有，不用动：**

| 已有能力 | 代码 |
|---|---|
| 轴 + 图片/视频/文字轨 | `timeline/TimelinePanel.tsx` |
| 右边 trim 小钮（左右握把，拖裁长短） | `TimelineClip.tsx:305`(左)/`:336`(右)，`cursor-ew-resize`→`resizeTimelineClip` |
| 拖动 clip 重排、分割(剪刀)、scrub、撤销 | `TimelinePanel.tsx` + `timelineEdit.ts` |
| clip 可有空隙(留空) / 可无 sourceNodeId(文字) | `timelineTypes.ts:7-47`（startFrame 任意） |

**两个桥动作要用到的地基（部分就位，部分要补）：**

| 资产 | 位置 | 状态 |
|---|---|---|
| `clip.sourceNodeId` 反向引用（必填） | `timelineTypes.ts:9` + `buildClipFromGenerationNode.ts:83` | ✅ 就位 |
| `nomi-focus-generation-node` 事件（nodeId→聚焦节点） | `GenerationCanvas.tsx:172` | ✅ 复用：「改参数」跳节点 |
| `arrange_storyboard_to_timeline`（AI 排片） | `agent/sendStoryboardToTimeline.ts` + `storyboardTimelinePlan.ts` | ✅ 已有，**只是没露出按钮** |
| 重生成入口 `confirmAndRunNode{rerun}` | `runner/generationRunController.ts:401` | ⚠️ 现在是「造变体新节点」非「原地」，须新写 in-place（§3-1） |
| clip 取 URL | `buildClipFromGenerationNode.ts:72` | ⚠️ 只读 url 漏 providerUrl，须收口（§3-3） |
| `shotIndex` | `shotNumbering.ts:14` | 冻结编号（章节号语义）→ 降级为「编号 + AI 拼片默认序」，不是成片顺序 |

---

## 2. 模型（三句话）

1. **预览时间轴 = 唯一成片轨**，排列/trim/分割/留空全在它上面（多数已有），不动。
2. **画布只加两个动作**：节点/clip 上的「就地重生成」、画布里的「一键拼片(料→预览轴)」；外加缩略图换真实帧。**画布里不立第二条轨。**
3. **单一真相源只锁镜头内容**（画布节点→产物 URL，改一处→预览里每个引用它的 clip 都更新）；**排列是预览时间轴自己的数据**，不被锁。

---

## 3. C0 地基不变量（6 角色评审挖出；两个桥动作的根基，开 UI 前先钉 + 纯函数单测）

1. **in-place 重生成**：新写 `regenerateNodeInPlace(nodeId)` —— 同节点叠新 `result`（旧的进 `history`），**不 duplicate、不换 id、不动 shotIndex**。否则 `{rerun}` 造新节点（`canvasNodeActions.ts:258`）→ clip.sourceNodeId 对不上。变体(duplicate) 与 重生成(in-place) 分流。保留 confirm + `mintSpendGrant`（不绕付费闸）。
2. **clip 内容回填闸**：新写 `reconcileTimelineForUpdatedNodes(nodeId,newResult)`，与删除对账对称 —— 节点产物更新 → 所有引用它的 clip 刷新 url/thumbnail/frameCount，**位置不变**。
3. **URL 口径收口**：clip 取产物改 `providerUrl > url > thumbnailUrl`，复用 `referenceUrl.resultUrl`，不抄第四份口径（防重演 `url-priority-inconsistency`）。
4. **trim 越界夹取**：回填新产物按新 `durationSeconds` 重算 `frameCount` 并夹 offsets（变短收窄/变长可延/保≥1帧），`startFrame` 不变。三例单测。
5. **入轨原语收敛**：现有 `sendStoryboardToTimeline`(at-playhead) + `arrangeStoryboardToTimeline`(append/dedup) + 新「一键拼片」按钮 → 收敛成一个 `ingestUnitsToTimeline(units,mode)`（提升 `placeUnitsSequentially`），**不加第三套**（P1）。
6. **删节点保护**：被 trim/复用过的 clip，其源节点被删时阻断+提示，不静默删用户剪辑工。

---

## 4. 切片（4 个，solo 扛得动）

| # | 切片 | 内容 | 量级 |
|---|---|---|---|
| **C0** | 地基不变量 | §3 全部（in-place 重生成 / 回填闸 / URL 口径 / trim 夹取 / 入轨原语 / 删节点保护），纯 runtime + 纯函数单测，零 UI | 中 |
| **C1** | 就地重生成（动作①） | 预览 clip 上 + 画布节点上加「重生成」，走 C0 的 in-place + 回填，位置不变、不跳；「改参数」才 `nomi-focus-generation-node` 跳节点 | 中 |
| **C2** | 一键拼片（动作②） | 画布里露出按钮，复用 `arrange_storyboard_to_timeline` 走收敛后的 `ingestUnitsToTimeline`，按镜序排进预览时间轴；默认用户按才跑、可推翻 | 小 |
| **C3** | 真实帧缩略图 | clip/节点缩略图用 `extractVideoFrameToNode` 抽真实首帧，替合成黑底卡；产物变→缩略图失效刷新（纳入 C0 回填闸） | 中 |

**没有「画布第二条轨」「片轨叠层」切片** —— v3 砍掉。

---

## 5. 范围 / 不动项 / 回滚 / 验收门（R4）

**范围**：§4 四切片。**不引入新框架/技术栈**，全建在现有 store/画布/时间轴/runtime/事件（R5 不触发）。
**不动项**：① 预览时间轴本体（轴/trim 小钮/拖动排序/分割/scrub）**一个不改**；② 画布里**不立第二条轨/片轨叠层**（用户测否决）；③ 不新增设计 token；④ 导出公式不破；⑤ `StoryboardPlan` 一次性 IR 语义不变。
**回滚**：每切片独立 commit；C1/C2/C3 均「新增动作/按钮」，关入口即回滚；C0 纯函数派生层可灰度。
**验收门**：
- 五门全过（`pnpm run gates`）。
- 单测：in-place 重生成、回填对账、URL 口径、trim 越界夹取、入轨原语 —— 纯函数全覆盖。
- **真机走查（R13，正常 GPU 实例）**：预览 clip 点重生成→位置不变、URL 是新产物、trim 没越界；画布节点重生成→预览里引用它的 clip 同步更新；一键拼片→镜序排进预览轴、可推翻；缩略图是真实帧、重生成后刷新。截图人眼判断 + 与现状对账（P3）。
- **关键不变量断言**：① clip 产物 URL == 源节点最新 result（`referenceUrl.resultUrl`）；② 重生成后 clip 位置不变、trim 不越界；③ 删节点 ≠ 删被编辑过的 clip（阻断提示）。

---

## 6. 与预览粗剪方案的收口

`2026-06-21-preview-rough-cut-overhaul.md` 原 B1（clip 原地重生成）= 本文 C1，**同一能力同一处实现，不重复造**。该文需同步裁剪（按用户测）：
- **删**：JKL·I/O 穿梭、帧级时间码（剪辑师广度仗，Nomi 用户当噪音）。
- **延后**：波纹删除（无高频证据）。
- **留**（纯预览内部手感）：redo、音量/静音、全屏、trim 帧气泡。
- **移交本文**：B1 原地重生成、真实缩略图（A6）。

---

## 7. 决策史（防回退 + 教训）

- **v1「单一有序镜头·两视图（shotIndex 列表两投影）」→ 否**：6 角色评审挖出 3 处代码事实错误（重生成造新节点非原地 / shotIndex 是冻结编号非排序键 / clip 是快照非投影），且混淆「库顺序 vs 成片顺序」。
- **v1.5「货架 vs 成片两个空间」→ 否**：5 画像测，3/5 斥为「把节点画布产品化阉割」。
- **v2「自由画布 + 可召唤片轨叠层」→ 否**：第 2 轮 5 画像「理解度」测——新手根本不理解「一份数据两处」、只看见两条会怕弄坏；老手懂但「懂≠要」；只留一条全员留预览；真正想要的是两个桥动作不是轨。
- **v3「两个桥动作，不加第二条轨」→ 定稿（本文）**：命中全员共识，避开新手最怕的「两条要同步」，劲使在真价值上。
- **新需求分流**：① 时长/节奏控制 → 预览时间轴 trim 小钮**已有**，只欠「边调边播」（小，归预览粗剪后续）；② 模板/批量套用变量（电商）→ 超范围，另立项；③ 多 cut 版本（技术玩家）→ 后续，非现在。
