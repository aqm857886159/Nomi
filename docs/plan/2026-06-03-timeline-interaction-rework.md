# 时间轴交互层重做 — 决策与执行文档

日期：2026-06-03
状态：**方案定稿（待用户确认样张后进入实现）**
触发：用户主诉"剪辑很烂、拖动不好用、逻辑有问题"；程序员朋友建议引入 **Remotion** 重做剪辑/预览/导出。

> 本文档遵守 `CLAUDE.md`：规则 3（对比表）、规则 4（执行前文档：范围/不动什么/回滚/验收门）、规则 5（Context7 查库）、规则 6（顶尖开源真实代码）、规则 7（6 角色审查）、规则 8（样张先行）、规则 9（先想模块化/架构）。

---

## 0. 一句话结论

**否决引入 Remotion；交互层走"自研 DOM + 照搬 OpenCut 的 snap-source 架构"；导出后续接线已有的 `ffmpegFiltergraph`。** 第一阶段先解决用户最痛的**拖拽吸附 + 可拖 playhead + 多选**。

---

## 1. 现状诊断（代码坐实，非主观）

| 用户吐槽 | 代码根因（文件:行） |
|---|---|
| 拖动不好用、对不齐 | `src/workbench/timeline/TimelineClip.tsx:54-79` 手搓 Pointer 拖拽，**拖动过程只写本地 `dragDeltaPixels`、松手才 `moveTimelineClip` 一次性提交**；`timelineEdit.ts:59-65` `canPlaceClip` 只做布尔判定，**撞了就整段弹回原位、零吸附** |
| 播放头动不了 | `TimelinePanel.tsx:241` playhead 写死 `pointer-events:none`，纯装饰条，只能点标尺跳 |
| 逻辑有问题（播放漂移） | `PreviewWorkspace.tsx:36-45` 用 `setInterval(1000/fps)` 自增 playhead，**与 `<video>` 真实进度是两条独立时钟 → 必然漂移**；`TimelinePreview.tsx:128` 仅暂停时校准 currentTime |
| 预览≠成片 | 预览是 DOM `<video>/<img>`（contain，`TimelinePreview.tsx:516/524`），导出是 canvas 重画（cover，`timelineWebmExport.ts`）→ **两套渲染、两个真相源** |
| 导出无音频/字幕/转场 | `electron/export/ffmpegRunner.ts:276` 写死 `-an`；`drawSubtitle` 是死代码；无转场 |
| 单选 / 导出慢 | 全局单 `selectedTimelineClipId`；导出逐帧 seek 串行 |

**关键资产发现**：
- `electron/export/ffmpegFiltergraph.ts`（multi-clip concat/overlay/adelay → filter_complex 编译器）+ `exportPlanner.ts`（多后端选择）**写好、有测试、但 0 调用方**，是为多片/音频/转场预留的脚手架——应**接线，不是废弃**。
- `electron/export/ffmpegRunner.ts` 是**已上线的生产级进程层**（取消/进度/原子落盘/asar 路径/错误分类齐全）。
- 既有架构文档 `docs/architecture/nomi-production-video-export-architecture-2026-05-24.md` 早已定调"FFmpeg 是桌面主后端，MediaRecorder 仅 fallback，音频从第一天预留"。本方案与之**连续**。

---

## 2. 决策一：否决 Remotion（规则 3 对比表）

| 方案 | 用户看到什么 | 代价 |
|---|---|---|
| **引入完整 Remotion** | 预览=成片；可买 $600 现成剪辑界面 | 安装包 **+300~400MB/平台**（多打一个 headless Chromium）；团队≥4 人**强制订阅**（$100/月起）；作为 Automators **每次渲染强制遥测上报**；开源会把许可义务**传染给下游**；**且 Remotion 不提供时间轴 UI，对"拖拽手感"零帮助** |
| **不碰 Remotion（本方案）** | 拖拽吸附、可拖 playhead、多选、预览=成片、导出有声/字幕；软件**保持轻、免费、不上报** | 工作量大，按阶段做 |

**否决依据**：
- Remotion 唯一真优点（Player 同源代码 → WYSIWYG）可用"预览/导出共享合成 IR"自行达成，无需绑定 Remotion。
- 许可传染 + 强制遥测 + 体积翻倍，与 Nomi**开源 / 本地优先 / 零义务**定位**结构性冲突**（6 角色一致否决，含 CTO 一票否决、真实用户明确反对）。
- 业界最相关两个开源剪辑器 **OpenCut（45k★ MIT）**、**Diffusion Studio** 都**刻意绕开 Remotion**，改用 WebCodecs/自研 + DOM。

---

## 3. 决策二：交互层"自研 DOM + 照搬 OpenCut"（选型逻辑链）

### 3.1 候选淘汰（规则 6，读真实源码）

| 候选 | 淘汰理由 |
|---|---|
| Canvas 自研（Fabric/Konva） | `@designcombo/timeline` 无 license=专有不能用；几十片段量级上 canvas 杀鸡用牛刀 |
| moveable + selecto | 最近提交停在 2024-06，~2 年没维护（违反规则 5） |
| interact.js | 无多选；最近 release 2023 |
| react-draggable / react-rnd | snap 只能等距 grid，吸附片段边得自己算；无多选 |
| tldraw | license 非 MIT；整套画布内核 → 只借鉴 SnapManager 思路，不依赖 |

剩两个决赛选手：**① dnd-kit + dnd-timeline**　**② 自研 DOM（照搬 OpenCut）**。

### 3.2 决赛关键洞察（Context7 核实官方 API 后）

第一阶段三个硬能力，**两条路都得自己写**：

| 第一阶段硬能力 | dnd-kit/dnd-timeline | 自研 |
|---|---|---|
| 拖拽/trim 手柄/缩放/时间轴坐标 | ✅ 现成 | 自己写（现有手搓版本**这部分能用**） |
| 边缘吸附（吸到片段边/playhead/0/整秒） | ❌ 库只给 grid 等距 | 自己写（照抄 OpenCut） |
| 可拖 playhead | ❌ 库不提供 | 自己写（照抄 OpenCut） |
| 多选/框选 | ⚠️ 多选有示例，框选自己加 | 自己写（照抄 OpenCut） |

### 3.3 加权决策矩阵 → 拍板自研

| 维度（权重） | 自研 | dnd-kit | 赢家 |
|---|---|---|---|
| 第一阶段净工作量（30%） | 差额只剩拖拽管道，而现有管道能用 | 省下已有的管道，却要学 DndContext + 改 date/ms 时间模型为帧 | 自研 |
| 与现有内核边界（25%，规则 1/9） | 长在现有 Zustand + `timelineEdit.ts` | 并排塞 `TimelineContext` = 第二份坐标/状态源 | 自研 |
| 输入管道健壮性（15%） | 自己维护 | dnd-kit 久经考验，**但触摸/无障碍/大规模性能在"桌面+几十片段+1D"全是低价值区** | dnd-kit（但价值砸在用不上处） |
| 长期维护/依赖风险（15%） | 零依赖/license/体积 | dnd-timeline 仅 243★、年轻、薄 | 自研 |
| 证据支撑（10%，规则 6） | OpenCut 45k★ MIT 正是自研、可照抄 | 无同量级对标 | 自研 |
| 锁定/可逆性（5%） | 资产（snap-source+ticks）与库无关 | 同样不锁定 | 平 |

**拍板**：交互层走**自研**。核心理由：dnd-kit 省的是"你已有且没坏的管道"，缺的硬能力它一个不给；其看家本领（触摸/无障碍/大规模）恰落在本场景低价值区。

---

## 4. 模块化 / 架构（规则 9 — 已过 CTO+前端+后端讨论）

**分层（关注点分离，禁止混进一个巨壳，规则 9 反例：勿重蹈 `BaseGenerationNode.tsx` 1354 行覆辙）：**

```
交互层（自研 pointer，纯 UI 事件）          ── 只产生"用户想把某 clip/playhead 移到某 px"的意图
  │  px → ticks 换算
  ▼
吸附领域层  src/workbench/timeline/snapping/   ── 纯函数，无 React
  SnapPoint source 模式（片段头/尾/playhead/0/整秒）
  阈值用像素定义、按 zoom 换算成 ticks（缩放下手感一致）
  │  解析出"吸附后的目标帧"
  ▼
状态层  Zustand store + timelineEdit.ts        ── 唯一真相源 = EDL（时间轴文档模型，整数帧/ticks）
  保留现有领域逻辑（canPlaceClip/moveClipToFrame/resizeClipEdge）
  │
  ├─▶ 播放时钟层  player/                       ── 以 video.requestVideoFrameCallback 为权威时钟
  │     （禁用 setInterval 当时钟；playhead 是 video 进度的从属量）
  │
  └─▶ 渲染合成层（后续阶段）                     ── 预览与导出共用同一份"合成 IR"
        预览渲染器  ┐
                    ├── 同一份 drawFrame/合成描述（CTO 红线：WYSIWYG 靠架构保证，非人肉对齐）
        ffmpegFiltergraph 编译器 ┘
```

**两条架构红线（CTO 不可让步）：**
1. **单一 EDL 真相源**：交互层只改 EDL，不存第二份 clip 状态。
2. **预览/导出共用同一份合成 IR**：禁止两套几何/缩放/转场逻辑（现状 contain vs cover 的病根）。

**时间单位**：全链路用**整数帧 / ticks**（照 OpenCut `TICKS_PER_SECOND`），像素只在渲染/命中时换算 → 杜绝累积误差。

---

## 5. 借鉴 OpenCut 的具体文件（规则 6，照抄思路/代码，非重复造轮子）

OpenCut 真实实现在 tag `pre-rewrite`（github.com/OpenCut-app/OpenCut）：
- `apps/web/src/timeline/snapping/{types,build,resolve,threshold}.ts` — SnapPoint source 收集 + 阈值内最近解析
- `apps/web/src/timeline/{element,playhead}-snap-source.ts` — 片段边 / playhead 吸附点
- `apps/web/src/timeline/controllers/playhead-controller.ts` — 可拖 playhead 状态机（点标尺跳 vs 拖把手 scrub，Shift 临时关吸附）
- `apps/web/src/timeline/group-move/snap.ts` — 多选成组拖动的全组最优吸附

tldraw `SnapManager`（吸附思路天花板，只读不依赖）：bounds/handle/gap 三类吸附，source 由各 shape 提供——与 OpenCut 同思想。

---

## 6. 分阶段路线（按"痛级"切片，每阶段独立可交付）

第一阶段已与用户确认：**先修手感**。

| 阶段 | 交付（用户立刻有感） | 落点 |
|---|---|---|
| **P1（本轮）先修手感** | 拖拽自动吸附（辅助线+咔哒）、**可拖 playhead scrub**、多选 | 自研交互层 + 吸附领域层；播放时钟改 rVFC 修漂移 |
| P2 收口信任 | 预览=成片（WYSIWYG，统一 cover/分辨率/合成 IR） | 渲染合成层单源；删 DOM 双合成 |
| P3 补成片能力 | 导出有音频/字幕/基础转场 | 接线 `ffmpegFiltergraph` + `exportPlanner` 真分派 + manifest 资产解析 |
| P4 效率/精致 | 多选批量、导出提速、更多转场 | 增量 |

> PM 视角提示：P3 的"导出无声=废品"痛级其实最高；但用户本人首选先爽手感（P1）。本路线尊重用户排序，P1 落地即推进 P3。

---

## 7. 第一阶段（P1）范围

**做：**
1. **吸附领域层**：新建 `src/workbench/timeline/snapping/`（types/build/resolve/threshold + element/playhead source），纯函数。
2. **可拖 playhead**：放开 `pointer-events`，新增 playhead controller（点标尺跳 / 拖把手 scrub / Shift 关吸附 / 按帧对齐）。
3. **拖拽改造**：`TimelineClip.tsx` 拖动/trim **过程中实时吸附并提交**（接吸附层），撞了找最近合法位而非弹回；保留现有 pointer-capture 管道。
4. **多选**：`selectedTimelineClipId: string|null` → 选区集合 + 框选 marquee + 成组拖动（成组吸附）。
5. **播放时钟修漂移**：`PreviewWorkspace` 的 `setInterval` → 以 `requestVideoFrameCallback` 为权威时钟反推 playhead；无 video 时用 rAF + `performance.now()` 增量，不再整数 +1。
6. **吸附视觉反馈**：对齐辅助线 + 轻量咔哒感（设计师红线：吸附三件套——目标/阈值/反馈缺一不可）。

---

## 8. 不动什么（明确边界）

- **不碰导出/渲染链路**（`export/`、`electron/export/`）—— 属 P2/P3。
- **不引入任何拖拽/canvas 第三方库**（自研结论）。
- **不动数据模型的轨道结构**（2 轨）——多轨属后续，P1 不扩。
- **不改生成画布（generationCanvas）→ 时间轴的投递链路**。
- `timelineEdit.ts` 的领域算法**保留复用**，只改"何时调用 + 吸附"。

---

## 9. 删旧清单（规则 1，自研落地时同 commit 删）

- `TimelineClip.tsx` 中"松手才提交 + ghost + 撞了弹回"的旧拖拽分支 → 被实时吸附拖拽替换后**物理删除**，不留两套拖拽。
- `PreviewWorkspace.tsx` 的 `setInterval` 播放循环 → 被 rVFC 时钟替换后删除。
- playhead 的 `pointer-events:none` 装饰实现 → 删。
- 确认无外部引用的 `timelineDragPayload.ts:decodeTimelineClipDragPayload`（死代码）→ 顺手删。

---

## 10. 回滚策略

- P1 在独立分支开发，交互层与吸附层为**新增模块**，旧拖拽在合并前保留、合并时同 commit 删（规则 1）。
- **可逆性兜底**：真正资产（SnapPoint source 模式 + ticks 模型）与"拖拽事件来源"解耦；若实测发现非要 dnd-kit 管道，只换事件源，吸附/playhead/EDL 不动。
- 每个子能力（吸附/playhead/多选/时钟）独立小 PR，单点回滚不牵连。

---

## 11. 验收门（P1）

| 类别 | 必须通过 |
|---|---|
| 吸附 | 拖到相邻片段边/playhead/0，阈值内自动吸附 + 显示辅助线；**靠近即吸、拖远即脱离（不靠快捷键）**；整秒吸附默认关；按 Shift 全程关闭；缩放下阈值手感一致 |
| playhead | 可直接拖动 scrub；点标尺跳转；拖动按帧对齐；与点击标尺行为区分 |
| 拖拽 | 拖动过程实时反馈（不再松手才变）；撞了找最近合法位而非弹回原位 |
| 多选 | 框选/Shift 增选；成组拖动整体吸附 |
| 播放 | 连续播放 60s+ playhead 与 `<video>` **不漂移**；切后台再回来不跑飞 |
| 单位 | 全链路整数帧/ticks，无浮点累积误差 |
| 删旧 | 旧 `setInterval` 时钟、旧松手提交拖拽、playhead 装饰实现已物理删除（规则 1 自检） |
| 回归 | `npm test` 通过；时间轴现有测试不破 |

---

## 12. 调研与评审留痕

- **Context7（规则 5）**：已查 Remotion（`/remotion-dev/remotion`，许可/遥测/本地渲染/Player）、dnd-kit（`/clauderic/dnd-kit`，snap modifier/DragOverlay/RestrictToHorizontalAxis）、dnd-timeline（`/samuelarbibe/dnd-timeline`，useItem/getSpanFromDragEvent/grid snap）。
- **顶尖开源（规则 6）**：读 OpenCut（45k★ MIT，自研 DOM snap-source）、designcombo（Fabric canvas，无 license）、moveable/interact/react-draggable、tldraw SnapManager、Diffusion Studio/Mediabunny。
- **6 角色审查（规则 7）**：CTO（B/自研，一票否决 Remotion，立单一 EDL+合成 IR 红线）、前端（漂移根因=setInterval/松手提交/双合成；分层落点）、后端（接线 ffmpegFiltergraph，否决 Remotion 体积+遥测）、设计师（吸附三件套红线，反对买 Editor Starter）、PM（按痛级分阶段，A 否决）、真实用户（先修拖拽手感）。

---

## 13. 下一步（规则 8 三道门）

1. ✅ 已出 **P1 可视样张**：`docs/design/timeline-interaction-p1-mockup.html`（可交互：拖拽吸附辅助线+咔哒、可拖 playhead scrub、多选成组拖动）。
2. ✅ **设计师 + 真实用户 agent 已评审**，结论与改进已回填（见 §14）。
3. ⏳ **待用户本人确认**样张后，才进入 P1 实现（按第 7 节范围 + 第 9 节删旧 + 第 11 节验收）。

**未经用户确认，不写 P1 实现代码。**

---

## 14. 样张评审回填（2026-06-03）

**真实用户（关键反馈，已采纳改进样张）：**
- 三大老痛点（拖拽跟丢/playhead 不可拖/单选）方向认可，手感是剪映/CapCut 路子。
- ⚠️ 吸附"太黏、想留缝放不准、逃生口靠记 Shift = 普通用户用不上" → **改为"靠近即吸、拖远即脱离"，不依赖快捷键**。
- ⚠️ 整秒吸附点太密 → 搓衣板感 + 咔哒连抖 → **整秒默认关**，只留片段边/playhead/起点等稀疏强目标。
- 放行：方向认可，要求上面两条做进实现。

**设计师（必改项，已采纳改进样张）：**
- 选中描边 2px → **对齐设计系统 1.5px**。
- snap tag 橙底白字对比不足 → **tag 底色压暗一档**（`--nomi-snap-tag`）。
- 新增吸附色 → 命名 **`--nomi-snap` / `--nomi-snap-tag`**，实现时按 §9 登记进 `nomi-tokens.css`。
- clip 裸 `#fff` → **`var(--nomi-paper)`**；细线像素值加注释。
- 可选打磨（实现期再定）：轨道 62→52px、clip 46→40px 向密度优先靠拢；标尺补 minor 次级刻度；控件级小圆角统一。
- 放行：方向/视觉语言/吸附反馈强度都对路，清掉必改项即可进实现。
- 放行：**实现时务必删除样张里的 `.hint`/`.note` 演示文案**（不带入真实组件，规则 2）。

> 以上必改项均已应用到样张文件，可重新打开预览验证手感。

---

## 15. 实现进度

P1 拆三个独立小步（决策文档 §10「单点可回滚」）：

### ✅ 子步 ①（已实现 + 验证）— 拖拽吸附 / trim 吸附 / 可拖 playhead
- **新增吸附领域层**（纯函数，规则 9 分层）：`src/workbench/timeline/snapping/`
  - `snapTypes.ts` · `snapPoints.ts`（稀疏强目标：起点/playhead/片段头尾，整秒默认关）· `resolveSnap.ts`（像素阈值→帧，近吸远脱）· `index.ts`
  - `snapping.test.ts`：8 测试全过。
- **合法落位**：`timelineEdit.ts` 新增 `resolveLegalStartFrame` / `moveClipToLegalFrame`（撞了滑入最近空位，不弹回）。
- **store**：`moveTimelineClip` 改用合法落位 + `{commit}` 开关（拖动中不触发自动保存，松手 commit 一次）；新增 `timelineSnapGuide` 临时状态；移除旧的"此位置已有片段"toast。
- **TimelineClip.tsx**：重写拖拽 = 实时吸附 + 合法落位 + 头/尾双边吸附 + 吸附辅助线 + WAAPI 咔哒；trim 手柄也吸附。**删除旧的 ghost / dragDeltaPixels / 撞了弹回逻辑**（规则 1）。
- **TimelinePanel.tsx**：可拖 playhead scrub（把手 + 标尺按下即跳并续拖）+ 吸附辅助线渲染。删除旧 `pointer-events:none` 纯装饰 playhead 与 `handleRulerClick`。
- **token**：`nomi-tokens.css` 登记 `--nomi-snap` / `--nomi-snap-tag`（规则 10）。
- **验证**：`npx vitest run` 50 文件/430 测试全过（含新增 8）；改动文件 `tsc` 零类型错误；`pnpm build:renderer` 通过。

### ✅ 子步 ②（已实现 + 验证）— 多选
- **schema**：`selectedTimelineClipId: string` → `selectedTimelineClipIds: string[]`（单一真相源，单片工具取末位 primary）。
- **store**：`selectTimelineClip(id, {additive})` 切换/替换、`setTimelineSelection`、`removeSelectedTimelineClips`、`moveTimelineClips`（成组绝对落位 + commit 开关）。
- **timelineEdit**：`clampGroupDelta`（成组位移夹紧不重叠非选中）、`applyClipStartFrames`、`removeClipsByIds`；`timelineGroupEdit.test.ts` 8 测试全过。
- **TimelineClip**：Shift/⌘ 点选切换；拖动时若选区>1 走成组路径（夹紧 + 吸附 + 落位），=1 走原单片路径。
- **TimelinePanel**：单片工具用 primary，删除按钮/Delete 键 → 批量删除全部选中。
- **TimelineTrack**：点轨道空白清空选区。
- 保留 `removeTimelineClip`/`removeClipById` 作单片删除原语（与批量互补，非并行重复）。

### ✅ 子步 ③（已实现 + 验证）— 修播放漂移
- `PreviewWorkspace` 的 `setInterval(1000/fps)` → **`requestAnimationFrame` 按真实墙钟时间推进**（fractional-frame 累加器，从当前 playhead 实时续推，支持播放中 scrub）。消除定时器节流/固定步长漂移。删除旧 setInterval 与未用的 `fps` 选择器（规则 1）。
- **注**：把 playhead 严格绑定 `<video>` 解码进度的"权威视频时钟"属更彻底 WYSIWYG，归 P2（合成层统一），本步先修墙钟漂移主因。

### P1 验证汇总
`npx vitest run` 51 文件/438 测试全过（新增 16：snapping 8 + group 8）；改动文件 `tsc` 零错误（renderer 总错误数维持基线 6 未新增）；`pnpm build:renderer` 通过。**未提交**（按用户指示）。

### 仍属后续（非本轮）
- 框选 marquee（cross-track 框选）—— shift/⌘ 点选 + 成组拖动已覆盖多选主价值，marquee 为便利项。
- 权威视频时钟（P2）、预览=导出 WYSIWYG（P2）、导出音频/字幕/转场（P3）。
